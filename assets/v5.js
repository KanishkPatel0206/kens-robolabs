/* ============================================================================
   Ken's RoboLabs v5 — Professional layer (browser UI, detailed 3D models)
   ----------------------------------------------------------------------------
   Loaded after engine/v5.js (RL5) and after index.html's own scripts, so it can
   read the page's globals (joints, calc, render3D, robotGroup3d, RoboRouter...).

   Adds, without touching the Modified-DH maths:
     * a per-robot "Link (skeleton)  <->  3D model" switch in the 3D viewport
     * a detailed 3D model renderer driven by the real DH geometry
     * six premade robot arms in the library, each with BOTH a skeleton/link
       form and a 3D-model form, plus a static URDF file
     * URDF import (file picker) and URDF export of the current robot
     * the "Professional" page: validated models, inertia tensors, convention
       reference, trajectory v2, workspace metrics, provenance and citations

   No network calls except same-origin fetches of assets/robots/*.urdf.
   ========================================================================== */
(function () {
  'use strict';

  var V5 = window.RL5;
  if (!V5) {
    console.warn('v5 layer: engine/v5.js (RL5) did not load — the Professional page and 3D models are unavailable.');
    return;
  }
  var CORE = (typeof RL !== 'undefined' && RL) ? RL : null;
  if (!CORE) {
    console.warn('v5 layer: the calculation core (RL) is not available.');
    return;
  }

  var DEG = Math.PI / 180, RAD = 180 / Math.PI, M2MM = 1000;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }
  function say(msg) { try { if (typeof toast === 'function') { toast(msg); return; } } catch (e) { /* ignore */ } console.log('[v5] ' + msg); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]); }); }
  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }

  /* ======================================================================
     1. State
     ====================================================================== */
  var LS_MODE = 'robolabs-v5-model-mode';
  var modelMode = false;
  try { modelMode = localStorage.getItem(LS_MODE) === '1'; } catch (e) { /* ignore */ }
  var activeModelId = null;          // premade model currently loaded (if any)

  function setModelMode(on, silent, noRender) {
    modelMode = !!on;
    try { localStorage.setItem(LS_MODE, modelMode ? '1' : '0'); } catch (e) { /* ignore */ }
    var b = $('#v5ModelToggle');
    if (b) {
      b.textContent = modelMode ? '▣ View: 3D model' : '▣ View: Link (skeleton)';
      b.classList.toggle('v5-on', modelMode);
      b.setAttribute('aria-pressed', modelMode ? 'true' : 'false');
      b.title = modelMode
        ? 'Showing detailed 3D model geometry built from the DH parameters — click for the link/skeleton view'
        : 'Showing the link/skeleton view — click for a detailed 3D model';
    }
    if (!noRender) { try { if (typeof render3D === 'function') render3D(); } catch (e) { console.warn('[v5] render after view switch failed', e); } }
    if (!silent && modelMode && !activeModelId) say('3D model view — geometry is generated from the DH parameters');
  }

  /* ======================================================================
     2. Detailed 3D model geometry (mm, Z-up — same scene units as index.html)
     ====================================================================== */
  function v5Materials() {
    var mk = function (c, o) { return new THREE.MeshStandardMaterial(Object.assign({ color: c, metalness: 0.34, roughness: 0.44 }, o || {})); };
    return {
      arm: ['#2273ca', '#c92b34', '#0b7a5c', '#6a45c4'].map(function (c) { return mk(c); }),
      housing: mk('#0d3947', { metalness: 0.55, roughness: 0.32 }),
      dark: mk('#123c4a', { metalness: 0.5, roughness: 0.4 }),
      accent: mk('#f0a71e', { metalness: 0.3, roughness: 0.3 }),
      rubber: mk('#22333d', { metalness: 0.05, roughness: 0.92 }),
      sel: mk('#ffc226', { emissive: '#7a5200', emissiveIntensity: 0.6 }),
      hit: mk('#ff2d20', { emissive: '#4d0a06', emissiveIntensity: 0.55 }),
      tool: mk('#062833', { metalness: 0.6, roughness: 0.3 })
    };
  }

  function v5BuildModel(G) {
    if (!window.THREE || !G) return false;
    var M = v5Materials();
    var V3 = function (a) { return new THREE.Vector3(a[0], a[1], a[2]); };
    var unit = new THREE.Vector3(0, 1, 0), zUnit = new THREE.Vector3(0, 0, 1);

    function box(a, b, w, h, m) {
      var A = V3(a), B = V3(b), d = new THREE.Vector3().subVectors(B, A);
      var L = d.length() || 1;
      var mesh = new THREE.Mesh(new THREE.BoxGeometry(w, L, h), m);
      mesh.position.copy(A).add(B).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(unit, d.clone().normalize());
      G.add(mesh); return mesh;
    }
    function cyl(p, ax, r, len, m, seg) {
      var mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg || 30), m);
      mesh.position.set(p[0], p[1], p[2]);
      mesh.quaternion.setFromUnitVectors(unit, V3(ax).normalize());
      G.add(mesh); return mesh;
    }
    function ring(p, ax, r, tube, m) {
      var mesh = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 10, 30), m);
      mesh.position.set(p[0], p[1], p[2]);
      mesh.quaternion.setFromUnitVectors(zUnit, V3(ax).normalize());
      G.add(mesh); return mesh;
    }
    function ball(p, r, m) {
      var s = new THREE.Mesh(new THREE.SphereGeometry(r, 22, 16), m);
      s.position.set(p[0], p[1], p[2]);
      G.add(s); return s;
    }
    /** Bolt circle of little studs around a joint face. */
    function bolts(p, ax, r, k, m) {
      var z = V3(ax).normalize();
      var ref = Math.abs(z.z) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      var u = new THREE.Vector3().crossVectors(z, ref).normalize();
      var v = new THREE.Vector3().crossVectors(z, u).normalize();
      for (var i = 0; i < k; i++) {
        var a = 2 * Math.PI * i / k;
        var q = new THREE.Vector3(p[0], p[1], p[2]).addScaledVector(u, r * Math.cos(a)).addScaledVector(v, r * Math.sin(a));
        cyl([q.x, q.y, q.z], ax, Math.max(2, r * 0.11), 9, m, 8);
      }
    }

    var Ts = calc().Ts, n = joints.length;
    var col = function (T, k) { return [T[0][k], T[1][k], T[2][k]]; };
    var zFloor = -(window.baseH || 0);

    // --- floor + pedestal -------------------------------------------------
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), new THREE.MeshStandardMaterial({ color: '#78aaa4', transparent: true, opacity: 0.95, side: THREE.DoubleSide, metalness: 0.1, roughness: 0.9 }));
    floor.position.set(300, 0, zFloor - 2); G.add(floor);
    var ped = new THREE.Mesh(new THREE.CylinderGeometry(140, 170, Math.max(30, (window.baseH || 0) + 30), 40), M.dark.clone());
    ped.rotation.x = Math.PI / 2; ped.position.set(0, 0, zFloor + Math.max(15, ((window.baseH || 0) + 30) / 2) - 30); G.add(ped);
    var plate = new THREE.Mesh(new THREE.CylinderGeometry(190, 190, 16, 44), M.housing);
    plate.rotation.x = Math.PI / 2; plate.position.set(0, 0, zFloor + 2); G.add(plate);
    bolts([0, 0, zFloor + 11], [0, 0, 1], 150, 8, M.accent);

    // --- links + joint housings ------------------------------------------
    for (var i = 0; i < n; i++) {
      var j = joints[i], isP = j.type === 'P';
      var hit = window._hit && window._hit.has && window._hit.has(i);
      var m = hit ? M.hit : (selected === i ? M.sel : M.arm[i % M.arm.length]);
      var oP = pos(Ts[i]), oI = pos(Ts[i + 1]);
      var xP = col(Ts[i], 0), zI = col(Ts[i + 1], 2);
      var mid = [oP[0] + (j.a || 0) * xP[0], oP[1] + (j.a || 0) * xP[1], oP[2] + (j.a || 0) * xP[2]];
      var seg = Math.hypot(mid[0] - oP[0], mid[1] - oP[1], mid[2] - oP[2]);
      var span = Math.hypot(oI[0] - oP[0], oI[1] - oP[1], oI[2] - oP[2]);
      var bw = Math.max(16, Math.min(78, span * 0.30));

      // drive housing at the joint origin
      cyl(oP, zI, bw * 0.72, Math.max(46, bw * 1.5), M.housing);
      ring(oP, zI, bw * 0.72, 4.5, M.accent);
      bolts(oI, zI, bw * 0.52, 6, M.dark);

      // the arm casting
      if (isP) {
        // rail + carriage
        var a0 = [mid[0] + j.min * zI[0], mid[1] + j.min * zI[1], mid[2] + j.min * zI[2]];
        var a1 = [mid[0] + j.max * zI[0], mid[1] + j.max * zI[1], mid[2] + j.max * zI[2]];
        cyl(a0, zI, Math.max(5, bw * 0.22), Math.hypot(a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]) || 1, M.rubber, 20);
        if (span > 0.5) box(oP, oI, bw, bw * 0.9, m);
        var cz = (j.d || 0);
        var cpos = [mid[0] + cz * zI[0], mid[1] + cz * zI[1], mid[2] + cz * zI[2]];
        box(cpos, oI, bw * 1.15, bw * 0.95, m);
        cyl(cpos, zI, bw * 0.62, Math.max(34, bw), M.dark);
      } else {
        if (seg > 0.5) box(oP, mid, bw, bw * 0.92, m);
        if (Math.hypot(oI[0] - mid[0], oI[1] - mid[1], oI[2] - mid[2]) > 0.5) box(mid, oI, bw * 0.82, bw * 0.78, m);
        // cable channel rib along the casting
        var rib = [oP[0] + 0.5 * (mid[0] - oP[0]), oP[1] + 0.5 * (mid[1] - oP[1]), oP[2] + 0.5 * (mid[2] - oP[2])];
        cyl(rib, zI, bw * 0.16, Math.max(20, seg * 0.8), M.dark, 14);
        // wrist housing at the far end
        cyl(oI, zI, bw * 0.58, Math.max(38, bw * 1.2), M.housing);
        ring(oI, zI, bw * 0.58, 4, M.accent);
      }
    }

    // --- tool flange / TCP -------------------------------------------------
    var tip = pos(Ts[Ts.length - 1]);
    var tipZ = col(Ts[Ts.length - 1], 2), tipX = col(Ts[Ts.length - 1], 0);
    var toolL = Math.hypot(window.toolOffset || 0, window.toolOffsetZ || 0);
    if (toolL > 1) {
      var pre = pos(Ts[Ts.length - 2]);
      box(pre, tip, 30, 30, M.tool);
    }
    cyl(tip, tipZ, 34, 14, M.tool);
    ring(tip, tipZ, 34, 4, M.accent);
    bolts(tip, tipZ, 24, 4, M.accent);
    var arrow = [tip[0] + tipZ[0] * 34, tip[1] + tipZ[1] * 34, tip[2] + tipZ[2] * 34];
    ball(tip, 8, M.hit);
    return true;
  }

  /* ---- renderer wrapper: model mode draws v5 geometry, link mode is stock ---- */
  function installRenderer() {
    if (typeof render3D !== 'function') return false;
    var base = render3D;
    if (base && base.__v5wrapped) return true;
    var wrapped = function () {
      if (!modelMode || !scene3d || !robotGroup3d) { return base.apply(this, arguments); }
      try {
        // clear the same way the stock renderer does
        [robotGroup3d, frameGroup3d].forEach(function (g) {
          while (g.children.length) {
            var o = g.children.pop();
            if (o.traverse) o.traverse(function (x) { if (x.geometry && x.geometry.dispose) x.geometry.dispose(); var mm = x.material; if (mm) (Array.isArray(mm) ? mm : [mm]).forEach(function (y) { if (y.dispose) y.dispose(); }); });
          }
        });
        // keep the ground grid aligned with the base height (as the stock renderer does)
        var gr = scene3d.children && scene3d.children.filter(function (o) { return o.type === 'GridHelper'; })[0];
        if (gr) gr.position.z = -(window.baseH || 0) - 1;
        v5BuildModel(robotGroup3d);
        // frames + trace (kept identical to the stock renderer so nothing regresses)
        var Ts = calc().Ts;
        if (typeof showFrames !== 'undefined' && showFrames) {
          Ts.forEach(function (T, i) {
            var o = pos(T);
            for (var k = 0; k < 3; k++) {
              var e = [o[0] + T[0][k] * 70, o[1] + T[1][k] * 70, o[2] + T[2][k] * 70];
              frameGroup3d.add(new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(o[0], o[1], o[2]), new THREE.Vector3(e[0], e[1], e[2])]),
                new THREE.LineBasicMaterial({ color: ['#e11d2e', '#0a9d52', '#1d5fd6'][k], depthTest: false })));
            }
          });
        }
        var tip = pos(Ts[Ts.length - 1]);
        if (typeof trace3DPoints !== 'undefined') {
          trace3DPoints.push(tip.slice());
          if (trace3DPoints.length > 150) trace3DPoints.shift();
          if (typeof trace !== 'undefined' && trace && trace3DPoints.length > 1) {
            frameGroup3d.add(new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(trace3DPoints.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); })),
              new THREE.LineBasicMaterial({ color: '#e8590c' })));
          }
        }
      } catch (e) {
        console.warn('[v5] detailed model render failed, falling back to the link view:', e);
        return base.apply(this, arguments);
      }
    };
    wrapped.__v5wrapped = true;
    try { render3D = wrapped; } catch (e) { /* ignore */ }
    window.render3D = wrapped;
    return true;
  }

  function installToggle() {
    var tools = $('.viewport-tools');
    if (!tools || $('#v5ModelToggle')) return;
    var b = el('button', 'v5-toggle', '');
    b.id = 'v5ModelToggle';
    b.type = 'button';
    b.addEventListener('click', function () { setModelMode(!modelMode); });
    tools.appendChild(b);
    setModelMode(modelMode, true);
  }

  /* ======================================================================
     3. Page <-> engine bridges
     ====================================================================== */
  /** [toolOffsetX, toolOffsetZ] in mm, read from the workspace's own bindings. */
  function pageTool() {
    var tx = (typeof toolOffset !== 'undefined' && isFinite(toolOffset)) ? Number(toolOffset) : num(window.toolOffset, 0);
    var tz = (typeof toolOffsetZ !== 'undefined' && isFinite(toolOffsetZ)) ? Number(toolOffsetZ) : num(window.toolOffsetZ, 0);
    return [tx, tz];
  }
  /** Write the tool offsets back to the workspace's own bindings. */
  function setPageTool(tx, tz) {
    var x = Math.round((Number(tx) || 0) * 1e6) / 1e6, z = Math.round((Number(tz) || 0) * 1e6) / 1e6;
    window.toolOffset = x; window.toolOffsetZ = z;
    try { toolOffset = x; } catch (e) { /* ignore */ }
    try { toolOffsetZ = z; } catch (e) { /* ignore */ }
  }

  /**
   * Current workspace robot as an RL robot in SI units (metres / radians).
   * Link mass, CoM and inertia are carried across when the joint row has them
   * (an imported URDF, for instance); otherwise they are estimated from the DH
   * geometry with the same slender-rod model the dynamics page uses.
   */
  function pageToRL() {
    var t = pageTool();
    var r = {
      id: 'workspace', name: 'Current workspace robot', scope: 'Current Modified-DH workspace robot',
      convention: 'mdh', gravity: [0, 0, -9.81],
      tool: [t[0] / M2MM, 0, t[1] / M2MM],
      home: joints.map(function () { return 0; }),
      joints: joints.map(function (j) {
        var isP = j.type === 'P';
        return CORE.makeJoint({
          name: j.name, linkName: j.linkName || j.name, type: isP ? 'P' : 'R',
          a: (j.a || 0) / M2MM, alpha: j.alpha || 0,
          d: isP ? 0 : (j.d || 0) / M2MM,
          theta: isP ? (j.theta || 0) : 0,
          qmin: isP ? (j.min || 0) / M2MM : j.min, qmax: isP ? (j.max || 0) / M2MM : j.max,
          mass: j.mass == null ? 1 : j.mass,
          com: Array.isArray(j.com) ? j.com.map(function (v) { return v / M2MM; }) : [0, 0, 0],
          inertia: j.inertia || [0.01, 0.01, 0.01]
        });
      })
    };
    r.joints.forEach(function (_, i) { if (!joints[i].inertia) CORE.autoInertialAt(r, i); });
    return r;
  }
  /** Current joint variables (SI) for the workspace robot. */
  function pageQ() { return joints.map(function (j) { return j.type === 'R' ? j.theta * DEG : j.d / M2MM; }); }

  /**
   * The library preset `key` as an RL robot in SI units, exactly as the
   * workspace would hold it after setPreset(key): the same Modified-DH table
   * plus the preset's tool offsets. This is the reference the premade 3D
   * models are checked against, so "Load" and "Load 3D model" are provably
   * the same robot.
   */
  function presetRobot(key) {
    var js = (typeof defaults !== 'undefined' && defaults[key]) || null;
    if (!js) return null;
    var tx = (typeof presetTool !== 'undefined' && presetTool[key]) || 0;
    var tz = (typeof presetToolZ !== 'undefined' && presetToolZ[key]) || 0;
    var r = {
      id: 'preset:' + key, name: key, convention: 'mdh', gravity: [0, 0, -9.81], home: [],
      tool: [tx / M2MM, 0, tz / M2MM],
      joints: js.map(function (j) {
        var isP = j.type === 'P';
        return CORE.makeJoint({
          name: j.name, linkName: j.name, type: isP ? 'P' : 'R',
          a: (j.a || 0) / M2MM, alpha: j.alpha || 0,
          d: isP ? 0 : (j.d || 0) / M2MM,
          theta: j.theta || 0,
          qmin: isP ? (j.min || 0) / M2MM : (j.min === undefined ? -180 : j.min),
          qmax: isP ? (j.max || 0) / M2MM : (j.max === undefined ? 180 : j.max),
          mass: 1, com: [0, 0, 0], inertia: [0.01, 0.01, 0.01]
        });
      })
    };
    r.joints.forEach(function (_, i) { CORE.autoInertialAt(r, i); });
    return r;
  }

  /** Replace the workspace joints from an RL robot (SI) — keeps the page in mm/deg. */
  function loadRLRobot(robot, opts) {
    opts = opts || {};
    if (!robot || !robot.joints || !robot.joints.length) throw new Error('No joints to load');
    var mdh = robot.convention === 'mdh' ? robot : CORE.convertConvention(robot, 'mdh');
    var next = mdh.joints.map(function (j) {
      var isP = j.type === 'P';
      var lo = (j.qmin === undefined) ? j.min : j.qmin;
      var hi = (j.qmax === undefined) ? j.max : j.qmax;
      if (lo === undefined || hi === undefined) { lo = isP ? -0.1 : -180; hi = isP ? 0.1 : 180; }
      return {
        name: String(j.name || 'Joint'),
        linkName: String(j.linkName || j.name || 'Link'),
        type: isP ? 'P' : 'R',
        alpha: +j.alpha,
        a: +(j.a * M2MM).toFixed(6),
        theta: isP ? +j.theta : +(j.theta),
        d: +(j.d * M2MM).toFixed(6),
        min: isP ? +(lo * M2MM).toFixed(6) : +lo,
        max: isP ? +(hi * M2MM).toFixed(6) : +hi,
        mass: j.mass == null ? 1 : j.mass,
        com: (j.com || [0, 0, 0]).map(function (v) { return v * M2MM; }),
        inertia: j.inertia
      };
    });
    if (typeof snap === 'function') snap();
    joints = next;
    activeModelId = null;
    setPageTool(mdh.tool ? mdh.tool[0] * M2MM : 0, mdh.tool ? mdh.tool[2] * M2MM : 0);
    selected = 0;
    if (typeof tracePoints !== 'undefined') tracePoints = [];
    if (typeof trace3DPoints !== 'undefined') trace3DPoints = [];
    currentPreset = opts.preset || mdh.id || 'custom';
    if (typeof renderAll === 'function') renderAll();
    return mdh;
  }

  /** Premade model -> workspace (mm/deg, MDH). */
  function loadModel(id, mode) {
    var model = V5.MODELS.filter(function (m) { return m.id === id; })[0];
    if (!model) { say('Unknown model: ' + id); return; }
    var next = model.joints.map(function (j) {
      var isP = j.type === 'P';
      return {
        name: j.name,
        linkName: j.linkName || j.name,
        type: isP ? 'P' : 'R',
        alpha: j.alpha || 0,
        a: j.a || 0,
        theta: j.theta || 0,
        d: j.d || 0,
        min: j.min === undefined ? (isP ? -100 : -180) : j.min,
        max: j.max === undefined ? (isP ? 100 : 180) : j.max,
        mass: j.mass == null ? 1 : j.mass,
        com: (j.com || [0, 0, 0]).slice(),          // models are already mm
        inertia: null                              // let the page estimate (as modelToRobot does)
      };
    });
    if (typeof snap === 'function') snap();
    joints = next;
    setPageTool(model.tool ? model.tool[0] : 0, model.tool ? model.tool[1] : 0);
    selected = 0;
    if (typeof tracePoints !== 'undefined') tracePoints = [];
    if (typeof trace3DPoints !== 'undefined') trace3DPoints = [];
    currentPreset = model.preset;             // the library preset this model mirrors
    activeModelId = id;
    setModelMode(mode === 'model', true, true);
    if (typeof renderAll === 'function') renderAll();
    try { window.RoboRouter && window.RoboRouter.go('workspace'); } catch (e) { /* ignore */ }
    refreshPro();
    say(model.name + ' loaded — ' + (modelMode ? '3D model' : 'link/skeleton') + ' view');
  }

  /**
   * The current workspace robot as an RL robot whose DH theta column carries
   * the live joint angle (theta0 = the pose on screen) instead of zero.
   *
   * URDF has no field for "the current q", so something has to be baked into
   * theta0. Baking the angle you are looking at means an exported file
   * reproduces the pose on screen when re-imported, matches the app's own DH
   * table (whose theta column is the live angle), and is identical to the
   * matching premade assets/robots/<preset>.urdf. pageToRL() stays as the
   * zero-offset robot the analysis panels need (q = the live angle).
   */
  function exportRobot() {
    var r = pageToRL();
    r.joints = r.joints.map(function (j, i) {
      var pj = joints[i] || {};
      return Object.assign({}, j, { theta: pj.theta || 0 });
    });
    return r;
  }

  /** Name for an exported document: the loaded model's id, else the preset. */
  function exportName() {
    if (typeof activeModelId === 'string' && activeModelId) return activeModelId;
    return (typeof currentPreset === 'string' && currentPreset) ? currentPreset : 'robot';
  }

  /** The current workspace robot as a standalone URDF document. */
  function exportURDF() {
    var r = exportRobot();
    return V5.robotToURDF(r, { name: exportName().replace(/[^A-Za-z0-9_.-]/g, '_') });
  }

  /** URDF text -> workspace. Returns a report instead of throwing. */
  function importURDF(text, label) {
    var parsed = V5.parseURDF(text);
    if (!parsed.ok) return { ok: false, errors: parsed.errors, warnings: parsed.warnings };
    var imp = V5.urdfToRobot(parsed, { convention: 'mdh', name: parsed.name, file: label || null });
    if (!imp.ok) return { ok: false, errors: imp.errors, warnings: imp.warnings };
    loadRLRobot(imp.robot, { preset: 'urdf:' + parsed.name });
    return { ok: true, errors: [], warnings: imp.warnings || [], name: parsed.name, jointCount: imp.robot.joints.length, residual: imp.residual };
  }

  /* ======================================================================
     4. Library integration — both a link/skeleton and a 3D model per robot
     ====================================================================== */
  var LIB_MAP = {                        // existing library key -> premade model id
    '2r': 'planar2r', scara4: 'scara4', ur5: 'ur5e', puma: 'puma560', irb120: 'irb120', iiwa7: 'iiwa14'
  };
  var MODEL_HREF = function (id) { return 'assets/robots/' + id + '.urdf'; };

  function installLibrary() {
    var grid = $('#libraryPage .matrix-grid');
    if (!grid) return;

    // 1. On the matching teaching robots, offer BOTH forms plus the URDF file.
    Object.keys(LIB_MAP).forEach(function (key) {
      var card = $('[data-lib="' + key + '"]', grid);
      if (!card) return;
      card = card.closest('.panel');
      if (!card || card.dataset.v5) return;
      card.dataset.v5 = '1';
      var id = LIB_MAP[key];
      var loadBtn = $('[data-lib="' + key + '"]', card);
      if (loadBtn) loadBtn.textContent = 'Load link view';
      var row = el('div', 'v5-card-actions');
      row.innerHTML =
        '<button class="soft v5-btn" data-v5-load="' + id + '" data-v5-mode="model">▣ Load 3D model</button>' +
        '<a class="v5-btn v5-link" href="' + MODEL_HREF(id) + '" download="' + id + '.urdf">⤓ URDF</a>';
      card.appendChild(row);
    });

    // 2. The premade URDF catalogue, appended to the library grid.
    var head = el('div', 'v5-sechead');
    head.innerHTML = '<h2>Premade 3D models &amp; URDF files</h2>' +
      '<p class="muted tiny">Procedurally generated industrial geometry driven by the library DH tables. Each entry loads as a <b>link/skeleton</b> or as a <b>3D model</b>, and downloads as a URDF that re-imports to the identical DH table - so both forms are the same robot.</p>';
    grid.appendChild(head);

    V5.MODELS.forEach(function (m) {
      var card = el('div', 'panel v5-catalogue-card');
      card.innerHTML =
        '<div class="v5-row">' +
          '<h2>' + esc(m.name) + '</h2>' +
          '<span class="badge">' + esc(String(m.cat).toUpperCase()) + '</span>' +
        '</div>' +
        '<div class="pose-values v5-meta">' +
          '<span>' + m.dof + ' DOF</span>' +
          '<span>' + m.joints.map(function (j) { return j.type === 'P' ? 'P' : 'R'; }).join('') + '</span>' +
          '<span>reach ≈ ' + m.reach + ' mm</span>' +
          '<span>tool ' + (m.tool ? m.tool[0] + '/' + m.tool[1] : '0/0') + ' mm</span>' +
        '</div>' +
        '<p class="tiny muted">' + esc(m.maker) + ' · ' + esc(m.notes) + '</p>' +
        '<div class="v5-card-actions">' +
          '<button class="soft v5-btn" data-v5-load="' + m.id + '" data-v5-mode="link">⌘ Link view</button>' +
          '<button class="primary v5-btn" data-v5-load="' + m.id + '" data-v5-mode="model">▣ 3D model</button>' +
          '<a class="v5-btn v5-link" href="' + MODEL_HREF(m.id) + '" download="' + m.id + '.urdf">⤓ URDF</a>' +
        '</div>';
      grid.appendChild(card);
    });

    grid.addEventListener('click', function (e) {
      var b = e.target.closest('[data-v5-load]');
      if (!b) return;
      e.preventDefault();
      loadModel(b.dataset.v5Load, b.dataset.v5Mode);
    });
  }

  /* ======================================================================
     5. The Professional page
     ====================================================================== */
  function table(headers, rows) {
    return '<div class="v5-tablewrap"><table class="v5-table"><thead><tr>' +
      headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div>';
  }
  function fmt(v, d) { var n = Number(v); return isFinite(n) ? n.toFixed(d == null ? 4 : d) : '—'; }
  function badge(ok, text) { return '<span class="v5-badge ' + (ok ? 'ok' : 'bad') + '">' + esc(text) + '</span>'; }

  /* The engine self-tests do not depend on page state, so run them once. */
  var testCache = null;
  function engineTests() {
    if (testCache) return testCache;
    var merged = [];
    try { CORE.selfTests().forEach(function (t) { merged.push({ group: 'core', name: t.name, pass: t.pass, detail: t.detail }); }); }
    catch (e) { merged.push({ group: 'core', name: 'core self-tests threw', pass: false, detail: e.message }); }
    try { V5.selfTests().forEach(function (t) { merged.push({ group: 'v5', name: t.name, pass: t.pass, detail: t.detail }); }); }
    catch (e) { merged.push({ group: 'v5', name: 'v5 self-tests threw', pass: false, detail: e.message }); }
    testCache = merged;
    return merged;
  }

  function panelValidation() {
    var page = pageToRL();
    var merged = engineTests().slice();
    // page <-> engine parity on the currently loaded robot.
    // calc() works in mm; the engine works in SI metres, so only the
    // translation column is rescaled before comparing.
    var parity = { pass: true, detail: 'no joints' };
    try {
      var q = pageQ();
      var pageT = calc().T;
      var engineT = CORE.fk(page, q).T;
      var m = 0, i, k;
      for (i = 0; i < 3; i++) for (k = 0; k < 3; k++) m = Math.max(m, Math.abs(pageT[i][k] - engineT[i][k]));
      for (k = 0; k < 3; k++) m = Math.max(m, Math.abs(pageT[k][3] - engineT[k][3] * M2MM));
      parity = { pass: m < 1e-6, detail: 'max |Δ| = ' + m.toExponential(2) + ' (mm/rotation) on the loaded robot' };
      merged.push({ group: 'parity', name: 'Page FK == engine FK (current robot, mm vs SI)', pass: parity.pass, detail: parity.detail });
    } catch (e) {
      merged.push({ group: 'parity', name: 'Page FK == engine FK (current robot, mm vs SI)', pass: false, detail: e.message });
    }

    // Every premade 3D model must be the same robot as its library preset:
    // identical DH table, identical tool offsets and identical FK.
    Object.keys(LIB_MAP).forEach(function (key) {
      var id = LIB_MAP[key];
      var name = 'Premade model "' + id + '" == library preset "' + key + '"';
      try {
        var model = V5.MODELS.filter(function (m) { return m.id === id; })[0];
        if (!model) { merged.push({ group: 'library', name: name, pass: false, detail: 'no such model' }); return; }
        if (model.preset !== key) { merged.push({ group: 'library', name: name, pass: false, detail: 'model mirrors preset "' + model.preset + '" instead' }); return; }
        var A = V5.modelToRobot(model), B = presetRobot(key);
        if (!B) { merged.push({ group: 'library', name: name, pass: false, detail: 'preset "' + key + '" is not in the library' }); return; }
        if (A.joints.length !== B.joints.length) { merged.push({ group: 'library', name: name, pass: false, detail: 'joints ' + A.joints.length + ' vs ' + B.joints.length }); return; }
        var worst = 0, where = '', i, k;
        for (i = 0; i < A.joints.length; i++) {
          if (A.joints[i].type !== B.joints[i].type) { worst = Infinity; where = 'joint ' + (i + 1) + ' type ' + A.joints[i].type + ' vs ' + B.joints[i].type; break; }
          ['a', 'd', 'alpha', 'theta', 'qmin', 'qmax'].forEach(function (f) {
            var dv = Math.abs((A.joints[i][f] || 0) - (B.joints[i][f] || 0));
            if (dv > worst) { worst = dv; where = 'joint ' + (i + 1) + ' ' + f; }
          });
        }
        for (k = 0; k < 3; k++) {
          var dt = Math.abs((A.tool[k] || 0) - (B.tool[k] || 0));
          if (dt > worst) { worst = dt; where = 'tool[' + k + ']'; }
        }
        var fk = 0;
        for (var t = 0; t < 5; t++) {
          var qv = A.joints.map(function (_, ix) { return 0.3 * Math.sin(t + ix); });
          fk = Math.max(fk, CORE.maxAbsDiff(CORE.fk(A, qv).T, CORE.fk(B, qv).T));
        }
        merged.push({ group: 'library', name: name, pass: worst < 1e-12 && fk < 1e-12,
          detail: 'max |Δparam| = ' + worst.toExponential(1) + ' (' + (where || 'none') + '), max |ΔFK| = ' + fk.toExponential(1) });
      } catch (e) {
        merged.push({ group: 'library', name: name, pass: false, detail: e.message });
      }
    });
    var pass = merged.filter(function (t) { return t.pass; }).length;
    var rows = merged.map(function (t) {
      return [badge(t.pass, t.pass ? 'PASS' : 'FAIL'), '<span class="v5-cap">' + t.group + '</span> ' + esc(t.name), '<span class="tiny muted mono">' + esc(t.detail || '') + '</span>'];
    });
    return {
      title: '✔ Validation harness',
      html: '<p>Every claim on this page is backed by a check that runs in your browser. ' +
        badge(pass === merged.length, pass + ' / ' + merged.length + ' passed') +
        ' <button class="soft v5-btn" id="v5Revalidate">Re-run all checks</button></p>' +
        table(['', 'Check', 'Detail'], rows) +
        '<p class="tiny muted">Tolerances: DH round-trip parameters &lt; 1e-8, FK agreement &lt; 1e-12, page↔engine parity &lt; 1e-9.</p>'
    };
  }

  function panelInterop() {
    return {
      title: '⇄ URDF interop',
      html:
        '<p>Export the robot you are looking at as URDF, or import a URDF from any other tool. Import is converted to a link (MDH) chain one joint at a time; the decomposition residual is reported, so an approximate conversion can never be mistaken for an exact one.</p>' +
        '<div class="v5-card-actions">' +
          '<button class="primary v5-btn" id="v5ExportUrdf">⤓ Export current robot (.urdf)</button>' +
          '<button class="soft v5-btn" id="v5CopyUrdf">⧉ Copy URDF</button>' +
          '<button class="soft v5-btn" id="v5ExportClassical">⤓ Export classical-DH URDF</button>' +
          '<label class="v5-btn v5-filebtn">⤒ Import .urdf<input type="file" id="v5ImportUrdf" accept=".urdf,.xml,text/xml,application/xml" hidden></label>' +
        '</div>' +
        '<div id="v5InteropOut" class="analysis-output"></div>' +
        '<p class="tiny muted">URDF uses the modified (Craig) DH convention: each joint origin is the zero-configuration DH transform and the joint axis is the joint-frame z. The exported theta column is the live joint angle, so the file matches this app\'s DH table and the matching premade <code>assets/robots/</code> file, and re-imports into the pose you were looking at. A classical-DH robot is converted to modified DH first (exact, covered by the engine self-tests) because classical DH cannot be written as a single URDF joint.</p>'
    };
  }

  function panelInertia() {
    var r = pageToRL();
    var rows = r.joints.map(function (j, i) {
      var I = CORE.inertiaToMatrix(j.inertia);
      var com = (j.com || [0, 0, 0]).map(function (v) { return (v * M2MM).toFixed(1); });
      return [
        '<b>' + (i + 1) + '</b> ' + esc(j.name),
        fmt(j.mass, 3) + ' kg',
        '<span class="mono tiny">[' + com.join(', ') + '] mm</span>',
        '<span class="mono tiny">' +
          fmt(I[0][0], 5) + ' / ' + fmt(I[0][1], 5) + ' / ' + fmt(I[0][2], 5) + '<br>' +
          fmt(I[1][0], 5) + ' / ' + fmt(I[1][1], 5) + ' / ' + fmt(I[1][2], 5) + '<br>' +
          fmt(I[2][0], 5) + ' / ' + fmt(I[2][1], 5) + ' / ' + fmt(I[2][2], 5) + '</span>'
      ];
    });
    return {
      title: '⚖ Link inertia (full 3×3 tensors)',
      html:
        '<p>Mass, centre of mass and the <b>full symmetric 3×3 inertia tensor</b> of every link, in the link frame (kg·m²). ' +
        'The dynamics core uses the full tensor (off-diagonal products of inertia included) through <code>M(q) = Σ m J<sub>v</sub><sup>T</sup>J<sub>v</sub> + J<sub>ω</sub><sup>T</sup> (R I R<sup>T</sup>) J<sub>ω</sub></code>.</p>' +
        table(['Link', 'Mass', 'CoM', 'Inertia tensor (kg·m²)'], rows) +
        '<div class="v5-row v5-inline" style="margin-top:10px">' +
          '<label>Motor inertia <input id="v5MotorI" type="number" step="0.0001" value="0.001"> kg·m²</label>' +
          '<label>Gear ratio n <input id="v5GearN" type="number" step="1" value="100"></label>' +
          '<span id="v5Reflected" class="v5-badge"></span>' +
        '</div>' +
        '<p class="tiny muted">Reflected motor inertia at the joint is I<sub>ref</sub> = n²·I<sub>motor</sub>. Add it to the joint’s diagonal term when comparing against a real drive chain.</p>'
    };
  }

  function conventionReport() {
    var r = pageToRL();
    var cls = CORE.convertConvention(r, 'classical');
    var back = CORE.convertConvention(cls, 'mdh');
    var worst = 0;
    for (var k = 0; k < 40; k++) {
      var q = r.joints.map(function (j, i) { return 0.3 * Math.sin(k * 0.7 + i); });
      worst = Math.max(worst, CORE.maxAbsDiff(CORE.fk(r, q).T, CORE.fk(back, q).T));
    }
    return { classical: cls, worst: worst };
  }

  function panelConvention() {
    var rep;
    try { rep = conventionReport(); } catch (e) { return { title: '⇄ Convention reference', html: '<p>Conversion unavailable: ' + esc(e.message) + '</p>' }; }
    var rows = rep.classical.joints.map(function (j, i) {
      return [
        '<b>' + (i + 1) + '</b> ' + esc(j.name),
        j.type,
        fmt(j.alpha, 3),
        fmt(j.a * M2MM, 3),
        fmt(j.theta * RAD, 3),
        fmt(j.d * M2MM, 3)
      ];
    });
    return {
      title: '⇄ Convention reference (modified ⇄ classical)',
      html:
        '<p>The workspace computes the <b>modified (Craig)</b> form. This panel shows the equivalent <b>classical (distal)</b> DH table for the same robot, so the model can be moved to textbooks and tools that use classical DH. ' + badge(rep.worst < 1e-9, 'FK parity ' + rep.worst.toExponential(1)) + '</p>' +
        table(['Link', 'Type', 'α(i−1) °', 'a(i−1) mm', 'θ(i) °', 'd(i) mm'], rows) +
        '<p class="tiny muted">The two tables are the same robot: forward kinematics from the classical table reproduces the modified table to ' + rep.worst.toExponential(1) + ' over 40 poses. Use <b>Export classical-DH URDF</b> above to save this form.</p>'
    };
  }

  function plot(canvas, series, opts) {
    opts = opts || {};
    var ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    var lo = [0, 0], hi = [1, 1];
    series.forEach(function (s) {
      s.data.forEach(function (p) {
        lo[0] = Math.min(lo[0], p[0]); hi[0] = Math.max(hi[0], p[0]);
        lo[1] = Math.min(lo[1], p[1]); hi[1] = Math.max(hi[1], p[1]);
      });
    });
    if (hi[0] === lo[0]) hi[0] = lo[0] + 1;
    if (hi[1] === lo[1]) { hi[1] += 1; lo[1] -= 1; }
    var padL = 46, padB = 26, padT = 12, padR = 12;
    var X = function (x) { return padL + (x - lo[0]) / (hi[0] - lo[0]) * (W - padL - padR); };
    var Y = function (y) { return H - padB - (y - lo[1]) / (hi[1] - lo[1]) * (H - padB - padT); };
    ctx.strokeStyle = '#c2d9d2'; ctx.lineWidth = 1;
    for (var i = 0; i <= 4; i++) {
      var yy = padT + i * (H - padT - padB) / 4;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
    }
    series.forEach(function (s) {
      ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.beginPath();
      s.data.forEach(function (p, k) { var x = X(p[0]), y = Y(p[1]); if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.stroke();
    });
    ctx.fillStyle = '#1f4a54'; ctx.font = '11px sans-serif';
    ctx.fillText((opts.xLabel || 't'), W - 60, H - 8);
    ctx.fillText(hi[1].toFixed(2), 4, padT + 10);
    ctx.fillText(lo[1].toFixed(2), 4, H - padB);
  }

  function panelTrajectory() {
    return {
      title: '⌁ Trajectory v2 — jerk-limited & trapezoidal',
      html:
        '<p>Single-shot joint-space moves calculated with a true 7-phase jerk-limited S-curve or a bang-bang trapezoid, then time-scaled so every joint finishes together. The limits are re-checked on the sampled motion; a violation is reported, never hidden.</p>' +
        '<div class="v5-row v5-inline">' +
          '<label>Profile <select id="v5TrajProfile"><option value="s-curve">S-curve (jerk limited)</option><option value="trapezoidal">Trapezoidal</option></select></label>' +
          '<label>v<sub>max</sub> <input id="v5TrajV" type="number" step="0.1" value="1.5"> rad/s</label>' +
          '<label>a<sub>max</sub> <input id="v5TrajA" type="number" step="0.1" value="3"> rad/s²</label>' +
          '<label>j<sub>max</sub> <input id="v5TrajJ" type="number" step="1" value="30"> rad/s³</label>' +
          '<label>Δq fraction <input id="v5TrajFrac" type="number" step="0.05" value="0.5" min="0.05" max="1"> </label>' +
          '<button class="primary v5-btn" id="v5TrajRun">Plan move</button>' +
        '</div>' +
        '<div id="v5TrajOut" class="analysis-output"></div>' +
        '<canvas id="v5TrajPlot" class="v5-plot" width="760" height="230" aria-label="Joint trajectory profile"></canvas>' +
        '<p class="tiny muted">The target is a fraction of each joint’s own range, from its current position, so the plan always starts inside the limits.</p>'
    };
  }

  function panelWorkspace() {
    return {
      title: '◌ Workspace metrics — reachable vs dexterous',
      html:
        '<p>Monte-Carlo sampling of the joint space, classifying poses by the smallest singular value σ<sub>min</sub> of the ' +
        'task Jacobian. Poses with σ<sub>min</sub> above half the median <i>positive</i> σ<sub>min</sub> are held to be <b>dexterous</b> ' +
        '(well conditioned); the rest are reachable but sliding along a singularity. A robot that cannot move in every sampled ' +
        'task direction at any pose has no dexterous set at all, and the panel says so rather than calling everything dexterous.</p>' +
        '<div class="v5-row v5-inline">' +
          '<label>Samples <input id="v5WsN" type="number" min="100" max="20000" step="100" value="2000"></label>' +
          '<button class="primary v5-btn" id="v5WsRun">Sample workspace</button>' +
          '<button class="soft v5-btn" id="v5WsCsv">⤓ CSV</button>' +
        '</div>' +
        '<div id="v5WsOut" class="analysis-output"></div>' +
        '<canvas id="v5WsPlot" class="v5-plot" width="760" height="260" aria-label="Reachable and dexterous workspace projection"></canvas>' +
        '<p class="tiny muted">Projection is the base-frame XY plane. Grey = reachable, teal = dexterous.</p>'
    };
  }

  function panelNullspace() {
    var n = joints.length;
    return {
      title: '⌥ Redundancy & null space',
      html:
        '<p>' + (n > 6
          ? 'This robot has ' + n + ' joints — ' + (n - 6) + ' redundant degree(s). The null-space projector <code>(I − J⁺J)</code> moves the arm while the tool stays put.'
          : 'This robot has ' + n + ' joints, so there is no exploitable null space. Load the 7-DOF redundant arm to see redundancy in action.') + '</p>' +
        '<div class="v5-row v5-inline">' +
          '<label>Damping λ <input id="v5NullLambda" type="number" step="0.0001" value="0.0001"></label>' +
          '<button class="primary v5-btn" id="v5NullRun">Test null-space step</button>' +
        '</div>' +
        '<div id="v5NullOut" class="analysis-output"></div>'
    };
  }

  function panelCatalogue() {
    var rows = V5.MODELS.map(function (m) {
      return [
        '<b>' + esc(m.name) + '</b><br><span class="tiny muted">' + esc(m.maker) +
          ' · library preset <code>' + esc(String(m.preset)) + '</code></span>',
        m.dof + ' · ' + m.joints.map(function (j) { return j.type === 'P' ? 'P' : 'R'; }).join(''),
        m.reach + ' mm',
        (m.tool ? m.tool[0] + ' / ' + m.tool[1] : '0 / 0') + ' mm',
        '<span class="tiny">' + esc(m.source) + '</span>',
        '<a class="v5-btn v5-link" href="' + MODEL_HREF(m.id) + '" download="' + m.id + '.urdf">⤓ .urdf</a>' +
        '<button class="soft v5-btn" data-v5-load="' + m.id + '" data-v5-mode="link">⌘</button>' +
        '<button class="primary v5-btn" data-v5-load="' + m.id + '" data-v5-mode="model">▣</button>'
      ];
    });
    return {
      title: '❖ Premade models & URDF files',
      html:
        '<p>Six arms from the teaching library, each with real link geometry. Every model mirrors one library DH table <b>exactly</b> ' +
        '(see the preset name), so its link/skeleton view, its 3D model and its URDF are all the same robot. Geometry is ' +
        '<b>procedural</b>, built from the DH parameters rather than manufacturer CAD - the kinematics are the trustworthy part, ' +
        'and the validation panel below proves the parameter match.</p>' +
        table(['Model', 'DOF', 'Reach', 'Tool x / z', 'Source', 'Forms'], rows) +
        '<p class="tiny muted">⌘ loads the link/skeleton form, ▣ the 3D model form, ⤓ downloads the URDF. All three describe the same robot.</p>'
    };
  }

  function panelTrust() {
    return {
      title: '⚖ Provenance, accessibility & privacy',
      html:
        '<div class="v5-grid2">' +
          '<div><h3>Provenance</h3><p class="tiny">Premade models use parameters published by the manufacturers or in the robotics literature (sources are listed per model above and in <code>engine/v5.js</code>). Where a manufacturer does not publish link masses, the value is marked as an estimate. Visual geometry is generated from the DH parameters and is explicitly <b>not</b> a manufacturer CAD assembly. Harness numbers in URDF files are illustrative placeholder ratings, not manufacturer specifications.</p></div>' +
          '<div><h3>Accessibility</h3><p class="tiny">Every control is a real button, label or input with a focus ring; the 3D viewport keeps its text alternative and 2D fallback; tables use header cells; colour is never the only signal (PASS/FAIL text accompanies every badge).</p></div>' +
          '<div><h3>Privacy</h3><p class="tiny">Everything runs in your browser. No account, no server, no analytics, no uploads: your robot never leaves this page. The only network requests are same-origin loads of this site’s own files; models are saved locally in <code>localStorage</code> and can be cleared with your browser data.</p></div>' +
          '<div><h3>Hosting</h3><p class="tiny">Static GitHub Pages deployment — sub-path safe URLs, no build step at runtime. The deploy workflow fails if any locally referenced asset (including the vendored Three.js and every premade URDF) is missing from the published artifact.</p></div>' +
        '</div>'
    };
  }

  function buildProPanels() {
    return [panelValidation(), panelInterop(), panelInertia(), panelConvention(), panelTrajectory(), panelWorkspace(), panelNullspace(), panelCatalogue(), panelTrust()];
  }

  function renderPro() {
    var body = $('#proBody');
    if (!body) return;
    var panels = buildProPanels();
    body.innerHTML = panels.map(function (p, i) {
      return '<div class="panel v5-panel" data-v5panel="' + i + '"><div class="panel-head"><h2>' + p.title + '</h2></div>' + p.html + '</div>';
    }).join('');
    bindPro();
  }

  /** Rebuild the professional page, but only when it is the visible page. */
  function refreshPro() {
    try { if (document.body.dataset.page === 'pro') renderPro(); } catch (e) { /* ignore */ }
  }

  function bindPro() {
    var body = $('#proBody');
    if (!body) return;

    var reval = $('#v5Revalidate', body);
    if (reval) reval.addEventListener('click', function () { testCache = null; renderPro(); say('Validation re-run'); });

    var exp = $('#v5ExportUrdf', body);
    if (exp) exp.addEventListener('click', function () {
      try { download('robolabs-' + exportName() + '.urdf', exportURDF(), 'application/xml'); say('URDF exported'); }
      catch (e) { say('URDF export failed: ' + e.message); }
    });
    var cp = $('#v5CopyUrdf', body);
    if (cp) cp.addEventListener('click', function () {
      var xml;
      try { xml = exportURDF(); } catch (e) { say('URDF export failed: ' + e.message); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(xml).then(function () { say('URDF copied'); }, function () { say('Clipboard blocked by the browser'); });
      else say('Clipboard unavailable');
    });
    var expc = $('#v5ExportClassical', body);
    if (expc) expc.addEventListener('click', function () {
      try {
        var cls = CORE.convertConvention(exportRobot(), 'classical');
        download('robolabs-' + exportName() + '-classical.urdf', V5.robotToURDF(cls, { name: 'classical' }), 'application/xml');
        say('Classical-DH URDF exported (converted to modified DH inside the file)');
      } catch (e) { say('Export failed: ' + e.message); }
    });
    var imp = $('#v5ImportUrdf', body);
    if (imp) imp.addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      f.text().then(function (text) {
        var rep = importURDF(text, f.name);
        var out = $('#v5InteropOut');
        if (!rep.ok) {
          if (out) out.innerHTML = '<div class="status v5-badbox"><b>Import refused</b><br>' + rep.errors.map(esc).join('<br>') + '</div>';
          say('URDF import refused (' + rep.errors.length + ' problem(s))');
          return;
        }
        if (out) out.innerHTML = '<div class="status"><b>✓ Imported ' + esc(rep.name) + '</b> — ' + rep.jointCount + ' joints, DH residual ' + (rep.residual || 0).toExponential(1) + '.' +
          (rep.warnings.length ? '<br><span class="tiny muted">' + rep.warnings.map(esc).join('<br>') + '</span>' : '') + '</div>';
        refreshPro();                       // the robot changed: rebuild the panels
        var out2 = $('#v5InteropOut');      // ...then re-print the report on the fresh DOM
        if (out2) out2.innerHTML = '<div class="status"><b>✓ Imported ' + esc(rep.name) + '</b> — ' + rep.jointCount + ' joints, DH residual ' + (rep.residual || 0).toExponential(1) + '.' +
          (rep.warnings.length ? '<br><span class="tiny muted">' + rep.warnings.map(esc).join('<br>') + '</span>' : '') + '</div>';
        say('URDF imported: ' + rep.name);
      }).catch(function (err) { say('Could not read the file: ' + err.message); });
    });

    var mi = $('#v5MotorI', body), gn = $('#v5GearN', body), refl = $('#v5Reflected', body);
    function updReflect() {
      if (!refl) return;
      var v = V5.reflectedInertia(num(mi && mi.value, 0.001), num(gn && gn.value, 100));
      refl.textContent = 'I_ref = ' + fmt(v, 5) + ' kg·m²';
      refl.className = 'v5-badge ok';
    }
    if (mi) mi.addEventListener('input', updReflect);
    if (gn) gn.addEventListener('input', updReflect);
    updReflect();

    var trun = $('#v5TrajRun', body);
    if (trun) trun.addEventListener('click', runTrajectory);

    var wrun = $('#v5WsRun', body);
    if (wrun) wrun.addEventListener('click', runWorkspace);
    var wcsv = $('#v5WsCsv', body);
    if (wcsv) wcsv.addEventListener('click', function () {
      if (!window.__v5ws) { say('Sample the workspace first'); return; }
      var w = window.__v5ws;
      var rows = [['kind', 'x_mm', 'y_mm', 'z_mm']];
      w.reachable.forEach(function (p) { rows.push(['reachable', p[0], p[1], p[2]]); });
      w.dexterous.forEach(function (p) { rows.push(['dexterous', p[0], p[1], p[2]]); });
      download('workspace-metrics.csv', rows.map(function (r) { return r.join(','); }).join('\n'), 'text/csv');
    });

    var nrun = $('#v5NullRun', body);
    if (nrun) nrun.addEventListener('click', runNullspace);

    // The page router re-routes on *any* click (it reads <body data-page>), which
    // would rebuild this page and discard live results. Keep pro-page clicks out
    // of the router: #proBody itself survives every re-render, so bind once.
    if (!body.dataset.v5bound) {
      body.dataset.v5bound = '1';
      body.addEventListener('click', function (e) {
        var b = e.target.closest('[data-v5-load]');
        if (b) { e.preventDefault(); loadModel(b.dataset.v5Load, b.dataset.v5Mode); }
        e.stopPropagation();
      });
    }
  }

  function runTrajectory() {
    var out = $('#v5TrajOut');
    var P = $('#v5TrajProfile').value;
    var vmax = num($('#v5TrajV').value, 1.5), amax = num($('#v5TrajA').value, 3), jmax = num($('#v5TrajJ').value, 30);
    var frac = Math.max(0.05, Math.min(1, num($('#v5TrajFrac').value, 0.5)));
    var r = pageToRL(), q0 = pageQ(), qf = r.joints.map(function (j, i) {
      var lo = j.type === 'R' ? j.qmin * DEG : j.qmin, hi = j.type === 'R' ? j.qmax * DEG : j.qmax;
      var t = q0[i] + (hi - q0[i]) * frac;
      return Math.max(lo, Math.min(hi, t));
    });
    var tr = V5.jointTrajectoryV2(r, q0, qf, { profile: P, vmax: r.joints.map(function () { return vmax; }), amax: r.joints.map(function () { return amax; }), jmax: r.joints.map(function () { return jmax; }), dt: 0.005 });
    var vpk = 0, apk = 0;
    tr.qd.forEach(function (row) { row.forEach(function (v) { vpk = Math.max(vpk, Math.abs(v)); }); });
    tr.qdd.forEach(function (row) { row.forEach(function (v) { apk = Math.max(apk, Math.abs(v)); }); });
    if (out) out.innerHTML =
      '<div class="pose-values"><span>duration ' + fmt(tr.t[tr.t.length - 1], 3) + ' s</span><span>samples ' + tr.q.length + '</span>' +
      '<span>peak |q̇| ' + fmt(vpk, 3) + ' rad/s</span><span>peak |q̈| ' + fmt(apk, 3) + ' rad/s²</span></div>' +
      badge(tr.checks.ok, tr.checks.ok ? 'within all limits' : tr.checks.messages.length + ' limit warning(s)') +
      (tr.checks.ok ? '' : '<div class="status v5-badbox tiny">' + tr.checks.messages.map(esc).join('<br>') + '</div>');
    var cv = $('#v5TrajPlot');
    if (cv) {
      var series = [];
      var cols = ['#2273ca', '#c92b34', '#0b7a5c', '#6a45c4', '#f0a71e', '#0d3947'];
      r.joints.forEach(function (j, i) {
        series.push({ label: j.name, color: cols[i % cols.length], data: tr.t.map(function (t, k) { return [t, tr.qd[k][i]]; }) });
      });
      plot(cv, series, { xLabel: 't (s) · joint velocities (rad/s)' });
    }
  }

  function runWorkspace() {
    var out = $('#v5WsOut');
    var N = Math.max(100, Math.min(20000, num($('#v5WsN') && $('#v5WsN').value, 2000)));
    var r = pageToRL();
    var w;
    try { w = V5.workspaceMetrics(r, { samples: N, seed: 11 }); }
    catch (e) { if (out) out.innerHTML = '<div class="status v5-badbox">' + esc(e.message) + '</div>'; return; }
    window.__v5ws = w;
    var boundsLine = '<p class="tiny muted">Bounds (mm): ' + ['X', 'Y', 'Z'].map(function (n, i) { return n + ' ' + fmt(w.reachVolume[i][0] * M2MM, 0) + ' ... ' + fmt(w.reachVolume[i][1] * M2MM, 0); }).join(' | ') + '</p>';
    if (out) out.innerHTML =
      '<div class="pose-values"><span>' + w.reachable.length + ' reachable</span>' +
      (w.dexterityAvailable
        ? '<span>' + w.dexterous.length + ' dexterous (' + fmt(100 * w.dexterousFraction, 1) + '%)</span><span>threshold ' + w.threshold.toExponential(2) + '</span>'
        : '<span>no dexterous set</span><span>median 0</span>') +
      '<span>' + fmt(100 * w.fullRankFraction, 1) + '% full-rank</span></div>' +
      boundsLine +
      (w.dexterityAvailable ? '' :
        '<div class="status v5-badbox"><b>No dexterous set.</b> Every sampled pose is rank deficient in the task ' +
        'space, so the smallest singular value is ~0 everywhere and no pose is well conditioned. That happens when ' +
        'the robot has fewer independent task directions than the analysis assumes - a planar arm has only two ' +
        'in-plane directions plus its tool angle. Load a 6-DOF arm (UR5-style cobot, PUMA 560-style, IRB 120-style) ' +
        'or the 7-DOF redundant arm to get a meaningful reachable / dexterous split.</div>');
    var cv = $('#v5WsPlot');
    if (cv) plot(cv, [
      { label: 'reachable', color: '#9fb8b3', data: w.reachable.map(function (p) { return [p[0] * M2MM, p[1] * M2MM]; }) },
      { label: 'dexterous', color: '#0b7a5c', data: w.dexterous.map(function (p) { return [p[0] * M2MM, p[1] * M2MM]; }) }
    ], { xLabel: 'X (mm) / Y (mm)' });
    say('Workspace sampled (' + w.reachable.length + ' poses' + (w.dexterityAvailable ? '' : ', no dexterous set') + ')');
  }

  function runNullspace() {
    var out = $('#v5NullOut');
    var r = pageToRL(), q = pageQ();
    var lambda = Math.max(1e-9, num($('#v5NullLambda') && $('#v5NullLambda').value, 1e-4));
    var n = r.joints.length;
    if (n <= 6) {
      if (out) out.innerHTML = '<div class="status">This robot has ' + n + ' joints — no redundancy, so the null-space projection is identically zero. Load the 7-DOF redundant arm to test it.</div>';
      return;
    }
    var gradient = r.joints.map(function (j, i) { return (i % 2 ? 1 : -1) * (j.type === 'R' ? 0.05 : 0.002); });
    var step = V5.nullSpaceStep(r, q, [0, 0, 0, 0, 0, 0], gradient, { lambda: lambda });
    var J = step.J;
    var tcp = [0, 1, 2].map(function (k) { return J[k].reduce(function (s, v, i) { return s + v * step.dq[i]; }, 0); });
    var drift = Math.hypot(tcp[0], tcp[1], tcp[2]);
    var moved = Math.hypot.apply(null, step.projected);
    if (out) out.innerHTML =
      '<div class="pose-values"><span>TCP drift ' + drift.toExponential(2) + ' m</span><span>joint motion ‖Δq‖ ' + moved.toExponential(2) + '</span><span>λ ' + lambda + '</span></div>' +
      badge(drift < 1e-3 && moved > 1e-9, drift < 1e-3 ? 'secondary motion projected into the null space' : 'projection residual is large') +
      '<p class="tiny muted">The secondary goal moves the joints by ‖Δq‖ while the tool moves only ' + drift.toExponential(2) + ' m (damping λ sets the residual).</p>';
  }

  /* ======================================================================
     6. Install
     ====================================================================== */
  function install() {
    installRenderer();
    installToggle();
    installLibrary();
    renderPro();

    // Rebuild the professional page when it is shown, and when the robot changes.
    if (window.RoboRouter && window.RoboRouter.onPage) {
      window.RoboRouter.onPage(function (page) { if (page === 'pro') renderPro(); });
    }

    // Expose a tiny API for tests and for other layers.
    window.RL5UI = {
      setModelMode: setModelMode,
      isModelMode: function () { return modelMode; },
      loadModel: loadModel,
      exportURDF: exportURDF,
      importURDF: importURDF,
      pageToRL: pageToRL,
      pageQ: pageQ,
      presetRobot: presetRobot,
      exportRobot: exportRobot,
      refreshPro: refreshPro,
      renderPro: renderPro,
      runTrajectory: runTrajectory,
      runWorkspace: runWorkspace,
      runNullspace: runNullspace,
      buildModel: v5BuildModel,
      version: '5.0.0'
    };
    console.log('[v5] Professional layer ready (' + V5.MODELS.length + ' premade models)');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
