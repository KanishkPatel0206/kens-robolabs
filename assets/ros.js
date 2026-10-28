/* ============================================================================
   Ken's RoboLabs v6.2 — ROS 2 Lab (browser UI)
   ----------------------------------------------------------------------------
   Loaded after engine/ros.js (ROS2) and engine/pysub.js (PY), and after
   index.html's own scripts. Mounts the ROS 2 simulation into #rosLab:

     * a terminal that runs `ros2 ...` commands against the live graph;
     * a Python playground (rclpy subset) that publishes on the graph — and,
       when it publishes on /arm_controller/joint_trajectory or /joint_states,
       actually moves the robot in the 3D workspace;
     * a node/topic graph, a message inspector (`ros2 topic echo`) and a
       simulated clock with play/step;
     * the six graded tasks from engine/ros.js with Check and Show solution.

   There is no network access and no server: the graph lives in this page.
   ================================================================== */
(function () {
  'use strict';

  var R = window.ROS2;
  var P = window.PY;
  var el = document.getElementById('rosLab');
  if (!R || !P || !el) {
    if (!R || !P) console.warn('v6.2 ROS 2 Lab: engine/ros.js (ROS2) and engine/pysub.js (PY) must load first.');
    return;
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]); }); }
  function say(msg) { try { if (typeof toast === 'function') { toast(msg); return; } } catch (e) { /* ignore */ } console.log('[v6.2 ros] ' + msg); }

  var ARM_TOPIC = '/arm_controller/joint_trajectory';
  var JS_TOPIC = '/joint_states';

  var SANDBOX = [
    'import rclpy',
    'from rclpy.node import Node',
    'from std_msgs.msg import String',
    '',
    '# A free sandbox: run this, then try `ros2 node list` in the terminal.',
    'class Talker(Node):',
    '    def __init__(self):',
    '        super().__init__("talker")',
    '        self.pub = self.create_publisher(String, "/chatter", 10)',
    '        self.n = 0',
    '        self.create_timer(0.2, self.tick)',
    '',
    '    def tick(self):',
    '        m = String()',
    '        m.data = "hello %d" % self.n',
    '        self.pub.publish(m)',
    '        self.get_logger().info("published " + m.data)',
    '        self.n += 1',
    '',
    'rclpy.init()',
    'rclpy.spin(Talker())',
    'rclpy.shutdown()',
    '',
  ].join('\n');

  /* ======================================================================
     1. state
     ====================================================================== */
  var state = {
    graph: null,
    cli: null,
    task: null,
    lang: 'py',
    spinning: false,
    spinTimer: null,
    armMoved: false,
    selectedTopic: null,
    terminal: [],   // { text, cls }
  };

  function newGraph() {
    var g = new R.Graph();
    // so `ros2 run` / `ros2 launch` can start the catalogued example nodes
    g.runner = function (code, ctx) {
      var res = P.run(code, { graph: g, spinSeconds: 1.0 });
      return res.out;
    };
    g.registry = R.EXAMPLES;
    g.launchFiles = R.LAUNCH_FILES;
    state.graph = g;
    state.cli = R.CLI(g);
    state.selectedTopic = null;
    return g;
  }

  /* ======================================================================
     2. the arm bridge — a ROS node that drives the 3D robot
     ====================================================================== */
  function findJointIndex(name) {
    var list = (typeof joints !== 'undefined' && joints) ? joints : [];
    var nm = String(name == null ? '' : name).trim();
    for (var i = 0; i < list.length; i++) if (String(list[i].name).trim() === nm) return i;
    var m = nm.match(/(\d+)\s*$/);
    if (m) { var idx = parseInt(m[1], 10) - 1; if (idx >= 0 && idx < list.length) return idx; }
    return -1;
  }
  function setJoint(idx, value) {
    var j = joints[idx];
    if (!j) return;
    var v = Number(value);
    if (!isFinite(v)) return;
    if (j.type === 'R') j.theta = Math.max(j.min, Math.min(j.max, v));
    else j.d = Math.max(j.min, Math.min(j.max, v));
  }
  function applyTrajectory(msg) {
    if (!msg || !msg.joint_names || !msg.points || !msg.points.length) return false;
    var pt = msg.points[msg.points.length - 1];
    var pos = pt.positions || [];
    var moved = false;
    for (var i = 0; i < msg.joint_names.length; i++) {
      var idx = findJointIndex(msg.joint_names[i]);
      if (idx >= 0 && pos[i] != null) { setJoint(idx, pos[i]); moved = true; }
    }
    if (moved) { state.armMoved = true; refreshRt(); }
    return moved;
  }
  function applyJointState(msg) {
    if (!msg || !msg.name || !msg.position) return false;
    var moved = false;
    for (var i = 0; i < msg.name.length; i++) {
      var idx = findJointIndex(msg.name[i]);
      if (idx >= 0 && msg.position[i] != null) { setJoint(idx, msg.position[i]); moved = true; }
    }
    if (moved) { state.armMoved = true; refreshRt(); }
    return moved;
  }
  // bridge every run through the two well-known arm topics
  function driveArm() {
    var t = state.graph.topics.get(ARM_TOPIC);
    if (t && t.last) applyTrajectory(t.last);
    var js = state.graph.topics.get(JS_TOPIC);
    if (js && js.last) applyJointState(js.last);
  }
  // re-render the robot if the app's workspace functions are in scope
  function refreshRt() {
    try { if (typeof renderAll === 'function') renderAll(); else if (typeof renderRobot === 'function') renderRobot(); } catch (e) { /* ignore */ }
  }

  /* ======================================================================
     3. mounting the markup
     ====================================================================== */
  el.innerHTML =
    '<div class="ros-grid">' +
      '<div class="ros-col">' +
        '<section class="ros-panel">' +
          '<div class="ros-panel-head"><h2>▮ Terminal</h2><span class="ros-note">simulated <span class="mono">ros2</span> CLI — no network</span></div>' +
          '<div class="ros-term" id="rosTerm" role="log" aria-label="Terminal output" aria-live="polite"></div>' +
          '<div class="ros-cmd"><span class="mono" style="align-self:center">$ ros2</span><input id="rosIn" type="text" placeholder="node list" aria-label="ROS 2 command" autocomplete="off" spellcheck="false"><button class="primary" id="rosRunCmd">Run ↵</button></div>' +
          '<div class="ros-chips" id="rosChips"></div>' +
        '</section>' +
        '<section class="ros-panel">' +
          '<div class="ros-panel-head"><h2>✎ Code playground</h2><span class="ros-note" id="rosLangNote">rclpy subset · runs offline in this page</span></div>' +
          '<div class="ros-tabs"><button type="button" class="active" data-lang="py">Python · rclpy</button><button type="button" data-lang="cpp" disabled title="rclcpp tab arrives in a later release">C++ · rclcpp (later)</button></div>' +
          '<textarea class="ros-editor" id="rosCode" spellcheck="false" aria-label="Python editor"></textarea>' +
          '<div class="ros-btn-row"><button class="primary" id="rosExec">▶ Run code</button><button class="soft" id="rosReset">↺ Reset lab</button><button class="soft" id="rosSandbox">Σ Sandbox example</button><button class="soft" id="rosClearOut">Clear output</button></div>' +
          '<div class="ros-out" id="rosPyOut" role="log" aria-live="polite"></div>' +
          '<p class="ros-note" id="rosExecNote"></p>' +
        '</section>' +
        '<section class="ros-panel">' +
          '<div class="ros-panel-head"><h2>✓ Graded tasks</h2><span class="ros-note">select a task, code it, press Check</span></div>' +
          '<div id="rosTasks"></div>' +
          '<div class="ros-btn-row"><button class="primary" id="rosCheck">Check my code</button><button class="soft" id="rosSolution">Show &amp; run solution</button><button class="soft" id="rosStarter">Load starter</button></div>' +
          '<div id="rosVerdict"></div>' +
        '</section>' +
      '</div>' +
      '<div class="ros-col">' +
        '<section class="ros-panel">' +
          '<div class="ros-panel-head"><h2>◉ Node / topic graph</h2><button class="soft" id="rosGraphRefresh">↻ Refresh</button></div>' +
          '<svg class="ros-svg" id="rosGraph" viewBox="0 0 760 300" role="img" aria-label="Nodes, topics, publishers and subscribers"></svg>' +
          '<div class="ros-kv" id="rosStats"></div>' +
        '</section>' +
        '<section class="ros-panel">' +
          '<div class="ros-panel-head"><h2>◎ Message inspector</h2><span class="ros-note">click a topic to echo its last message</span></div>' +
          '<div class="ros-topic-list" id="rosTopics"></div>' +
          '<div class="ros-echo" id="rosEcho">Run some code to create topics, then pick one here.</div>' +
        '</section>' +
        '<section class="ros-panel">' +
          '<div class="ros-panel-head"><h2>⏱ Simulated clock</h2></div>' +
          '<div class="ros-clock"><span>t = <b id="rosClock">0.000</b> s</span>' +
            '<button class="soft" id="rosStep">Step 0.5 s</button>' +
            '<button class="soft" id="rosPlay">▶ Play</button>' +
            '<button class="soft" id="rosTick">Publish tick</button></div>' +
          '<p class="ros-note">Timers fire on this clock. <span class="mono">rclpy.spin(node)</span> advances it for 2 s; Play advances it live and keeps driving the robot.</p>' +
          '<div class="ros-kv"><div><div class="caps">Nodes</div><b id="rosStatNodes">0</b></div><div><div class="caps">Topics</div><b id="rosStatTopics">0</b></div><div><div class="caps">Messages</div><b id="rosStatMsgs">0</b></div></div>' +
        '</section>' +
      '</div>' +
    '</div>' +
    '<section class="ros-panel" style="margin-top:14px">' +
      '<div class="ros-panel-head"><h2>≡ What this simulation is (and is not)</h2></div>' +
      '<p class="ros-note">GitHub Pages cannot run a real ROS 2 stack — that needs DDS, <span class="mono">rclpy</span> and the daemon. This lab is a faithful <b>simulation</b> of the parts you practise: a real pub/sub graph with message types, QoS (reliability, durability, depth), parameters, services, actions, timers, a mock <span class="mono">ros2</span> command line, and an rclpy-subset Python runner. Everything stays in your browser: nothing is uploaded and no CDN is fetched. Joint positions are the app’s units — degrees for revolute joints, millimetres for prismatic ones.</p>' +
    '</section>';

  var term = $('#rosTerm'), input = $('#rosIn'), code = $('#rosCode'), pyOut = $('#rosPyOut');
  var graphSvg = $('#rosGraph'), topicsList = $('#rosTopics'), echoBox = $('#rosEcho'), verdictBox = $('#rosVerdict');

  /* ======================================================================
     4. terminal
     ====================================================================== */
  function printTerminal(text, cls) {
    state.terminal.push({ text: String(text == null ? '' : text), cls: cls || '' });
    if (state.terminal.length > 300) state.terminal.shift();
    paintTerminal();
  }
  function paintTerminal() {
    term.innerHTML = state.terminal.map(function (l) {
      return '<div' + (l.cls ? ' class="' + l.cls + '"' : '') + '>' + esc(l.text) + '</div>';
    }).join('');
    term.scrollTop = term.scrollHeight;
  }
  function runTerminal(line) {
    var cmd = String(line || '').trim();
    if (!cmd) return;
    printTerminal('$ ros2 ' + cmd, 'ros-dim');
    var res;
    try { res = state.cli.run('ros2 ' + cmd); }
    catch (e) { printTerminal('error: ' + (e && e.message ? e.message : e), 'ros-err'); return; }
    (res.out || []).forEach(function (l) { printTerminal(l, res.code ? 'ros-err' : ''); });
    if (!res.out || !res.out.length) printTerminal('(no output)', 'ros-dim');
    if (res.code) printTerminal('exit code ' + res.code, 'ros-warn');
    refreshAll();
  }

  /* ======================================================================
     5. Python playground
     ====================================================================== */
  function printPy(lines) {
    pyOut.textContent = (lines || []).join('\n');
    pyOut.scrollTop = pyOut.scrollHeight;
  }
  function runCode(src, spinSeconds) {
    state.armMoved = false;
    var res = P.run(src, { graph: state.graph, spinSeconds: spinSeconds == null ? 2.0 : spinSeconds });
    var lines = (res.out || []).slice();
    if (!res.ok) {
      lines.push('Traceback (most recent call last):');
      lines.push('  File "<roblabs>", line ' + (res.line || '?'));
      lines.push(String(res.error || 'Error'));
    } else {
      lines.push('— finished; graph updated —');
    }
    printPy(lines);
    driveArm();
    refreshAll();
    return res;
  }

  /* ======================================================================
     6. graph SVG
     ====================================================================== */
  function renderGraph() {
    var g = state.graph;
    var nodes = g.nodes.slice();
    var topics = Array.from(g.topics.values()).filter(function (t) { return t.publishers.length || t.subscriptions.length; });
    var H = Math.max(230, Math.max(nodes.length, topics.length) * 54 + 40);
    graphSvg.setAttribute('viewBox', '0 0 760 ' + H);

    function nodeY(name) { var i = 0; for (var k = 0; k < nodes.length; k++) if (nodes[k].name === name) { i = k; break; } return 34 + i * 54; }
    function topicY(name) { var i = 0; for (var k = 0; k < topics.length; k++) if (topics[k].name === name) { i = k; break; } return 34 + i * 54; }

    var parts = [];
    parts.push('<text x="14" y="18" font-family="Outfit" font-size="12" fill="#3a5c63">nodes</text>');
    parts.push('<text x="440" y="18" font-family="Outfit" font-size="12" fill="#3a5c63">topics</text>');

    // edges first (so boxes sit on top)
    topics.forEach(function (t) {
      t.publishers.forEach(function (p) {
        parts.push('<line x1="212" y1="' + nodeY(p.node.name) + '" x2="440" y2="' + topicY(t.name) + '" stroke="#2f9d6a" stroke-width="1.4" opacity="0.75"/>');
      });
      t.subscriptions.forEach(function (s) {
        parts.push('<line x1="440" y1="' + topicY(t.name) + '" x2="212" y2="' + nodeY(s.node.name) + '" stroke="#1d5fd6" stroke-width="1.4" stroke-dasharray="4 3" opacity="0.75"/>');
      });
    });

    nodes.forEach(function (n, i) {
      var y = 34 + i * 54;
      parts.push('<rect x="14" y="' + (y - 15) + '" width="198" height="30" rx="8" fill="#dcefe8" stroke="#06617c"/>');
      parts.push('<text x="24" y="' + (y + 4) + '" font-family="JetBrains Mono" font-size="12" fill="#082f3c">' + esc('/' + n.name) + '</text>');
    });
    topics.forEach(function (t, i) {
      var y = 34 + i * 54;
      var pub = t.publishers.length, sub = t.subscriptions.length;
      parts.push('<rect x="440" y="' + (y - 16) + '" width="306" height="32" rx="8" fill="#f9ecc2" stroke="#caa94a"/>');
      parts.push('<text x="450" y="' + (y + 4) + '" font-family="JetBrains Mono" font-size="12" fill="#082f3c">' + esc(t.name) + '</text>');
      parts.push('<text x="634" y="' + (y + 4) + '" text-anchor="end" font-family="JetBrains Mono" font-size="10" fill="#3a5c63">' + pub + '↑ ' + sub + '↓ ' + t.count + 'msg</text>');
    });
    if (!nodes.length && !topics.length) {
      parts.push('<text x="380" y="' + (H / 2) + '" text-anchor="middle" font-family="Outfit" font-size="13" fill="#3a5c63">No nodes yet — run the sandbox or `ros2 run robolabs_demo talker`.</text>');
    }
    graphSvg.innerHTML = parts.join('');
  }

  /* ======================================================================
     7. message inspector + stats
     ====================================================================== */
  function renderTopics() {
    var g = state.graph;
    var topics = Array.from(g.topics.values()).filter(function (t) { return t.publishers.length || t.subscriptions.length; });
    if (!topics.length) { topicsList.innerHTML = '<div class="ros-empty">No topics yet.</div>'; echoBox.textContent = 'Run some code to create topics, then pick one here.'; return; }
    topicsList.innerHTML = topics.map(function (t) {
      var active = t.name === state.selectedTopic ? ' active' : '';
      return '<div class="ros-topic-row' + active + '" data-topic="' + esc(t.name) + '" role="button" tabindex="0">' +
        '<span class="tname">' + esc(t.name) + '</span>' +
        '<span class="ros-badge">' + esc(t.type || '?') + '</span>' +
        '<span class="ros-badge pub">' + t.publishers.length + ' pub</span>' +
        '<span class="ros-badge sub">' + t.subscriptions.length + ' sub</span>' +
        '</div>';
    }).join('');
    Array.prototype.forEach.call(topicsList.querySelectorAll('[data-topic]'), function (row) {
      row.addEventListener('click', function () { state.selectedTopic = row.dataset.topic; renderTopics(); renderEcho(); });
      row.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); } });
    });
  }
  function renderEcho() {
    var t = state.selectedTopic ? state.graph.topics.get(state.selectedTopic) : null;
    if (!t) { echoBox.textContent = 'Pick a topic to echo its last message.'; return; }
    var head = 'ros2 topic echo ' + t.name + '\n' + 'type: ' + (t.type || '?') + '   published: ' + t.count + '\n\n';
    echoBox.textContent = head + (t.last ? R.yamlDump(t.last).replace(/\n$/, '') : '(no messages yet)');
  }
  function renderStats() {
    var g = state.graph;
    var topics = Array.from(g.topics.values()).filter(function (t) { return t.publishers.length || t.subscriptions.length; });
    var msgs = 0; g.topics.forEach(function (t) { msgs += t.count; });
    $('#rosStatNodes').textContent = String(g.nodes.length);
    $('#rosStatTopics').textContent = String(topics.length);
    $('#rosStatMsgs').textContent = String(msgs);
    $('#rosClock').textContent = g.t.toFixed(3);
    $('#rosStats').innerHTML =
      '<div><div class="caps">Name space</div><b>/</b></div>' +
      '<div><div class="caps">Executor</div><b>single-threaded</b></div>' +
      '<div><div class="caps">Nodes</div><b>' + g.nodes.length + '</b></div>' +
      '<div><div class="caps">Topics</div><b>' + topics.length + '</b></div>';
  }

  function refreshAll() { renderGraph(); renderTopics(); renderEcho(); renderStats(); renderTasksDone(); }

  /* ======================================================================
     8. graded tasks
     ====================================================================== */
  function renderTasks() {
    $('#rosTasks').innerHTML = R.TASKS.map(function (t) {
      return '<div class="ros-task' + (t.id === state.task ? ' active' : '') + '" data-task="' + t.id + '" role="button" tabindex="0">' +
        '<b>' + esc(t.title) + '</b>' +
        '<div class="ros-task-brief">' + t.brief + '</div>' +
        '</div>';
    }).join('');
    Array.prototype.forEach.call($('#rosTasks').querySelectorAll('[data-task]'), function (card) {
      card.addEventListener('click', function () { selectTask(card.dataset.task); });
      card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); } });
    });
  }
  function renderTasksDone() {
    if (!state.task) return;
    var card = $('#rosTasks').querySelector('[data-task="' + state.task + '"]');
    Array.prototype.forEach.call($('#rosTasks').querySelectorAll('.ros-task'), function (c) { c.classList.remove('active'); });
    if (card) card.classList.add('active');
  }
  function selectTask(id) {
    var t = R.TASKS.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    state.task = id;
    code.value = t.starter;
    verdictBox.innerHTML = '';
    printPy(['Loaded “' + t.title + '”. Fill in the TODOs, then press Check my code.']);
    newGraph();
    refreshAll();
    renderTasks();
  }
  function currentTask() { return R.TASKS.filter(function (x) { return x.id === state.task; })[0] || null; }
  function showVerdict(v) {
    verdictBox.innerHTML = '<div class="ros-verdict ' + (v.ok ? 'pass' : 'fail') + '">' + (v.ok ? '✓ ' : '✗ ') + esc(v.detail) + '</div>';
  }
  function checkTask() {
    var t = currentTask();
    if (!t) { say('Pick a task first'); return; }
    var res = runCode(code.value, 2.0);
    if (!res.ok) { showVerdict({ ok: false, detail: 'the script did not run: ' + res.error }); return; }
    var ctx = R.makeContext(state.graph);
    ctx.arm = function () { return { moved: state.armMoved }; };
    var v;
    try { v = t.check(ctx); } catch (e) { v = { ok: false, detail: 'check raised: ' + (e && e.message ? e.message : e) }; }
    showVerdict(v);
    say(v.ok ? 'Task passed' : 'Not yet — see the message under the task');
  }

  /* ======================================================================
     9. clock
     ====================================================================== */
  function stepClock(dt) {
    state.graph.spinFor(dt, 0.05);
    driveArm();
    refreshAll();
  }
  function togglePlay() {
    state.spinning = !state.spinning;
    var btn = $('#rosPlay');
    btn.textContent = state.spinning ? '❚❚ Pause' : '▶ Play';
    if (state.spinning) {
      state.spinTimer = setInterval(function () { state.graph.spinFor(0.1, 0.05); driveArm(); refreshAll(); }, 100);
    } else if (state.spinTimer) { clearInterval(state.spinTimer); state.spinTimer = null; }
  }

  /* ======================================================================
     10. wiring
     ====================================================================== */
  var CHIPS = ['node list', 'topic list -t', 'topic info /chatter', 'topic echo /chatter', 'param list', 'interface show std_msgs/String', 'run robolabs_demo talker', 'doctor'];
  $('#rosChips').innerHTML = CHIPS.map(function (c) { return '<button type="button" class="soft" data-chip="' + esc(c) + '">' + esc(c) + '</button>'; }).join('');
  Array.prototype.forEach.call($('#rosChips').querySelectorAll('[data-chip]'), function (b) {
    b.addEventListener('click', function () { input.value = b.dataset.chip; runTerminal(b.dataset.chip); });
  });

  $('#rosRunCmd').addEventListener('click', function () { runTerminal(input.value); input.value = ''; });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { runTerminal(input.value); input.value = ''; } });

  $('#rosExec').addEventListener('click', function () { runCode(code.value, 2.0); });
  $('#rosReset').addEventListener('click', function () { newGraph(); state.terminal = []; paintTerminal(); printPy(['Lab reset — graph cleared.']); refreshAll(); say('Lab reset'); });
  $('#rosSandbox').addEventListener('click', function () { state.task = null; code.value = SANDBOX; verdictBox.innerHTML = ''; printPy(['Sandbox loaded — press Run code.']); renderTasks(); });
  $('#rosClearOut').addEventListener('click', function () { printPy([]); });

  Array.prototype.forEach.call(el.querySelectorAll('[data-lang]'), function (b) {
    b.addEventListener('click', function () {
      if (b.disabled) { say('C++ (rclcpp) arrives in a later release'); return; }
      state.lang = b.dataset.lang;
      Array.prototype.forEach.call(el.querySelectorAll('[data-lang]'), function (x) { x.classList.toggle('active', x === b); });
    });
  });

  $('#rosCheck').addEventListener('click', checkTask);
  $('#rosSolution').addEventListener('click', function () {
    var t = currentTask();
    if (!t) { say('Pick a task first'); return; }
    code.value = t.solution;
    var res = runCode(t.solution, 2.0);
    if (res.ok) {
      var ctx = R.makeContext(state.graph); ctx.arm = function () { return { moved: state.armMoved }; };
      var v = t.check(ctx);
      showVerdict({ ok: v.ok, detail: 'Solution: ' + v.detail });
    } else { showVerdict({ ok: false, detail: 'solution error: ' + res.error }); }
  });
  $('#rosStarter').addEventListener('click', function () {
    var t = currentTask();
    if (!t) { say('Pick a task first'); return; }
    code.value = t.starter; printPy(['Starter reloaded.']);
  });

  $('#rosGraphRefresh').addEventListener('click', refreshAll);
  $('#rosStep').addEventListener('click', function () { stepClock(0.5); });
  $('#rosPlay').addEventListener('click', togglePlay);
  $('#rosTick').addEventListener('click', function () {
    R.CLI(state.graph).run('ros2 topic pub /chatter std_msgs/String "data: manual tick"');
    refreshAll();
  });

  /* ======================================================================
     11. install
     ====================================================================== */
  function install() {
    newGraph();
    code.value = SANDBOX;
    printTerminal('Ken’s RoboLabs — ROS 2 Lab (simulation). Type a command, e.g. `topic list -t`, or run the Python sandbox.', 'ros-ok');
    printTerminal('Note: `ros2 run` starts a catalogue example; try `run robolabs_demo talker`.', 'ros-dim');
    printPy(['Press ▶ Run code to start the sandbox node, then explore the graph on the right.']);
    $('#rosExecNote').textContent = 'Each Run starts from the current graph; `rclpy.spin(node)` advances the simulated clock 2 s so timers fire.';
    refreshAll();
    renderTasks();
    try {
      if (window.RoboRouter && window.RoboRouter.onPage) {
        window.RoboRouter.onPage(function (page) { if (page === 'ros') refreshAll(); });
      }
    } catch (e) { /* ignore */ }
  }

  window.ROSUI = {
    version: R.VERSION,
    graph: function () { return state.graph; },
    cli: function () { return state.cli; },
    runCode: runCode,
    runTerminal: runTerminal,
    checkTask: checkTask,
    selectTask: selectTask,
    stepClock: stepClock,
    applyTrajectory: applyTrajectory,
    applyJointState: applyJointState,
    taskIds: R.TASKS.map(function (t) { return t.id; }),
    newGraph: newGraph,
    refresh: refreshAll,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
