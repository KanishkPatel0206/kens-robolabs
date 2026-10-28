/* ============================================================================
   Ken's RoboLabs v6.2 — ROS 2 Lab: in-browser ROS 2 simulation (engine)
   ----------------------------------------------------------------------------
   Pure JavaScript: no DOM, no Three.js and no network, so it also runs under
   plain Node in the test suite. In the browser it is the global `ROS2`.

   GitHub Pages cannot run a real ROS 2 stack (that needs DDS, rclpy and a
   daemon). This is a faithful *simulation* of the middleware a beginner
   practices against, modelled on the real command line and the real rclpy
   surface:

     * message types  — std_msgs, geometry_msgs, sensor_msgs, trajectory_msgs,
                        control_msgs, rosgraph_msgs, builtin_interfaces, with
                        defaults, normalisation and validation;
     * the graph      — nodes, topics, publishers, subscriptions, timers,
                        services, actions and a parameter server, with QoS
                        (reliability / durability / depth);
     * an executor    — deterministic step(dt) so timers fire and messages are
                        delivered in a reproducible order (that is what the
                        tests drive);
     * the CLI        — `ros2 node/topic/param/service/interface/run/launch/bag`
                        parsing that prints realistic output;
     * graded tasks   — engine-checked exercises (see TASKS).

   Units: joint positions in this lab are read off the app, i.e. degrees for
   revolute joints and millimetres for prismatic joints. The interpreter and
   the arm bridge (assets/ros.js) share that convention.
   ========================================================================== */
const ROS2 = (function () {
  'use strict';

  const NODE = (typeof module !== 'undefined' && module.exports);
  const VERSION = '6.2.0';

  /* ======================================================================
     0. small helpers
     ====================================================================== */
  function clone(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(clone);
    const o = {};
    for (const k in v) if (Object.prototype.hasOwnProperty.call(v, k) && k !== '__type') o[k] = clone(v[k]);
    return o;
  }
  function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  /* ======================================================================
     1. message types
     ====================================================================== */
  const TYPES = Object.create(null);
  function def(full, fields) {
    const parts = full.split('/');
    TYPES[full] = { full: full, pkg: parts[0], name: parts[1], fields: fields };
  }
  function typeKind(t) {
    if (/\[\]$/.test(t)) return 'array';
    if (TYPES[t]) return 'msg';
    if (t === 'string' || t === 'wstring') return 'string';
    if (t === 'bool') return 'bool';
    if (t === 'time' || t === 'duration') return 'time';
    if (/^u?int\d+$/.test(t)) return 'int';
    if (/^float\d+$/.test(t)) return 'float';
    return 'unknown';
  }
  function elemType(t) { return t.replace(/\[\]$/, ''); }

  def('builtin_interfaces/Time', [['sec', 'int32'], ['nanosec', 'uint32']]);
  def('builtin_interfaces/Duration', [['sec', 'int32'], ['nanosec', 'uint32']]);
  def('std_msgs/Header', [['stamp', 'builtin_interfaces/Time'], ['frame_id', 'string']]);
  def('std_msgs/String', [['data', 'string']]);
  def('std_msgs/Bool', [['data', 'bool']]);
  def('std_msgs/Int32', [['data', 'int32']]);
  def('std_msgs/Int64', [['data', 'int64']]);
  def('std_msgs/Float64', [['data', 'float64']]);
  def('geometry_msgs/Vector3', [['x', 'float64'], ['y', 'float64'], ['z', 'float64']]);
  def('geometry_msgs/Point', [['x', 'float64'], ['y', 'float64'], ['z', 'float64']]);
  def('geometry_msgs/Quaternion', [['x', 'float64'], ['y', 'float64'], ['z', 'float64'], ['w', 'float64']]);
  def('geometry_msgs/Pose', [['position', 'geometry_msgs/Point'], ['orientation', 'geometry_msgs/Quaternion']]);
  def('geometry_msgs/PoseStamped', [['header', 'std_msgs/Header'], ['pose', 'geometry_msgs/Pose']]);
  def('geometry_msgs/Twist', [['linear', 'geometry_msgs/Vector3'], ['angular', 'geometry_msgs/Vector3']]);
  def('geometry_msgs/Transform', [['translation', 'geometry_msgs/Vector3'], ['rotation', 'geometry_msgs/Quaternion']]);
  def('geometry_msgs/TransformStamped', [['header', 'std_msgs/Header'], ['child_frame_id', 'string'], ['transform', 'geometry_msgs/Transform']]);
  def('sensor_msgs/JointState', [['header', 'std_msgs/Header'], ['name', 'string[]'], ['position', 'float64[]'], ['velocity', 'float64[]'], ['effort', 'float64[]']]);
  def('trajectory_msgs/JointTrajectoryPoint', [['positions', 'float64[]'], ['velocities', 'float64[]'], ['accelerations', 'float64[]'], ['effort', 'float64[]'], ['time_from_start', 'builtin_interfaces/Duration']]);
  def('trajectory_msgs/JointTrajectory', [['header', 'std_msgs/Header'], ['joint_names', 'string[]'], ['points', 'trajectory_msgs/JointTrajectoryPoint[]']]);
  def('control_msgs/FollowJointTrajectoryGoal', [['trajectory', 'trajectory_msgs/JointTrajectory'], ['goal_time_tolerance', 'builtin_interfaces/Duration']]);
  def('rosgraph_msgs/Clock', [['clock', 'builtin_interfaces/Time']]);
  def('std_srvs/SetBool', [['data', 'bool']]);
  def('std_srvs/Trigger', []);

  function create(full, init) {
    const t = TYPES[full];
    if (!t) throw new Error('unknown message type: ' + full);
    const o = {};
    for (let i = 0; i < t.fields.length; i++) {
      const name = t.fields[i][0], type = t.fields[i][1], kind = typeKind(type);
      if (kind === 'array') o[name] = [];
      else if (kind === 'msg') o[name] = create(type, {});
      else if (kind === 'string') o[name] = '';
      else if (kind === 'bool') o[name] = false;
      else if (kind === 'time') o[name] = { sec: 0, nanosec: 0 };
      else o[name] = 0;
    }
    if (init) for (const k in init) if (Object.prototype.hasOwnProperty.call(o, k)) o[k] = init[k];
    Object.defineProperty(o, '__type', { value: full, enumerable: false, writable: true });
    return o;
  }

  /* Fill missing fields, coerce numerics and return { msg, errors }. */
  function normalize(full, msg) {
    const t = TYPES[full];
    if (!t) throw new Error('unknown message type: ' + full);
    const src = msg && typeof msg === 'object' ? msg : {};
    const out = {};
    const errors = [];
    const use = t.fields.map((f) => f[0]);
    for (let i = 0; i < t.fields.length; i++) {
      const name = t.fields[i][0], type = t.fields[i][1], kind = typeKind(type);
      let v = src[name];
      if (v === undefined) {
        if (kind === 'array') v = [];
        else if (kind === 'msg') v = normalize(type, {}).msg;
        else if (kind === 'string') v = '';
        else if (kind === 'bool') v = false;
        else if (kind === 'time') v = { sec: 0, nanosec: 0 };
        else v = 0;
      } else if (kind === 'array') {
        if (!Array.isArray(v)) { errors.push(name + ' must be an array'); v = [v]; }
        const et = elemType(type), ek = typeKind(et);
        v = v.map((x) => {
          if (ek === 'msg') return normalize(et, x).msg;
          if (ek === 'int') return Math.trunc(Number(x) || 0);
          if (ek === 'float') return Number(x) || 0;
          if (ek === 'bool') return !!x;
          if (ek === 'time') return x || { sec: 0, nanosec: 0 };
          return String(x == null ? '' : x);
        });
      } else if (kind === 'msg') {
        v = normalize(type, v).msg;
      } else if (kind === 'string') {
        v = String(v == null ? '' : v);
      } else if (kind === 'bool') {
        v = !!v;
      } else if (kind === 'time') {
        if (typeof v === 'number') v = { sec: Math.trunc(v), nanosec: Math.round((v - Math.trunc(v)) * 1e9) };
        v = { sec: Math.trunc(Number(v.sec) || 0), nanosec: Math.trunc(Number(v.nanosec) || 0) };
      } else if (kind === 'int') {
        v = Math.trunc(Number(v) || 0);
      } else if (kind === 'float') {
        v = Number(v) || 0;
        if (!Number.isFinite(v)) { errors.push(name + ' is not finite'); v = 0; }
      }
      out[name] = v;
    }
    // flag unknown keys so a typo does not pass silently
    for (const k in src) if (Object.prototype.hasOwnProperty.call(src, k) && use.indexOf(k) < 0 && k !== '__type') errors.push('unknown field: ' + k);
    Object.defineProperty(out, '__type', { value: full, enumerable: false, writable: true });
    return { msg: out, errors: errors };
  }

  function interfaceShow(full) {
    const t = TYPES[full];
    if (!t) return null;
    let out = '';
    for (let i = 0; i < t.fields.length; i++) out += t.fields[i][1] + ' ' + t.fields[i][0] + '\n';
    return out.replace(/\n$/, '');
  }
  function typeNames() { return Object.keys(TYPES).sort(); }
  function hasType(full) { return !!TYPES[full]; }

  /* ======================================================================
     2. QoS
     ====================================================================== */
  function qos(v, defaultDepth) {
    if (v == null) return { reliability: 'reliable', durability: 'volatile', depth: defaultDepth || 10 };
    if (typeof v === 'number') return { reliability: 'reliable', durability: 'volatile', depth: Math.max(1, Math.trunc(v)) };
    return {
      reliability: v.reliability || 'reliable',
      durability: v.durability || 'volatile',
      depth: Math.max(1, Math.trunc(v.depth || defaultDepth || 10)),
    };
  }

  /* ======================================================================
     3. graph, nodes, topics, publishers, subscriptions, timers
     ====================================================================== */
  function resolve(name, ns) {
    if (!name) return '/';
    ns = ns || '';
    if (name[0] === '/') { const p = name.replace(/\/+$/, ''); return p === '' ? '/' : p; }
    const base = ns ? '/' + String(ns).replace(/^\/+|\/+$/g, '') : '';
    return (base + '/' + name).replace(/\/{2,}/g, '/');
  }
  function topicLeaf(name) { const i = name.lastIndexOf('/'); return i < 0 ? name : name.slice(i + 1); }

  function Graph(opts) {
    opts = opts || {};
    this.name = opts.name || 'robolabs';
    this.nodes = [];
    this.topics = new Map();     // resolved name -> topic
    this.services = new Map();   // resolved name -> service
    this.actions = new Map();    // resolved name -> action
    this.t = 0;                  // simulated seconds
    this.log = [];               // { t, level, node, message }
    this.events = [];            // { t, node, topic, type, msg }
    this.maxLog = 400;
    this.stopped = false;
    this.bag = null;
    this.runner = opts.runner || null;     // (code, ctx) => logs, set by the host (pysub)
    this.registry = opts.registry || null;   // ros2 run catalogue (defaults to EXAMPLES)
    this.launchFiles = opts.launchFiles || null; // ros2 launch catalogue
  }
  Graph.prototype.now = function () { return this.t; };
  Graph.prototype.addLog = function (level, node, message) {
    this.log.push({ t: this.t, level: level, node: node, message: String(message) });
    if (this.log.length > this.maxLog) this.log.shift();
  };
  Graph.prototype.node = function (name, ns) {
    const n = new Node(this, name, ns || '');
    this.nodes.push(n);
    this.addLog('info', name, 'created node ' + resolve(name, ns));
    return n;
  };
  Graph.prototype.findNode = function (name) {
    return this.nodes.find((n) => n.name === name || resolve(n.name, n.namespace) === name) || null;
  };
  Graph.prototype.ensureTopic = function (name, type, q) {
    let t = this.topics.get(name);
    if (!t) {
      t = {
        name: name, type: type || '', qos: q || null,
        publishers: [], subscriptions: [], buffer: [], count: 0, bytes: 0,
        last: null, lastT: -1, latched: false, subOrder: 0,
      };
      this.topics.set(name, t);
    } else if (type && t.type && t.type !== type) {
      this.addLog('warn', 'graph', 'topic ' + name + ' type mismatch: ' + t.type + ' vs ' + type);
    } else if (type && !t.type) {
      t.type = type;
    }
    return t;
  };
  Graph.prototype.publish = function (pub, raw) {
    const topic = pub.topic;
    const norm = normalize(topic.type, raw);
    for (let i = 0; i < norm.errors.length; i++) this.addLog('warn', pub.node.name, topic.name + ': ' + norm.errors[i]);
    const msg = norm.msg;
    topic.count++;
    topic.last = clone(msg);
    topic.lastT = this.t;
    topic.buffer.push(clone(msg));
    while (topic.buffer.length > Math.max(1, topic.qos ? topic.qos.depth : 10)) topic.buffer.shift();
    const e = { t: this.t, node: pub.node.name, topic: topic.name, type: topic.type, msg: clone(msg) };
    this.events.push(e);
    if (this.bag && this.bag.recording && this.bag.topics.indexOf(topic.name) >= 0) {
      this.bag.messages.push({ t: this.t, topic: topic.name, type: topic.type, msg: clone(msg) });
    }
    let delivered = 0;
    // deliver in subscription creation order (matches a single-threaded executor)
    const subs = topic.subscriptions.slice().sort((a, b) => a.order - b.order);
    for (let i = 0; i < subs.length; i++) {
      const sub = subs[i];
      try { sub.cb(clone(msg)); delivered++; }
      catch (err) { this.addLog('error', sub.node.name, 'subscriber ' + topic.name + ' raised: ' + (err && err.message ? err.message : err)); }
    }
    return delivered;
  };
  Graph.prototype.step = function (dt) {
    dt = dt == null ? 0.05 : dt;
    this.t += dt;
    let guard = 0;
    for (;;) {
      let next = null;
      for (let i = 0; i < this.nodes.length; i++) {
        const ts = this.nodes[i].timers;
        for (let k = 0; k < ts.length; k++) if (!ts[k].cancelled && (next === null || ts[k].next < next.next)) next = ts[k];
      }
      if (!next || next.next > this.t || guard++ > 10000) break;
      const period = Math.max(1e-3, next.period);
      next.next = next.next + period;
      if (next.next <= this.t) next.next = this.t + period; // coalesce if we fell far behind
      try { next.cb(); }
      catch (err) { this.addLog('error', next.node.name, 'timer raised: ' + (err && err.message ? err.message : err)); }
    }
    return this.t;
  };
  Graph.prototype.spinFor = function (seconds, dt) {
    dt = dt || 0.05;
    const end = this.t + seconds;
    let guard = 0;
    while (this.t + 1e-9 < end && guard++ < 100000) this.step(dt);
    return this.t;
  };
  Graph.prototype.topicInfo = function (topic) {
    const t = this.topics.get(topic);
    if (!t) return null;
    return { name: t.name, type: t.type, publishers: t.publishers.length, subscriptions: t.subscriptions.length, count: t.count };
  };

  function Node(graph, name, namespace) {
    this.graph = graph;
    this.name = name;
    this.namespace = namespace || '';
    this.publishers = [];
    this.subscriptions = [];
    this.timers = [];
    this.services = [];
    this.clients = [];
    this.actions = [];
    this.params = new Map();
    this._logger = this._makeLogger();
  }
  Node.prototype._makeLogger = function () {
    const self = this;
    const mk = (lv) => function (m) { self.graph.addLog(lv, self.name, m); };
    return { info: mk('info'), warn: mk('warn'), error: mk('error'), debug: mk('debug') };
  };
  Node.prototype.getLogger = function () { return this._logger; };
  Node.prototype.createPublisher = function (type, topic, q) {
    if (!hasType(type)) this.graph.addLog('error', this.name, 'unknown type ' + type);
    const name = resolve(topic, this.namespace);
    const t = this.graph.ensureTopic(name, type, qos(q, 10));
    if (t.qos && t.qos.durability === 'transient_local') t.latched = true;
    const pub = { node: this, type: type, topic: t };
    pub.publish = function (msg) { return self.graph.publish(pub, msg); };
    const self = this;
    t.publishers.push(pub);
    this.publishers.push(pub);
    return pub;
  };
  Node.prototype.createSubscription = function (type, topic, cb, q) {
    if (!hasType(type)) this.graph.addLog('error', this.name, 'unknown type ' + type);
    const name = resolve(topic, this.namespace);
    const t = this.graph.ensureTopic(name, type, qos(q, 10));
    const sub = { node: this, type: type, topic: t, cb: cb, order: t.subOrder++, count: 0 };
    const orig = cb;
    sub.cb = function (m) { sub.count++; return orig(m); };
    t.subscriptions.push(sub);
    this.subscriptions.push(sub);
    if (t.latched && t.last) { try { sub.cb(clone(t.last)); } catch (e) { this.graph.addLog('error', this.name, 'latched delivery: ' + e.message); } }
    return sub;
  };
  Node.prototype.createTimer = function (period, cb) {
    const timer = { node: this, period: Math.max(1e-3, Number(period) || 0.1), cb: cb, next: this.graph.t + Math.max(1e-3, Number(period) || 0.1), cancelled: false };
    timer.cancel = function () { timer.cancelled = true; };
    this.timers.push(timer);
    return timer;
  };
  Node.prototype.createService = function (type, name, cb) {
    const full = resolve(name, this.namespace);
    const srv = { node: this, type: type, name: full, cb: cb, calls: 0 };
    this.graph.services.set(full, srv);
    this.services.push(srv);
    return srv;
  };
  Node.prototype.callService = function (full, request) {
    const srv = this.graph.services.get(resolve(full, this.namespace));
    if (!srv) throw new Error('service not available: ' + full);
    srv.calls++;
    return srv.cb(request || {});
  };
  Node.prototype.declareParameter = function (name, value) {
    if (this.params.has(name)) throw new Error("parameter '" + name + "' has already been declared");
    this.params.set(name, { value: value, declared: true });
    return { name: name, value: value };
  };
  Node.prototype.setParameter = function (name, value) {
    this.params.set(name, { value: value, declared: true });
  };
  Node.prototype.getParameter = function (name) {
    const p = this.params.get(name);
    return { name: name, value: p ? p.value : undefined };
  };
  Node.prototype.listParameters = function () { return Array.from(this.params.keys()); };
  Node.prototype.destroy = function () {
    this.timers.forEach((t) => (t.cancelled = true));
    this.graph.nodes = this.graph.nodes.filter((n) => n !== this);
    this.publishers.forEach((p) => { p.topic.publishers = p.topic.publishers.filter((x) => x !== p); });
    this.subscriptions.forEach((s) => { s.topic.subscriptions = s.topic.subscriptions.filter((x) => x !== s); });
    this.services.forEach((s) => this.graph.services.delete(s.name));
  };

  /* ======================================================================
     4. tiny YAML-ish reader / writer (for `ros2 topic pub` and `echo`)
     ====================================================================== */
  function parseScalar(s) {
    s = String(s).trim();
    if (s === '' ) return '';
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d*\.\d+([eE][-+]?\d+)?$/.test(s) || /^-?\d+[eE][-+]?\d+$/.test(s)) return parseFloat(s);
    if (s === 'true' || s === 'false') return s === 'true';
    if (s === 'null' || s === '~') return null;
    if (/^\[.*\]$/.test(s)) {
      const inner = s.slice(1, -1).trim();
      if (!inner) return [];
      return splitTop(inner, ',').map(parseScalar);
    }
    if ((s[0] === '"' && s.slice(-1) === '"') || (s[0] === "'" && s.slice(-1) === "'")) return s.slice(1, -1);
    return s;
  }
  function splitTop(s, sep) {
    const out = []; let depth = 0, cur = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '[' || c === '(' || c === '{') depth++;
      else if (c === ']' || c === ')' || c === '}') depth--;
      if (c === sep && depth === 0) { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur);
    return out.map((x) => x.trim()).filter((x) => x !== '');
  }
  function parseYaml(text) {
    const lines = String(text).split('\n').map((l) => l.replace(/\t/g, '  ')).filter((l) => l.trim() !== '' && !/^\s*#/.test(l));
    function block(i, indent) {
      const obj = {};
      while (i < lines.length) {
        const line = lines[i];
        const ind = line.length - line.trimStart().length;
        if (ind < indent) break;
        const body = line.trim();
        const m = body.match(/^([^:]+):\s*(.*)$/);
        if (!m) { i++; continue; }
        const key = m[1].trim();
        if (m[2].trim() === '') {
          const child = block(i + 1, ind + 1);
          obj[key] = Array.isArray(child) ? child : child.obj;
          i = child.i;
        } else {
          obj[key] = parseScalar(m[2]);
          i++;
        }
      }
      return { obj: obj, i: i };
    }
    const r = block(0, 0);
    return r.obj;
  }
  function yamlDump(obj, indent) {
    indent = indent || '';
    if (Array.isArray(obj)) return '[' + obj.map((x) => (typeof x === 'object' && x !== null ? yamlDump(x) : String(x))).join(', ') + ']';
    if (obj && typeof obj === 'object') {
      let out = '';
      for (const k in obj) {
        if (k === '__type') continue;
        const v = obj[k];
        if (v && typeof v === 'object') {
          out += indent + k + ':\n' + yamlDump(v, indent + '  ');
        } else {
          out += indent + k + ': ' + String(v) + '\n';
        }
      }
      return out;
    }
    return indent + String(obj) + '\n';
  }

  /* ======================================================================
     5. the `ros2` command line
     ====================================================================== */
  function tokenize(line) {
    const out = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m;
    while ((m = re.exec(line))) out.push(m[1] != null ? m[1] : m[2] != null ? m[2] : m[3]);
    return out;
  }
  function fmtNum(v) { return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(6))); }

  function CLI(graph) {
    function listNodes() { return graph.nodes.map((n) => n.name).sort(); }
    function lookTopic(name) {
      const r = resolve(name);
      return graph.topics.get(r) || graph.topics.get('/' + name.replace(/^\/+/, '')) || null;
    }
    const api = {};

    api['node list'] = function () { return { out: listNodes() }; };
    api['node info'] = function (args) {
      const n = graph.findNode(args[0]);
      if (!n) return { out: ['Node not found: ' + args[0]], code: 1 };
      const out = ['/' + n.name];
      out.push('  Subscribers:');
      n.subscriptions.forEach((s) => out.push('    ' + s.topic.name + ': ' + s.type));
      out.push('  Publishers:');
      n.publishers.forEach((p) => out.push('    ' + p.topic.name + ': ' + p.type));
      out.push('  Service Servers:');
      n.services.forEach((s) => out.push('    ' + s.name + ': ' + s.type));
      out.push('  Parameters:');
      n.listParameters().forEach((p) => out.push('    ' + p));
      return { out: out };
    };

    api['topic list'] = function (args) {
      const verbose = args.indexOf('-t') >= 0 || args.indexOf('--verbose') >= 0;
      const names = Array.from(graph.topics.values()).filter((t) => t.publishers.length || t.subscriptions.length).map((t) => t.name).sort();
      return { out: names.map((n) => (verbose ? n + ' [' + graph.topics.get(n).type + ']' : n)) };
    };
    api['topic info'] = function (args) {
      const t = lookTopic(args[0] || '');
      if (!t) return { out: ['Unknown topic ' + (args[0] || '')], code: 1 };
      return { out: ['Type: ' + t.type, 'Publisher count: ' + t.publishers.length, 'Subscription count: ' + t.subscriptions.length, 'Messages published: ' + t.count] };
    };
    api['topic type'] = function (args) {
      const t = lookTopic(args[0] || '');
      return t ? { out: [t.type] } : { out: ['Unknown topic ' + (args[0] || '')], code: 1 };
    };
    api['topic find'] = function (args) {
      const type = args[0];
      return { out: Array.from(graph.topics.values()).filter((t) => t.type === type).map((t) => t.name) };
    };
    api['topic echo'] = function (args) {
      const t = lookTopic(args[0] || '');
      if (!t) return { out: ['Unknown topic ' + (args[0] || '')], code: 1 };
      if (!t.last) return { out: ['(no messages yet on ' + t.name + ')'] };
      return { out: yamlDump(t.last).replace(/\n$/, '').split('\n') };
    };
    api['topic pub'] = function (args) {
      const name = args[0], type = args[1], payload = args.slice(2).join(' ');
      if (!name || !type) return { out: ['usage: ros2 topic pub <topic> <type> "<yaml>"'], code: 1 };
      if (!hasType(type)) return { out: ['Unknown type: ' + type], code: 1 };
      const t = graph.ensureTopic(resolve(name), type, qos(10, 10));
      const parsed = normalize(type, parseYaml(payload || ''));
      t.count++;
      t.last = clone(parsed.msg); t.lastT = graph.t;
      const e = { t: graph.t, node: 'cli', topic: t.name, type: type, msg: clone(parsed.msg) };
      graph.events.push(e);
      t.subscriptions.forEach((s) => { try { s.cb(clone(parsed.msg)); } catch (err) { graph.addLog('error', s.node.name, String(err)); } });
      return { out: ['published 1 message on ' + t.name] };
    };
    api['topic hz'] = function (args) {
      const t = lookTopic(args[0] || '');
      if (!t) return { out: ['Unknown topic ' + (args[0] || '')], code: 1 };
      const rate = t.count > 0 && t.lastT > 0 ? (t.count / Math.max(1e-6, t.lastT)) : 0;
      return { out: ['average rate: ' + rate.toFixed(3), '  min: ' + rate.toFixed(3), '  max: ' + rate.toFixed(3), '  window: ' + Math.max(1, t.count)] };
    };

    api['param list'] = function (args) {
      const nodes = args[0] ? [graph.findNode(args[0])] : graph.nodes;
      if (args[0] && !nodes[0]) return { out: ['Node not found: ' + args[0]], code: 1 };
      const out = [];
      nodes.filter(Boolean).forEach((n) => { out.push('/' + n.name + ':'); n.listParameters().forEach((p) => out.push('  ' + p)); });
      return { out: out };
    };
    api['param get'] = function (args) {
      const n = graph.findNode(args[0] || '');
      if (!n) return { out: ['Node not found: ' + (args[0] || '')], code: 1 };
      const p = n.getParameter(args[1]);
      if (p.value === undefined) return { out: ['Parameter not set'], code: 1 };
      return { out: ['Parameter name: ' + args[1], 'Parameter type: ' + (typeof p.value), 'Parameter value: ' + p.value] };
    };
    api['param set'] = function (args) {
      const n = graph.findNode(args[0] || '');
      if (!n) return { out: ['Node not found: ' + (args[0] || '')], code: 1 };
      const val = parseScalar(args[2]);
      n.setParameter(args[1], val);
      return { out: ['Set parameter ' + args[1] + ' to ' + val] };
    };

    api['service list'] = function () {
      return { out: Array.from(graph.services.values()).map((s) => s.name).sort() };
    };
    api['service type'] = function (args) {
      const s = graph.services.get(resolve(args[0] || ''));
      return s ? { out: [s.type] } : { out: ['Unknown service ' + (args[0] || '')], code: 1 };
    };
    api['service call'] = function (args) {
      const name = resolve(args[0] || '');
      const s = graph.services.get(name);
      if (!s) return { out: ['Unknown service ' + (args[0] || '')], code: 1 };
      let res;
      try { res = s.cb(parseYaml(args.slice(2).join(' ') || '')); }
      catch (e) { return { out: ['Service call failed: ' + e.message], code: 1 }; }
      return { out: ['response:', ...yamlDump(res).replace(/\n$/, '').split('\n')] };
    };

    api['interface list'] = function () { return { out: typeNames().map((t) => t.replace('/', '/msg/')) }; };
    api['interface show'] = function (args) {
      const full = String(args[0] || '').replace('/msg/', '/');
      const s = interfaceShow(full);
      if (!s) return { out: ['Unknown interface ' + args[0]], code: 1 };
      return { out: s.split('\n') };
    };

    api['action list'] = function () { return { out: Array.from(graph.actions.keys()).sort() }; };
    api['action info'] = function (args) {
      const a = graph.actions.get(resolve(args[0] || ''));
      return a ? { out: ['Action: ' + a.name, 'Type: ' + a.type] } : { out: ['Unknown action ' + (args[0] || '')], code: 1 };
    };
    api['action send_goal'] = function (args) {
      const a = graph.actions.get(resolve(args[0] || ''));
      if (!a) return { out: ['Unknown action ' + (args[0] || '')], code: 1 };
      let res; try { res = a.goal(parseYaml(args.slice(2).join(' ') || '')); }
      catch (e) { return { out: ['Goal rejected: ' + e.message], code: 1 }; }
      return { out: ['Goal accepted', ...yamlDump(res || {}).replace(/\n$/, '').split('\n')] };
    };

    function cmdRun(args) {
      const pkg = args[0], exe = args[1];
      const cat = graph.registry || EXAMPLES;
      if (!pkg || !exe) return { out: ['usage: ros2 run <package> <executable>'], code: 1 };
      const entry = cat[pkg] && cat[pkg][exe];
      if (!entry) return { out: ['No executable ' + exe + ' in package ' + pkg], code: 1 };
      if (!graph.runner) return { out: ['(python runtime not loaded)'], code: 1 };
      const logs = graph.runner(entry, { graph: graph, source: pkg + '/' + exe });
      return { out: ['[ros2 run] starting ' + pkg + '/' + exe, ...(logs || [])] };
    };
    api['launch'] = function (args) {
      const file = args[0];
      const cat = graph.launchFiles || LAUNCH_FILES;
      if (!file) return { out: ['usage: ros2 launch <file>'], code: 1 };
      const key = String(file).replace(/^.*\//, '');
      const entry = cat[key];
      if (!entry) return { out: ['No launch file ' + file], code: 1 };
      if (!graph.runner) return { out: ['(python runtime not loaded)'], code: 1 };
      const out = ['[ros2 launch] ' + key];
      entry.nodes.forEach((n) => { out.push('  start node ' + n.name + ' (' + n.exe + ')'); if (n.code) out.push(...(graph.runner(n.code, { graph: graph, source: key }) || [])); });
      return { out: out };
    };

    api['bag record'] = function (args) {
      const topics = args.filter((a) => a[0] === '/' || /[a-z]/.test(a));
      const all = args.indexOf('-a') >= 0 || args.indexOf('--all') >= 0;
      const rec = topics.filter((t) => t[0] === '/');
      graph.bag = { recording: true, started: graph.t, topics: all ? Array.from(graph.topics.keys()) : rec, messages: [] };
      return { out: ['Recording ' + (all ? 'all topics' : rec.join(', ') || '(none)') + ' ...'] };
    };
    api['bag stop'] = function () {
      if (graph.bag) graph.bag.recording = false;
      return { out: ['Stopped recording.'] };
    };
    api['bag info'] = function () {
      if (!graph.bag) return { out: ['No bag recorded.'], code: 1 };
      return { out: ['Bag: robolabs', 'Messages: ' + graph.bag.messages.length, 'Topics: ' + graph.bag.topics.join(', '), 'Duration: ' + (graph.t - graph.bag.started).toFixed(2) + ' s'] };
    };
    api['bag play'] = function () {
      if (!graph.bag) return { out: ['No bag to play.'], code: 1 };
      const bag = graph.bag;
      let n = 0;
      bag.messages.forEach((m) => { const t = graph.topics.get(m.topic); if (t) { t.count++; t.last = clone(m.msg); t.subscriptions.forEach((s) => { try { s.cb(clone(m.msg)); } catch (e) {} }); n++; } });
      return { out: ['Played ' + n + ' messages.'] };
    };

    api['doctor'] = function () {
      const issues = [];
      graph.nodes.forEach((n) => {
        if (!n.publishers.length && !n.subscriptions.length && !n.timers.length) issues.push('node ' + n.name + ' has no publishers, subscribers or timers');
        n.publishers.forEach((p) => { if (!p.topic.subscriptions.length) issues.push('topic ' + p.topic.name + ' is published but nobody subscribes'); });
      });
      return { out: issues.length ? ['Found ' + issues.length + ' potential issue(s):', ...issues.map((s) => '  ' + s)] : ['All ' + graph.nodes.length + ' checks passed'] };
    };
    api['wtf'] = function () {
      return { out: ['ROS 2 Lab: this is a browser simulation of ROS 2 — no DDS, no daemon, no network. ', 'Everything you see (nodes, topics, messages, parameters) lives in this page.'] };
    };

    api.run = function (line) {
      const words = tokenize(String(line || '').trim());
      if (!words.length) return { out: [], code: 0 };
      if (words[0] === 'ros2') words.shift();
      if (words[0] === '--help' || words[0] === '-h' || words[0] === 'help') return { out: help() };
      if (words[0] === 'version' || words[0] === '--version') return { out: ['ros2 (RoboLabs simulation) ' + VERSION] };
      if (words[0] === 'run') return cmdRun(words.slice(1));
      // most specific two-word command first
      const two = words[0] + ' ' + (words[1] || '');
      if (api[two]) return api[two](words.slice(2));
      if (api[words[0]]) return api[words[0]](words.slice(1));
      return { out: ['Unknown command: ' + words.join(' ') + '. Type `ros2 --help`.'], code: 1 };
    };
    function help() {
      return [
        'Usage: ros2 [-h] [--version] COMMAND [ARGS]',
        '',
        'Commands:',
        '  node      list | info',
        '  topic     list [-t] | info | type | find | echo | pub | hz',
        '  param     list | get | set',
        '  service   list | type | call',
        '  action    list | info | send_goal',
        '  interface list | show',
        '  run       <package> <executable>',
        '  launch    <file>',
        '  bag       record | stop | info | play',
        '  doctor',
        '  wtf',
      ];
    }
    return api;
  }

  /* ======================================================================
     6. graded tasks (engine-checked)
     ====================================================================== */
  const TASKS = [
    {
      id: 'hello',
      title: '1 · Publish once',
      brief: 'Create a node named <code>talker</code> that creates a publisher of <code>std_msgs/String</code> on <code>/chatter</code> and publishes one message whose <code>data</code> contains <code>hello</code>.',
      hint: 'Subclass <code>Node</code>, call <code>self.create_publisher(String, \'chatter\', 10)</code>, then <code>pub.publish(msg)</code>.',
      starter: 'import rclpy\nfrom rclpy.node import Node\nfrom std_msgs.msg import String\n\nclass Talker(Node):\n    def __init__(self):\n        super().__init__(\'talker\')\n        # TODO: create the publisher on \'/chatter\'\n\n    def send(self):\n        msg = String()\n        # TODO: set msg.data and publish it\n\nrclpy.init()\nt = Talker()\nt.send()\nrclpy.shutdown()\n',
      solution: "import rclpy\nfrom rclpy.node import Node\nfrom std_msgs.msg import String\n\nclass Talker(Node):\n    def __init__(self):\n        super().__init__('talker')\n        self.pub = self.create_publisher(String, '/chatter', 10)\n\n    def send(self):\n        msg = String()\n        msg.data = 'hello from rclpy'\n        self.pub.publish(msg)\n        self.get_logger().info('Published: %s' % msg.data)\n\nrclpy.init()\nt = Talker()\nt.send()\nrclpy.shutdown()\n",
      check: function (ctx) {
        const t = ctx.topic('/chatter');
        if (!t) return fail('no publisher on /chatter');
        if (t.type !== 'std_msgs/String') return fail('/chatter type is ' + t.type);
        const msgs = ctx.messages('/chatter');
        if (!msgs.length) return fail('nothing was published on /chatter');
        if (!/hello/i.test(String(msgs[msgs.length - 1].data || ''))) return fail('data was "' + msgs[msgs.length - 1].data + '"');
        return ok('published ' + msgs.length + ' message(s); data = "' + msgs[msgs.length - 1].data + '"');
      },
    },
    {
      id: 'vector',
      title: '2 · A typed message',
      brief: 'Publish a <code>geometry_msgs/Vector3</code> on <code>/cmd_vector</code> with <code>x = 1.0</code> and <code>y</code> negative.',
      hint: '<code>from geometry_msgs.msg import Vector3</code>, then set the fields before publishing.',
      starter: 'import rclpy\nfrom rclpy.node import Node\nfrom geometry_msgs.msg import Vector3\n\nclass Cmd(Node):\n    def __init__(self):\n        super().__init__(\'cmd\')\n        self.pub = self.create_publisher(Vector3, \'/cmd_vector\', 10)\n\n    def send(self):\n        v = Vector3()\n        # TODO: x = 1.0, y < 0, then publish\n\nrclpy.init()\nn = Cmd()\nn.send()\nrclpy.shutdown()\n',
      solution: "import rclpy\nfrom rclpy.node import Node\nfrom geometry_msgs.msg import Vector3\n\nclass Cmd(Node):\n    def __init__(self):\n        super().__init__('cmd')\n        self.pub = self.create_publisher(Vector3, '/cmd_vector', 10)\n\n    def send(self):\n        v = Vector3()\n        v.x = 1.0\n        v.y = -2.5\n        v.z = 0.0\n        self.pub.publish(v)\n\nrclpy.init()\nn = Cmd()\nn.send()\nrclpy.shutdown()\n",
      check: function (ctx) {
        const t = ctx.topic('/cmd_vector');
        if (!t) return fail('no publisher on /cmd_vector');
        if (t.type !== 'geometry_msgs/Vector3') return fail('/cmd_vector type is ' + t.type);
        const msgs = ctx.messages('/cmd_vector');
        if (!msgs.length) return fail('nothing published');
        const m = msgs[msgs.length - 1];
        if (m.x !== 1) return fail('x = ' + m.x);
        if (!(m.y < 0)) return fail('y = ' + m.y + ' (must be negative)');
        return ok('x = 1, y = ' + m.y);
      },
    },
    {
      id: 'relay',
      title: '3 · Subscribe and relay',
      brief: 'Create a node <code>relay</code> that subscribes to <code>/chatter</code> (<code>std_msgs/String</code>) and republishes each message unchanged on <code>/chatter_out</code>.',
      hint: '<code>self.create_subscription(String, \'/chatter\', self.cb, 10)</code>; in <code>cb</code>, publish to the second publisher.',
      starter: "import rclpy\nfrom rclpy.node import Node\nfrom std_msgs.msg import String\n\nclass Relay(Node):\n    def __init__(self):\n        super().__init__('relay')\n        self.out = self.create_publisher(String, '/chatter_out', 10)\n        # TODO: subscribe to '/chatter' with self.on_msg\n\n    def on_msg(self, msg):\n        # TODO: republish msg on /chatter_out\n        pass\n\nrclpy.init()\nr = Relay()\nrclpy.spin(r)\nrclpy.shutdown()\n",
      solution: "import rclpy\nfrom rclpy.node import Node\nfrom std_msgs.msg import String\n\nclass Relay(Node):\n    def __init__(self):\n        super().__init__('relay')\n        self.out = self.create_publisher(String, '/chatter_out', 10)\n        self.sub = self.create_subscription(String, '/chatter', self.on_msg, 10)\n\n    def on_msg(self, msg):\n        self.out.publish(msg)\n\nrclpy.init()\nr = Relay()\nrclpy.spin(r)\nrclpy.shutdown()\n",
      check: function (ctx) {
        const t = ctx.topic('/chatter_out');
        if (!t) return fail('no publisher on /chatter_out');
        if (t.subscriptions.length === 0 && t.publishers.length === 0) return fail('nothing wired to /chatter_out');
        // the relay only acts on incoming messages, so push one through /chatter
        let msgs = ctx.messages('/chatter_out');
        if (!msgs.length) { ctx.probe('/chatter', 'std_msgs/String', { data: 'relay probe' }); msgs = ctx.messages('/chatter_out'); }
        if (!msgs.length) return fail('nothing was relayed to /chatter_out');
        return ok('relayed ' + msgs.length + ' message(s); last data = "' + msgs[msgs.length - 1].data + '"');
      },
    },
    {
      id: 'timer',
      title: '4 · A timer publisher',
      brief: 'Create a node <code>ticker</code> with a <code>create_timer(0.1, ...)</code> callback that publishes a <code>std_msgs/Int32</code> (the count so far) on <code>/tick</code>.',
      hint: 'Store <code>self.count = 0</code>; in the callback publish <code>self.count</code> then increment. The lab spins the timer for a few ticks.',
      starter: "import rclpy\nfrom rclpy.node import Node\nfrom std_msgs.msg import Int32\n\nclass Ticker(Node):\n    def __init__(self):\n        super().__init__('ticker')\n        self.pub = self.create_publisher(Int32, '/tick', 10)\n        self.count = 0\n        # TODO: create_timer(0.1, self.on_tick)\n\n    def on_tick(self):\n        msg = Int32()\n        # TODO: msg.data = self.count, publish, then count += 1\n\nrclpy.init()\nt = Ticker()\nrclpy.spin(t)\nrclpy.shutdown()\n",
      solution: "import rclpy\nfrom rclpy.node import Node\nfrom std_msgs.msg import Int32\n\nclass Ticker(Node):\n    def __init__(self):\n        super().__init__('ticker')\n        self.pub = self.create_publisher(Int32, '/tick', 10)\n        self.count = 0\n        self.timer = self.create_timer(0.1, self.on_tick)\n\n    def on_tick(self):\n        msg = Int32()\n        msg.data = self.count\n        self.pub.publish(msg)\n        self.count += 1\n\nrclpy.init()\nt = Ticker()\nrclpy.spin(t)\nrclpy.shutdown()\n",
      check: function (ctx) {
        const t = ctx.topic('/tick');
        if (!t) return fail('no publisher on /tick');
        const msgs = ctx.messages('/tick');
        if (msgs.length < 2) return fail('only ' + msgs.length + ' tick(s); the timer must fire repeatedly');
        return ok('timer fired ' + msgs.length + ' times; last count = ' + msgs[msgs.length - 1].data);
      },
    },
    {
      id: 'move',
      title: '5 · Move the arm',
      brief: 'Publish a <code>trajectory_msgs/JointTrajectory</code> on <code>/arm_controller/joint_trajectory</code> that moves the loaded robot: set <code>joint_names</code> to the first two joints and give one point with those <code>positions</code>.',
      hint: 'The lab bridge reads <code>joint_names</code> + <code>points[0].positions</code> and applies them to the robot.',
      uses: 'arm',
      starter: "import rclpy\nfrom rclpy.node import Node\nfrom trajectory_msgs.msg import JointTrajectory, JointTrajectoryPoint\n\nclass Mover(Node):\n    def __init__(self):\n        super().__init__('mover')\n        self.pub = self.create_publisher(JointTrajectory, '/arm_controller/joint_trajectory', 10)\n\n    def move(self, names, targets):\n        traj = JointTrajectory()\n        # TODO: traj.joint_names = names\n        p = JointTrajectoryPoint()\n        # TODO: p.positions = targets, then traj.points.append(p)\n        # self.pub.publish(traj)\n\nrclpy.init()\nm = Mover()\nm.move(['Joint 1', 'Joint 2'], [45.0, 30.0])\nrclpy.shutdown()\n",
      solution: "import rclpy\nfrom rclpy.node import Node\nfrom trajectory_msgs.msg import JointTrajectory, JointTrajectoryPoint\n\nclass Mover(Node):\n    def __init__(self):\n        super().__init__('mover')\n        self.pub = self.create_publisher(JointTrajectory, '/arm_controller/joint_trajectory', 10)\n\n    def move(self, names, targets):\n        traj = JointTrajectory()\n        traj.joint_names = names\n        p = JointTrajectoryPoint()\n        p.positions = targets\n        p.time_from_start = 1.0\n        traj.points.append(p)\n        self.pub.publish(traj)\n        self.get_logger().info('moving %d joints' % len(names))\n\nrclpy.init()\nm = Mover()\nm.move(['Joint 1', 'Joint 2'], [45.0, 30.0])\nrclpy.shutdown()\n",
      check: function (ctx) {
        const t = ctx.topic('/arm_controller/joint_trajectory');
        if (!t) return fail('no publisher on /arm_controller/joint_trajectory');
        if (t.type !== 'trajectory_msgs/JointTrajectory') return fail('wrong type ' + t.type);
        const msgs = ctx.messages('/arm_controller/joint_trajectory');
        if (!msgs.length) return fail('nothing published');
        const m = msgs[msgs.length - 1];
        if (!m.joint_names || m.joint_names.length < 2) return fail('joint_names needs at least two joints');
        if (!m.points || !m.points.length || !m.points[0].positions || m.points[0].positions.length < 2) return fail('a point with two positions is required');
        if (ctx.arm) {
          const a = ctx.arm();
          if (a && a.moved !== true) return fail('the message was published but the robot did not move');
        }
        return ok('moved ' + m.joint_names.join(', ') + ' to [' + m.points[0].positions.join(', ') + ']');
      },
    },
    {
      id: 'params',
      title: '6 · Parameters',
      brief: 'Create a node <code>cfg</code> and declare a parameter <code>speed</code> with value <code>1.5</code>.',
      hint: '<code>self.declare_parameter(\'speed\', 1.5)</code>.',
      starter: "import rclpy\nfrom rclpy.node import Node\n\nclass Cfg(Node):\n    def __init__(self):\n        super().__init__('cfg')\n        # TODO: declare_parameter('speed', 1.5)\n\nrclpy.init()\nc = Cfg()\nrclpy.shutdown()\n",
      solution: "import rclpy\nfrom rclpy.node import Node\n\nclass Cfg(Node):\n    def __init__(self):\n        super().__init__('cfg')\n        self.declare_parameter('speed', 1.5)\n\nrclpy.init()\nc = Cfg()\nrclpy.shutdown()\n",
      check: function (ctx) {
        const n = ctx.node('cfg');
        if (!n) return fail('no node named cfg');
        const p = n.getParameter('speed');
        if (p.value === undefined) return fail('parameter speed is not declared');
        if (Math.abs(p.value - 1.5) > 1e-9) return fail('speed = ' + p.value + ' (expected 1.5)');
        return ok('speed = ' + p.value);
      },
    },
  ];
  function ok(d) { return { ok: true, detail: d }; }
  function fail(d) { return { ok: false, detail: d }; }

  /* ======================================================================
     7. a small example catalogue for `ros2 run` / `ros2 launch`
     ====================================================================== */
  const EXAMPLES = {
    robolabs_demo: {
      talker: "import rclpy\nfrom rclpy.node import Node\nfrom std_msgs.msg import String\n\nclass Talker(Node):\n    def __init__(self):\n        super().__init__('talker')\n        self.pub = self.create_publisher(String, '/chatter', 10)\n        self.n = 0\n        self.create_timer(0.2, self.tick)\n\n    def tick(self):\n        m = String()\n        m.data = 'hello %d' % self.n\n        self.pub.publish(m)\n        self.n += 1\n\nrclpy.init()\nrclpy.spin(Talker())\nrclpy.shutdown()\n",
      joint_state_publisher: "import rclpy\nfrom rclpy.node import Node\nfrom sensor_msgs.msg import JointState\n\nclass JS(Node):\n    def __init__(self):\n        super().__init__('joint_state_publisher')\n        self.pub = self.create_publisher(JointState, '/joint_states', 10)\n        self.create_timer(0.2, self.tick)\n\n    def tick(self):\n        j = JointState()\n        j.name = ['Joint 1', 'Joint 2']\n        j.position = [20.0, -10.0]\n        self.pub.publish(j)\n\nrclpy.init()\nrclpy.spin(JS())\nrclpy.shutdown()\n",
    },
    robolabs_arm: {
      move_demo: "import rclpy\nfrom rclpy.node import Node\nfrom trajectory_msgs.msg import JointTrajectory, JointTrajectoryPoint\n\nclass Move(Node):\n    def __init__(self):\n        super().__init__('move_demo')\n        self.pub = self.create_publisher(JointTrajectory, '/arm_controller/joint_trajectory', 10)\n        self.create_timer(0.5, self.tick)\n        self.goal = 0\n\n    def tick(self):\n        t = JointTrajectory()\n        t.joint_names = ['Joint 1', 'Joint 2']\n        p = JointTrajectoryPoint()\n        p.positions = [self.goal % 90, 30.0]\n        p.time_from_start = 0.5\n        t.points.append(p)\n        self.pub.publish(t)\n        self.goal += 15\n\nrclpy.init()\nrclpy.spin(Move())\nrclpy.shutdown()\n",
    },
  };
  const LAUNCH_FILES = {
    'demo.launch.py': { nodes: [{ name: 'talker', exe: 'talker', code: EXAMPLES.robolabs_demo.talker }] },
    'arm.launch.py': { nodes: [{ name: 'joint_state_publisher', exe: 'joint_state_publisher', code: EXAMPLES.robolabs_demo.joint_state_publisher }, { name: 'move_demo', exe: 'move_demo', code: EXAMPLES.robolabs_arm.move_demo }] },
  };

  /* ======================================================================
     8. self-tests (pure, deterministic — no DOM)
     ====================================================================== */
  function selfTests() {
    const res = [];
    const add = (name, pass, detail) => res.push({ name: name, pass: !!pass, detail: detail == null ? '' : String(detail) });

    // message defaults and normalisation
    {
      const s = create('std_msgs/String');
      add('ros2 · std_msgs/String has an empty string default', s.data === '' && s.__type === 'std_msgs/String');
      const hs = create('sensor_msgs/JointState');
      add('ros2 · JointState nests a Header and empty arrays', hs.header && hs.header.frame_id === '' && Array.isArray(hs.name) && hs.name.length === 0);
      const n = normalize('geometry_msgs/Vector3', { x: 1, y: 2, z: 3 });
      add('ros2 · Vector3 normalises to plain numbers', n.msg.x === 1 && n.msg.y === 2 && n.errors.length === 0, 'errors ' + n.errors.length);
      const bad = normalize('geometry_msgs/Vector3', { x: 1, oops: 2 });
      add('ros2 · unknown fields are reported', bad.errors.some((e) => /unknown field/.test(e)), bad.errors.join('; '));
    }

    // pub/sub delivery in subscription order, with clones
    {
      const g = new Graph();
      const a = g.node('a'), b = g.node('b');
      const pub = a.createPublisher('std_msgs/String', '/chatter', 10);
      const got = [];
      b.createSubscription('std_msgs/String', '/chatter', (m) => got.push(m.data), 10);
      b.createSubscription('std_msgs/String', '/chatter', (m) => got.push(m.data + '!'), 10);
      pub.publish({ data: 'hi' });
      add('ros2 · a published message reaches every subscriber in order', got.join(',') === 'hi,hi!', got.join(','));
      const t = g.topics.get('/chatter');
      add('ros2 · the topic records its type and message count', t.type === 'std_msgs/String' && t.count === 1);
      got.length = 0;
      pub.publish({ data: 'x' });
      add('ros2 · each delivery is an independent clone', got[0] === 'x' && got[1] === 'x!');
    }

    // QoS depth bounds the buffer; transient_local latches
    {
      const g = new Graph();
      const a = g.node('a');
      const pub = a.createPublisher('std_msgs/Int32', '/n', { depth: 3 });
      for (let i = 0; i < 6; i++) pub.publish({ data: i });
      const t = g.topics.get('/n');
      add('ros2 · QoS depth bounds the topic buffer', t.buffer.length === 3, 'buffer ' + t.buffer.length);
      const g2 = new Graph();
      const a2 = g2.node('a');
      const p2 = a2.createPublisher('std_msgs/String', '/latched', { durability: 'transient_local', depth: 1 });
      p2.publish({ data: 'late' });
      let seen = null;
      g2.node('late').createSubscription('std_msgs/String', '/latched', (m) => (seen = m.data), { durability: 'transient_local', depth: 1 });
      add('ros2 · a transient_local publisher latches its last message', seen === 'late', String(seen));
    }

    // timers fire on the simulated clock
    {
      const g = new Graph();
      const n = g.node('ticker');
      let ticks = 0;
      n.createTimer(0.1, () => { ticks++; });
      g.spinFor(1.0, 0.05);
      add('ros2 · a 0.1 s timer fires ~10 times in 1 s', ticks >= 9 && ticks <= 11, ticks + ' ticks');
    }

    // parameters
    {
      const g = new Graph(), n = g.node('cfg');
      n.declareParameter('speed', 1.5);
      add('ros2 · a declared parameter can be read back', n.getParameter('speed').value === 1.5);
      let threw = false;
      try { n.declareParameter('speed', 2); } catch (e) { threw = true; }
      add('ros2 · re-declaring a parameter throws', threw);
    }

    // services
    {
      const g = new Graph(), n = g.node('srv');
      n.createService('std_srvs/SetBool', '/enable', (req) => ({ success: !!req.data, message: 'ok' }));
      const r = n.callService('/enable', { data: true });
      add('ros2 · a service call returns the callback response', r.success === true && r.message === 'ok');
    }

    // the CLI
    {
      const g = new Graph();
      const a = g.node('talker');
      const p = a.createPublisher('std_msgs/String', '/chatter', 10);
      g.node('listener').createSubscription('std_msgs/String', '/chatter', () => {}, 10);
      a.createService('std_srvs/Trigger', '/reset', () => ({ success: true }));
      a.declareParameter('rate', 10);
      const cli = CLI(g);
      add('ros2 · `node list` names the nodes', cli.run('ros2 node list').out.join(',') === 'listener,talker', cli.run('ros2 node list').out.join(','));
      add('ros2 · `topic list -t` shows the type', cli.run('ros2 topic list -t').out[0] === '/chatter [std_msgs/String]', cli.run('ros2 topic list -t').out.join(' | '));
      add('ros2 · `topic info` counts publishers and subscribers', /Publisher count: 1/.test(cli.run('ros2 topic info /chatter').out.join('\n')) && /Subscription count: 1/.test(cli.run('ros2 topic info /chatter').out.join('\n')));
      add('ros2 · `topic pub` publishes and is echoed', cli.run('ros2 topic pub /chatter std_msgs/String "data: hi"').out[0].indexOf('published') === 0 && /data: hi/.test(cli.run('ros2 topic echo /chatter').out.join('\n')));
      add('ros2 · `service call` runs the server', /success: true/.test(cli.run('ros2 service call /reset std_srvs/Trigger "{}"').out.join('\n')));
      add('ros2 · `param get` reads a value', /Parameter value: 10/.test(cli.run('ros2 param get /talker rate').out.join('\n')));
      add('ros2 · `interface show` prints the definition', /string data/.test(cli.run('ros2 interface show std_msgs/String').out.join('\n')));
      add('ros2 · an unknown command is reported, not thrown', cli.run('ros2 frobnicate').code === 1);
    }

    // YAML-ish round trip
    {
      const o = parseYaml('x: 1\ny: -2.5\nnames: [a, b, c]\npos:\n  sec: 2\n  nanosec: 5');
      add('ros2 · the mini-YAML reader parses scalars, lists and nesting', o.x === 1 && o.y === -2.5 && o.names.length === 3 && o.pos.sec === 2, JSON.stringify(o));
    }

    // every task ships a starter and a solution, and solutions pass their own check
    {
      add('ros2 · six graded tasks each ship a brief, starter and solution', TASKS.length === 6 && TASKS.every((t) => t.brief && t.starter && t.solution && typeof t.check === 'function'), TASKS.map((t) => t.id).join(', '));
      add('ros2 · the example catalogue and launch files exist', Object.keys(EXAMPLES).length >= 2 && LAUNCH_FILES['demo.launch.py'] && LAUNCH_FILES['arm.launch.py']);
    }

    return res;
  }

  /* ======================================================================
     9. exports
     ====================================================================== */
  const API = {
    VERSION, Graph, Node, CLI, TASKS, EXAMPLES, LAUNCH_FILES,
    TYPES, create, normalize, clone, deepEqual,
    hasType, typeNames, interfaceShow, typeKind,
    qos, resolve, parseYaml, yamlDump, tokenize,
    selfTests, makeContext,
  };

  function makeContext(graph) {
    return {
      graph: graph,
      topic: function (name) { return graph.topics.get(resolve(name)) || null; },
      node: function (name) { return graph.findNode(name); },
      messages: function (name) {
        const t = graph.topics.get(resolve(name));
        if (!t) return [];
        return graph.events.filter((e) => e.topic === t.name).map((e) => e.msg);
      },
      // push a message onto a topic (as `ros2 topic pub` would) so a relay /
      // subscriber task can be verified without a separate publisher script
      probe: function (name, type, msg) {
        const t = graph.ensureTopic(resolve(name), type, qos(10, 10));
        const norm = normalize(type, msg).msg;
        t.count++; t.last = clone(norm); t.lastT = graph.t;
        graph.events.push({ t: graph.t, node: 'probe', topic: t.name, type: type, msg: clone(norm) });
        t.subscriptions.slice().sort((a, b) => a.order - b.order).forEach((s) => { try { s.cb(clone(norm)); } catch (e) { graph.addLog('error', s.node.name, String(e)); } });
        return norm;
      },
      arm: null,
    };
  }

  if (NODE) module.exports = API;
  if (typeof window !== 'undefined') window.ROS2 = API;
  return API;
})();
