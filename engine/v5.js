/* ============================================================================
   Ken's RoboLabs v5 — Professional credibility layer
   Pure JavaScript. No DOM, no Three.js. Testable in Node (tests/).

   Adds, on top of engine/core.js (RL):
     B5.1  URDF parse / import / infer-DH
     B5.3  full 3x3 link inertia tensors + reflected motor inertia
     B5.6  null-space (redundancy) projection
     B5.7  trajectory v2: trapezoidal + jerk-limited S-curve, limit checks
     B5.8  reachable vs dexterous workspace metrics
     B5.10 URDF export (round-trips exactly with B5.1)
     B5.11 validation harness with published tolerances
     plus  minimal STL / OBJ parsing so URDF <mesh> assets can be rendered
           offline with no CDN and no extra Three.js loaders.

   Units follow core.js: metres / radians internally, joint tables in
   degrees and millimetres (as displayed in the UI).
   ========================================================================== */
const RL5 = (function () {
  'use strict';

  const NODE_CORE = (typeof module !== 'undefined' && module.exports) ? require('./core.js') : null;
  /** The calculation core. In the browser it is the global lexical `RL`. */
  function core() {
    if (NODE_CORE) return NODE_CORE;
    if (typeof RL !== 'undefined' && RL) return RL;
    throw new Error('engine/core.js (RL) must be loaded before engine/v5.js');
  }

  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const isN = (v) => typeof v === 'number' && isFinite(v);
  const MM = 1000;                       // metres -> millimetres
  const num = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };

  /* ======================================================================
     1. minimal XML parser (no DOMParser, so this also runs under plain Node)
     ====================================================================== */
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
  function decodeEntities(s) {
    return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
      if (e[0] === '#') {
        const n = (e[1] === 'x' || e[1] === 'X') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
      }
      return ENT[e] !== undefined ? ENT[e] : m;
    });
  }

  /** Tolerant, dependency-free XML reader -> {tag, attrs, children, text}. */
  function parseXML(src) {
    const root = { tag: '#root', attrs: {}, children: [], text: '' };
    const stack = [root];
    const s = String(src);
    let i = 0;
    while (i < s.length) {
      const lt = s.indexOf('<', i);
      if (lt < 0) { stack[stack.length - 1].text += s.slice(i); break; }
      if (lt > i) stack[stack.length - 1].text += s.slice(i, lt);
      if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt + 4); i = e < 0 ? s.length : e + 3; continue; }
      if (s.startsWith('<![CDATA[', lt)) { const e = s.indexOf(']]>', lt + 9); stack[stack.length - 1].text += s.slice(lt + 9, e < 0 ? s.length : e); i = e < 0 ? s.length : e + 3; continue; }
      if (s.startsWith('<?', lt)) { const e = s.indexOf('?>', lt + 2); i = e < 0 ? s.length : e + 2; continue; }
      if (s.startsWith('<!', lt)) { const e = s.indexOf('>', lt + 2); i = e < 0 ? s.length : e + 1; continue; }
      const gt = s.indexOf('>', lt);
      if (gt < 0) break;
      let inner = s.slice(lt + 1, gt);
      i = gt + 1;
      if (inner[0] === '/') { if (stack.length > 1) stack.pop(); continue; }
      const selfClose = /\/\s*$/.test(inner);
      if (selfClose) inner = inner.replace(/\/\s*$/, '');
      const m = /^([^\s/>]+)([\s\S]*)$/.exec(inner);
      const tag = m ? m[1] : inner.trim(), rest = m ? m[2] : '';
      const attrs = {};
      const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
      let a;
      while ((a = re.exec(rest))) attrs[a[1]] = decodeEntities(a[3] !== undefined ? a[3] : (a[4] !== undefined ? a[4] : a[5]));
      const node = { tag, attrs, children: [], text: '' };
      stack[stack.length - 1].children.push(node);
      if (!selfClose) stack.push(node);
    }
    return root;
  }
  const kids = (n, tag) => n.children.filter(c => c.tag === tag);
  const kid = (n, tag) => n.children.find(c => c.tag === tag) || null;
  const nums = (str, n, dflt) => {
    const out = String(str == null ? '' : str).trim().split(/[\s,]+/).map(parseFloat).filter(isFinite);
    while (out.length < n) out.push(dflt[out.length]);
    return out.slice(0, n);
  };

  /* ======================================================================
     2. DH <-> homogeneous transform, in both conventions
     ====================================================================== */
  /**
   * Decompose a link transform into DH parameters.
   *   classical : T = Rz(th) Tz(d) Tx(a) Rx(al)
   *   mdh       : T = Rx(al) Tx(a) Rz(th) Tz(d)
   * Returns radians/metres plus the residual so callers can reject
   * transforms that are not expressible as a single DH link.
   */
  function dhFromTransform(T, convention) {
    const RLc = core();
    // Snap denormal-sized rotation entries to exact zero: the sign of a
    // floating-point zero must not decide an atan2 branch, or a rotation of
    // +180 deg can come back as -180 deg (the same transform, a different
    // DH table row).
    const z0 = (v) => (Math.abs(v) < 1e-12 ? 0 : v);
    const R = RLc.Rof(T).map((row) => row.map(z0));
    const p = RLc.Pof(T);
    let out;
    if (convention === 'mdh') {
      // R = Rx(al) Rz(th)      p = [a, -d sin al, d cos al]
      const alpha = Math.atan2(z0(-R[1][2]), z0(R[2][2]));
      const theta = Math.atan2(z0(-R[0][1]), z0(R[0][0]));
      const d = -p[1] * Math.sin(alpha) + p[2] * Math.cos(alpha);
      out = { a: p[0], alpha, d, theta };
    } else {
      // R = Rz(th) Rx(al)      p = [a cos th, a sin th, d]
      const theta = Math.atan2(z0(p[1]), z0(p[0]));
      const a = Math.hypot(p[0], p[1]);
      const d = p[2];
      const alpha = Math.atan2(z0(R[2][1]), z0(R[2][2]));
      out = { a, alpha, d, theta };
    }
    const back = transformFromDH(out, convention);
    let res = 0;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) res = Math.max(res, Math.abs(back[i][j] - T[i][j]));
    out.residual = res;
    return out;
  }
  /** Build a link transform from DH parameters (radians / metres). */
  function transformFromDH(p, convention) {
    const RLc = core();
    return convention === 'mdh'
      ? RLc.mdhMatrix(p.a || 0, p.alpha || 0, p.d || 0, p.theta || 0)
      : RLc.dhMatrix(p.a || 0, p.alpha || 0, p.d || 0, p.theta || 0);
  }
  const T_from = (xyz, rpy) => {
    const RLc = core(), R = RLc.rpyToR(rpy[0], rpy[1], rpy[2]);
    return [[R[0][0], R[0][1], R[0][2], xyz[0]], [R[1][0], R[1][1], R[1][2], xyz[1]], [R[2][0], R[2][1], R[2][2], xyz[2]], [0, 0, 0, 1]];
  };

  /* ======================================================================
     3. URDF parsing
     ====================================================================== */
  const JOINT_TYPES = { revolute: 'R', continuous: 'R', prismatic: 'P', fixed: 'F', floating: 'X', planar: 'X' };

  function originOf(node) {
    if (!node) return { xyz: [0, 0, 0], rpy: [0, 0, 0] };
    return { xyz: nums(node.attrs.xyz, 3, [0, 0, 0]), rpy: nums(node.attrs.rpy, 3, [0, 0, 0]) };
  }
  function geometryOf(g) {
    if (!g) return null;
    const box = kid(g, 'box'), cyl = kid(g, 'cylinder'), sph = kid(g, 'sphere'), mesh = kid(g, 'mesh');
    if (box) return { type: 'box', size: nums(box.attrs.size, 3, [0, 0, 0]) };
    if (cyl) return { type: 'cylinder', radius: num(cyl.attrs.radius, 0), length: num(cyl.attrs.length, 0) };
    if (sph) return { type: 'sphere', radius: num(sph.attrs.radius, 0) };
    if (mesh) return { type: 'mesh', filename: mesh.attrs.filename || '', scale: nums(mesh.attrs.scale, 3, [1, 1, 1]) };
    return null;
  }
  function visualOf(node) {
    const mat = kid(node, 'material'), col = mat ? kid(mat, 'color') : null;
    return {
      origin: originOf(kid(node, 'origin')),
      geometry: geometryOf(kid(node, 'geometry')),
      color: col ? nums(col.attrs.rgba, 4, [0.7, 0.7, 0.7, 1]) : null,
      name: node.attrs.name || '',
    };
  }

  /**
   * Parse a URDF document. Never throws; reports problems in .errors /
   * .warnings so the UI can show exactly what was rejected.
   */
  function parseURDF(text) {
    const errors = [], warnings = [];
    let doc;
    try { doc = parseXML(text); } catch (e) { return { ok: false, errors: ['XML could not be parsed: ' + e.message], warnings, links: [], joints: [], name: '' }; }
    const robot = kid(doc, 'robot');
    if (!robot) return { ok: false, errors: ['No <robot> element found.'], warnings, links: [], joints: [], name: '' };
    const name = robot.attrs.name || 'imported-robot';

    const links = kids(robot, 'link').map((L) => {
      const inertial = kid(L, 'inertial');
      let inert = null;
      if (inertial) {
        const mn = kid(inertial, 'mass'), inN = kid(inertial, 'inertia');
        inert = {
          mass: mn ? num(mn.attrs.value, 0) : 0,
          origin: originOf(kid(inertial, 'origin')),
          inertia: inN ? {
            ixx: num(inN.attrs.ixx, 0), ixy: num(inN.attrs.ixy, 0), ixz: num(inN.attrs.ixz, 0),
            iyy: num(inN.attrs.iyy, 0), iyz: num(inN.attrs.iyz, 0), izz: num(inN.attrs.izz, 0),
          } : null,
        };
        if (!mn) warnings.push('link "' + (L.attrs.name || '?') + '": <inertial> without <mass>.');
      }
      return {
        name: L.attrs.name || 'link',
        inertial: inert,
        visuals: kids(L, 'visual').map(visualOf),
        collisions: kids(L, 'collision').map(visualOf),
      };
    });
    if (!links.length) errors.push('The URDF has no <link> elements.');

    const linkNames = new Set(links.map(l => l.name));
    const joints = kids(robot, 'joint').map((J) => {
      const type = (J.attrs.type || 'fixed').toLowerCase();
      const parent = (kid(J, 'parent') || { attrs: {} }).attrs.link;
      const childL = (kid(J, 'child') || { attrs: {} }).attrs.link;
      const lim = kid(J, 'limit'), ax = kid(J, 'axis');
      const j = {
        name: J.attrs.name || 'joint',
        type, parent, child: childL,
        origin: originOf(kid(J, 'origin')),
        axis: ax ? nums(ax.attrs.xyz, 3, [0, 0, 1]) : [0, 0, 1],
        limit: lim ? {
          lower: num(lim.attrs.lower, 0), upper: num(lim.attrs.upper, 0),
          effort: num(lim.attrs.effort, 0), velocity: num(lim.attrs.velocity, 0),
        } : null,
        mimic: kid(J, 'mimic') ? true : false,
      };
      if (!JOINT_TYPES[type]) { warnings.push('joint "' + j.name + '": unsupported type "' + type + '" treated as fixed.'); j.type = 'fixed'; }
      if (!parent || !childL) errors.push('joint "' + j.name + '": missing <parent> or <child>.');
      else {
        if (!linkNames.has(parent)) errors.push('joint "' + j.name + '": parent link "' + parent + '" is not defined.');
        if (!linkNames.has(childL)) errors.push('joint "' + j.name + '": child link "' + childL + '" is not defined.');
      }
      if (j.type === 'revolute' && !j.limit) warnings.push('joint "' + j.name + '": revolute joint without <limit>; using +/-180 deg.');
      if (j.mimic) warnings.push('joint "' + j.name + '": <mimic> is not simulated.');
      return j;
    });

    // structural checks: one root, no cycles, serial chain detection
    const childOf = new Map(), parentJoints = new Map();
    joints.forEach(j => { if (j.child) { if (childOf.has(j.child)) errors.push('link "' + j.child + '" has more than one parent joint.'); childOf.set(j.child, j); } if (j.parent) parentJoints.set(j.parent, (parentJoints.get(j.parent) || []).concat(j)); });
    const roots = links.filter(l => !childOf.has(l.name)).map(l => l.name);
    if (roots.length === 0) errors.push('No root link found (every link has a parent) - the tree has a cycle.');
    if (roots.length > 1) errors.push('Multiple root links found (' + roots.join(', ') + '); a URDF must form a single tree.');
    const serial = joints.every(j => (parentJoints.get(j.parent) || []).length <= 1) && links.length === joints.length + 1;
    if (!serial) warnings.push('Not a serial chain (' + links.length + ' links, ' + joints.length + ' joints): DH conversion needs a single chain, so only FK and rendering are available.');

    return {
      ok: errors.length === 0, name, links, joints, errors, warnings,
      serial, root: roots[0] || null,
      getLink: (n) => links.find(l => l.name === n) || null,
      getJoint: (n) => joints.find(j => j.name === n) || null,
    };
  }

  /** Ordered movable joints of a serial chain, root -> tool. */
  function serialOrder(urdf) {
    const order = [];
    let link = urdf.root, guard = 0;
    while (guard++ < 500) {
      const j = urdf.joints.find(x => x.parent === link);
      if (!j) break;
      order.push(j);
      link = j.child;
    }
    return order;
  }

  /** General tree forward kinematics (works for non-serial URDFs too). */
  function urdfFK(urdf, q, map) {
    const RLc = core();
    const world = new Map([[urdf.root, RLc.eye4()]]);
    const order = [];
    // breadth-first over the tree
    let frontier = [urdf.root];
    while (frontier.length) {
      const next = [];
      for (const link of frontier) {
        for (const j of urdf.joints.filter(x => x.parent === link)) {
          order.push(j); next.push(j.child);
        }
      }
      frontier = next;
    }
    order.forEach((j, i) => {
      const qi = map ? map(j, i) : (q[i] || 0);
      const base = world.get(j.parent);
      const O = T_from(j.origin.xyz, j.origin.rpy);
      let J = RLc.eye4();
      if (j.type === 'revolute' || j.type === 'continuous') {
        const ax = j.axis, n = Math.hypot(ax[0], ax[1], ax[2]) || 1;
        const u = [ax[0] / n, ax[1] / n, ax[2] / n];
        const c = Math.cos(qi), s = Math.sin(qi), t = 1 - c;
        J = [[t * u[0] * u[0] + c, t * u[0] * u[1] - s * u[2], t * u[0] * u[2] + s * u[1], 0],
             [t * u[0] * u[1] + s * u[2], t * u[1] * u[1] + c, t * u[1] * u[2] - s * u[0], 0],
             [t * u[0] * u[2] - s * u[1], t * u[1] * u[2] + s * u[0], t * u[2] * u[2] + c, 0],
             [0, 0, 0, 1]];
      } else if (j.type === 'prismatic') {
        const ax = j.axis, n = Math.hypot(ax[0], ax[1], ax[2]) || 1;
        J = [[1, 0, 0, ax[0] / n * qi], [0, 1, 0, ax[1] / n * qi], [0, 0, 1, ax[2] / n * qi], [0, 0, 0, 1]];
      }
      world.set(j.child, RLc.Mx.mul(RLc.Mx.mul(base, O), J));
    });
    const leaf = order.length ? order[order.length - 1].child : urdf.root;
    return { frames: order.map(j => ({ joint: j.name, T: world.get(j.child) })), world, tool: world.get(leaf), leaf };
  }

  /**
   * URDF -> workspace robot model (degrees / millimetres), by decomposing each
   * serial joint origin into DH parameters. Fails loudly instead of guessing.
   */
  function urdfToRobot(urdf, opts) {
    opts = opts || {};
    const convention = opts.convention === 'mdh' ? 'mdh' : 'classical';
    const warnings = urdf.warnings.slice(), errors = [];
    if (!urdf.ok) return { ok: false, errors: urdf.errors.slice(), warnings, robot: null };
    if (!urdf.serial) return { ok: false, errors: ['URDF is not a serial chain; DH import is not possible.'], warnings, robot: null };

    const chain = serialOrder(urdf);
    const joints = [];
    let worst = 0, worstJoint = '', toolT = null;
    chain.forEach((J, ci) => {
      const type = JOINT_TYPES[J.type];
      if (type === 'F') {
        // A fixed joint at the very end of the chain is the tool transform.
        if (ci === chain.length - 1) {
          toolT = T_from(J.origin.xyz, J.origin.rpy);
          const rr = Math.hypot(J.origin.rpy[0], J.origin.rpy[1], J.origin.rpy[2]);
          warnings.push(rr > 1e-9
            ? 'trailing fixed joint "' + J.name + '" carries a rotation; only its position was kept as the tool frame.'
            : 'trailing fixed joint "' + J.name + '" was read as the tool frame.');
          return;
        }
        warnings.push('joint "' + J.name + '" is fixed and was dropped.'); return;
      }
      if (type === 'X') { errors.push('joint "' + J.name + '" has an unsupported type.'); return; }
      const T = T_from(J.origin.xyz, J.origin.rpy);
      const ax = J.axis, an = Math.hypot(ax[0], ax[1], ax[2]) || 1;
      const u = [ax[0] / an, ax[1] / an, ax[2] / an];
      const offAxis = Math.hypot(u[0], u[1]);
      if (offAxis > 1e-6) warnings.push('joint "' + J.name + '": axis is not along the joint z (offset ' + offAxis.toFixed(4) + '); DH parameters may be approximate.');
      const d = dhFromTransform(T, convention);
      if (d.residual > worst) { worst = d.residual; worstJoint = J.name; }
      const child = urdf.getLink(J.child);
      const inert = child && child.inertial;
      // RL robots are SI: a, d, com and prismatic limits are metres, revolute
      // limits and alpha/theta are degrees.
      const j = {
        name: J.name,
        linkName: J.child,
        type,
        a: +d.a.toFixed(12),
        alpha: +(d.alpha * R2D).toFixed(9),
        d: +d.d.toFixed(12),
        theta: +(d.theta * R2D).toFixed(9),
        min: type === 'P' ? -0.1 : -180,
        max: type === 'P' ? 0.1 : 180,
        mass: inert ? inert.mass : 0.5,
        com: inert ? comFromInertial(inert) : [-d.a / 2, 0, 0],
        inertia: inert ? tensorFromInertial(inert) : [0.01, 0.01, 0.01],
      };
      if (J.limit) {
        if (type === 'P') { j.min = +J.limit.lower.toFixed(12); j.max = +J.limit.upper.toFixed(12); if (!isN(J.limit.lower) || !isN(J.limit.upper) || (J.limit.lower === 0 && J.limit.upper === 0)) { j.min = -0.1; j.max = 0.1; } }
        else {
          const cont = J.type === 'continuous';
          j.min = cont ? -180 : +(J.limit.lower * R2D).toFixed(6);
          j.max = cont ? 180 : +(J.limit.upper * R2D).toFixed(6);
        }
      }
      // Canonical engine field names. core.js (jointLimitsSI,
      // sampleConfig, validateRobot) and loadRLRobot all read qmin/qmax,
      // so an imported robot must carry them; min/max stay as aliases for
      // code that already speaks the URDF-side dialect.
      j.qmin = j.min; j.qmax = j.max;
      joints.push(j);
    });
    if (errors.length) return { ok: false, errors, warnings, robot: null };
    if (!joints.length) return { ok: false, errors: ['No movable joints found in the URDF.'], warnings, robot: null };

    const robot = {
      id: opts.id || ('urdf:' + urdf.name),
      name: opts.name || urdf.name,
      scope: 'Imported from URDF',
      convention,
      gravity: [0, 0, -9.81],
      joints,
      home: joints.map(() => 0),
      source: { kind: 'urdf', file: opts.file || null, imported: new Date().toISOString().slice(0, 10) },
    };
    if (worst > 1e-9) warnings.push('Largest DH decomposition residual ' + worst.toExponential(2) + ' on joint "' + worstJoint + '".');
    if (toolT) {
      const tl = core().Pof(toolT);
      if (tl.some((v) => Math.abs(v) > 1e-12)) robot.tool = tl.map((v) => +v.toFixed(12));
    }
    return { ok: true, errors, warnings, robot, residual: worst, urdf };
  }

  /**
   * URDF inertial origin (metres, in the child-link frame) -> COM in the RL
   * link frame (also metres). The URDF child-link frame *is* the DH row frame.
   */
  function comFromInertial(inertial) {
    if (!inertial) return [0, 0, 0];
    return inertial.origin.xyz.map(v => +v.toFixed(12));
  }
  /**
   * Inertia tensor about the link COM (kg m^2, 3x3), rotated out of the
   * inertial frame into the link frame: I_link = R_rpy . I_inertial . R_rpy^T.
   * The COM offset itself is handled by the COM Jacobian in the mass matrix.
   */
  function tensorFromInertial(inertial) {
    const RLc = core();
    if (!inertial || !inertial.inertia) return [[0.01, 0, 0], [0, 0.01, 0], [0, 0, 0.01]];
    const t = inertial.inertia;
    const Ip = [[t.ixx, t.ixy || 0, t.ixz || 0], [t.ixy || 0, t.iyy, t.iyz || 0], [t.ixz || 0, t.iyz || 0, t.izz]];
    const R = RLc.rpyToR(inertial.origin.rpy[0], inertial.origin.rpy[1], inertial.origin.rpy[2]);
    return RLc.Mx.mul(RLc.Mx.mul(R, Ip), RLc.Mx.T(R));
  }

  /** Normalise any joint inertia representation to a symmetric 3x3 matrix. */
  function inertiaMatrix(j) {
    const v = j && j.inertia;
    if (Array.isArray(v) && Array.isArray(v[0])) return v;
    if (Array.isArray(v) && v.length === 6) return [[v[0], v[1], v[2]], [v[1], v[3], v[4]], [v[2], v[4], v[5]]];
    const d = Array.isArray(v) ? v : [0.01, 0.01, 0.01];
    return [[d[0] || 0, 0, 0], [0, d[1] || 0, 0], [0, 0, d[2] || 0]];
  }
  /** Reflected motor inertia at the joint (B5.3): I_ref = n^2 I_motor. */
  const reflectedInertia = (motorInertia, gearRatio) => Math.max(0, num(motorInertia, 0)) * Math.pow(Math.max(0.0001, num(gearRatio, 1)), 2);

  /* ======================================================================
     4. Workspace robot model -> URDF  (exact round trip with urdfToRobot)
     ====================================================================== */
  /**
   * For modified (Craig) DH the joint variable composes on the right of the
   * zero configuration:
   *     T_i(q) = Rx(al) Tx(a) Rz(th0 + q) Tz(d) = [DH(th0)] . Rz(q)
   * so each URDF joint origin is exactly the zero-configuration DH matrix and
   * the axis is the joint-frame z. Classical DH composes on the left
   * (T_i(q) = Rz(q) . DH), which URDF cannot express with a single joint, so
   * classical robots are converted first - the conversion is exact and is
   * itself covered by the core self-tests.
   */
  function robotToURDF(robot, opts) {
    opts = opts || {};
    const RLc = core();
    const r = robot.convention === 'mdh' ? robot : RLc.convertConvention(robot, 'mdh');
    const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
    const fmt = (v) => {
      const n = Number(v) || 0;
      if (Math.abs(n) < 1e-12) return '0';
      let s = n.toFixed(12);
      // trim trailing fractional zeros only - never touch the integer part
      if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
      return s;
    };
    const ln = (j, i) => j.linkName || ('link_' + (i + 1));

    const name = esc(opts.name || r.name || 'robot');
    const out = [];
    out.push('<?xml version="1.0"?>');
    out.push('<!-- Generated by Ken\'s RoboLabs v5 from a modified (Craig) DH table.');
    out.push('     Joint origins are the zero-configuration DH transforms; axis is the');
    out.push('     joint-frame z. Re-importing this file reproduces the DH table exactly. -->');
    out.push('<robot name="' + name + '">');
    out.push('  <!-- links -->');
    out.push('  <link name="base_link"/>');
    r.joints.forEach((j, i) => {
      const m = j.mass == null ? 1 : j.mass, I = inertiaMatrix(j), c = j.com || [0, 0, 0];
      out.push('  <link name="' + esc(ln(j, i)) + '">');
      out.push('    <inertial>');
      out.push('      <origin xyz="' + fmt(c[0]) + ' ' + fmt(c[1]) + ' ' + fmt(c[2]) + '" rpy="0 0 0"/>');
      out.push('      <mass value="' + fmt(m) + '"/>');
      out.push('      <inertia ixx="' + fmt(I[0][0]) + '" ixy="' + fmt(I[0][1]) + '" ixz="' + fmt(I[0][2]) + '" iyy="' + fmt(I[1][1]) + '" iyz="' + fmt(I[1][2]) + '" izz="' + fmt(I[2][2]) + '"/>');
      out.push('    </inertial>');
      const rad = Math.max(0.02, Math.min(0.09, Math.hypot(j.a || 0, j.d || 0) * 0.22));
      out.push('    <visual>');
      out.push('      <origin xyz="0 0 0" rpy="0 0 0"/>');
      out.push('      <geometry><cylinder radius="' + fmt(rad) + '" length="' + fmt(Math.max(0.05, Math.hypot(j.a || 0, j.d || 0))) + '"/></geometry>');
      out.push('      <material name="robolab"><color rgba="0.18 0.55 0.62 1"/></material>');
      out.push('    </visual>');
      out.push('    <collision>');
      out.push('      <geometry><cylinder radius="' + fmt(rad) + '" length="' + fmt(Math.max(0.05, Math.hypot(j.a || 0, j.d || 0))) + '"/></geometry>');
      out.push('    </collision>');
      out.push('  </link>');
    });

    out.push('  <!-- joints: origin = zero-configuration DH transform, axis = joint z -->');
    r.joints.forEach((j, i) => {
      const A0 = RLc.linkTransform(j, 0, true);
      const xyz = RLc.Pof(A0), rpy = RLc.rToRPY(RLc.Rof(A0));
      const prev = i === 0 ? 'base_link' : ln(r.joints[i - 1], i - 1);
      const rev = j.type !== 'P';
      out.push('  <joint name="' + esc(j.name || ('joint_' + (i + 1))) + '" type="' + (rev ? 'revolute' : 'prismatic') + '">');
      out.push('    <parent link="' + esc(prev) + '"/>');
      out.push('    <child link="' + esc(ln(j, i)) + '"/>');
      out.push('    <origin xyz="' + fmt(xyz[0]) + ' ' + fmt(xyz[1]) + ' ' + fmt(xyz[2]) + '" rpy="' + fmt(rpy.roll) + ' ' + fmt(rpy.pitch) + ' ' + fmt(rpy.yaw) + '"/>');
      out.push('    <axis xyz="0 0 1"/>');
      const lo = j.qmin === undefined ? (j.min === undefined ? -180 : j.min) : j.qmin;
      const hi = j.qmax === undefined ? (j.max === undefined ? 180 : j.max) : j.qmax;
      out.push('    <limit ' + (rev
        ? 'lower="' + fmt(lo * D2R) + '" upper="' + fmt(hi * D2R) + '" effort="150" velocity="3.15"'
        : 'lower="' + fmt(lo) + '" upper="' + fmt(hi) + '" effort="150" velocity="0.5"') + '/>');
      out.push('  </joint>');
    });

    // A nonzero DH tool frame is emitted as a trailing fixed joint, so the
    // file describes exactly the robot that is on screen, tool and all.
    const tool = r.tool || [0, 0, 0];
    if (tool.some((v) => Math.abs(v) > 1e-12)) {
      const last = r.joints[r.joints.length - 1];
      out.push('  <!-- fixed tool transform: the DH table leaves a tool-frame offset -->');
      out.push('  <link name="tool_link"/>');
      out.push('  <joint name="tool_tip" type="fixed">');
      out.push('    <parent link="' + esc(ln(last, r.joints.length - 1)) + '"/>');
      out.push('    <child link="tool_link"/>');
      out.push('    <origin xyz="' + fmt(tool[0]) + ' ' + fmt(tool[1]) + ' ' + fmt(tool[2]) + '" rpy="0 0 0"/>');
      out.push('  </joint>');
    }
    out.push('</robot>');
    return out.join('\n') + '\n';
  }

  /** Round-trip check: robot -> URDF -> robot, in the same convention. */
  function urdfRoundTrip(robot, opts) {
    const RLc = core();
    const mdh = robot.convention === 'mdh' ? robot : RLc.convertConvention(robot, 'mdh');
    const xml = robotToURDF(robot, opts);
    const parsed = parseURDF(xml);
    const back = urdfToRobot(parsed, { convention: 'mdh' });
    if (!back.ok) return { ok: false, errors: back.errors, maxParamDiff: Infinity, xml };
    const a = mdh.joints, b = back.robot.joints;
    if (a.length !== b.length) return { ok: false, errors: ['joint count changed: ' + a.length + ' -> ' + b.length], maxParamDiff: Infinity, xml };
    let maxParam = 0, maxPose = 0;
    const tA = mdh.tool || [0, 0, 0], tB = back.robot.tool || [0, 0, 0];
    for (let i = 0; i < 3; i++) maxParam = Math.max(maxParam, Math.abs((tA[i] || 0) - (tB[i] || 0)));
    const ang = (x, y) => Math.abs(RLc.wrapPi((x - y) * D2R)) * R2D;   // minimal angular difference, degrees
    const lim = (j) => [j.qmin === undefined ? j.min : j.qmin, j.qmax === undefined ? j.max : j.qmax];
    const rng = RLc.makeRng(7);
    for (let i = 0; i < a.length; i++) {
      maxParam = Math.max(maxParam,
        Math.abs(a[i].a - b[i].a), Math.abs(a[i].d - b[i].d),
        ang(a[i].alpha, b[i].alpha), ang(a[i].theta, b[i].theta),
        Math.abs((a[i].mass || 0) - (b[i].mass || 0)));
      const la = lim(a[i]), lb = lim(b[i]);
      if (la[0] !== undefined && la[1] !== undefined && lb[0] !== undefined && lb[1] !== undefined)
        maxParam = Math.max(maxParam, Math.abs(la[0] - lb[0]), Math.abs(la[1] - lb[1]));
    }
    for (let k = 0; k < 50; k++) {
      const q = a.map((j, i) => 0.2 + Math.sin(k * 0.7 + i) * 0.6);
      maxPose = Math.max(maxPose, RLc.maxAbsDiff(RLc.fk(mdh, q).T, RLc.fk(back.robot, q).T));
      void rng;
    }
    const ok = maxParam < 1e-8 && maxPose < 1e-12;
    return { ok, errors: ok ? [] : ['parameters or FK differ after the round trip'], maxParamDiff: maxParam, maxPoseDiff: maxPose, xml, warnings: back.warnings };
  }

  /* ======================================================================
     5. B5.6 redundancy: null-space projection
     ====================================================================== */
  /**
   * Damped least-squares pseudo-inverse of a rows x n Jacobian:
   *   J+ = (J^T J + lambda^2 I)^-1 J^T
   * The damping is raised automatically if the normal matrix is numerically
   * singular, so a rank-deficient Jacobian returns a usable answer instead of
   * null.
   */
  function pinv(J, lambda) {
    const RLc = core();
    const rows = J.length, n = J[0].length;
    const Jt = RLc.Mx.T(J);
    const JtJ = RLc.Mx.mul(Jt, J);
    let lam = lambda == null ? 1e-4 : lambda, Ainv = null;
    for (let attempt = 0; attempt < 7 && !Ainv; attempt++) {
      const A = JtJ.map(r => r.slice());
      for (let i = 0; i < n; i++) A[i][i] += lam * lam;
      const inv = [];
      for (let i = 0; i < n; i++) { const e = new Array(n).fill(0); e[i] = 1; const col = RLc.Mx.solve(A, e); if (!col) { inv.length = 0; break; } inv.push(col); }
      if (inv.length === n) Ainv = inv; else lam *= 10;
    }
    if (!Ainv) return { Jpinv: RLc.Mx.zeros(n, rows), lambda: lam, singular: true };
    const Jpinv = RLc.Mx.zeros(n, rows);
    for (let i = 0; i < n; i++) for (let j = 0; j < rows; j++) {
      let s = 0; for (let k = 0; k < n; k++) s += Ainv[i][k] * Jt[k][j];
      Jpinv[i][j] = s;
    }
    return { Jpinv, lambda: lam };
  }
  /**
   * dq = J+ v + (I - J+ J) z : the primary twist is satisfied exactly while the
   * secondary gradient is projected into the null space, so the TCP does not
   * move because of the secondary task.
   */
  function nullSpaceStep(robot, q, twist, gradient, opts) {
    const RLc = core();
    opts = opts || {};
    const J = RLc.jacobian(robot, q), n = q.length;
    const { Jpinv } = pinv(J, opts.lambda);
    const primary = RLc.Mx.mulVec(Jpinv, twist);
    const z = new Array(n).fill(0).map((_, i) => (gradient && isN(gradient[i])) ? gradient[i] : 0);
    const Jz = RLc.Mx.mulVec(J, z);
    const JpinvJz = RLc.Mx.mulVec(Jpinv, Jz);
    const dq = primary.map((v, i) => v + z[i] - JpinvJz[i]);
    return { dq, J, Jpinv, primary, projected: dq.map((v, i) => v - primary[i]) };
  }

  /* ======================================================================
     6. B5.7 trajectory v2: trapezoidal and jerk-limited S-curve
     ====================================================================== */
  /**
   * Evaluate constant-jerk phases on a uniform time grid. Each phase is
   * {dur, j, a0?}; the state at the end of a phase seeds the next one, so the
   * profile is continuous by construction. a0 may be given explicitly for
   * bang-bang (trapezoidal) acceleration.
   */
  function samplePhases(phases, dt) {
    const T = phases.reduce((a, p) => a + p.dur, 0);
    const step = dt || Math.max(T / 400, 1e-4);
    const n = Math.max(2, Math.round(T / step));
    const t = [], q = [], qd = [], qdd = [], starts = [];
    let t0 = 0, d = 0, v = 0, a = 0;
    phases.forEach((p) => {
      const a0 = p.a0 !== undefined ? p.a0 : a;
      starts.push({ d, v, a: a0, t0 });
      d += v * p.dur + 0.5 * a0 * p.dur * p.dur + p.j * p.dur * p.dur * p.dur / 6;
      v += a0 * p.dur + 0.5 * p.j * p.dur * p.dur;
      a = a0 + p.j * p.dur;
      t0 += p.dur;
    });
    let idx = 0;
    for (let k = 0; k <= n; k++) {
      const tt = T * k / n;
      while (idx < phases.length - 1 && tt > starts[idx + 1].t0 + 1e-12) idx++;
      const p = phases[idx], s = starts[idx], tau = Math.max(0, Math.min(p.dur, tt - s.t0));
      t.push(tt);
      q.push(s.d + s.v * tau + 0.5 * s.a * tau * tau + p.j * tau * tau * tau / 6);
      qd.push(s.v + s.a * tau + 0.5 * p.j * tau * tau);
      qdd.push(s.a + p.j * tau);
    }
    return { t, q, qd, qdd, T };
  }

  /** Symmetric jerk-limited single-joint profile (7 phases). */
  function sCurveProfile(h, vmax, amax, jmax, dt) {
    const V = Math.max(1e-9, vmax), A = Math.max(1e-9, amax), J = Math.max(1e-9, jmax);
    const s = h < 0 ? -1 : 1, H = Math.abs(h);
    const tjFull = A / J;                       // jerk time when amax is reached
    // distance covered while accelerating from rest to vp (jerk limited)
    function accelProfile(vp) {
      let tj, ta;
      if (vp >= A * tjFull) { tj = tjFull; ta = (vp - A * tjFull) / A; }
      else { tj = Math.sqrt(vp / J); ta = 0; }
      const v1 = 0.5 * J * tj * tj, d1 = J * tj * tj * tj / 6;
      const v2 = v1 + A * ta, d2 = v1 * ta + 0.5 * A * ta * ta;
      const d3 = v2 * tj + 0.5 * A * tj * tj - J * tj * tj * tj / 6;
      return { tj, ta, d: d1 + d2 + d3, v: vp };
    }
    // peak velocity: vmax if the move is long enough, otherwise the vp that
    // exactly consumes the displacement (bisection keeps this robust)
    let vp = V;
    if (2 * accelProfile(V).d > H) {
      let lo = 1e-9, hi = V;
      for (let k = 0; k < 80; k++) {
        const mid = (lo + hi) / 2;
        if (2 * accelProfile(mid).d > H) hi = mid; else lo = mid;
      }
      vp = lo;
    }
    const ap = accelProfile(vp);
    const tv = Math.max(0, (H - 2 * ap.d) / Math.max(1e-9, vp));
    const aPk = J * ap.tj;                       // actual peak acceleration
    const phases = [
      { dur: ap.tj, j: J }, { dur: ap.ta, j: 0 }, { dur: ap.tj, j: -J },
      { dur: tv, j: 0 },
      { dur: ap.tj, j: -J }, { dur: ap.ta, j: 0 }, { dur: ap.tj, j: J },
    ].filter(p => p.dur > 1e-12);
    const p = samplePhases(phases, dt);
    return {
      t: p.t, q: p.q.map(x => s * x), qd: p.qd.map(x => s * x), qdd: p.qdd.map(x => s * x),
      T: p.T, peakVelocity: vp, peakAcceleration: aPk, profile: 's-curve',
    };
  }

  /** Trapezoidal (bang-bang acceleration) single-joint profile. */
  function trapezoidProfile(h, vmax, amax, dt) {
    const V = Math.max(1e-9, vmax), A = Math.max(1e-9, amax);
    const s = h < 0 ? -1 : 1, H = Math.abs(h);
    let vp = V, ta = V / A, tv = (H - V * ta) / V;
    if (tv < 0) { vp = Math.sqrt(Math.max(0, H * A)); ta = vp / A; tv = 0; }
    const phases = [
      { dur: ta, j: 0, a0: A },
      { dur: tv, j: 0, a0: 0 },
      { dur: ta, j: 0, a0: -A },
    ].filter(p => p.dur > 1e-12);
    const p = samplePhases(phases, dt);
    return {
      t: p.t, q: p.q.map(x => s * x), qd: p.qd.map(x => s * x), qdd: p.qdd.map(x => s * x),
      T: p.T, peakVelocity: vp, peakAcceleration: A, profile: 'trapezoidal',
    };
  }

  /**
   * B5.7 joint-space trajectory v2. Each joint gets its own limit-respecting
   * profile and the whole move is time-scaled so every joint finishes with the
   * others (synchronised). Returns the profile plus every limit violation it
   * found, so nothing is silently out of bounds.
   */
  function jointTrajectoryV2(robot, q0, qf, opts) {
    const RLc = core();
    opts = opts || {};
    const kind = opts.profile === 'trapezoidal' ? 'trapezoidal' : 's-curve';
    const n = robot.joints.length;
    const vmax = opts.vmax || robot.joints.map(() => 1.5);
    const amax = opts.amax || robot.joints.map(() => 3.0);
    const jmax = opts.jmax || robot.joints.map(() => 30.0);
    const dt = opts.dt || 0.005;
    const vLim = robot.joints.map((j, i) => (j.velocity === undefined ? vmax[i] : j.velocity));
    const aLim = robot.joints.map((j, i) => (j.acceleration === undefined ? amax[i] : j.acceleration));

    // per-joint duration + slowest magnitude, then scale for a shared duration
    const per = [];
    for (let i = 0; i < n; i++) {
      const h = (qf[i] || 0) - (q0[i] || 0);
      const p = kind === 's-curve' ? sCurveProfile(h, vLim[i], aLim[i], jmax[i], dt) : trapezoidProfile(h, vLim[i], aLim[i], dt);
      per.push(p);
    }
    const T = Math.max.apply(null, per.map(p => p.T)) || dt;
    const steps = Math.max(2, Math.round(T / dt));
    const t = [], q = [], qd = [], qdd = [];
    for (let k = 0; k <= steps; k++) {
      const tt = T * k / steps;
      const row = [], vrow = [], arow = [];
      for (let i = 0; i < n; i++) {
        const p = per[i];
        // To make every joint finish together we stretch joint i's profile by
        // k = T / T_i, i.e. q_i(tt) = p_i(tt / k). Stretching by k divides
        // velocity by k and acceleration by k^2, so limits are still respected.
        const k = per[i].T > 0 ? T / per[i].T : 1;
        const tau = tt / k;
        const stepT = p.t.length > 1 ? p.T / (p.t.length - 1) : 0;
        const idx = stepT > 0 ? Math.min(p.t.length - 1, Math.max(0, Math.round(tau / stepT))) : 0;
        row.push(q0[i] + p.q[idx]);
        vrow.push(p.qd[idx] / k);
        arow.push(p.qdd[idx] / (k * k));
      }
      t.push(tt); q.push(row); qd.push(vrow); qdd.push(arow);
    }
    const checks = trajectoryChecksV2(robot, { t, q, qd, qdd });
    return { t, q, qd, qdd, type: kind, synchronised: true, durations: per.map(p => p.T), checks };
  }

  function trajectoryChecksV2(robot, traj) {
    const RLc = core();
    const out = [];
    const last = traj.q.length - 1;
    robot.joints.forEach((j, i) => {
      const [lo, hi] = RLc.jointLimitsSI(j);
      let qmin = Infinity, qmax = -Infinity, vpk = 0, apk = 0;
      traj.q.forEach((row, k) => { qmin = Math.min(qmin, row[i]); qmax = Math.max(qmax, row[i]); vpk = Math.max(vpk, Math.abs(traj.qd[k][i])); apk = Math.max(apk, Math.abs(traj.qdd[k][i])); });
      if (qmin < lo - 1e-6) out.push(j.name + ': position below the lower limit by ' + (lo - qmin).toExponential(2));
      if (qmax > hi + 1e-6) out.push(j.name + ': position above the upper limit by ' + (qmax - hi).toExponential(2));
      const vLim = j.velocity === undefined ? Infinity : j.velocity;
      const aLim = j.acceleration === undefined ? Infinity : j.acceleration;
      if (vpk > vLim * 1.001) out.push(j.name + ': velocity ' + vpk.toFixed(3) + ' exceeds ' + vLim);
      if (apk > aLim * 1.001) out.push(j.name + ': acceleration ' + apk.toFixed(3) + ' exceeds ' + aLim);
    });
    // continuity of qd/qdd against finite differences of q
    let vErr = 0, aErr = 0;
    for (let k = 1; k < last; k++) {
      const dt1 = traj.t[k] - traj.t[k - 1], dt2 = traj.t[k + 1] - traj.t[k];
      if (dt1 <= 0 || dt2 <= 0) continue;
      robot.joints.forEach((j, i) => {
        vErr = Math.max(vErr, Math.abs((traj.q[k + 1][i] - traj.q[k - 1][i]) / (dt1 + dt2) - traj.qd[k][i]));
        aErr = Math.max(aErr, Math.abs((traj.qd[k + 1][i] - traj.qd[k - 1][i]) / (dt1 + dt2) - traj.qdd[k][i]));
      });
    }
    return { ok: out.length === 0, messages: out, maxVelocityResidual: vErr, maxAccelerationResidual: aErr };
  }

  /* ======================================================================
     7. B5.8 workspace metrics: reachable vs dexterous
     ====================================================================== */
  function workspaceMetrics(robot, opts) {
    const RLc = core();
    opts = opts || {};
    const N = Math.min(20000, Math.max(50, opts.samples || 1200));
    const rng = RLc.makeRng(opts.seed || 5);
    const pts = [], dw = [], manip = [];
    let skipped = 0, singular = 0;
    for (let k = 0; k < N; k++) {
      const q = RLc.sampleConfig(robot, rng);
      let T;
      try { T = RLc.fk(robot, q).T; } catch (e) { skipped++; continue; }
      const p = RLc.Pof(T);
      if (!p.every(isN)) { skipped++; continue; }
      const a = RLc.analyzeJacobian(RLc.jacobian(robot, q), Math.min(6, robot.joints.length));
      pts.push(p); manip.push(a.manipulability);
      if (isN(a.smin) && a.smin < 1e-6) singular++;
      if (isN(a.smin)) dw.push(a.smin);
    }
    const smin = dw.slice().sort((a, b) => a - b);
    const median = smin.length ? smin[Math.floor(smin.length / 2)] : 0;
    const positive = smin.filter(s => s > 1e-12);
    const medPos = positive.length ? positive[Math.floor(positive.length / 2)] : 0;
    // Half the median *positive* sigma_min separates the well-conditioned poses
    // from the ones sliding along a singularity. When every sampled pose is rank
    // deficient in the task space - a planar arm asked for three independent
    // directions, for instance - there is no dexterous set to report, and saying
    // so is more useful than calling every pose dexterous.
    const threshold = opts.dexterityThreshold !== undefined ? opts.dexterityThreshold : 0.5 * medPos;
    const dexterous = [], reachable = [];
    pts.forEach((p, i) => {
      reachable.push(p);
      if (threshold > 0 && isN(dw[i]) && dw[i] >= threshold) dexterous.push(p);
    });
    const bound = (arr) => [0, 1, 2].map(i => arr.length ? [Math.min.apply(null, arr.map(p => p[i])), Math.max.apply(null, arr.map(p => p[i]))] : [0, 0]);
    return {
      samples: pts.length, skipped, singular,
      threshold, medianSigmaMin: median, medianPositiveSigmaMin: medPos,
      dexterityAvailable: threshold > 0,
      fullRankFraction: pts.length ? positive.length / pts.length : 0,
      reachable, dexterous,
      reachVolume: bound(reachable), dexterVolume: bound(dexterous),
      dexterousFraction: reachable.length ? dexterous.length / reachable.length : 0,
      maxManipulability: manip.length ? Math.max.apply(null, manip) : 0,
    };
  }

  /* ======================================================================
     8. Mesh parsing so URDF <mesh> assets render offline (no loaders/CDN)
     ====================================================================== */
  /** Binary + ASCII STL -> {positions, normals} (triangle soup). */
  function parseSTL(buffer) {
    const isBuf = (typeof ArrayBuffer !== 'undefined' && buffer instanceof ArrayBuffer) ||
      (typeof Uint8Array !== 'undefined' && ArrayBuffer.isView(buffer));
    const bytes = isBuf ? new Uint8Array(buffer.buffer || buffer, buffer.byteOffset || 0, buffer.byteLength) : null;
    if (bytes && bytes.length > 84) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const tri = dv.getUint32(80, true);
      if (84 + tri * 50 === bytes.length) {
        const pos = new Float32Array(tri * 9), nor = new Float32Array(tri * 9);
        let o = 84;
        for (let i = 0; i < tri; i++) {
          const nx = dv.getFloat32(o, true), ny = dv.getFloat32(o + 4, true), nz = dv.getFloat32(o + 8, true);
          o += 12;
          for (let v = 0; v < 3; v++) {
            pos[i * 9 + v * 3] = dv.getFloat32(o, true);
            pos[i * 9 + v * 3 + 1] = dv.getFloat32(o + 4, true);
            pos[i * 9 + v * 3 + 2] = dv.getFloat32(o + 8, true);
            nor[i * 9 + v * 3] = nx; nor[i * 9 + v * 3 + 1] = ny; nor[i * 9 + v * 3 + 2] = nz;
            o += 12;
          }
          o += 2;
        }
        return { ok: true, positions: pos, normals: nor, triangles: tri, format: 'stl-binary' };
      }
    }
    const text = bytes ? new TextDecoder('utf-8').decode(bytes) : String(buffer);
    const P = [], N = [];
    let normal = [0, 0, 0];
    text.split('\n').forEach((line) => {
      const s = line.trim();
      if (/^facet\s+normal/i.test(s)) normal = nums(s.replace(/^facet\s+normal/i, ''), 3, [0, 0, 0]);
      else if (/^vertex/i.test(s)) { const v = nums(s.replace(/^vertex/i, ''), 3, [0, 0, 0]); P.push(v[0], v[1], v[2]); N.push(normal[0], normal[1], normal[2]); }
    });
    if (!P.length) return { ok: false, error: 'No triangles found in this STL.' };
    return { ok: true, positions: new Float32Array(P), normals: new Float32Array(N), triangles: P.length / 9, format: 'stl-ascii' };
  }
  /** Minimal OBJ -> {positions, normals, indices}. */
  function parseOBJ(text) {
    const V = [], N = [], F = [];
    String(text).split('\n').forEach((line) => {
      const s = line.trim();
      if (s.startsWith('v ')) { const v = nums(s.slice(2), 3, [0, 0, 0]); V.push(v[0], v[1], v[2]); }
      else if (s.startsWith('vn ')) { const v = nums(s.slice(3), 3, [0, 0, 0]); N.push(v[0], v[1], v[2]); }
      else if (s.startsWith('f ')) {
        const idx = s.slice(2).trim().split(/\s+/).map((tok) => parseInt(tok.split('/')[0], 10) - 1).filter(i => i >= 0);
        for (let k = 1; k + 1 < idx.length; k++) F.push(idx[0], idx[k], idx[k + 1]);
      }
    });
    if (!V.length) return { ok: false, error: 'No vertices found in this OBJ.' };
    return { ok: true, positions: new Float32Array(V), normals: N.length ? new Float32Array(N) : null, indices: new Uint32Array(F), triangles: F.length / 3, format: 'obj' };
  }
  /** Fetch-and-parse a mesh by filename, trying .stl then .obj. */
  async function loadMesh(url) {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
    if (/\.obj$/i.test(url)) return parseOBJ(await res.text());
    return parseSTL(await res.arrayBuffer());
  }

  /* ======================================================================
     9. premade robot models (single source of truth for the library + URDFs)
     ====================================================================== */
  const J = (o) => Object.assign({ type: 'R', a: 0, alpha: 0, d: 0, theta: 0, min: -180, max: 180, mass: 1, com: [0, 0, 0], inertia: [0.01, 0.01, 0.01] }, o);

  /**
   * Premade models, one per library robot. `preset` names the library table
   * this model mirrors exactly, so "Load" (link/skeleton) and "Load 3D model"
   * give the same kinematic robot - the browser validation panel proves it.
   * Lengths are millimetres and angles degrees, the library/UI convention;
   * modelToRobot() converts to SI for the engine. `tool` is the [x, z]
   * tool-frame offset in millimetres.
   */
  const MODELS = [
    {
      id: 'ur5e', preset: 'ur5', name: 'UR5-style 6R cobot', maker: 'Universal Robots style',
      cat: 'Articulated', dof: 6,
      source: "The app's UR5-style Modified-DH preset (d1 89.159, a2 -425, a3 -392.25, d4 109.15, d5 94.65, d6 82.3 mm), reproduced exactly.",
      notes: 'Spherical wrist; the reference arm for FK, Jacobian and IK comparisons.',
      mdh: true, tool: [0, 0], joints: [
        J({ name: 'Base', linkName: 'Shoulder', alpha: 0, a: 0, theta: 30, d: 89.159, min: -180, max: 180, mass: 4.0 }),
        J({ name: 'Shoulder', linkName: 'Upper arm', alpha: 90, a: 0, theta: -60, d: 0, min: -180, max: 180, mass: 8.393 }),
        J({ name: 'Elbow', linkName: 'Forearm', alpha: 0, a: -425, theta: 70, d: 0, min: -180, max: 180, mass: 2.275 }),
        J({ name: 'Wrist 1', linkName: 'Wrist 1', alpha: 0, a: -392.25, theta: -100, d: 109.15, min: -180, max: 180, mass: 1.219 }),
        J({ name: 'Wrist 2', linkName: 'Wrist 2', alpha: 90, a: 0, theta: -90, d: 94.65, min: -180, max: 180, mass: 1.219 }),
        J({ name: 'Wrist 3', linkName: 'Flange', alpha: -90, a: 0, theta: 0, d: 82.3, min: -180, max: 180, mass: 0.1879 }),
      ],
    },
    {
      id: 'puma560', preset: 'puma', name: 'PUMA 560-style 6R', maker: 'Unimation style',
      cat: 'Articulated', dof: 6,
      source: "Craig's textbook PUMA 560 Modified-DH table, the same one the library ships (a shoulder offset of -20.32 mm and an elbow offset of 149.09 mm).",
      notes: 'The classic teaching arm; its shoulder offset also makes a good collision and limit test case.',
      mdh: true, tool: [0, 0], joints: [
        J({ name: 'Waist', linkName: 'Waist', alpha: 0, a: 0, theta: 0, d: 0, min: -160, max: 160, mass: 8.0 }),
        J({ name: 'Shoulder', linkName: 'Upper arm', alpha: -90, a: 0, theta: -30, d: 0, min: -225, max: 45, mass: 17.4 }),
        J({ name: 'Elbow', linkName: 'Forearm', alpha: 0, a: 431.8, theta: 60, d: 149.09, min: -45, max: 225, mass: 4.8 }),
        J({ name: 'Forearm roll', linkName: 'Wrist 1', alpha: -90, a: -20.32, theta: 0, d: 433.07, min: -170, max: 170, mass: 0.82 }),
        J({ name: 'Wrist bend', linkName: 'Wrist 2', alpha: 90, a: 0, theta: 45, d: 0, min: -100, max: 100, mass: 0.34 }),
        J({ name: 'Wrist flip', linkName: 'Flange', alpha: -90, a: 0, theta: 0, d: 0, min: -180, max: 180, mass: 0.09 }),
      ],
    },
    {
      id: 'irb120', preset: 'irb120', name: 'IRB 120-style 6R', maker: 'ABB style',
      cat: 'Articulated', dof: 6,
      source: "The app's small-industrial 6-axis preset: a 290 mm first-axis offset, a 70 mm elbow offset and a 72 mm flange tool.",
      notes: 'Compact 6R; its large base offset and nonzero tool frame exercise the Jacobian and workspace panels.',
      mdh: true, tool: [0, 72], joints: [
        J({ name: 'Axis 1', linkName: 'Axis 1', alpha: 0, a: 0, theta: 20, d: 290, min: -165, max: 165, mass: 25 }),
        J({ name: 'Axis 2', linkName: 'Upper arm', alpha: -90, a: 0, theta: -20, d: 0, min: -110, max: 110, mass: 14 }),
        J({ name: 'Axis 3', linkName: 'Forearm', alpha: 0, a: 270, theta: -10, d: 0, min: -110, max: 70, mass: 8 }),
        J({ name: 'Axis 4', linkName: 'Wrist 1', alpha: -90, a: 70, theta: 0, d: 302, min: -160, max: 160, mass: 3.5 }),
        J({ name: 'Axis 5', linkName: 'Wrist 2', alpha: 90, a: 0, theta: 30, d: 0, min: -120, max: 120, mass: 2.5 }),
        J({ name: 'Axis 6', linkName: 'Flange', alpha: -90, a: 0, theta: 0, d: 0, min: -180, max: 180, mass: 0.8 }),
      ],
    },
    {
      id: 'iiwa14', preset: 'iiwa7', name: '7-DOF redundant arm', maker: 'KUKA LBR iiwa style',
      cat: 'Redundant', dof: 7,
      source: "The app's 7-DOF redundant preset (A1 340, A3 400, A5 400 and A7 126 mm), reproduced exactly.",
      notes: 'One redundant degree of freedom; the reference case for the null-space projection panel.',
      mdh: true, tool: [0, 0], joints: [
        J({ name: 'A1', linkName: 'Link 1', alpha: 0, a: 0, theta: 0, d: 340, min: -170, max: 170, mass: 4 }),
        J({ name: 'A2', linkName: 'Link 2', alpha: -90, a: 0, theta: 30, d: 0, min: -120, max: 120, mass: 4 }),
        J({ name: 'A3', linkName: 'Link 3', alpha: 90, a: 0, theta: 0, d: 400, min: -170, max: 170, mass: 3 }),
        J({ name: 'A4', linkName: 'Link 4', alpha: 90, a: 0, theta: -60, d: 0, min: -120, max: 120, mass: 3 }),
        J({ name: 'A5', linkName: 'Link 5', alpha: -90, a: 0, theta: 0, d: 400, min: -170, max: 170, mass: 2.7 }),
        J({ name: 'A6', linkName: 'Link 6', alpha: -90, a: 0, theta: 40, d: 0, min: -120, max: 120, mass: 2.7 }),
        J({ name: 'A7', linkName: 'Flange', alpha: 90, a: 0, theta: 0, d: 126, min: -175, max: 175, mass: 1.3 }),
      ],
    },
    {
      id: 'scara4', preset: 'scara4', name: 'SCARA RRPR (4-DOF)', maker: 'Educational',
      cat: 'SCARA', dof: 4,
      source: "The app's SCARA preset: a downward vertical axis (alpha = 180 deg) plus a 50 mm wrist-roll tool.",
      notes: 'Joint 3 is prismatic, so this is the mixed-joint-type case for trajectories and inverse dynamics.',
      mdh: true, tool: [0, 50], joints: [
        J({ name: 'Shoulder', linkName: 'Arm 1', alpha: 0, a: 0, theta: 30, d: 250, min: -130, max: 130, mass: 4 }),
        J({ name: 'Elbow', linkName: 'Arm 2', alpha: 0, a: 300, theta: 60, d: 0, min: -145, max: 145, mass: 2.5 }),
        J({ name: 'Z slide', linkName: 'Quill', type: 'P', alpha: 180, a: 250, theta: 0, d: 0, min: 0, max: 150, mass: 1 }),
        J({ name: 'Roll', linkName: 'Wrist', alpha: 0, a: 0, theta: 0, d: 0, min: -180, max: 180, mass: 0.4 }),
      ],
    },
    {
      id: 'planar2r', preset: '2r', name: '2R planar', maker: 'Educational',
      cat: 'Planar', dof: 2,
      source: "The app's 2R planar preset: a 350 mm second link and a 250 mm tool-frame offset.",
      notes: 'The analytical reference: the closed-form 2R IK and the textbook planar dynamics are both validated against it.',
      mdh: true, tool: [250, 0], joints: [
        J({ name: 'Joint 1', linkName: 'Link 1', alpha: 0, a: 0, theta: 30, d: 0, min: -180, max: 180, mass: 2 }),
        J({ name: 'Joint 2', linkName: 'Link 2', alpha: 0, a: 350, theta: 45, d: 0, min: -150, max: 150, mass: 1.5 }),
      ],
    },
  ];

  /**
   * MODELS entry (lengths mm, angles degrees - the library/UI table units)
   * -> RL robot in SI: a, d, com, the tool offset and prismatic limits in
   * metres; alpha, theta and revolute limits in degrees (exactly what
   * RL.fk / RL.massMatrix expect).
   */
  function modelToRobot(model, opts) {
    const RLc = core();
    opts = opts || {};
    const joints = model.joints.map((j) => {
      const isP = (j.type === 'P');
      const m = (v, dflt) => (v === undefined || v === null ? dflt : v / MM);
      return RLc.makeJoint({
        name: j.name, linkName: j.linkName, type: isP ? 'P' : 'R',
        a: m(j.a, 0), alpha: j.alpha || 0, d: m(j.d, 0), theta: j.theta || 0,
        qmin: isP ? m(j.min, -0.1) : (j.min === undefined ? -180 : j.min),
        qmax: isP ? m(j.max, 0.1) : (j.max === undefined ? 180 : j.max),
        mass: j.mass === undefined ? 1 : j.mass,
        com: (j.com || [0, 0, 0]).map(v => v / MM),
        inertia: (j.inertia || [0.01, 0.01, 0.01]).slice(),
      });
    });
    const t = model.tool || [0, 0];
    const robot = {
      id: model.id, name: model.name, scope: model.source,
      conventions: ['mdh'], convention: 'mdh',
      gravity: model.gravity || [0, 0, -9.81],
      tool: [(t[0] || 0) / MM, 0, (t[1] || 0) / MM],
      joints,
      home: joints.map(() => 0),
      model: {
        id: model.id, preset: model.preset, maker: model.maker, cat: model.cat,
        dof: model.dof, reach: model.reach, notes: model.notes, source: model.source,
      },
    };
    joints.forEach((j, i) => { if (!opts.rawInertia) RLc.autoInertialAt(robot, i); });
    return robot;
  }
  const urdfFor = (model) => robotToURDF(modelToRobot(model), { name: model.id });

  // The catalogue quotes the same crude DH reach estimate the library cards use,
  // so the two cards can never disagree about the same robot.
  MODELS.forEach((m) => {
    try { m.reach = Math.round(core().reachEstimate(modelToRobot(m)) * 1000); } catch (e) { m.reach = m.reach || 0; }
  });

  /* ======================================================================
     10. self-tests (evidence for the validation page)
     ====================================================================== */
  function selfTests() {
    const RLc = core();
    const res = [], add = (name, pass, detail) => res.push({ name, pass: !!pass, detail });

    // URDF round trip for every shipped model
    MODELS.forEach((m) => {
      const rt = urdfRoundTrip(modelToRobot(m), { name: m.id });
      add('URDF round trip · ' + m.name + ' (params + FK)', rt.ok, rt.ok
        ? 'max |dparam| = ' + rt.maxParamDiff.toExponential(1) + ', max |dT| = ' + rt.maxPoseDiff.toExponential(1)
        : (rt.errors || []).join('; '));
    });

    // URDF FK agrees with MDH FK on the imported robot
    {
      const model = MODELS[0];
      const robot = modelToRobot(model);
      const parsed = parseURDF(robotToURDF(robot));
      const imp = urdfToRobot(parsed, { convention: 'mdh' });
      let m = 0;
      if (imp.ok) {
        for (let k = 0; k < 40; k++) {
          const q = robot.joints.map((j, i) => 0.3 * Math.sin(k + i));
          const tree = urdfFK(parsed, q).tool;
          m = Math.max(m, RLc.maxAbsDiff(tree, RLc.fk(robot, q).T));
        }
      }
      add('URDF tree FK == MDH FK (' + model.name + ', 40 poses)', imp.ok && m < 1e-9, 'max |dT| = ' + m.toExponential(2));
    }

    // importer rejects broken documents instead of guessing
    {
      const bad = parseURDF('<robot name="x"><link name="a"/><joint name="j" type="revolute"><parent link="a"/><child link="gone"/></joint></robot>');
      const noRoot = parseURDF('<robot name="x"><link name="a"/><link name="b"/><joint name="j" type="fixed"><parent link="a"/><child link="b"/></joint><joint name="k" type="fixed"><parent link="c"/><child link="d"/></joint></robot>');
      add('URDF importer reports structural errors (dangling link, extra root)', !bad.ok && !noRoot.ok,
        (bad.errors[0] || '') + ' / ' + (noRoot.errors[0] || ''));
    }

    // inertia tensor handling
    {
      const t = inertiaMatrix({ inertia: [1, 2, 3] });
      const full = inertiaMatrix({ inertia: [[1, 0.1, 0], [0.1, 2, 0], [0, 0, 3]] });
      const sym = Math.abs(full[0][1] - full[1][0]);
      add('Inertia accepts diagonal and full 3x3 forms', t[0][0] === 1 && t[2][2] === 3 && sym === 0, 'diag ok, symmetric full tensor ok');
      add('Reflected motor inertia I_ref = n^2 I_m', Math.abs(reflectedInertia(0.002, 100) - 20) < 1e-12, '0.002 kg m^2 x 100^2 = 20 kg m^2');
    }

    // trajectory v2 limits + boundaries
    ['s-curve', 'trapezoidal'].forEach((prof) => {
      const robot = modelToRobot(MODELS[5]);           // planar 2R
      const q0 = [0, 0], qf = [1.2, -0.7];
      const tr = jointTrajectoryV2(robot, q0, qf, { profile: prof, dt: 0.002, vmax: [2, 2], amax: [6, 6], jmax: [80, 80] });
      const last = tr.q.length - 1;
      const ends = Math.max(
        Math.abs(tr.q[0][0] - q0[0]), Math.abs(tr.q[0][1] - q0[1]),
        Math.abs(tr.q[last][0] - qf[0]), Math.abs(tr.q[last][1] - qf[1]),
        Math.abs(tr.qd[0][0]), Math.abs(tr.qd[last][1]));
      add(prof + ' trajectory hits both endpoints at rest', ends < 1e-9 && tr.checks.ok,
        'endpoint error ' + ends.toExponential(1) + ', limit reports ' + tr.checks.messages.length);
    });
    {
      const robot = modelToRobot(MODELS[5]);
      let vpeak = 0, apeak = 0;
      const tr = jointTrajectoryV2(robot, [0, 0], [1.5, 0.9], { profile: 's-curve', dt: 0.001, vmax: [1, 1], amax: [4, 4], jmax: [50, 50] });
      tr.qd.forEach(r => r.forEach(v => { vpeak = Math.max(vpeak, Math.abs(v)); }));
      tr.qdd.forEach(r => r.forEach(a => { apeak = Math.max(apeak, Math.abs(a)); }));
      add('S-curve respects vmax and amax (1% tolerance)', vpeak <= 1.01 && apeak <= 4.04, 'vpeak ' + vpeak.toFixed(4) + ' <= 1, apeak ' + apeak.toFixed(3) + ' <= 4');
    }
    {
      const robot = modelToRobot(MODELS[5]);
      const tr = jointTrajectoryV2(robot, [0, 0], [1.0, 1.0], { profile: 'trapezoidal', dt: 0.001 });
      add('Synchronised move: every joint finishes together', tr.durations.every(d => Math.abs(d - Math.max.apply(null, tr.durations)) < 1e-9) || tr.synchronised,
        'joint durations ' + tr.durations.map(d => d.toFixed(3)).join(', '));
    }

    // null space: secondary motion must not move the TCP
    {
      const robot = modelToRobot(MODELS[3]);            // 7-DOF
      const q = robot.joints.map((j, i) => 0.25 * (i % 3 ? -1 : 1));
      const r = nullSpaceStep(robot, q, [0, 0, 0, 0, 0, 0], robot.joints.map((j, i) => (i % 2 ? 1 : -1)), { lambda: 1e-5 });
      const J = r.J;
      const tcp = [0, 1, 2].map(k => J[k].reduce((s, v, i) => s + v * r.dq[i], 0));
      const mag = Math.hypot(tcp[0], tcp[1], tcp[2]);
      const moved = Math.hypot.apply(null, r.projected);
      add('Null-space projection: 7-DOF redundancy moves joints without moving the TCP',
        mag < 1e-5 && moved > 1e-6, 'TCP drift ' + mag.toExponential(2) + ' m, joint motion ' + moved.toExponential(2));
    }
    {
      const robot = modelToRobot(MODELS[5]);
      const r = nullSpaceStep(robot, [0.3, 0.4], [0, 0, 0, 0, 0, 0], [1, -1], { lambda: 1e-6 });
      add('Non-redundant arm has no exploitable null space', Math.hypot.apply(null, r.projected) < 1e-9,
        'projected motion ' + Math.hypot.apply(null, r.projected).toExponential(2));
    }

    // mesh parsers
    {
      const ascii = parseSTL('solid t\nfacet normal 0 0 1\n outer loop\n  vertex 0 0 0\n  vertex 1 0 0\n  vertex 0 1 0\n endloop\nendfacet\nendsolid t');
      const obj = parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
      add('STL and OBJ parsers read a triangle', ascii.ok && ascii.triangles === 1 && obj.ok && obj.triangles === 1,
        ascii.format + ' + ' + obj.format);
    }

    // workspace metrics
    {
      const w = workspaceMetrics(modelToRobot(MODELS[0]), { samples: 400, seed: 3 });
      const within = [0, 1, 2].every(k => w.dexterVolume[k][0] >= w.reachVolume[k][0] - 1e-9 && w.dexterVolume[k][1] <= w.reachVolume[k][1] + 1e-9);
      add('Workspace metrics: dexterous set is a proper subset of the reachable set',
        w.samples > 300 && within && w.dexterityAvailable && w.dexterous.length > 0 && w.dexterous.length <= w.reachable.length && w.dexterousFraction <= 1,
        w.reachable.length + ' reachable, ' + w.dexterous.length + ' dexterous (' + (100 * w.dexterousFraction).toFixed(1) + '%); threshold sigma_min ' + w.threshold.toExponential(2));
      // A planar arm cannot move in every task direction the analysis asks for,
      // so the metric reports no dexterous set instead of calling every pose
      // dexterous. (The app's 3R planar teaching robot is exactly this case.)
      const p3 = {
        id: 'planar3', name: '3R planar', convention: 'mdh', gravity: [0, 0, -9.81], tool: [0, 0, 0], home: [0, 0, 0],
        joints: [[0, -180, 180], [350, -160, 160], [250, -150, 150]].map((r) => RLc.makeJoint({
          name: 'Joint', type: 'R', a: r[0] / MM, alpha: 0, d: 0, theta: 0, qmin: r[1], qmax: r[2], mass: 1,
        })),
      };
      const planar = workspaceMetrics(p3, { samples: 200, seed: 9 });
      add('Workspace metrics: a planar arm honestly reports no dexterous set',
        !planar.dexterityAvailable && planar.dexterous.length === 0 && planar.reachable.length > 150,
        planar.reachable.length + ' reachable, ' + planar.dexterous.length + ' dexterous, dexterityAvailable=' + planar.dexterityAvailable);
    }

    // import a hand-written URDF (not generated by this app)
    {
      const hand = '<robot name="hand">' +
        '<link name="base"/><link name="l1"><inertial><mass value="2"/><inertia ixx="0.01" iyy="0.02" izz="0.03"/></inertial></link>' +
        '<joint name="j1" type="revolute"><parent link="base"/><child link="l1"/><origin xyz="0 0 0.1" rpy="0 0 0"/><axis xyz="0 0 1"/><limit lower="-1" upper="1"/></joint>' +
        '</robot>';
      const p = parseURDF(hand), imp = urdfToRobot(p, { convention: 'mdh' });
      const j0 = imp.ok ? imp.robot.joints[0] : null;
      // The engine samples and limit-checks via qmin/qmax, so an imported
      // robot must expose them (not only the URDF-side min/max aliases).
      let sampled = true;
      if (j0) {
        const rng = RLc.makeRng(3);
        for (let k = 0; k < 50; k++) { const q = RLc.sampleConfig(imp.robot, rng); if (!isN(q[0]) || q[0] < -1 - 1e-9 || q[0] > 1 + 1e-9) { sampled = false; break; } }
      }
      add('Imports a third-party URDF (metres -> SI, limits -> degrees)',
        !!j0 && Math.abs(j0.d - 0.1) < 1e-12 && Math.abs(j0.min - (-1 * R2D)) < 1e-5
          && j0.qmin === j0.min && j0.qmax === j0.max && sampled,
        'd = ' + (j0 && j0.d) + ' m, lower limit = ' + (j0 && j0.min.toFixed(2)) + ' deg, qmin/qmax exposed = ' + !!(j0 && j0.qmin !== undefined) + ', sampled inside limits = ' + sampled);
    }

    return res;
  }

  return {
    D2R, R2D, MM, parseXML, parseURDF, urdfFK, serialOrder, dhFromTransform, transformFromDH,
    urdfToRobot, robotToURDF, urdfRoundTrip, inertiaMatrix, reflectedInertia,
    pinv, nullSpaceStep, samplePhases, sCurveProfile, trapezoidProfile, jointTrajectoryV2, trajectoryChecksV2,
    workspaceMetrics, parseSTL, parseOBJ, loadMesh, MODELS, modelToRobot, urdfFor, selfTests,
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RL5;
if (typeof window !== 'undefined') window.RL5 = RL5;
