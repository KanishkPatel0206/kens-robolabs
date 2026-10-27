/* ============================================================================
   Ken's RoboLabs v6 — Practice layer (browser UI)
   ----------------------------------------------------------------------------
   Loaded after engine/practice.js (PRACTICE) and after index.html's own
   scripts. Mounts the self-study practice modules into #practiceModules:

     * a module navigator (eight modules, with per-module progress)
     * the reference documentation and the generated figures for the module
     * a generated quiz: answer, Check, Show solution, per-module score
     * progress remembered in localStorage (robolabs-practice-progress)

   There is no lecture voice and no network access: every question and every
   published solution comes from engine/practice.js, which re-derives each
   answer from the real Modified-DH maths.
   ================================================================== */
(function () {
  'use strict';

  var P = window.PRACTICE;
  if (!P) {
    console.warn('v6 practice layer: engine/practice.js (PRACTICE) did not load — the Learning Center is unavailable.');
    return;
  }

  var LS_KEY = 'robolabs-practice-progress';
  var QUIZ_LEN = 8;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]); }); }
  function say(msg) { try { if (typeof toast === 'function') { toast(msg); return; } } catch (e) { /* ignore */ } console.log('[v6] ' + msg); }

  /* ======================================================================
     1. Progress (localStorage)
     ====================================================================== */
  var prog = { modules: {}, seeds: {}, active: null };
  try {
    var raw = localStorage.getItem(LS_KEY);
    if (raw) {
      var o = JSON.parse(raw);
      if (o && o.modules) prog = { modules: o.modules, seeds: o.seeds || {}, active: o.active || null };
    }
  } catch (e) { /* ignore */ }
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(prog)); } catch (e) { /* ignore */ } }
  function modProg(id) { if (!prog.modules[id]) prog.modules[id] = { seen: 0, correct: 0 }; return prog.modules[id]; }

  /* ======================================================================
     2. Runtime state
     ====================================================================== */
  var state = { active: null, questions: {} };

  function seedFor(id) { if (prog.seeds[id] == null) prog.seeds[id] = 1; return prog.seeds[id]; }

  function build(id) {
    var qs = P.generate(id, seedFor(id), QUIZ_LEN);
    return qs.map(function (q) {
      return { q: q, value: '', chosen: -1, ok: false, ready: false, checkedOnce: false, credited: false, shown: false };
    });
  }
  function cur() { return state.questions[state.active] || (state.questions[state.active] = build(state.active)); }

  function newQuiz() {
    if (!state.active) return;
    prog.seeds[state.active] = (prog.seeds[state.active] || 1) + 1;
    state.questions[state.active] = build(state.active);
    save();
    renderQuiz();
    say('New questions generated');
  }
  function resetModule() {
    if (!state.active) return;
    prog.modules[state.active] = { seen: 0, correct: 0 };
    prog.seeds[state.active] = (prog.seeds[state.active] || 1) + 1;
    state.questions[state.active] = build(state.active);
    save();
    renderNav(); renderQuiz();
    say('Module progress reset');
  }

  /* ======================================================================
     3. Rendering
     ====================================================================== */
  function score(id) { var s = prog.modules[id] || { seen: 0, correct: 0 }; return s; }

  function renderNav() {
    var list = $('#prNavList');
    if (!list) return;
    list.innerHTML = P.MODULES.map(function (m) {
      var s = score(m.id);
      var pct = s.seen ? Math.round(100 * s.correct / s.seen) : 0;
      return '<li>' +
        '<button type="button" class="pr-navbtn' + (m.id === state.active ? ' active' : '') + '" data-mod="' + esc(m.id) + '"' +
        (m.id === state.active ? ' aria-current="true"' : '') + '>' +
        '<span class="pr-navttl">' + esc(m.title) + '</span>' +
        '<span class="pr-navblurb">' + esc(m.blurb) + '</span>' +
        '<span class="pr-navbar" aria-hidden="true"><i style="width:' + pct + '%"></i></span>' +
        '<span class="pr-navscore">' + (s.seen ? (s.correct + ' / ' + s.seen) : 'not started') + '</span>' +
        '</button></li>';
    }).join('');
    var tot = { seen: 0, correct: 0 };
    P.MODULES.forEach(function (m) { var s = score(m.id); tot.seen += s.seen; tot.correct += s.correct; });
    var overall = $('#prOverall');
    if (overall) overall.textContent = tot.seen ? (tot.correct + ' / ' + tot.seen + ' correct') : '8 modules';
  }

  function renderDoc(m) {
    var doc = $('#prDoc');
    if (!doc) return;
    doc.innerHTML = m.doc.map(function (b) {
      if (b.eq != null) return '<div class="pr-eq">' + b.eq + '</div>';
      var s = '';
      if (b.h) s += '<h3>' + b.h + '</h3>';
      if (b.p) s += '<p>' + b.p + '</p>';
      if (b.ul) s += '<ul class="pr-list">' + b.ul.map(function (li) { return '<li>' + li + '</li>'; }).join('') + '</ul>';
      return s;
    }).join('');
  }

  function renderFigures(m) {
    var host = $('#prFigures');
    if (!host) return;
    host.innerHTML = m.figures.map(function (f) {
      return '<figure class="pr-fig"><img src="' + esc(f.src) + '" alt="' + esc(f.caption) + '" loading="lazy">' +
        '<figcaption>' + esc(f.caption) + '</figcaption></figure>';
    }).join('');
  }

  function itemHTML(item, i) {
    var q = item.q;
    var body;
    if (q.kind === 'num') {
      body = '<div class="pr-answer"><input class="pr-in" type="number" step="any" inputmode="decimal" ' +
        'aria-label="Answer for question ' + (i + 1) + '">' +
        (q.unit ? '<span class="pr-unit">' + esc(q.unit) + '</span>' : '') + '</div>';
    } else {
      body = '<div class="pr-choices" role="radiogroup" aria-label="Choices for question ' + (i + 1) + '">' +
        q.choices.map(function (c, k) {
          return '<button type="button" class="pr-choice" role="radio" aria-checked="false" data-k="' + k + '">' +
            '<span class="pr-key">' + String.fromCharCode(65 + k) + '</span><span class="pr-ctext">' + c + '</span></button>';
        }).join('') + '</div>';
    }
    return '<div class="pr-q" data-i="' + i + '">' +
      '<div class="pr-qhead"><span class="pr-qnum">Q' + (i + 1) + '</span>' +
      '<span class="pr-mark" aria-live="polite"></span></div>' +
      '<div class="pr-prompt">' + q.prompt + '</div>' +
      body +
      '<div class="pr-controls">' +
      '<button type="button" class="primary pr-check">Check</button>' +
      '<button type="button" class="soft pr-show">Show solution</button>' +
      '</div>' +
      '<div class="pr-solution hidden"><div class="pr-solhead">Worked solution</div>' + q.solution + '</div>' +
      '</div>';
  }

  function renderQuiz() {
    var host = $('#prQuiz');
    if (!host) return;
    var m = P.module(state.active);
    var items = cur();
    host.innerHTML = items.map(itemHTML).join('');
    items.forEach(function (item, i) { paintItem(i, true); });
    updateScore();
  }

  function updateScore() {
    var el = $('#prScore');
    if (!el) return;
    var items = cur();
    var done = items.filter(function (it) { return it.ready; }).length;
    var ok = items.filter(function (it) { return it.ok; }).length;
    el.textContent = ok + ' / ' + done + ' answered';
    el.className = 'pill ' + (done && ok === done ? 'green' : 'blue');
  }

  function itemNode(i) { return $('#prQuiz .pr-q[data-i="' + i + '"]'); }

  function paintItem(i, silent) {
    var item = cur()[i], node = itemNode(i);
    if (!node) return;
    node.classList.toggle('ok', !!item.ok && item.ready);
    node.classList.toggle('bad', item.ready && !item.ok);
    var mark = $('.pr-mark', node);
    if (mark) mark.innerHTML = item.ready ? (item.ok ? '✓ Correct' : '✗ Not quite — try again or show the solution') : '';
    var sol = $('.pr-solution', node);
    if (sol) sol.classList.toggle('hidden', !item.shown);
    var showBtn = $('.pr-show', node);
    if (showBtn) showBtn.textContent = item.shown ? 'Hide solution' : 'Show solution';
    if (item.q.kind === 'mc') {
      var btns = node.querySelectorAll('.pr-choice');
      for (var k = 0; k < btns.length; k++) {
        var selected = Number(btns[k].getAttribute('data-k')) === item.chosen;
        btns[k].classList.toggle('sel', selected);
        btns[k].setAttribute('aria-checked', selected ? 'true' : 'false');
      }
    }
    if (!silent) updateScore();
  }

  function renderModule() {
    var m = P.module(state.active);
    if (!m) return;
    var t = $('#prTitle'); if (t) t.textContent = m.title;
    var b = $('#prBlurb'); if (b) b.textContent = m.blurb;
    renderDoc(m);
    renderFigures(m);
    renderQuiz();
  }

  function selectModule(id, opts) {
    if (!P.module(id)) id = P.MODULES[0].id;
    state.active = id;
    prog.active = id; save();
    if (!opts || !opts.keepSeed) { /* seed persists per module */ }
    if (!state.questions[id]) state.questions[id] = build(id);
    renderNav();
    renderModule();
  }

  /* ======================================================================
     4. Grading
     ====================================================================== */
  function grade(item) {
    var q = item.q;
    if (q.kind === 'num') {
      var v = parseFloat(item.value);
      if (!isFinite(v)) return { ready: false, ok: false };
      return { ready: true, ok: Math.abs(v - q.answer) <= (q.tol == null ? 0.05 : q.tol) };
    }
    if (item.chosen < 0) return { ready: false, ok: false };
    return { ready: true, ok: item.chosen === q.answerIndex };
  }

  function check(i) {
    var item = cur()[i];
    if (!item) return null;
    var r = grade(item);
    if (!r.ready) { say(item.q.kind === 'num' ? 'Enter a number first' : 'Choose an option first'); return null; }
    item.ok = r.ok; item.ready = true;
    if (!item.checkedOnce) { item.checkedOnce = true; modProg(state.active).seen++; }
    if (r.ok && !item.credited) { item.credited = true; modProg(state.active).correct++; }
    save();
    paintItem(i);
    renderNav();
    return r.ok;
  }

  function toggleSolution(i) {
    var item = cur()[i];
    if (!item) return;
    item.shown = !item.shown;
    paintItem(i);
  }

  /* ======================================================================
     5. Wiring
     ====================================================================== */
  function readAnswer(node, item) {
    if (item.q.kind === 'num') { var inp = $('.pr-in', node); item.value = inp ? inp.value : ''; }
  }

  function onClick(e) {
    var host = $('#prQuiz');
    if (!host || !host.contains(e.target)) return;
    var node = e.target.closest('.pr-q');
    if (!node) return;
    var i = Number(node.getAttribute('data-i'));
    var item = cur()[i];
    if (!item) return;

    if (e.target.closest('.pr-check')) { readAnswer(node, item); check(i); return; }
    if (e.target.closest('.pr-show')) { toggleSolution(i); return; }
    var ch = e.target.closest('.pr-choice');
    if (ch) { item.chosen = Number(ch.getAttribute('data-k')); paintItem(i); return; }
  }

  function onInput(e) {
    var host = $('#prQuiz');
    if (!host || !host.contains(e.target)) return;
    var node = e.target.closest('.pr-q');
    if (!node) return;
    var item = cur()[Number(node.getAttribute('data-i'))];
    if (item && item.q.kind === 'num') item.value = e.target.value;
  }

  function onNavClick(e) {
    var b = e.target.closest('[data-mod]');
    if (!b) return;
    selectModule(b.getAttribute('data-mod'));
  }

  function bindSkeleton() {
    var navList = $('#prNavList');
    if (navList) navList.addEventListener('click', onNavClick);
    var host = $('#prQuiz');
    if (host) { host.addEventListener('click', onClick); host.addEventListener('input', onInput); host.addEventListener('change', onInput); }
    var nb = $('#prNewQuiz'); if (nb) nb.addEventListener('click', newQuiz);
    var rb = $('#prReset'); if (rb) rb.addEventListener('click', resetModule);
  }

  function mount() {
    var host = $('#practiceModules');
    if (!host) return;
    host.innerHTML =
      '<div class="pr-layout">' +
      '<aside class="pr-nav" aria-label="Practice modules">' +
      '<div class="pr-nav-head"><span>Practice modules</span><span class="pr-navsum" id="prOverall"></span></div>' +
      '<ol class="pr-nav-list" id="prNavList"></ol>' +
      '<p class="pr-navnote tiny">Documentation, a generated quiz and a worked solution for each topic. Nothing leaves this page — your progress is stored in this browser only.</p>' +
      '</aside>' +
      '<div class="pr-main">' +
      '<div class="pr-mainhead">' +
      '<div><h2 id="prTitle"></h2><p id="prBlurb" class="pr-blurb"></p></div>' +
      '<div class="pr-mainacts"><button type="button" class="soft" id="prNewQuiz">New questions</button>' +
      '<button type="button" class="soft" id="prReset">Reset module</button></div>' +
      '</div>' +
      '<div class="pr-doc" id="prDoc"></div>' +
      '<div class="pr-figs" id="prFigures"></div>' +
      '<div class="pr-quizhead"><h3>Practice</h3><span class="pill blue" id="prScore">0 / 0 answered</span></div>' +
      '<div id="prQuiz"></div>' +
      '</div>' +
      '</div>';
    bindSkeleton();
    state.active = (prog.active && P.module(prog.active)) ? prog.active : P.MODULES[0].id;
    selectModule(state.active);
  }

  /* ======================================================================
     6. Install
     ====================================================================== */
  function install() {
    if (!$('#practiceModules')) return;
    mount();
    try {
      if (window.RoboRouter && window.RoboRouter.onPage) {
        window.RoboRouter.onPage(function (page) { if (page === 'learn' && !$('#prTitle').textContent) renderModule(); });
      }
    } catch (e) { /* ignore */ }
    window.PRACTICEUI = {
      version: P.VERSION,
      mount: mount,
      selectModule: selectModule,
      newQuiz: newQuiz,
      resetModule: resetModule,
      check: check,
      toggleSolution: toggleSolution,
      moduleCount: P.MODULES.length,
      activeModule: function () { return state.active; },
      questions: cur,
      progress: function () { return prog; },
      moduleProgress: score
    };
    console.log('[v6] Practice layer ready (' + P.MODULES.length + ' modules)');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
