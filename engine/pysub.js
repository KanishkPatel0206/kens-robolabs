/* ============================================================================
   Ken's RoboLabs v6.2 — ROS 2 Lab: the rclpy-flavoured Python runner
   ----------------------------------------------------------------------------
   A small but real interpreter for the Python subset students write against
   rclpy: imports, classes with inheritance and super(), methods, attributes,
   lists and dicts, if/elif/else, while, for-in, def with defaults, keyword
   arguments, f-strings, %-formatting and the usual operators. It is *parsed*
   (tokenizer + recursive-descent parser) and evaluated — not pattern-matched —
   so the tracebacks point at the line that failed.

   The rclpy -> ROS 2 simulation bridge lives here too: `rclpy.init/spin`,
   `Node.create_publisher/create_subscription/create_timer/create_service`,
   `get_logger`, `declare_parameter` and the message constructors all talk to
   the engine/ros.js graph, so a script that publishes really does deliver to
   subscribers.

   Deliberately NOT a full Python: no generators, comprehensions, closures over
   loop variables, exceptions, decorators or third-party imports beyond the
   message packages and `math`/`time`. Unknown syntax raises a clear error
   instead of pretending.
   ========================================================================== */
const PY = (function () {
  'use strict';

  const NODE = (typeof module !== 'undefined' && module.exports);
  const VERSION = '6.2.0';
  function ros() {
    if (NODE) return require('./ros.js');
    if (typeof ROS2 !== 'undefined' && ROS2) return ROS2;
    if (typeof window !== 'undefined' && window.ROS2) return window.ROS2;
    throw new Error('engine/ros.js (ROS2) must be loaded before engine/pysub.js');
  }

  /* ======================================================================
     0. errors + signals
     ====================================================================== */
  function PyError(message, line) { const e = new Error(message); e.pyline = line; return e; }
  const BREAK = { __signal: 'break' };
  const CONTINUE = { __signal: 'continue' };
  function Return(v) { return { __signal: 'return', value: v }; }

  /* ======================================================================
     1. tokenizer
     ====================================================================== */
  const KEYWORDS = ['and', 'break', 'class', 'continue', 'def', 'elif', 'else', 'False', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'None', 'not', 'or', 'pass', 'return', 'True', 'while'];
  const KW = new Set(KEYWORDS);
  const OPS3 = ['**=', '//=', '=='];
  const OPS2 = ['**', '//', '!=', '<=', '>=', '->', '+=', '-=', '*=', '/=', '%=', '<>'];
  const OPS1 = '+-*/%<>=()[]{},:.'; 

  function tokenize(src) {
    src = String(src).replace(/\r\n?/g, '\n');
    const toks = [];
    const indents = [0];
    let i = 0, line = 1, depth = 0, atLineStart = true;
    const n = src.length;
    const push = (t, v) => toks.push({ t: t, v: v, line: line });
    function readString(quote, triple) {
      const q = quote; let out = '';
      i += triple ? 3 : 1;
      for (;;) {
        if (i >= n) throw PyError('unterminated string starting on line ' + line, line);
        if (src[i] === '\\') {
          const c = src[i + 1]; i += 2;
          out += c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c === '\\' ? '\\' : c === q ? q : c === '"' ? '"' : c === "'" ? "'" : c;
          continue;
        }
        if (triple && src[i] === q && src[i + 1] === q && src[i + 2] === q) { i += 3; return out; }
        if (!triple && src[i] === q) { i += 1; return out; }
        if (src[i] === '\n') { if (!triple) throw PyError('unterminated string on line ' + line, line); line++; }
        out += src[i]; i++;
      }
    }
    while (i < n) {
      if (atLineStart && depth === 0) {
        let j = i, ind = 0;
        while (j < n && (src[j] === ' ' || src[j] === '\t')) { ind += src[j] === '\t' ? 4 : 1; j++; }
        if (j >= n || src[j] === '\n' || src[j] === '#') { while (j < n && src[j] !== '\n') j++; if (j < n) { j++; line++; } i = j; continue; }
        if (ind > indents[indents.length - 1]) { indents.push(ind); push('INDENT'); }
        else while (ind < indents[indents.length - 1]) { indents.pop(); push('DEDENT'); }
        i = j; atLineStart = false; continue;
      }
      const c = src[i];
      if (c === '\n') { if (depth === 0) push('NEWLINE'); line++; i++; atLineStart = (depth === 0); continue; }
      if (c === ' ' || c === '\t') { i++; continue; }
      if (c === '#') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '(' || c === '[' || c === '{') { depth++; push('OP', c); i++; continue; }
      if (c === ')' || c === ']' || c === '}') { if (depth > 0) depth--; push('OP', c); i++; continue; }
      if (c === '"' || c === "'") { push('STRING', readString(c, src[i + 1] === c && src[i + 2] === c)); continue; }
      if ((c === 'f' || c === 'F') && (src[i + 1] === '"' || src[i + 1] === "'")) { const q = src[i + 1]; i++; push('FSTRING', readString(q, src[i + 1] === q && src[i + 2] === q)); continue; }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1]))) {
        let j = i;
        while (j < n && /[0-9.eE]/.test(src[j])) { if ((src[j] === '+' || src[j] === '-') && !/[eE]/.test(src[j - 1])) break; j++; }
        const raw = src.slice(i, j); i = j; push('NUMBER', Number(raw)); continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = i; while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
        push('NAME', src.slice(i, j)); i = j; continue;
      }
      const three = src.substr(i, 3);
      if (OPS3.indexOf(three) >= 0) { push('OP', three); i += 3; continue; }
      const two = src.substr(i, 2);
      if (OPS2.indexOf(two) >= 0) { push('OP', two); i += 2; continue; }
      if (OPS1.indexOf(c) >= 0) { push('OP', c); i++; continue; }
      if (c === '@') { push('OP', '@'); i++; continue; }
      throw PyError("unexpected character '" + c + "'", line);
    }
    if (depth !== 0) throw PyError('unbalanced brackets at end of input', line);
    push('NEWLINE');
    while (indents.length > 1) { indents.pop(); push('DEDENT'); }
    push('EOF');
    return toks;
  }

  /* ======================================================================
     2. parser (recursive descent -> plain AST objects)
     ====================================================================== */
  const BIN = { 'or': 1, 'and': 2, '==': 3, '!=': 3, '<': 3, '<=': 3, '>': 3, '>=': 3, 'in': 3, 'not in': 3, 'is': 3, 'is not': 3, '+': 4, '-': 4, '*': 5, '/': 5, '//': 5, '%': 5, '**': 7 };
  const CMP = { '==': 1, '!=': 1, '<': 1, '<=': 1, '>': 1, '>=': 1, 'in': 1, 'not in': 1, 'is': 1, 'is not': 1 };

  function Parser(toks) {
    this.toks = toks; this.i = 0;
  }
  Parser.prototype.peek = function (k) { return this.toks[this.i + (k || 0)]; };
  Parser.prototype.next = function () { return this.toks[this.i++]; };
  Parser.prototype.at = function (t, v) { const x = this.peek(); return x.t === t && (v === undefined || x.v === v); };
  Parser.prototype.eat = function (t, v) { if (this.at(t, v)) { this.i++; return true; } return false; };
  Parser.prototype.expect = function (t, v) {
    const x = this.peek();
    if (x.t !== t || (v !== undefined && x.v !== v)) throw PyError('expected ' + (v || t) + " but found '" + (x.v != null ? x.v : x.t) + "'", x.line);
    this.i++; return x;
  };
  Parser.prototype.skipNewlines = function () { while (this.at('NEWLINE')) this.i++; };
  Parser.prototype.block = function () {
    if (this.eat('NEWLINE')) { this.expect('INDENT'); const body = []; while (!this.at('DEDENT') && !this.at('EOF')) { this.skipNewlines(); if (this.at('DEDENT') || this.at('EOF')) break; body.push(this.statement()); } this.eat('DEDENT'); return body; }
    return [this.simpleStatement()];
  };
  Parser.prototype.module = function () {
    const body = [];
    this.skipNewlines();
    while (!this.at('EOF')) { body.push(this.statement()); this.skipNewlines(); }
    return { type: 'Module', body: body };
  };
  Parser.prototype.statement = function () {
    const x = this.peek();
    if (x.t === 'OP' && x.v === '@') { while (!this.at('NEWLINE') && !this.at('EOF')) this.i++; this.eat('NEWLINE'); return { type: 'Pass' }; }
    if (x.t === 'NAME') {
      switch (x.v) {
        case 'import': return this.importStmt();
        case 'from': return this.fromStmt();
        case 'class': return this.classDef();
        case 'def': return this.funcDef();
        case 'if': return this.ifStmt();
        case 'while': return this.whileStmt();
        case 'for': return this.forStmt();
        case 'return': { this.i++; let v = null; if (!this.at('NEWLINE')) v = this.testlist(); this.eat('NEWLINE'); return { type: 'Return', value: v }; }
        case 'pass': this.i++; this.eat('NEWLINE'); return { type: 'Pass' };
        case 'break': this.i++; this.eat('NEWLINE'); return { type: 'Break' };
        case 'continue': this.i++; this.eat('NEWLINE'); return { type: 'Continue' };
        case 'global': { this.i++; const names = []; while (this.at('NAME')) { names.push(this.next().v); this.eat('OP', ','); } this.eat('NEWLINE'); return { type: 'Global', names: names }; }
      }
    }
    return this.simpleStatement();
  };
  Parser.prototype.dotted = function () { let s = this.expect('NAME').v; while (this.at('OP', '.')) { this.i++; s += '.' + this.expect('NAME').v; } return s; };
  Parser.prototype.importStmt = function () {
    this.i++; const names = [];
    do { const d = this.dotted(); let as = null; if (this.at('NAME', 'as')) { this.i++; as = this.expect('NAME').v; } names.push({ path: d, as: as || d.split('.')[0] }); } while (this.eat('OP', ','));
    this.eat('NEWLINE'); return { type: 'Import', names: names };
  };
  Parser.prototype.fromStmt = function () {
    this.i++; const path = this.dotted();
    this.expect('NAME', 'import'); const names = [];
    if (this.eat('OP', '*')) names.push({ name: '*' });
    else if (this.eat('OP', '(')) { while (!this.at('OP', ')')) { names.push(this.importName()); this.eat('OP', ','); } this.expect('OP', ')'); }
    else { do { names.push(this.importName()); } while (this.eat('OP', ',')); }
    this.eat('NEWLINE'); return { type: 'FromImport', path: path, names: names };
  };
  Parser.prototype.importName = function () { const nm = this.expect('NAME').v; let as = null; if (this.at('NAME', 'as')) { this.i++; as = this.expect('NAME').v; } return { name: nm, as: as || nm }; };
  Parser.prototype.classDef = function () {
    this.i++; const name = this.expect('NAME').v; const bases = [];
    if (this.eat('OP', '(')) { while (!this.at('OP', ')')) { if (this.eat('OP', '*')) this.eat('OP', '*'); bases.push(this.expr()); this.eat('OP', ','); } this.expect('OP', ')'); }
    this.expect('OP', ':'); const body = this.block();
    return { type: 'ClassDef', name: name, bases: bases, body: body };
  };
  Parser.prototype.params = function () {
    const ps = [];
    if (this.eat('OP', ')')) return ps;
    do {
      if (this.eat('OP', '*') || this.eat('OP', '**')) { ps.push({ name: this.expect('NAME').v, star: true }); continue; }
      const name = this.expect('NAME').v;
      if (this.eat('OP', ':')) this.expr(); // ignore annotation
      let def = null;
      if (this.eat('OP', '=')) def = this.expr();
      ps.push({ name: name, def: def });
    } while (this.eat('OP', ','));
    this.expect('OP', ')'); return ps;
  };
  Parser.prototype.funcDef = function () {
    this.i++; const name = this.expect('NAME').v; this.expect('OP', '('); const params = this.params();
    if (this.eat('OP', '->')) this.expr();
    this.expect('OP', ':'); const body = this.block();
    return { type: 'FuncDef', name: name, params: params, body: body };
  };
  Parser.prototype.ifStmt = function () {
    const branches = [];
    this.i++; const test = this.expr(); this.expect('OP', ':'); branches.push({ test: test, body: this.block() });
    while (this.at('NAME', 'elif')) { this.i++; const t = this.expr(); this.expect('OP', ':'); branches.push({ test: t, body: this.block() }); }
    let orelse = null;
    if (this.at('NAME', 'else')) { this.i++; this.expect('OP', ':'); orelse = this.block(); }
    return { type: 'If', branches: branches, orelse: orelse };
  };
  Parser.prototype.whileStmt = function () { this.i++; const test = this.expr(); this.expect('OP', ':'); return { type: 'While', test: test, body: this.block() }; };
  Parser.prototype.forStmt = function () { this.i++; const target = this.targetList(); this.expect('NAME', 'in'); const iter = this.testlist(); this.expect('OP', ':'); return { type: 'For', target: target, iter: iter, body: this.block() }; };
  Parser.prototype.targetItem = function () {
    if (this.at('OP', '(')) { this.i++; const items = []; while (!this.at('OP', ')')) { items.push(this.targetItem()); this.eat('OP', ','); } this.expect('OP', ')'); return { type: 'Tuple', items: items }; }
    if (this.at('OP', '[')) { this.i++; const items = []; while (!this.at('OP', ']')) { items.push(this.targetItem()); this.eat('OP', ','); } this.expect('OP', ']'); return { type: 'List', items: items }; }
    return { type: 'Name', id: this.expect('NAME').v };
  };
  Parser.prototype.targetList = function () {
    const first = this.targetItem();
    if (!this.at('OP', ',')) return first;
    const items = [first];
    while (this.eat('OP', ',')) { if (this.at('NAME', 'in')) break; items.push(this.targetItem()); }
    return { type: 'Tuple', items: items };
  };
  Parser.prototype.testlist = function () {
    const first = this.expr();
    if (!this.at('OP', ',')) return first;
    const items = [first];
    while (this.eat('OP', ',')) { if (this.at('NEWLINE') || this.at('OP', ')') || this.at('OP', ']')) break; items.push(this.expr()); }
    return { type: 'Tuple', items: items };
  };
  const AUG = ['+=', '-=', '*=', '/=', '%=', '**=', '//='];
  Parser.prototype.simpleStatement = function () {
    const first = this.testlist();
    const op = this.peek();
    if (op.t === 'OP' && (op.v === '=' || AUG.indexOf(op.v) >= 0)) {
      if (AUG.indexOf(op.v) >= 0) { this.i++; const value = this.testlist(); this.eat('NEWLINE'); return { type: 'AugAssign', target: first, op: op.v.slice(0, -1), value: value }; }
      const targets = [first];
      let value = null;
      while (this.eat('OP', '=')) { const rhs = this.testlist(); targets.push(rhs); }
      value = targets.pop();
      this.eat('NEWLINE'); return { type: 'Assign', targets: targets, value: value };
    }
    this.eat('NEWLINE');
    return { type: 'ExprStmt', value: first };
  };
  Parser.prototype.expr = function (min) {
    min = min || 0;
    let left = this.unary();
    for (;;) {
      const op = this.binOp();
      if (!op) break;
      const p = BIN[op];
      if (p < min) break;
      this.i += op.indexOf(' ') >= 0 ? 2 : 1;
      const right = this.expr(op === '**' ? p : p + 1);
      left = { type: 'BinOp', op: op, left: left, right: right };
    }
    return left;
  };
  Parser.prototype.binOp = function () {
    const x = this.peek();
    if (x.t === 'OP' && BIN[x.v] != null && x.v !== '=') return x.v;
    if (x.t === 'NAME') {
      if (x.v === 'and' || x.v === 'or' || x.v === 'in' || x.v === 'is') return x.v;
      if (x.v === 'not' && this.peek(1) && this.peek(1).t === 'NAME' && this.peek(1).v === 'in') return 'not in';
      if (x.v === 'is' && this.peek(1) && this.peek(1).t === 'NAME' && this.peek(1).v === 'not') return 'is not';
    }
    return null;
  };
  Parser.prototype.unary = function () {
    const x = this.peek();
    if (x.t === 'OP' && (x.v === '-' || x.v === '+' || x.v === '~')) { this.i++; return { type: 'UnaryOp', op: x.v, value: this.unary() }; }
    if (x.t === 'NAME' && x.v === 'not') { this.i++; return { type: 'UnaryOp', op: 'not', value: this.unary() }; }
    return this.postfix(this.atom());
  };
  Parser.prototype.postfix = function (node) {
    for (;;) {
      if (this.at('OP', '.')) { this.i++; node = { type: 'Attribute', obj: node, attr: this.expect('NAME').v }; }
      else if (this.at('OP', '[')) { this.i++; const idx = this.expr(); this.expect('OP', ']'); node = { type: 'Subscript', obj: node, index: idx }; }
      else if (this.at('OP', '(')) { this.i++; const args = [], kwargs = []; while (!this.at('OP', ')')) { if (this.eat('OP', '*')) { args.push(this.expr()); this.eat('OP', ','); continue; } if (this.eat('OP', '**')) { kwargs.push({ name: null, value: this.expr() }); this.eat('OP', ','); continue; } const e = this.expr(); if (this.at('OP', '=') && e.type === 'Name') { this.i++; kwargs.push({ name: e.id, value: this.expr() }); } else args.push(e); this.eat('OP', ','); } this.expect('OP', ')'); node = { type: 'Call', func: node, args: args, kwargs: kwargs }; }
      else break;
    }
    return node;
  };
  Parser.prototype.atom = function () {
    const x = this.peek();
    if (x.t === 'NUMBER') { this.i++; return { type: 'Num', value: x.v }; }
    if (x.t === 'STRING') { this.i++; return { type: 'Str', value: x.v }; }
    if (x.t === 'FSTRING') { this.i++; return { type: 'FStr', value: x.v, line: x.line }; }
    if (x.t === 'NAME') {
      this.i++;
      if (x.v === 'True') return { type: 'Const', value: true };
      if (x.v === 'False') return { type: 'Const', value: false };
      if (x.v === 'None') return { type: 'Const', value: null };
      if (KW.has(x.v)) throw PyError("unexpected keyword '" + x.v + "'", x.line);
      return { type: 'Name', id: x.v };
    }
    if (x.t === 'OP' && x.v === '(') {
      this.i++; if (this.at('OP', ')')) { this.i++; return { type: 'Tuple', items: [] }; }
      const first = this.expr();
      if (this.at('OP', ',')) { const items = [first]; while (this.eat('OP', ',')) { if (this.at('OP', ')')) break; items.push(this.expr()); } this.expect('OP', ')'); return { type: 'Tuple', items: items }; }
      this.expect('OP', ')'); return first;
    }
    if (x.t === 'OP' && x.v === '[') { this.i++; const items = []; while (!this.at('OP', ']')) { items.push(this.expr()); this.eat('OP', ','); } this.expect('OP', ']'); return { type: 'List', items: items }; }
    if (x.t === 'OP' && x.v === '{') { this.i++; const pairs = []; while (!this.at('OP', '}')) { const k = this.expr(); this.expect('OP', ':'); const v = this.expr(); pairs.push([k, v]); this.eat('OP', ','); } this.expect('OP', '}'); return { type: 'Dict', pairs: pairs }; }
    throw PyError("unexpected token '" + (x.v != null ? x.v : x.t) + "'", x.line);
  };

  /* ======================================================================
     3. runtime values
     ====================================================================== */
  function Env(parent) { this.vars = new Map(); this.parent = parent || null; }
  Env.prototype.get = function (name) { let e = this; while (e) { if (e.vars.has(name)) return e.vars.get(name); e = e.parent; } throw PyError("name '" + name + "' is not defined"); };
  Env.prototype.has = function (name) { let e = this; while (e) { if (e.vars.has(name)) return true; e = e.parent; } return false; };
  Env.prototype.set = function (name, v) { let e = this; while (e) { if (e.vars.has(name)) { e.vars.set(name, v); return; } e = e.parent; } this.vars.set(name, v); };
  Env.prototype.define = function (name, v) { this.vars.set(name, v); };

  function PyTuple(items) { this.__tuple = true; this.items = items || []; }
  function PyFunc(name, params, body, closure, owner) { this.__fn = true; this.name = name; this.params = params; this.body = body; this.closure = closure; this.owner = owner || null; }
  function PyClass(name, base) { this.__class = true; this.name = name; this.base = base || null; this.methods = new Map(); this.attrs = new Map(); this.native = false; }
  function PyInstance(cls) { this.__inst = true; this.cls = cls; this.attrs = new Map(); }
  function PyModule(name) { this.__module = true; this.name = name; this.attrs = new Map(); }

  function isTruthy(v) { if (v === null || v === undefined || v === false) return false; if (v === 0 || v === '') return false; if (typeof v === 'object' && (v.__tuple || Array.isArray(v))) return v.items ? v.items.length > 0 : v.length > 0; if (typeof v === 'object' && v.__dict) return v.map.size > 0; return true; }

  function pyType(v) {
    if (v === null || v === undefined) return 'NoneType';
    if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
    if (typeof v === 'boolean') return 'bool';
    if (typeof v === 'string') return 'str';
    if (Array.isArray(v)) return 'list';
    if (v.__tuple) return 'tuple';
    if (v.__dict) return 'dict';
    if (v.__fn) return 'function';
    if (v.__class) return 'type';
    if (v.__inst) return v.cls.name;
    if (v.__module) return 'module';
    if (v.__bound) return 'method';
    return 'object';
  }
  function repr(v, seen) {
    seen = seen || [];
    if (v === null || v === undefined) return 'None';
    if (typeof v === 'boolean') return v ? 'True' : 'False';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
    if (typeof v === 'string') return seen.__inPrint ? v : "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
    if (Array.isArray(v)) return '[' + v.map((x) => repr(x)).join(', ') + ']';
    if (v.__tuple) return '(' + v.items.map((x) => repr(x)).join(', ') + (v.items.length === 1 ? ',' : '') + ')';
    if (v.__dict) { const parts = []; v.map.forEach((val, k) => parts.push(repr(k) + ': ' + repr(val))); return '{' + parts.join(', ') + '}'; }
    if (v.__fn) return '<function ' + v.name + '>';
    if (v.__class) return "<class '" + v.name + "'>";
    if (v.__inst) return '<' + v.cls.name + ' object>';
    if (v.__module) return "<module '" + v.name + "'>";
    if (v.__bound) return '<bound method ' + v.fn.name + '>';
    if (v.__type) { const o = {}; for (const k in v) o[k] = v[k]; return 'msg(' + v.__type + ')' + JSON.stringify(o); }
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }
  function str(v) {
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return '[' + v.map((x) => (typeof x === 'string' ? "'" + x + "'" : repr(x))).join(', ') + ']';
    if (v && v.__tuple) return '(' + v.items.map((x) => (typeof x === 'string' ? "'" + x + "'" : repr(x))).join(', ') + ')';
    return repr(v);
  }

  /* ======================================================================
     4. the interpreter
     ====================================================================== */
  function Interp(opts) {
    opts = opts || {};
    this.ros = ros();
    this.graph = opts.graph || new this.ros.Graph();
    this.out = [];
    this.globals = new Env(null);
    this.host = {
      print: (opts.print || ((s) => this.out.push(s))).bind(this),
      log: (level, node, msg) => this.out.push('[' + level.toUpperCase() + '] [' + node + ']: ' + msg),
      spinSeconds: opts.spinSeconds == null ? 2.0 : opts.spinSeconds,
      dt: opts.dt || 0.05,
    };
    this.installBuiltins();
    this.installModules();
  }
  Interp.prototype.installBuiltins = function () {
    const g = this.globals;
    const def = (n, f) => g.define(n, f);
    def('print', (...a) => { this.host.print(a.map((x) => str(x)).join(' ')); return null; });
    def('len', (o) => { if (typeof o === 'string') return o.length; if (Array.isArray(o)) return o.length; if (o && o.__tuple) return o.items.length; if (o && o.__dict) return o.map.size; throw PyError('object has no len()'); });
    def('range', (...a) => { let start = 0, stop = 0, step = 1; if (a.length === 1) { stop = a[0]; } else { start = a[0]; stop = a[1]; if (a.length > 2) step = a[2]; } const out = []; for (let v = start; step > 0 ? v < stop : v > stop; v += step) out.push(v); return out; });
    def('str', (v) => (v === undefined ? '' : str(v)));
    def('repr', (v) => repr(v));
    def('int', (v) => Math.trunc(Number(v) || 0));
    def('float', (v) => Number(v) || 0);
    def('bool', (v) => isTruthy(v));
    def('abs', (v) => Math.abs(v));
    def('round', (v, n) => { const f = Math.pow(10, n || 0); return Math.round(v * f) / f; });
    def('min', (...a) => { const arr = a.length === 1 && Array.isArray(a[0]) ? a[0] : a; return Math.min.apply(null, arr); });
    def('max', (...a) => { const arr = a.length === 1 && Array.isArray(a[0]) ? a[0] : a; return Math.max.apply(null, arr); });
    def('sum', (a) => a.reduce((s, x) => s + x, 0));
    def('list', (a) => (a == null ? [] : (Array.isArray(a) ? a.slice() : Array.from(a))));
    def('tuple', (a) => new PyTuple(a ? (Array.isArray(a) ? a.slice() : Array.from(a)) : []));
    def('dict', () => { const d = { __dict: true, map: new Map() }; return d; });
    def('enumerate', (a) => (Array.isArray(a) ? a : Array.from(a || [])).map((x, i) => new PyTuple([i, x])));
    def('sorted', (a) => (Array.isArray(a) ? a.slice() : Array.from(a || [])).sort((x, y) => (x > y ? 1 : x < y ? -1 : 0)));
    def('type', (v) => ({ __class: true, name: pyType(v), native: true, methods: new Map(), attrs: new Map() }));
    def('isinstance', (v, c) => { if (!c || !c.__class) return false; if (Array.isArray(v)) return c.name === 'list'; if (v && v.__inst) { let k = v.cls; while (k) { if (k === c || k.name === c.name) return true; k = k.base; } } return pyType(v) === c.name; });
    def('super', () => { throw PyError('super() may only be used inside a method'); });
  };
  Interp.prototype.installModules = function () {
    const self = this;
    const mods = {};
    // every module node is a plain object carrying a Map of its attributes
    function makeMod() { return { __module: true, attrs: new Map() }; }
    function ensure(path) {
      const parts = String(path).split('.');
      let cur = mods;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (!Object.prototype.hasOwnProperty.call(cur, p) || !cur[p] || typeof cur[p] !== 'object') { cur[p] = makeMod(); if (cur.attrs) cur.attrs.set(p, cur[p]); }
        else if (!cur[p].__module) { cur[p].__module = true; if (!cur[p].attrs) cur[p].attrs = new Map(); }
        cur = cur[p];
      }
      return cur;
    }
    const expose = (node, name, value) => { node.attrs.set(name, value); return value; };

    // --- message packages: each type becomes a constructor class object ---
    const PKGS = { std_msgs: ['String', 'Bool', 'Int32', 'Int64', 'Float64'], geometry_msgs: ['Vector3', 'Point', 'Quaternion', 'Pose', 'PoseStamped', 'Twist', 'Transform', 'TransformStamped'], sensor_msgs: ['JointState'], trajectory_msgs: ['JointTrajectory', 'JointTrajectoryPoint'], control_msgs: ['FollowJointTrajectoryGoal'], rosgraph_msgs: ['Clock'], builtin_interfaces: ['Time', 'Duration'] };
    Object.keys(PKGS).forEach((pkg) => {
      ensure(pkg);
      const msgMod = ensure(pkg + '.msg');
      PKGS[pkg].forEach((nm) => {
        const full = pkg + '/' + nm;
        expose(msgMod, nm, { __class: true, __msgcall: full, name: nm, methods: new Map(), attrs: new Map() });
      });
    });

    // --- math ---
    const m = ensure('math');
    expose(m, 'pi', Math.PI); expose(m, 'e', Math.E);
    ['sin', 'cos', 'tan', 'atan2', 'sqrt', 'floor', 'ceil', 'exp', 'log'].forEach((f) => expose(m, f, Math[f]));
    expose(m, 'fabs', Math.abs);
    expose(m, 'radians', (d) => (d * Math.PI) / 180);
    expose(m, 'degrees', (r) => (r * 180) / Math.PI);

    // --- time ---
    const t = ensure('time');
    expose(t, 'sleep', (s) => { self.graph.t += Math.max(0, Number(s) || 0); return null; });
    expose(t, 'time', () => self.graph.t);

    // --- rclpy.clock ---
    const tc = ensure('rclpy.clock');
    expose(tc, 'Clock', { __class: true, name: 'Clock', methods: new Map([['now', function (slf) { return { sec: Math.floor(self.graph.t), nanosec: Math.round((self.graph.t % 1) * 1e9) }; }]]), attrs: new Map() });

    this.__mods = mods;
    this.__ns = mods;
  };

  /* ======================================================================
     5. attribute access / calls
     ====================================================================== */
  const LIST_METHODS = {
    append(self, x) { self.push(x); return null; },
    extend(self, xs) { (Array.isArray(xs) ? xs : Array.from(xs || [])).forEach((x) => self.push(x)); return null; },
    insert(self, i, x) { self.splice(i, 0, x); return null; },
    remove(self, x) { const i = self.indexOf(x); if (i >= 0) self.splice(i, 1); return null; },
    pop(self, i) { return i == null ? self.pop() : self.splice(i, 1)[0]; },
    clear(self) { self.length = 0; return null; },
    index(self, x) { return self.indexOf(x); },
    count(self, x) { return self.filter((v) => v === x).length; },
    sort(self) { self.sort((a, b) => (a > b ? 1 : a < b ? -1 : 0)); return null; },
    reverse(self) { self.reverse(); return null; },
  };
  const STR_METHODS = {
    split(self, sep) { return sep === undefined ? self.split(/\s+/).filter((s) => s !== '') : self.split(sep); },
    join(self, xs) { return (Array.isArray(xs) ? xs : Array.from(xs || [])).map(String).join(self); },
    strip(self) { return self.trim(); },
    lstrip(self) { return self.replace(/^\s+/, ''); },
    rstrip(self) { return self.replace(/\s+$/, ''); },
    upper(self) { return self.toUpperCase(); },
    lower(self) { return self.toLowerCase(); },
    replace(self, a, b) { return self.split(a).join(b); },
    startswith(self, p) { return self.indexOf(p) === 0; },
    endswith(self, p) { return self.slice(-p.length) === p; },
    format(self, ...a) { let i = 0; return self.replace(/\{\}/g, () => str(a[i++])); },
    find(self, p) { return self.indexOf(p); },
    count(self, p) { return self.split(p).length - 1; },
  };
  const DICT_METHODS = {
    get(self, k, d) { return self.map.has(k) ? self.map.get(k) : (d === undefined ? null : d); },
    keys(self) { return Array.from(self.map.keys()); },
    values(self) { return Array.from(self.map.values()); },
    items(self) { return Array.from(self.map.entries()).map(([k, v]) => new PyTuple([k, v])); },
    update(self, other) { if (other && other.__dict) other.map.forEach((v, k) => self.map.set(k, v)); return null; },
    pop(self, k, d) { if (self.map.has(k)) { const v = self.map.get(k); self.map.delete(k); return v; } return d === undefined ? null : d; },
    clear(self) { self.map.clear(); return null; },
  };

  Interp.prototype.getAttr = function (obj, name) {
    if (obj === null || obj === undefined) throw PyError("'NoneType' object has no attribute '" + name + "'");
    if (typeof obj === 'string') { if (STR_METHODS[name]) return this.bindMethod(STR_METHODS[name], obj); throw PyError("'str' object has no attribute '" + name + "'"); }
    if (Array.isArray(obj)) { if (LIST_METHODS[name]) return this.bindMethod(LIST_METHODS[name], obj); if (name === 'len') return obj.length; throw PyError("'list' object has no attribute '" + name + "'"); }
    if (obj.__bound) { if (name === 'func') return obj.fn; throw PyError('bound method has no attribute ' + name); }
    if (obj.__super) {
      let k = obj.cls.base;
      while (k) { if (k.methods.has(name)) return this.bindMethod(k.methods.get(name), obj.self, k); k = k.base; }
      throw PyError("'super' object has no attribute '" + name + "'");
    }
    if (obj.__dict) { if (DICT_METHODS[name]) return this.bindMethod(DICT_METHODS[name], obj); throw PyError("'dict' object has no attribute '" + name + "'"); }
    if (obj.__module) { if (obj.attrs && obj.attrs.has(name)) return obj.attrs.get(name); return obj[name] !== undefined ? obj[name] : (() => { throw PyError("module has no attribute '" + name + "'"); })(); }
    if (obj.__inst) {
      if (obj.attrs.has(name)) return obj.attrs.get(name);
      let k = obj.cls;
      while (k) { if (k.methods.has(name)) return this.bindMethod(k.methods.get(name), obj, k); if (k.attrs && k.attrs.has(name)) return k.attrs.get(name); k = k.base; }
      throw PyError("'" + obj.cls.name + "' object has no attribute '" + name + "'");
    }
    if (obj.__class) {
      if (obj.methods.has(name)) return this.bindMethod(obj.methods.get(name), null, obj);
      if (obj.attrs.has(name)) return obj.attrs.get(name);
      if (name === '__name__') return obj.name;
      throw PyError("type object '" + obj.name + "' has no attribute '" + name + "'");
    }
    if (obj.__tuple) { if (name === 'index') return this.bindMethod((self, x) => self.items.indexOf(x), obj); if (name === 'count') return this.bindMethod((self, x) => self.items.filter((v) => v === x).length, obj); throw PyError("'tuple' object has no attribute '" + name + "'"); }
    // plain message / generic object
    if (Object.prototype.hasOwnProperty.call(obj, name)) return obj[name];
    if (name in obj) return obj[name];
    throw PyError("object has no attribute '" + name + "'");
  };
  Interp.prototype.bindMethod = function (fn, self, owner) {
    const interp = this;
    return { __bound: true, fn: fn, self: self, owner: owner || null, call: function (args, kwargs) { return interp.callValue(this.fn, [this.self].concat(args), kwargs, this.owner); } };
  };
  Interp.prototype.setAttr = function (obj, name, value) {
    if (obj && obj.__inst) { obj.attrs.set(name, value); return; }
    if (obj && (obj.__module)) { if (!obj.attrs) obj.attrs = new Map(); obj.attrs.set(name, value); return; }
    if (obj && typeof obj === 'object') { obj[name] = value; return; }
    throw PyError('cannot set attribute on ' + pyType(obj));
  };

  /* ======================================================================
     6. evaluation
     ====================================================================== */
  Interp.prototype.exec = function (node, env) {
    switch (node.type) {
      case 'Module': { node.body.forEach((s) => this.exec(s, env)); return null; }
      case 'Pass': return null;
      case 'ExprStmt': return this.eval(node.value, env);
      case 'Import': { node.names.forEach((n) => { const m = this.resolveModule(n.path, node.line); env.define(n.as, m); }); return null; }
      case 'FromImport': {
        const m = this.resolveModule(node.path, node.line);
        node.names.forEach((n) => { if (n.name === '*') { if (m.__module && m.attrs) m.attrs.forEach((v, k) => env.define(k, v)); else if (m && m.attrs) m.attrs.forEach((v, k) => env.define(k, v)); return; } const v = this.getAttr(m, n.name); env.define(n.as, v); });
        return null;
      }
      case 'ClassDef': return this.execClass(node, env);
      case 'FuncDef': { const f = new PyFunc(node.name, node.params, node.body, env, null); env.define(node.name, f); return null; }
      case 'Return': throw Return(node.value ? this.eval(node.value, env) : null);
      case 'Break': throw BREAK;
      case 'Continue': throw CONTINUE;
      case 'Global': node.names.forEach((n) => { if (!env.vars.has(n)) env.define(n, null); }); return null;
      case 'If': {
        for (const b of node.branches) if (isTruthy(this.eval(b.test, env))) { b.body.forEach((s) => this.exec(s, env)); return null; }
        if (node.orelse) node.orelse.forEach((s) => this.exec(s, env));
        return null;
      }
      case 'While': {
        let guard = 0; while (isTruthy(this.eval(node.test, env))) { if (guard++ > 100000) throw PyError('while loop exceeded 100000 iterations'); try { node.body.forEach((s) => this.exec(s, env)); } catch (e) { if (e === BREAK) break; if (e === CONTINUE) continue; throw e; } }
        return null;
      }
      case 'For': {
        const it = this.eval(node.iter, env); const list = this.iterate(it);
        for (let i = 0; i < list.length; i++) { this.assign(node.target, list[i], env); try { node.body.forEach((s) => this.exec(s, env)); } catch (e) { if (e === BREAK) break; if (e === CONTINUE) continue; throw e; } }
        return null;
      }
      case 'Assign': { const v = this.eval(node.value, env); node.targets.forEach((t) => this.assign(t, v, env)); return null; }
      case 'AugAssign': {
        const cur = this.eval(node.target, env); const rhs = this.eval(node.value, env);
        const nv = this.binop(node.op, cur, rhs, node.line);
        this.assign(node.target, nv, env); return null;
      }
      default: throw PyError('unsupported statement: ' + node.type);
    }
  };
  Interp.prototype.iterate = function (v) {
    if (Array.isArray(v)) return v.slice();
    if (v && v.__tuple) return v.items.slice();
    if (typeof v === 'string') return v.split('');
    if (v && v.__dict) return Array.from(v.map.keys());
    if (v && v.map && typeof v.map.entries === 'function') return Array.from(v.map.keys());
    throw PyError('object of type ' + pyType(v) + ' is not iterable');
  };
  Interp.prototype.assign = function (target, value, env) {
    if (target.type === 'Name') { env.set(target.id, value); return; }
    if (target.type === 'Tuple' || target.type === 'List') {
      const items = Array.isArray(value) ? value : (value && value.__tuple ? value.items : null);
      if (!items) throw PyError('cannot unpack a non-sequence');
      if (items.length !== target.items.length) throw PyError('unpack: expected ' + target.items.length + ' values, got ' + items.length);
      target.items.forEach((t, i) => this.assign(t, items[i], env)); return;
    }
    if (target.type === 'Attribute') { const o = this.eval(target.obj, env); this.setAttr(o, target.attr, value); return; }
    if (target.type === 'Subscript') { const o = this.eval(target.obj, env); const idx = this.eval(target.index, env); if (Array.isArray(o)) { o[idx] = value; return; } if (o && o.__dict) { o.map.set(idx, value); return; } if (o && typeof o === 'object') { o[idx] = value; return; } throw PyError('cannot assign to subscript'); }
    throw PyError('cannot assign to ' + target.type);
  };
  Interp.prototype.eval = function (node, env) {
    switch (node.type) {
      case 'Num': return node.value;
      case 'Str': return node.value;
      case 'FStr': return this.evalFString(node.value, env, node.line);
      case 'Const': return node.value;
      case 'Name': return env.get(node.id);
      case 'Tuple': return new PyTuple(node.items.map((x) => this.eval(x, env)));
      case 'List': return node.items.map((x) => this.eval(x, env));
      case 'Dict': { const d = { __dict: true, map: new Map() }; node.pairs.forEach(([k, v]) => d.map.set(this.eval(k, env), this.eval(v, env))); return d; }
      case 'Attribute': { const o = this.eval(node.obj, env); return this.getAttr(o, node.attr); }
      case 'Subscript': { const o = this.eval(node.obj, env); const i = this.eval(node.index, env); return this.subscript(o, i); }
      case 'BinOp': return this.binop(node.op, this.eval(node.left, env), this.eval(node.right, env), node.line);
      case 'UnaryOp': { const v = this.eval(node.value, env); return node.op === '-' ? -v : node.op === '+' ? +v : node.op === 'not' ? !isTruthy(v) : ~v; }
      case 'Call': {
        const args = node.args.map((a) => this.eval(a, env));
        const kwargs = {}; node.kwargs.forEach((k) => { if (k.name) kwargs[k.name] = this.eval(k.value, env); });
        return this.evalCall(node.func, args, kwargs, env);
      }
      case 'Tuple_target': return null;
      default: throw PyError('unsupported expression: ' + node.type);
    }
  };
  Interp.prototype.evalCall = function (funcNode, args, kwargs, env) {
    // super()
    if (funcNode.type === 'Name' && funcNode.id === 'super') {
      const self = env.get('self'); const cls = env.get('__class__');
      if (!self || !cls) throw PyError('super() outside a method');
      return { __super: true, self: self, cls: cls };
    }
    const fn = this.eval(funcNode, env);
    return this.callValue(fn, args, kwargs, null);
  };
  Interp.prototype.callValue = function (fn, args, kwargs, owner) {
    if (fn === null || fn === undefined) throw PyError('calling a non-callable');
    if (fn.__bound) return this.callValue(fn.fn, [fn.self].concat(args), kwargs, fn.owner);
    if (fn.__fn) return this.callUserFunction(fn, args, kwargs);
    if (fn.__super) {
      const m = (function () { let k = fn.cls.base; while (k) { if (k.methods.has('__init__')) return k.methods.get('__init__'); k = k.base; } return null; })();
      if (!m) return null;
      return this.callValue(m, [fn.self].concat(args), kwargs, fn.cls.base);
    }
    if (fn.__class) {
      if (fn.__msgcall) return this.ros.create(fn.__msgcall, kwargs);
      const inst = new PyInstance(fn);
      let k = fn;
      while (k) { if (k.methods.has('__init__')) { this.callValue(k.methods.get('__init__'), [inst].concat(args), kwargs, k); break; } k = k.base; }
      return inst;
    }
    if (typeof fn === 'function') return fn.apply(null, args);
    throw PyError('object of type ' + pyType(fn) + ' is not callable');
  };
  Interp.prototype.callUserFunction = function (f, args, kwargs) {
    const env = new Env(f.closure);
    if (f.owner) env.define('__class__', f.owner);
    let ai = 0;
    const params = f.params.filter((p) => !p.star);
    for (const p of params) {
      if (ai < args.length) { env.define(p.name, args[ai++]); }
      else if (kwargs[p.name] !== undefined) { env.define(p.name, kwargs[p.name]); }
      else if (p.def) env.define(p.name, this.eval(p.def, env));
      else env.define(p.name, null);
    }
    let res;
    try { f.body.forEach((s) => this.exec(s, env)); }
    catch (e) { if (e && e.__signal === 'return') return e.value; throw e; }
    return null;
  };
  Interp.prototype.execClass = function (node, env) {
    let base = null;
    if (node.bases.length) base = this.eval(node.bases[0], env);
    if (base && base.__msgcall) base = null; // a message type is not a usable base here
    const cls = new PyClass(node.name, base && base.__class ? base : null);
    const cenv = new Env(env);
    cenv.define('__class__', cls);
    node.body.forEach((s) => {
      if (s.type === 'FuncDef') { const f = new PyFunc(s.name, s.params, s.body, env, cls); cls.methods.set(s.name, f); }
      else if (s.type === 'Assign') { const v = this.eval(s.value, cenv); s.targets.forEach((t) => { if (t.type === 'Name') cls.attrs.set(t.id, v); }); }
      else if (s.type === 'Pass') { /* nothing */ }
      else this.exec(s, cenv);
    });
    env.define(node.name, cls);
    return null;
  };
  Interp.prototype.subscript = function (o, i) {
    if (typeof o === 'string') return o[i];
    if (Array.isArray(o)) { if (i < 0) i = o.length + i; return o[i]; }
    if (o && o.__tuple) return o.items[i];
    if (o && o.__dict) return o.map.has(i) ? o.map.get(i) : null;
    if (o && typeof o === 'object') return o[i];
    throw PyError('object is not subscriptable');
  };
  Interp.prototype.binop = function (op, a, b, line) {
    if (op === 'and') return isTruthy(a) ? b : a;
    if (op === 'or') return isTruthy(a) ? a : b;
    if (op === '+') { if (typeof a === 'string' && typeof b === 'string') return a + b; if (Array.isArray(a) && Array.isArray(b)) return a.concat(b); return a + b; }
    if (op === '-') return a - b;
    if (op === '*') { if (typeof a === 'string' && typeof b === 'number') return a.repeat(b); if (typeof b === 'string' && typeof a === 'number') return b.repeat(a); if (Array.isArray(a) && typeof b === 'number') { const o = []; for (let i = 0; i < b; i++) o.push.apply(o, a); return o; } return a * b; }
    if (op === '/') return a / b;
    if (op === '//') return Math.floor(a / b);
    if (op === '%') { if (typeof a === 'string') return this.formatPercent(a, b); return ((a % b) + b) % b; }
    if (op === '**') return Math.pow(a, b);
    if (op === '==') return this.eq(a, b);
    if (op === '!=') return !this.eq(a, b);
    if (op === '<') return a < b;
    if (op === '<=') return a <= b;
    if (op === '>') return a > b;
    if (op === '>=') return a >= b;
    if (op === 'in') return this.contains(b, a);
    if (op === 'not in') return !this.contains(b, a);
    if (op === 'is') return a === b;
    if (op === 'is not') return a !== b;
    throw PyError('unsupported operator ' + op, line);
  };
  Interp.prototype.eq = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
  Interp.prototype.contains = function (container, item) {
    if (typeof container === 'string') return container.indexOf(item) >= 0;
    if (Array.isArray(container)) return container.some((x) => this.eq(x, item));
    if (container && container.__tuple) return container.items.some((x) => this.eq(x, item));
    if (container && container.__dict) return container.map.has(item);
    return false;
  };
  Interp.prototype.formatPercent = function (fmt, args) {
    const list = args && args.__tuple ? args.items : Array.isArray(args) ? args : [args];
    let idx = 0;
    return fmt.replace(/%[%sdifx]|%\.\d+[f]/g, (m) => {
      if (m === '%%') return '%';
      const v = list[idx++];
      if (m === '%s') return str(v);
      if (m === '%d' || m === '%i') return String(Math.trunc(Number(v)));
      if (m === '%f') return Number(v).toFixed(6);
      if (m === '%x') return Math.trunc(Number(v)).toString(16);
      const p = m.match(/^%\.(\d+)f$/); if (p) return Number(v).toFixed(Number(p[1]));
      return m;
    });
  };
  Interp.prototype.evalFString = function (raw, env, line) {
    const interp = this;
    return raw.replace(/\{\{|\}\}|\{([^}]+)\}/g, (m, expr) => {
      if (m === '{{') return '{';
      if (m === '}}') return '}';
      const toks = tokenize(expr);
      const p = new Parser(toks);
      const ast = p.expr();
      return str(interp.eval(ast, env));
    });
  };
  Interp.prototype.resolveModule = function (path, line) {
    const m = this.__ns;
    const parts = path.split('.');
    let cur = m;
    for (const p of parts) { if (!cur || cur[p] === undefined) throw PyError("No module named '" + path + "'", line); cur = cur[p]; }
    // materialise as a PyModule-like for attribute access
    if (!cur.__module && typeof cur === 'object') { cur.__module = true; if (!cur.attrs) cur.attrs = new Map(); }
    return cur;
  };

  /* ======================================================================
     7. the rclpy surface (installed per-run so it binds the graph)
     ====================================================================== */
  Interp.prototype.installRclpy = function () {
    const self = this, R = this.ros, graph = this.graph;
    const rclpy = this.__ns.rclpy || (this.__ns.rclpy = {});
    const nodeMod = this.__ns.rclpy.node || (this.__ns.rclpy.node = {});
    rclpy.__module = true; rclpy.attrs = new Map();
    const state = { ready: false };
    rclpy.init = function () { state.ready = true; return null; };
    rclpy.shutdown = function () { state.ready = false; return null; };
    rclpy.ok = function () { return state.ready; };
    rclpy.create_node = function (name) { return makeNode(name); };
    function makeNode(name) {
      const n = graph.node(name);
      const inst = new PyInstance(NodeClass);
      inst.attrs.set('_rosNode', n);
      inst.attrs.set('_name', name);
      return inst;
    }
    let NodeClass;
    NodeClass = new PyClass('Node', null);
    NodeClass.native = true;
    const M = (nm, f) => NodeClass.methods.set(nm, function (slf, ...args) { return f(slf, ...args); });
    M('__init__', (slf, name) => {
      const n = graph.node(String(name || 'node'));
      slf.attrs.set('_rosNode', n);
      slf.attrs.set('_name', String(name || 'node'));
      return null;
    });
    M('create_publisher', (slf, type, topic, q) => {
      const full = typeName(type);
      const pub = slf.attrs.get('_rosNode').createPublisher(full, String(topic), qosArg(q));
      return wrapHandle(pub, 'publisher');
    });
    M('create_subscription', (slf, type, topic, cb, q) => {
      const full = typeName(type);
      const sub = slf.attrs.get('_rosNode').createSubscription(full, String(topic), (m) => self.callValue(cb, [m], {}, null), qosArg(q));
      return wrapHandle(sub, 'subscription');
    });
    M('create_timer', (slf, period, cb) => {
      const t = slf.attrs.get('_rosNode').createTimer(Number(period) || 0.1, () => self.callValue(cb, [], {}, null));
      return wrapHandle(t, 'timer');
    });
    M('create_service', (slf, type, name, cb) => {
      const s = slf.attrs.get('_rosNode').createService(typeName(type), String(name), (req) => convertResult(self.callValue(cb, [req], {}, null)));
      return wrapHandle(s, 'service');
    });
    M('get_logger', (slf) => ({ __logger: true, node: slf.attrs.get('_name'), info: (m) => self.host.log('info', slf.attrs.get('_name'), m), warn: (m) => self.host.log('warn', slf.attrs.get('_name'), m), error: (m) => self.host.log('error', slf.attrs.get('_name'), m), debug: (m) => self.host.log('debug', slf.attrs.get('_name'), m) }));
    M('declare_parameter', (slf, name, value) => { slf.attrs.get('_rosNode').declareParameter(String(name), value); return { name: name, value: value }; });
    M('get_parameter', (slf, name) => { const r = slf.attrs.get('_rosNode').getParameter(String(name)); return { name: name, value: r.value }; });
    M('destroy_node', (slf) => { slf.attrs.get('_rosNode').destroy(); return null; });
    nodeMod.__module = true; nodeMod.attrs = new Map();
    nodeMod.__class = true; // marker
    nodeMod.attrs.set('Node', NodeClass);
    // Node must be reachable as rclpy.node.Node AND rclpy.Node
    rclpy.attrs.set('node', nodeMod);
    rclpy.attrs.set('Node', NodeClass);

    rclpy.spin = function (node) { self.graph.spinFor(self.host.spinSeconds, self.host.dt); return null; };
    rclpy.spin_once = function (node, timeout) { self.graph.spinFor(Math.max(self.host.dt, Number(timeout) || 0) || self.host.dt, self.host.dt); return null; };

    function typeName(t) {
      if (!t) throw PyError('a message type is required');
      if (t.__msgcall) return t.__msgcall;
      if (typeof t === 'string') return t;
      throw PyError('expected a message type (e.g. String or Vector3)');
    }
    function qosArg(q) { if (q == null) return 10; if (typeof q === 'object' && q.__dict) { const o = {}; q.map.forEach((v, k) => (o[k] = v)); return o; } return q; }
    function wrapHandle(handle, kind) {
      const h = new PyInstance(new PyClass(kind, null));
      h.attrs.set('_handle', handle);
      h.attrs.set('publish', { __bound: true, fn: { __fn: true, name: 'publish', params: [], body: [], closure: null }, self: h, owner: null, call: () => { } });
      h.__handle = handle;
      return h;
    }
    function convertResult(v) { if (v && v.__dict) { const o = {}; v.map.forEach((val, k) => (o[k] = val)); return o; } return v == null ? {} : v; }
  };

  /* publisher handles need a real publish() */
  Interp.prototype.getAttrOrig = Interp.prototype.getAttr;
  Interp.prototype.getAttr = function (obj, name) {
    if (obj && obj.__inst && obj.__handle && name === 'publish') {
      const h = obj.__handle;
      return this.bindMethod(function (slf, msg) { return h.publish(msg); }, obj);
    }
    if (obj && obj.__logger && (name === 'info' || name === 'warn' || name === 'error' || name === 'debug')) return obj[name];
    return this.getAttrOrig(obj, name);
  };

  /* ======================================================================
     8. public: run a script
     ====================================================================== */
  function run(code, opts) {
    opts = opts || {};
    const interp = new Interp(opts);
    const R = interp.ros;
    let ast;
    try {
      ast = new Parser(tokenize(code)).module();
    } catch (e) {
      return { ok: false, error: e.message, line: e.pyline || null, out: interp.out, graph: interp.graph };
    }
    interp.installRclpy();
    try {
      interp.exec(ast, interp.globals);
    } catch (e) {
      if (e && e.__signal === 'return') { /* top-level return: ignore */ }
      else return { ok: false, error: e && e.message ? e.message : String(e), line: e && e.pyline || null, out: interp.out, graph: interp.graph };
    }
    return { ok: true, error: null, out: interp.out, graph: interp.graph };
  }

  /* ======================================================================
     9. self-tests
     ====================================================================== */
  function selfTests() {
    const res = [];
    const add = (name, pass, detail) => res.push({ name: name, pass: !!pass, detail: detail == null ? '' : String(detail) });
    const ev = (code, opts) => { const r = run(code, opts); return r; };

    { const r = ev('x = 2\nprint(x ** 10)'); add('python · arithmetic and print', r.ok && r.out.join('') === '1024', r.out.join('') || r.error); }
    { const r = ev('s = 0\nfor i in range(5):\n    s += i\nprint(s)'); add('python · for-in over range', r.ok && r.out.join('') === '10', r.out.join('') || r.error); }
    { const r = ev('x = 7\nif x > 5:\n    print("big")\nelse:\n    print("small")'); add('python · if/else', r.ok && r.out.join('') === 'big', r.out.join('')); }
    { const r = ev('def add(a, b=10):\n    return a + b\nprint(add(1) + add(1, 2))'); add('python · functions with default arguments', r.ok && r.out.join('') === '14', r.out.join('') || r.error); }
    { const r = ev('xs = [1, 2, 3]\nxs.append(4)\nprint(len(xs), xs[-1])'); add('python · lists and negative index', r.ok && r.out.join('') === '4 4', r.out.join('') || r.error); }
    { const r = ev('d = {"a": 1}\nd["b"] = 2\nprint(d["a"] + d["b"])'); add('python · dicts', r.ok && r.out.join('') === '3', r.out.join('') || r.error); }
    { const r = ev('name = "world"\nprint("hello %s, %d" % (name, 3))'); add('python · %-formatting', r.ok && r.out.join('') === 'hello world, 3', r.out.join('') || r.error); }
    { const r = ev('n = 2\nprint(f"n = {n}, double = {n*2}")'); add('python · f-strings', r.ok && r.out.join('') === 'n = 2, double = 4', r.out.join('') || r.error); }
    { const r = ev('class A:\n    def __init__(self, n):\n        self.n = n\n    def double(self):\n        return self.n * 2\nprint(A(21).double())'); add('python · classes and methods', r.ok && r.out.join('') === '42', r.out.join('') || r.error); }
    { const r = ev('class A:\n    def hi(self):\n        return "A"\nclass B(A):\n    def hi(self):\n        return super().hi() + "B"\nprint(B().hi())'); add('python · inheritance and super()', r.ok && r.out.join('') === 'AB', r.out.join('') || r.error); }
    { const r = ev('import math\nprint(round(math.degrees(math.pi), 0))'); add('python · the math module', r.ok && r.out.join('') === '180', r.out.join('') || r.error); }
    { const r = ev('print(oops)'); add('python · an undefined name is reported with a message', !r.ok && /not defined/.test(r.error), r.error); }
    { const r = ev('x = (1 + 2'); add('python · a syntax error is reported, not thrown', !r.ok && /expected|unbalanced|unexpected/.test(r.error), r.error); }

    // the rclpy surface drives the real graph
    {
      const r = ev([
        'import rclpy',
        'from rclpy.node import Node',
        'from std_msgs.msg import String',
        'class Talker(Node):',
        '    def __init__(self):',
        '        super().__init__("talker")',
        '        self.pub = self.create_publisher(String, "/chatter", 10)',
        '    def send(self):',
        '        m = String()',
        '        m.data = "hi"',
        '        self.pub.publish(m)',
        'rclpy.init()',
        't = Talker()',
        't.send()',
        'rclpy.shutdown()',
      ].join('\n'));
      const t = r.graph.topics.get('/chatter');
      add('python · an rclpy publisher reaches the graph', r.ok && t && t.type === 'std_msgs/String' && t.count === 1, r.error || (t ? t.count + ' msg' : 'no topic'));
    }
    {
      const r = ev([
        'import rclpy',
        'from rclpy.node import Node',
        'from std_msgs.msg import String',
        'class Relay(Node):',
        '    def __init__(self):',
        '        super().__init__("relay")',
        '        self.out = self.create_publisher(String, "/out", 10)',
        '        self.sub = self.create_subscription(String, "/in", self.cb, 10)',
        '    def cb(self, m):',
        '        self.out.publish(m)',
        'rclpy.init()',
        'r = Relay()',
        'rclpy.shutdown()',
      ].join('\n'));
      // publish into /in from the CLI to exercise the subscriber
      const cli = new r.graph.constructor.prototype.constructor === null ? null : null;
      const R = ros();
      const c = R.CLI(r.graph);
      c.run('ros2 topic pub /in std_msgs/String "data: relayed"');
      const outT = r.graph.topics.get('/out');
      add('python · a subscriber callback publishes on the graph', r.ok && outT && outT.count === 1 && outT.last.data === 'relayed', r.error || (outT ? outT.count + ' msg' : 'no topic'));
    }
    {
      const r = ev([
        'import rclpy',
        'from rclpy.node import Node',
        'from std_msgs.msg import Int32',
        'class Ticker(Node):',
        '    def __init__(self):',
        '        super().__init__("ticker")',
        '        self.pub = self.create_publisher(Int32, "/tick", 10)',
        '        self.n = 0',
        '        self.create_timer(0.1, self.tick)',
        '    def tick(self):',
        '        m = Int32()',
        '        m.data = self.n',
        '        self.pub.publish(m)',
        '        self.n += 1',
        'rclpy.init()',
        't = Ticker()',
        'rclpy.spin(t)',
        'rclpy.shutdown()',
      ].join('\n'), { spinSeconds: 1.0 });
      const tk = r.graph.topics.get('/tick');
      add('python · a timer callback fires during spin()', r.ok && tk && tk.count >= 9, r.error || (tk ? tk.count + ' ticks' : 'no topic'));
    }
    {
      const r = ev('import rclpy\nfrom rclpy.node import Node\nrclpy.init()\nn = Node("cfg")\nn.declare_parameter("speed", 1.5)\nrclpy.shutdown()');
      const n = r.graph.findNode('cfg');
      add('python · parameters declared from Python reach the node', r.ok && n && Math.abs(n.getParameter('speed').value - 1.5) < 1e-9, r.error || 'ok');
    }

    // every graded task solution passes its own check
    {
      const R = ros();
      let allPass = true, firstFail = '';
      R.TASKS.forEach((task) => {
        const g = new R.Graph();
        const r = run(task.solution, { graph: g, spinSeconds: 2.0 });
        const ctx = R.makeContext(g);
        if (task.uses === 'arm') ctx.arm = () => ({ moved: true });
        const verdict = r.ok ? task.check(ctx) : { ok: false, detail: 'script error: ' + r.error };
        if (!verdict.ok) { allPass = false; firstFail = task.id + ': ' + verdict.detail; }
      });
      add('python · every graded task solution passes its own check', allPass, firstFail);
    }

    return res;
  }

  const API = { VERSION, run, selfTests, tokenize, Parser };
  if (NODE) module.exports = API;
  if (typeof window !== 'undefined') window.PY = API;
  return API;
})();
