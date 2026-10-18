/* ============================================================================
   RoboLab Web — calculation core
   Pure JavaScript. No DOM, no Three.js. Can be tested in Node (see tests/).
   Units: metres, radians internally. Robot joint parameters store alpha/theta in
   DEGREES (as shown in the DH table); joint values q are SI (rad or m).
   Convention: classical (distal) Denavit–Hartenberg:
       T(i-1,i) = Rz(theta) · Tz(d) · Tx(a) · Rx(alpha)
   ========================================================================== */
const RL = (function () {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI, TWO_PI = 2 * Math.PI;
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
  function wrapPi(a) { a = (a + Math.PI) % TWO_PI; if (a < 0) a += TWO_PI; return a - Math.PI; }

  /* ---------------------------- vectors ---------------------------------- */
  const V = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    norm: (a) => Math.hypot(a[0], a[1], a[2]),
  };
  const vnorm = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0));

  /* ---------------------------- matrices --------------------------------- */
  const Mx = {
    zeros: (r, c) => Array.from({ length: r }, () => new Array(c).fill(0)),
    eye(n) { const I = Mx.zeros(n, n); for (let i = 0; i < n; i++) I[i][i] = 1; return I; },
    mul(A, B) {
      const n = A.length, k = B.length, m = B[0].length, C = Mx.zeros(n, m);
      for (let i = 0; i < n; i++) for (let l = 0; l < k; l++) {
        const a = A[i][l]; if (a === 0) continue;
        for (let j = 0; j < m; j++) C[i][j] += a * B[l][j];
      }
      return C;
    },
    T(A) { const r = A.length, c = A[0].length, B = Mx.zeros(c, r); for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) B[j][i] = A[i][j]; return B; },
    mulVec(A, v) { return A.map(row => row.reduce((s, a, j) => s + a * v[j], 0)); },
    /* Gaussian elimination with partial pivoting. Returns null when singular. */
    solve(A, b) {
      const n = A.length, M = A.map((r, i) => r.concat([b[i]]));
      let scale = 0; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) scale = Math.max(scale, Math.abs(A[i][j]));
      if (scale === 0) return null;
      for (let c = 0; c < n; c++) {
        let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
        if (Math.abs(M[p][c]) < 1e-13 * scale) return null;
        if (p !== c) { const t = M[p]; M[p] = M[c]; M[c] = t; }
        for (let r = c + 1; r < n; r++) {
          const f = M[r][c] / M[c][c]; if (f === 0) continue;
          for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
        }
      }
      const x = new Array(n).fill(0);
      for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
      return x;
    },
    /* Eigenvalues of a symmetric matrix (cyclic Jacobi), sorted descending. */
    eigSym(A0) {
      const n = A0.length, A = A0.map(r => r.slice());
      for (let sweep = 0; sweep < 80; sweep++) {
        let off = 0, dg = 0;
        for (let i = 0; i < n; i++) { dg += A[i][i] * A[i][i]; for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j]; }
        if (off <= 1e-30 * (1 + dg)) break;
        for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
          if (Math.abs(A[p][q]) < 1e-300) continue;
          const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
          const t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1));
          const c = 1 / Math.sqrt(t * t + 1), s = t * c;
          for (let k = 0; k < n; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
          for (let k = 0; k < n; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
        }
      }
      return A.map((r, i) => r[i]).sort((a, b) => b - a);
    },
  };

  /* ----------------------- rigid-body transforms ------------------------- */
  const eye4 = () => Mx.eye(4);
  const Rof = (T) => [[T[0][0], T[0][1], T[0][2]], [T[1][0], T[1][1], T[1][2]], [T[2][0], T[2][1], T[2][2]]];
  const Pof = (T) => [T[0][3], T[1][3], T[2][3]];
  const colOf = (T, j) => [T[0][j], T[1][j], T[2][j]];

  /** Classical DH link transform (angles in radians). */
  function dhMatrix(a, alpha, d, theta) {
    const ct = Math.cos(theta), st = Math.sin(theta), ca = Math.cos(alpha), sa = Math.sin(alpha);
    return [[ct, -st * ca, st * sa, a * ct], [st, ct * ca, -ct * sa, a * st], [0, sa, ca, d], [0, 0, 0, 1]];
  }
  /** Modified (Craig) DH link transform: Rx(alpha[i-1]) Tx(a[i-1]) Rz(theta[i]) Tz(d[i]). */
  function mdhMatrix(a, alpha, d, theta) {
    const ct = Math.cos(theta), st = Math.sin(theta), ca = Math.cos(alpha), sa = Math.sin(alpha);
    return [[ct, -st, 0, a], [st * ca, ct * ca, -sa, -sa * d], [st * sa, ct * sa, ca, ca * d], [0, 0, 0, 1]];
  }
  function invT(T) {
    const R = Rof(T), Rt = Mx.T(R), p = Pof(T), pi = Mx.mulVec(Rt, p).map(x => -x);
    return [[Rt[0][0], Rt[0][1], Rt[0][2], pi[0]], [Rt[1][0], Rt[1][1], Rt[1][2], pi[1]], [Rt[2][0], Rt[2][1], Rt[2][2], pi[2]], [0, 0, 0, 1]];
  }
  /** R = Rz(yaw) Ry(pitch) Rx(roll)  (ZYX / "RPY" convention), angles in rad. */
  function rpyToR(r, p, y) {
    const cr = Math.cos(r), sr = Math.sin(r), cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(y), sy = Math.sin(y);
    return [[cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
            [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
            [-sp, cp * sr, cp * cr]];
  }
  function rToRPY(R) {
    const pitch = Math.asin(clamp(-R[2][0], -1, 1));
    if (Math.abs(R[2][0]) < 1 - 1e-9) return { roll: Math.atan2(R[2][1], R[2][2]), pitch, yaw: Math.atan2(R[1][0], R[0][0]), gimbal: false };
    return { roll: 0, pitch, yaw: Math.atan2(-R[0][1], R[1][1]), gimbal: true };
  }
  function rotationCheck(R) {
    const RtR = Mx.mul(Mx.T(R), R); let e = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) e = Math.max(e, Math.abs(RtR[i][j] - (i === j ? 1 : 0)));
    const det = R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
    return { orthError: e, det };
  }
  /** Rotation vector (axis * angle) of a rotation matrix. */
  function logRot(R) {
    const c = clamp((R[0][0] + R[1][1] + R[2][2] - 1) / 2, -1, 1), ang = Math.acos(c);
    const w = [R[2][1] - R[1][2], R[0][2] - R[2][0], R[1][0] - R[0][1]];
    if (ang < 1e-7) return [w[0] / 2, w[1] / 2, w[2] / 2];
    if (Math.PI - ang < 1e-5) {
      const ax = [Math.sqrt(Math.max(0, (R[0][0] + 1) / 2)), Math.sqrt(Math.max(0, (R[1][1] + 1) / 2)), Math.sqrt(Math.max(0, (R[2][2] + 1) / 2))];
      let k = 0; if (ax[1] > ax[k]) k = 1; if (ax[2] > ax[k]) k = 2;
      for (let i = 0; i < 3; i++) if (i !== k) ax[i] = (R[k][i] + R[i][k]) / (4 * ax[k]);
      if (V.dot(ax, w) < 0) for (let i = 0; i < 3; i++) ax[i] = -ax[i];
      return V.scale(ax, ang);
    }
    return V.scale(w, ang / (2 * Math.sin(ang)));
  }

  /* ------------------------------ robots --------------------------------- */
  function makeJoint(o) {
    return Object.assign({ name: 'Joint', linkName: 'Link', type: 'R', a: 0, alpha: 0, d: 0, theta: 0, qmin: -180, qmax: 180,
      mass: 1, com: [0, 0, 0], inertia: [0.01, 0.01, 0.01] }, o || {});
  }
  /** Fill mass properties from a slender-rod approximation of the DH link geometry. */
  function autoInertial(j, mass) {
    const m = mass === undefined ? j.mass : mass, al = j.alpha * D2R, len = Math.hypot(j.a, j.d);
    j.mass = m;
    j.com = [-j.a / 2, -j.d * Math.sin(al) / 2, -j.d * Math.cos(al) / 2];
    const I = m * (len * len / 12 + 1e-4);
    j.inertia = [I, I, I];
    return j;
  }
  const jointLimitsSI = (j) => j.type === 'R' ? [j.qmin * D2R, j.qmax * D2R] : [j.qmin, j.qmax];
  const jointDisplayScale = (j) => j.type === 'R' ? R2D : 1;
  function clampQ(robot, q) { return q.map((v, i) => { const [lo, hi] = jointLimitsSI(robot.joints[i]); return clamp(v, lo, hi); }); }
  const qWithinLimits = (robot, q, tol = 1e-9) => q.every((v, i) => { const [lo, hi] = jointLimitsSI(robot.joints[i]); return v >= lo - tol && v <= hi + tol; });
  const reachEstimate = (robot) => robot.joints.reduce((s, j) => s + Math.abs(j.a) + Math.abs(j.d) + (j.type === 'P' ? Math.max(Math.abs(j.qmin), Math.abs(j.qmax)) : 0), 0);

  function buildPreset(id) {
    const J = makeJoint, home = (a) => a.slice();
    let r;
    switch (id) {
      case 'planar2':
        r = { name: '2-link planar arm', scope: 'Educational model (not a manufacturer robot). Motion plane is X–Y; gravity acts along −Y.',
          gravity: [0, -9.81, 0], joints: [
            J({ name: 'Shoulder', linkName: 'Link 1', a: 1.0, qmin: -180, qmax: 180, mass: 2 }),
            J({ name: 'Elbow', linkName: 'Link 2', a: 0.8, qmin: -150, qmax: 150, mass: 1.5 })], home: home([30 * D2R, 60 * D2R]) };
        break;
      case 'arm3':
        r = { name: '3-DOF articulated arm', scope: 'Educational anthropomorphic arm (yaw, shoulder, elbow). Z is up.', gravity: [0, 0, -9.81], joints: [
          J({ name: 'Base yaw', linkName: 'Turret', alpha: 90, d: 0.4, qmin: -180, qmax: 180, mass: 3 }),
          J({ name: 'Shoulder', linkName: 'Upper arm', a: 0.5, qmin: -135, qmax: 135, mass: 2 }),
          J({ name: 'Elbow', linkName: 'Forearm', a: 0.4, qmin: -150, qmax: 150, mass: 1.2 })], home: home([0, 40 * D2R, -70 * D2R]) };
        break;
      case 'scara4':
        r = { name: '4-DOF SCARA (R-R-P-R)', scope: 'Educational SCARA-style manipulator. Joint 3 is prismatic and moves along the (downward) z₂ axis.', gravity: [0, 0, -9.81], joints: [
          J({ name: 'Shoulder', linkName: 'Arm 1', a: 0.4, d: 0.3, qmin: -150, qmax: 150, mass: 4 }),
          J({ name: 'Elbow', linkName: 'Arm 2', a: 0.3, alpha: 180, qmin: -150, qmax: 150, mass: 2.5 }),
          J({ name: 'Z slide', linkName: 'Quill', type: 'P', qmin: 0, qmax: 0.25, mass: 1 }),
          J({ name: 'Wrist roll', linkName: 'Tool', qmin: -180, qmax: 180, mass: 0.4 })], home: home([30 * D2R, -45 * D2R, 0.1, 0]) };
        break;
      case 'ur5like':
        r = { name: '6-DOF serial arm (UR5-like)', scope: 'Educational model using the published UR5 classical DH table and public link masses; geometry is procedural, not a manufacturer-accurate model. Limits reduced to ±180°.',
          gravity: [0, 0, -9.81], joints: [
            J({ name: 'Base', linkName: 'Shoulder', alpha: 90, d: 0.0892, mass: 3.7 }),
            J({ name: 'Shoulder', linkName: 'Upper arm', a: -0.425, mass: 8.393 }),
            J({ name: 'Elbow', linkName: 'Forearm', a: -0.392, mass: 2.275 }),
            J({ name: 'Wrist 1', linkName: 'Wrist 1', alpha: 90, d: 0.1093, mass: 1.219 }),
            J({ name: 'Wrist 2', linkName: 'Wrist 2', alpha: -90, d: 0.09475, mass: 1.219 }),
            J({ name: 'Wrist 3', linkName: 'Flange', d: 0.0825, mass: 0.1879 })], home: home([0, -90 * D2R, 90 * D2R, -90 * D2R, -90 * D2R, 0]) };
        break;
      case 'blank1':
        r = { name: 'New robot', scope: 'Custom robot.', gravity: [0, 0, -9.81], joints: [J({ name: 'Joint 1', linkName: 'Link 1', a: 0.5, mass: 1 })], home: [0] };
        break;
      default: throw new Error('Unknown preset ' + id);
    }
    r.id = id; r.joints.forEach(j => autoInertial(j)); return r;
  }
  const PRESET_IDS = [['planar2', '2-link planar'], ['arm3', '3-DOF articulated'], ['scara4', '4-DOF SCARA'], ['ur5like', '6-DOF UR5-like']];
  const cloneRobot = (r) => JSON.parse(JSON.stringify(r));
  /** Exact re-expression of a robot in the other DH convention (classical <-> modified/Craig). */
  function convertConvention(robot, to) {
    const from = robot.convention === 'mdh' ? 'mdh' : 'classical'; if (from === to) return robot;
    const r = cloneRobot(robot), O = robot.joints, J = r.joints, n = J.length, tl = robot.tool || [0, 0, 0];
    for (let i = 0; i < n; i++) {
      if (to === 'mdh') { J[i].a = i ? O[i - 1].a : 0; J[i].alpha = i ? O[i - 1].alpha : 0; const al = O[i].alpha * D2R, c = O[i].com, ca = Math.cos(al), sa = Math.sin(al);
        J[i].com = [O[i].a + c[0], ca * c[1] - sa * c[2], sa * c[1] + ca * c[2]]; }
      else { J[i].a = i < n - 1 ? O[i + 1].a : tl[0]; J[i].alpha = i < n - 1 ? O[i + 1].alpha : 0; const al = J[i].alpha * D2R, c = O[i].com, ca = Math.cos(al), sa = Math.sin(al);
        J[i].com = [c[0] - J[i].a, ca * c[1] + sa * c[2], -sa * c[1] + ca * c[2]]; }
    }
    if (to === 'mdh') r.tool = [O[n - 1].a, 0, 0]; else delete r.tool;
    r.convention = to; return r;
  }
  /** Slender-rod mass estimate; in modified DH the link extends from frame i to frame i+1 (stored in the next row / tool). */
  function autoInertialAt(robot, i) {
    const j = robot.joints[i]; if (robot.convention !== 'mdh') return autoInertial(j);
    const nx = robot.joints[i + 1], al = nx ? nx.alpha * D2R : 0, v = nx ? [nx.a, -Math.sin(al) * nx.d, Math.cos(al) * nx.d] : (robot.tool || [0, 0, 0]), len = Math.hypot(v[0], v[1], v[2]);
    j.com = v.map(x => x / 2); const I = j.mass * (len * len / 12 + 1.6e-3); j.inertia = [I, I, I]; return j; /* 1.6e-3 ≈ 40 mm body radius: keeps M(q) well-conditioned for very short links */
  }

  /* ------------------------ forward kinematics --------------------------- */
  function linkTransform(j, qi, mdh) {
    const theta = j.type === 'R' ? j.theta * D2R + qi : j.theta * D2R;
    const d = j.type === 'P' ? j.d + qi : j.d;
    return (mdh ? mdhMatrix : dhMatrix)(j.a, j.alpha * D2R, d, theta);
  }
  /** Full FK: frames[i] = ⁰T_i (frames[0] = identity), links[i-1] = ^{i-1}T_i. */
  function fk(robot, q) {
    const frames = [eye4()], links = [];
    let T = eye4();
    for (let i = 0; i < robot.joints.length; i++) {
      const A = linkTransform(robot.joints[i], q[i], robot.convention === 'mdh'); links.push(A); T = Mx.mul(T, A); frames.push(T);
    }
    const tl = robot.tool; if (tl && (tl[0] || tl[1] || tl[2])) T = Mx.mul(T, [[1, 0, 0, tl[0]], [0, 1, 0, tl[1]], [0, 0, 1, tl[2]], [0, 0, 0, 1]]);
    return { frames, links, T };
  }
  /** Fast, allocation-light end-effector position (used for workspace sampling). */
  function fkPos(robot, q, out) {
    if (robot.convention === 'mdh' || robot.tool) { const pp = Pof(fk(robot, q).T); out = out || [0, 0, 0]; out[0] = pp[0]; out[1] = pp[1]; out[2] = pp[2]; return out; }
    let r00 = 1, r01 = 0, r02 = 0, r10 = 0, r11 = 1, r12 = 0, r20 = 0, r21 = 0, r22 = 1, px = 0, py = 0, pz = 0;
    for (let i = 0; i < robot.joints.length; i++) {
      const j = robot.joints[i], th = (j.type === 'R' ? j.theta * D2R + q[i] : j.theta * D2R), d = j.type === 'P' ? j.d + q[i] : j.d, al = j.alpha * D2R;
      const ct = Math.cos(th), st = Math.sin(th), ca = Math.cos(al), sa = Math.sin(al), a = j.a;
      const c0x = ct, c0y = st, c1x = -st * ca, c1y = ct * ca, c1z = sa, c2x = st * sa, c2y = -ct * sa, c2z = ca;
      const tx = a * ct, ty = a * st, tz = d;
      px += r00 * tx + r01 * ty + r02 * tz; py += r10 * tx + r11 * ty + r12 * tz; pz += r20 * tx + r21 * ty + r22 * tz;
      const n00 = r00 * c0x + r01 * c0y, n10 = r10 * c0x + r11 * c0y, n20 = r20 * c0x + r21 * c0y;
      const n01 = r00 * c1x + r01 * c1y + r02 * c1z, n11 = r10 * c1x + r11 * c1y + r12 * c1z, n21 = r20 * c1x + r21 * c1y + r22 * c1z;
      const n02 = r00 * c2x + r01 * c2y + r02 * c2z, n12 = r10 * c2x + r11 * c2y + r12 * c2z, n22 = r20 * c2x + r21 * c2y + r22 * c2z;
      r00 = n00; r10 = n10; r20 = n20; r01 = n01; r11 = n11; r21 = n21; r02 = n02; r12 = n12; r22 = n22;
    }
    out = out || [0, 0, 0]; out[0] = px; out[1] = py; out[2] = pz; return out;
  }

  /* ------------------------------ Jacobian ------------------------------- */
  /** Geometric Jacobian in the BASE frame, 6×n: rows 0-2 linear velocity, rows 3-5 angular velocity. */
  function jacobianFromFrames(robot, frames) {
    const n = robot.joints.length, s = robot.convention === 'mdh' ? 1 : 0, pe = V.add(Pof(frames[n]), Mx.mulVec(Rof(frames[n]), robot.tool || [0, 0, 0])), J = Mx.zeros(6, n);
    for (let i = 0; i < n; i++) {
      const z = colOf(frames[i + s], 2), p = Pof(frames[i + s]);
      if (robot.joints[i].type === 'R') { const v = V.cross(z, V.sub(pe, p)); for (let k = 0; k < 3; k++) { J[k][i] = v[k]; J[3 + k][i] = z[k]; } }
      else for (let k = 0; k < 3; k++) J[k][i] = z[k];
    }
    return J;
  }
  const jacobian = (robot, q) => jacobianFromFrames(robot, fk(robot, q).frames);
  /** Central finite-difference Jacobian (independent check). */
  function jacobianFD(robot, q, h = 1e-6) {
    const n = q.length, J = Mx.zeros(6, n);
    for (let i = 0; i < n; i++) {
      const qp = q.slice(), qm = q.slice(); qp[i] += h; qm[i] -= h;
      const Fp = fk(robot, qp).T, Fm = fk(robot, qm).T;
      const dp = V.sub(Pof(Fp), Pof(Fm));
      const dR = Mx.mul(Rof(Fp), Mx.T(Rof(Fm)));
      const w = [(dR[2][1] - dR[1][2]) / 2, (dR[0][2] - dR[2][0]) / 2, (dR[1][0] - dR[0][1]) / 2];
      for (let k = 0; k < 3; k++) { J[k][i] = dp[k] / (2 * h); J[3 + k][i] = w[k] / (2 * h); }
    }
    return J;
  }
  const maxAbsDiff = (A, B) => { let m = 0; for (let i = 0; i < A.length; i++) for (let j = 0; j < A[0].length; j++) m = Math.max(m, Math.abs(A[i][j] - B[i][j])); return m; };
  /** Singular values / conditioning / Yoshikawa manipulability of the selected Jacobian rows. */
  function analyzeJacobian(J, rows) {
    const Js = J.slice(0, rows), n = Js[0].length;
    const G = rows <= n ? Mx.mul(Js, Mx.T(Js)) : Mx.mul(Mx.T(Js), Js);
    const sv = Mx.eigSym(G).map(x => Math.sqrt(Math.max(0, x)));
    const full = rows <= n, smin = sv[sv.length - 1], smax = sv[0];
    const manip = sv.reduce((p, s) => p * s, 1);
    return { sv, smax, smin, cond: smin > 1e-12 ? smax / smin : Infinity, manipulability: manip, fullRank: full && smin > 1e-6,
      singular: !(full && smin > 1e-3) };
  }
  /** Damped least-squares joint velocities for a desired Cartesian velocity. */
  function jointVelocityFromTwist(J, v, rows, lambda = 1e-3) {
    const Js = J.slice(0, rows), JJt = Mx.mul(Js, Mx.T(Js));
    for (let i = 0; i < rows; i++) JJt[i][i] += lambda * lambda;
    const y = Mx.solve(JJt, v.slice(0, rows)); if (!y) return null;
    const qd = Mx.mulVec(Mx.T(Js), y), back = Mx.mulVec(Js, qd);
    return { qd, residual: vnorm(back.map((b, i) => b - v[i])) };
  }

  /* --------------------------- inverse kinematics ------------------------ */
  function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function poseError(T, pd, Rd, useOri, wOri) {
    const ep = V.sub(pd, Pof(T));
    if (!useOri) return { e: ep, ep: V.norm(ep), eo: 0 };
    const w = logRot(Mx.mul(Rd, Mx.T(Rof(T))));
    return { e: ep.concat(V.scale(w, wOri)), ep: V.norm(ep), eo: V.norm(w) };
  }
  /**
   * Damped-least-squares IK (Levenberg-style adaptive damping):
   *    Δq = Jᵀ (J Jᵀ + λ² I)⁻¹ e ,  step-limited, clamped to joint limits.
   * `converged` is true ONLY if the final residual (recomputed with FK) is within tolerance.
   */
  function ikDLS(robot, target, q0, o) {
    const opt = Object.assign({ lambda: 0.05, tol: 1e-4, tolOri: 1e-3, maxIter: 300, useOri: false, wOri: 1, maxStep: 0.35 }, o || {});
    const n = robot.joints.length, rows = opt.useOri ? 6 : 3;
    const Rd = target.R || (target.rpy ? rpyToR(target.rpy[0], target.rpy[1], target.rpy[2]) : eye4().slice(0, 3).map(r => r.slice(0, 3)));
    let q = clampQ(robot, q0.slice()), lam = opt.lambda, history = [], reason = 'max iterations reached', it = 0;
    let f = fk(robot, q), pe = poseError(f.T, target.pos, Rd, opt.useOri, opt.wOri), eN = vnorm(pe.e), stall = 0;
    for (it = 0; it < opt.maxIter; it++) {
      history.push({ pos: pe.ep, ori: pe.eo });
      if (pe.ep <= opt.tol && (!opt.useOri || pe.eo <= opt.tolOri)) { reason = 'tolerance reached'; break; }
      const J = jacobianFromFrames(robot, f.frames).slice(0, rows);
      const JJt = Mx.mul(J, Mx.T(J)); for (let i = 0; i < rows; i++) JJt[i][i] += lam * lam;
      const y = Mx.solve(JJt, pe.e); if (!y) { reason = 'numerical failure (singular system)'; break; }
      let dq = Mx.mulVec(Mx.T(J), y);
      const m = Math.max(...dq.map(Math.abs)); if (m > opt.maxStep) dq = dq.map(x => x * opt.maxStep / m);
      const qn = clampQ(robot, q.map((v, i) => v + dq[i]));
      const fn = fk(robot, qn), pn = poseError(fn.T, target.pos, Rd, opt.useOri, opt.wOri), eNn = vnorm(pn.e);
      if (eNn > eN * (1 + 1e-12)) { lam = Math.min(lam * 2, 10); if (lam >= 10) stall++; }
      else { stall = (eN - eNn < 1e-12) ? stall + 1 : 0; lam = Math.max(opt.lambda, lam * 0.7); q = qn; f = fn; pe = pn; eN = eNn; }
      if (stall > 25) { reason = 'stalled (joint limit, singularity or local minimum)'; break; }
    }
    const fin = fk(robot, q), pf = poseError(fin.T, target.pos, Rd, opt.useOri, opt.wOri);
    const converged = pf.ep <= opt.tol && (!opt.useOri || pf.eo <= opt.tolOri);
    if (converged) reason = 'tolerance reached';
    else if (reason === 'tolerance reached') reason = 'max iterations reached';
    history.push({ pos: pf.ep, ori: pf.eo });
    const dist = V.norm(target.pos), reach = reachEstimate(robot);
    return { q, converged, iterations: Math.min(it, opt.maxIter), posError: pf.ep, oriError: pf.eo, history, reason,
      withinLimits: qWithinLimits(robot, q), likelyUnreachable: !converged && dist > reach + 1e-9, T: fin.T };
  }
  const qDistance = (a, b, robot) => vnorm(a.map((v, i) => robot.joints[i].type === 'R' ? wrapPi(v - b[i]) : v - b[i]));
  /** Multi-start DLS: start 0 uses q0; others use random configurations inside the joint limits. */
  function ikMulti(robot, target, q0, o, nStarts, seed) {
    const rng = makeRng(seed || 12345), sols = [], all = [];
    for (let s = 0; s < nStarts; s++) {
      let qs = q0;
      if (s > 0) qs = robot.joints.map(j => { const [lo, hi] = jointLimitsSI(j); return lo + (hi - lo) * rng(); });
      const r = ikDLS(robot, target, qs, o); all.push(r);
      if (r.converged && r.withinLimits && !sols.some(x => qDistance(x.q, r.q, robot) < 1e-3)) sols.push(r);
    }
    sols.sort((a, b) => qDistance(a.q, q0, robot) - qDistance(b.q, q0, robot));
    return { solutions: sols, attempts: all };
  }
  /** Is the robot a 2-link planar RR arm (all alpha = 0, d = 0)? Analytical IK applies. */
  function lens2R(robot) {
    const J = robot.joints; if (J.length !== 2 || !J.every(j => j.type === 'R' && Math.abs(j.alpha) < 1e-9 && Math.abs(j.d) < 1e-9)) return null;
    if (robot.convention === 'mdh') { const t = robot.tool || [0, 0, 0]; return Math.abs(J[0].a) < 1e-9 && Math.abs(J[1].a) > 1e-9 && Math.abs(t[0]) > 1e-9 && !t[1] && !t[2] ? [J[1].a, t[0]] : null; }
    return Math.abs(J[0].a) > 1e-9 && Math.abs(J[1].a) > 1e-9 ? [J[0].a, J[1].a] : null;
  }
  const isPlanar2R = (robot) => !!lens2R(robot);
  /** Closed-form IK of the 2R planar arm for target (x, y, z). Returns up to two solutions. */
  function ik2R(robot, x, y, z, tol = 1e-9) {
    if (!isPlanar2R(robot)) return { applicable: false, solutions: [], reachable: false, message: 'Analytical solver applies only to 2-link planar RR robots.' };
    const [j1, j2] = robot.joints, [l1, l2] = lens2R(robot), r2 = x * x + y * y;
    if (Math.abs(z) > 1e-6) return { applicable: true, solutions: [], reachable: false, message: 'Target is out of the robot plane (z must be 0).' };
    const c2 = (r2 - l1 * l1 - l2 * l2) / (2 * l1 * l2);
    if (Math.abs(c2) > 1 + tol) return { applicable: true, solutions: [], reachable: false, message: 'Target is outside the reachable annulus |L1−L2| ≤ r ≤ L1+L2 (r = ' + Math.sqrt(r2).toFixed(4) + ' m).' };
    const sols = [], cc = clamp(c2, -1, 1);
    const cands = Math.abs(Math.abs(cc) - 1) < 1e-12 ? [Math.acos(cc)] : [Math.acos(cc), -Math.acos(cc)];
    for (const t2 of cands) {
      const t1 = Math.atan2(y, x) - Math.atan2(l2 * Math.sin(t2), l1 + l2 * Math.cos(t2));
      const q = [wrapPi(t1 - j1.theta * D2R), wrapPi(t2 - j2.theta * D2R)];
      const lim = qWithinLimits(robot, q, 1e-9);
      sols.push({ q, withinLimits: lim, label: (l1 * l2 > 0 ? (t2 < 0) : (t2 > 0)) ? 'elbow-up (θ₂<0)' : 'elbow-down (θ₂≥0)' });
    }
    return { applicable: true, solutions: sols, reachable: true, message: sols.length === 1 ? 'Single solution (arm fully stretched or folded).' : 'Two closed-form solutions.' };
  }

  /* ------------------------------ trajectories --------------------------- */
  function polyCoeffs(type, q0, qf, v0, vf, a0, af, T) {
    const D = qf - q0;
    if (type === 'cubic') return [q0, v0, (3 * D - (2 * v0 + vf) * T) / (T * T), (-2 * D + (v0 + vf) * T) / (T * T * T), 0, 0];
    return [q0, v0, a0 / 2, (20 * D - (8 * vf + 12 * v0) * T - (3 * a0 - af) * T * T) / (2 * T ** 3),
      (-30 * D + (14 * vf + 16 * v0) * T + (3 * a0 - 2 * af) * T * T) / (2 * T ** 4), (12 * D - 6 * (vf + v0) * T - (a0 - af) * T * T) / (2 * T ** 5)];
  }
  function evalPoly(c, t) {
    return [c[0] + t * (c[1] + t * (c[2] + t * (c[3] + t * (c[4] + t * c[5])))),
      c[1] + t * (2 * c[2] + t * (3 * c[3] + t * (4 * c[4] + t * 5 * c[5]))),
      2 * c[2] + t * (6 * c[3] + t * (12 * c[4] + t * 20 * c[5]))];
  }
  const TRAJ_MAX_SAMPLES = 5001;
  /** Joint-space trajectory. spec: {type:'linear'|'cubic'|'quintic', q0,qf,v0,vf,a0,af, T, dt} (per-joint arrays). */
  function jointTrajectory(spec) {
    const { type, q0, qf, T, dt } = spec, n = q0.length;
    const v0 = spec.v0 || new Array(n).fill(0), vf = spec.vf || new Array(n).fill(0), a0 = spec.a0 || new Array(n).fill(0), af = spec.af || new Array(n).fill(0);
    if (!(T > 0) || !(dt > 0)) throw new Error('Duration and sampling interval must be positive.');
    const N = Math.floor(T / dt + 1e-9) + 1; if (N + 1 > TRAJ_MAX_SAMPLES) throw new Error('Too many samples (max ' + (TRAJ_MAX_SAMPLES - 1) + '). Increase the sampling interval.');
    const coeffs = q0.map((_, j) => type === 'linear' ? null : polyCoeffs(type, q0[j], qf[j], v0[j], vf[j], a0[j], af[j], T));
    const t = [], q = [], qd = [], qdd = [];
    const times = []; for (let k = 0; k < N; k++) times.push(k * dt); if (T - times[times.length - 1] > 1e-9) times.push(T); else times[times.length - 1] = T;
    for (const tk of times) {
      const qq = [], vv = [], aa = [];
      for (let j = 0; j < n; j++) {
        if (type === 'linear') { qq.push(q0[j] + (qf[j] - q0[j]) * tk / T); vv.push((qf[j] - q0[j]) / T); aa.push(0); }
        else { const e = evalPoly(coeffs[j], tk); qq.push(e[0]); vv.push(e[1]); aa.push(e[2]); }
      }
      t.push(tk); q.push(qq); qd.push(vv); qdd.push(aa);
    }
    return { t, q, qd, qdd, type };
  }
  function trajectoryChecks(robot, traj) {
    const warnings = [], n = robot.joints.length;
    for (let j = 0; j < n; j++) {
      const [lo, hi] = jointLimitsSI(robot.joints[j]); let mn = Infinity, mx = -Infinity;
      traj.q.forEach(r => { mn = Math.min(mn, r[j]); mx = Math.max(mx, r[j]); });
      if (mn < lo - 1e-9 || mx > hi + 1e-9) warnings.push(robot.joints[j].name + ': trajectory leaves its joint limits (range ' + (mn * jointDisplayScale(robot.joints[j])).toFixed(2) + ' … ' + (mx * jointDisplayScale(robot.joints[j])).toFixed(2) + ').');
    }
    if (traj.q.some(r => r.some(v => !Number.isFinite(v)))) warnings.push('Trajectory contains non-finite values.');
    return warnings;
  }
  /** Cartesian straight line (position only) using IK at each sample. Failed samples are reported, never hidden. */
  function cartesianLineTrajectory(robot, qStart, pEnd, T, dt, ikOpt) {
    const N = Math.floor(T / dt + 1e-9) + 1; if (N + 1 > 2001) throw new Error('Cartesian trajectories are limited to 2000 samples (each sample runs an IK solve).');
    const p0 = Pof(fk(robot, qStart).T), t = [], q = [], failed = [], ee = []; let qprev = qStart.slice();
    for (let k = 0; k < N + (T - (N - 1) * dt > 1e-9 ? 1 : 0); k++) {
      const tk = Math.min(k * dt, T), u = tk / T, s = 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5;
      const p = V.add(p0, V.scale(V.sub(pEnd, p0), s));
      const r = ikDLS(robot, { pos: p }, qprev, Object.assign({ maxIter: 100 }, ikOpt || {}, { useOri: false }));
      t.push(tk); ee.push(p);
      if (r.converged && r.withinLimits) { qprev = r.q; q.push(r.q); } else { failed.push({ k, t: tk, posError: r.posError, reason: r.reason }); q.push(qprev.slice()); }
    }
    const qd = q.map(() => null), qdd = q.map(() => null), n = qStart.length;
    for (let k = 0; k < q.length; k++) {
      const a = Math.max(0, k - 1), b = Math.min(q.length - 1, k + 1), h = t[b] - t[a];
      qd[k] = q[b].map((v, j) => (v - q[a][j]) / h);
    }
    for (let k = 0; k < q.length; k++) {
      const a = Math.max(0, k - 1), b = Math.min(q.length - 1, k + 1), h = t[b] - t[a];
      qdd[k] = qd[b].map((v, j) => (v - qd[a][j]) / h);
    }
    return { ok: failed.length === 0, failed, traj: { t, q, qd, qdd, type: 'cartesian-line', velocityNote: 'q̇, q̈ are finite differences of the IK solutions.' }, n };
  }

  /* ------------------------------- dynamics ------------------------------ */
  function linkComJacobians(robot, frames) {
    const n = robot.joints.length, out = [], s = robot.convention === 'mdh' ? 1 : 0;
    for (let i = 1; i <= n; i++) {
      const L = robot.joints[i - 1], R = Rof(frames[i]), pc = V.add(Pof(frames[i]), Mx.mulVec(R, L.com));
      const Jv = Mx.zeros(3, n), Jw = Mx.zeros(3, n);
      for (let j = 0; j < i; j++) {
        const z = colOf(frames[j + s], 2), p = Pof(frames[j + s]);
        if (robot.joints[j].type === 'R') { const v = V.cross(z, V.sub(pc, p)); for (let k = 0; k < 3; k++) { Jv[k][j] = v[k]; Jw[k][j] = z[k]; } }
        else for (let k = 0; k < 3; k++) Jv[k][j] = z[k];
      }
      out.push({ Jv, Jw, R, pc, L });
    }
    return out;
  }
  /** Mass matrix M(q) = Σ m JvᵀJv + Jwᵀ (R I Rᵀ) Jw */
  function massMatrix(robot, q) {
    const n = q.length, M = Mx.zeros(n, n), cj = linkComJacobians(robot, fk(robot, q).frames);
    for (const { Jv, Jw, R, L } of cj) {
      const I = Mx.mul(Mx.mul(R, [[L.inertia[0], 0, 0], [0, L.inertia[1], 0], [0, 0, L.inertia[2]]]), Mx.T(R));
      const A = Mx.mul(Mx.T(Jv), Jv), B = Mx.mul(Mx.T(Jw), Mx.mul(I, Jw));
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) M[i][j] += L.mass * A[i][j] + B[i][j];
    }
    return M;
  }
  /** g(q) = ∂U/∂q with U = −Σ m gᵀ p_c  (gravity vector g in base frame). */
  function gravityVector(robot, q, g) {
    const n = q.length, G = new Array(n).fill(0), cj = linkComJacobians(robot, fk(robot, q).frames);
    for (const { Jv, L } of cj) for (let j = 0; j < n; j++) G[j] -= L.mass * (g[0] * Jv[0][j] + g[1] * Jv[1][j] + g[2] * Jv[2][j]);
    return G;
  }
  /** Coriolis/centrifugal matrix C(q, q̇) from Christoffel symbols of the first kind (∂M by central differences). */
  function coriolisMatrix(robot, q, qd, h = 1e-6) {
    const n = q.length, dM = [];
    for (let i = 0; i < n; i++) {
      const qp = q.slice(), qm = q.slice(); qp[i] += h; qm[i] -= h;
      const Mp = massMatrix(robot, qp), Mm = massMatrix(robot, qm);
      dM.push(Mp.map((r, a) => r.map((v, b) => (v - Mm[a][b]) / (2 * h))));
    }
    const C = Mx.zeros(n, n);
    for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < n; i++) s += 0.5 * (dM[i][k][j] + dM[j][k][i] - dM[k][i][j]) * qd[i]; C[k][j] = s; }
    return C;
  }
  function inverseDynamics(robot, q, qd, qdd, g) {
    const M = massMatrix(robot, q), C = coriolisMatrix(robot, q, qd), G = gravityVector(robot, q, g);
    const Mq = Mx.mulVec(M, qdd), Cq = Mx.mulVec(C, qd), tau = Mq.map((v, i) => v + Cq[i] + G[i]);
    return { tau, M, C, G, Mqdd: Mq, Cqd: Cq };
  }
  function forwardDynamics(robot, q, qd, tau, g) {
    const M = massMatrix(robot, q), C = coriolisMatrix(robot, q, qd), G = gravityVector(robot, q, g), Cq = Mx.mulVec(C, qd);
    const qdd = Mx.solve(M, tau.map((t, i) => t - Cq[i] - G[i]));
    return { qdd, M, C, G };
  }
  function energy(robot, q, qd, g) {
    const M = massMatrix(robot, q), cj = linkComJacobians(robot, fk(robot, q).frames);
    const Mqd = Mx.mulVec(M, qd), K = 0.5 * qd.reduce((s, v, i) => s + v * Mqd[i], 0);
    let U = 0; for (const { pc, L } of cj) U -= L.mass * (g[0] * pc[0] + g[1] * pc[1] + g[2] * pc[2]);
    return { K, U, E: K + U };
  }
  /** RK4 forward-dynamics simulation with constant applied joint torque/force `tau`. */
  function simulateForward(robot, q0, qd0, tau, T, dt, g) {
    const n = q0.length, steps = Math.round(T / dt); if (steps > 4000) throw new Error('Too many simulation steps (max 4000).');
    const f = (q, qd) => { const r = forwardDynamics(robot, q, qd, tau, g); if (!r.qdd) throw new Error('Mass matrix is singular.'); return r.qdd; };
    let q = q0.slice(), qd = qd0.slice(); const t = [0], Q = [q.slice()], QD = [qd.slice()], QDD = [f(q, qd)], E = [energy(robot, q, qd, g).E];
    for (let s = 0; s < steps; s++) {
      const k1q = qd, k1v = f(q, qd);
      const q2 = q.map((v, i) => v + 0.5 * dt * k1q[i]), v2 = qd.map((v, i) => v + 0.5 * dt * k1v[i]), k2q = v2, k2v = f(q2, v2);
      const q3 = q.map((v, i) => v + 0.5 * dt * k2q[i]), v3 = qd.map((v, i) => v + 0.5 * dt * k2v[i]), k3q = v3, k3v = f(q3, v3);
      const q4 = q.map((v, i) => v + dt * k3q[i]), v4 = qd.map((v, i) => v + dt * k3v[i]), k4q = v4, k4v = f(q4, v4);
      q = q.map((v, i) => v + dt / 6 * (k1q[i] + 2 * k2q[i] + 2 * k3q[i] + k4q[i]));
      qd = qd.map((v, i) => v + dt / 6 * (k1v[i] + 2 * k2v[i] + 2 * k3v[i] + k4v[i]));
      if (q.some(x => !Number.isFinite(x))) throw new Error('Simulation diverged.');
      t.push((s + 1) * dt); Q.push(q.slice()); QD.push(qd.slice()); QDD.push(f(q, qd)); E.push(energy(robot, q, qd, g).E);
    }
    return { t, q: Q, qd: QD, qdd: QDD, energy: E, type: 'forward-dynamics' };
  }
  /** Inverse dynamics for each trajectory sample. */
  function trajectoryTorques(robot, traj, g) {
    return traj.q.map((q, k) => inverseDynamics(robot, q, traj.qd[k], traj.qdd[k], g).tau);
  }

  /* ------------------------------- workspace ----------------------------- */
  function sampleConfig(robot, rng, q) {
    q = q || new Array(robot.joints.length);
    for (let i = 0; i < q.length; i++) { const [lo, hi] = jointLimitsSI(robot.joints[i]); q[i] = lo + (hi - lo) * rng(); }
    return q;
  }

  /* --------------------------- validation / IO --------------------------- */
  const cleanStr = (s, fb) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, 60) : fb);
  function validateRobot(r) {
    const err = [];
    if (!r || typeof r !== 'object') return { ok: false, errors: ['Robot is missing or not an object.'] };
    if (!Array.isArray(r.joints) || r.joints.length < 1 || r.joints.length > 12) return { ok: false, errors: ['Robot must have between 1 and 12 joints.'] };
    const numIn = (v, lo, hi, label) => { if (!isNum(v) || v < lo || v > hi) { err.push(label + ' must be a number in [' + lo + ', ' + hi + '].'); return 0; } return v; };
    const joints = r.joints.map((j, i) => {
      const L = 'Joint ' + (i + 1) + ' ';
      if (!j || typeof j !== 'object') { err.push(L + 'is not an object.'); return makeJoint(); }
      if (j.type !== 'R' && j.type !== 'P') err.push(L + 'type must be "R" or "P".');
      const o = makeJoint({ name: cleanStr(j.name, 'Joint ' + (i + 1)), linkName: cleanStr(j.linkName, 'Link ' + (i + 1)), type: j.type === 'P' ? 'P' : 'R',
        a: numIn(j.a, -100, 100, L + 'a'), alpha: numIn(j.alpha, -3600, 3600, L + 'alpha'), d: numIn(j.d, -100, 100, L + 'd'), theta: numIn(j.theta, -3600, 3600, L + 'theta'),
        qmin: numIn(j.qmin, -1e4, 1e4, L + 'qmin'), qmax: numIn(j.qmax, -1e4, 1e4, L + 'qmax'), mass: numIn(j.mass, 0, 1e6, L + 'mass') });
      if (o.qmin >= o.qmax) err.push(L + 'lower limit must be below upper limit.');
      if (!Array.isArray(j.com) || j.com.length !== 3) err.push(L + 'com must be [x,y,z].'); else o.com = j.com.map((v, k) => numIn(v, -100, 100, L + 'com[' + k + ']'));
      if (!Array.isArray(j.inertia) || j.inertia.length !== 3) err.push(L + 'inertia must be [Ixx,Iyy,Izz].'); else o.inertia = j.inertia.map((v, k) => numIn(v, 0, 1e6, L + 'inertia[' + k + ']'));
      return o;
    });
    const gravity = Array.isArray(r.gravity) && r.gravity.length === 3 && r.gravity.every(v => isNum(v) && Math.abs(v) <= 1e3) ? r.gravity.slice() : (err.push('gravity must be three finite numbers.'), [0, 0, -9.81]);
    let home = Array.isArray(r.home) && r.home.length === joints.length && r.home.every(isNum) ? r.home.slice() : (err.push('home must have one finite number per joint.'), joints.map(() => 0));
    return { ok: err.length === 0, errors: err, robot: { id: cleanStr(r.id, 'custom'), name: cleanStr(r.name, 'Imported robot'), scope: cleanStr(r.scope, 'Imported robot.') + '', gravity, joints, home, convention: r.convention === 'mdh' ? 'mdh' : 'classical', tool: r.convention === 'mdh' && Array.isArray(r.tool) && r.tool.length === 3 && r.tool.every(v => isNum(v) && Math.abs(v) <= 100) ? r.tool.slice() : (r.convention === 'mdh' ? [0, 0, 0] : undefined) } };
  }
  function validateProject(p) {
    if (!p || typeof p !== 'object' || p.format !== 'robolab-web-project') return { ok: false, errors: ['Not a RoboLab Web project file (format field missing).'] };
    if (p.version !== 1) return { ok: false, errors: ['Unsupported project version: ' + String(p.version).slice(0, 20)] };
    const v = validateRobot(p.robot); if (!v.ok) return v;
    const q = Array.isArray(p.q) && p.q.length === v.robot.joints.length && p.q.every(isNum) ? p.q.slice() : v.robot.home.slice();
    return { ok: true, errors: [], robot: v.robot, q: clampQ(v.robot, q) };
  }

  /* ------------------------------- self-tests ---------------------------- */
  function selfTests() {
    const res = [], add = (name, pass, detail) => res.push({ name, pass: !!pass, detail });
    const rng = makeRng(2024);
    const maxd = (A, B) => maxAbsDiff(A, B);
    // 1 identity
    { const r0 = buildPreset('ur5like'), r1 = convertConvention(r0, 'mdh'), r2 = buildPreset('scara4'), r3 = convertConvention(r2, 'mdh'); let m = 0, mj = 0, mm = 0, mg = 0;
      for (let k = 0; k < 100; k++) { for (const [A, B] of [[r0, r1], [r2, r3]]) { const q = sampleConfig(A, rng); m = Math.max(m, maxd(fk(A, q).T, fk(B, q).T)); mj = Math.max(mj, maxAbsDiff(jacobian(A, q), jacobian(B, q))); mm = Math.max(mm, maxAbsDiff(massMatrix(A, q), massMatrix(B, q))); mg = Math.max(mg, Math.max(...gravityVector(A, q, [0, 0, -9.81]).map((g, i) => Math.abs(g - gravityVector(B, q, [0, 0, -9.81])[i])))); } }
      add('Modified DH ≡ classical (UR5-like & SCARA, 200 poses): FK, Jacobian, M(q), g(q)', m < 1e-12 && mj < 1e-12 && mm < 1e-9 && mg < 1e-9, 'max |ΔT| = ' + m.toExponential(1) + ', |ΔJ| = ' + mj.toExponential(1) + ', |ΔM| = ' + mm.toExponential(1) + ', |Δg| = ' + mg.toExponential(1));
      const mk = convertConvention(convertConvention(r0, 'mdh'), 'classical'); add('Convention conversion round-trips', JSON.stringify(mk.joints.map(j => [j.a, j.alpha])) === JSON.stringify(r0.joints.map(j => [j.a, j.alpha]))); }
    { const r = { joints: [makeJoint({ a: 0, alpha: 0, d: 0, theta: 0 })] }; const T = fk(r, [0]).T; add('DH identity (a=α=d=θ=0)', maxd(T, eye4()) < 1e-15, 'max |T − I| = ' + maxd(T, eye4()).toExponential(2)); }
    // 2 known pose
    { const T = Mx.mul(dhMatrix(0, 0, 0, Math.PI / 2), dhMatrix(1, 0, 0, 0)); add('Homogeneous product Rz(90°)·Tx(1) → p = (0,1,0)', Math.abs(T[0][3]) < 1e-12 && Math.abs(T[1][3] - 1) < 1e-12, 'p = (' + T[0][3].toExponential(1) + ', ' + T[1][3].toFixed(6) + ', ' + T[2][3] + ')'); }
    // 3 rotation validity on 6-DOF
    { const r = buildPreset('ur5like'); let w = 0, wd = 0; for (let k = 0; k < 200; k++) { const R = Rof(fk(r, sampleConfig(r, rng)).T), c = rotationCheck(R); w = Math.max(w, c.orthError); wd = Math.max(wd, Math.abs(c.det - 1)); }
      add('Rotation matrices orthonormal, det = 1 (200 random 6-DOF poses)', w < 1e-12 && wd < 1e-12, 'max orth err = ' + w.toExponential(2) + ', max |det−1| = ' + wd.toExponential(2)); }
    // 4 planar FK analytic
    const p2 = buildPreset('planar2'); const L1 = p2.joints[0].a, L2 = p2.joints[1].a;
    { let m = 0, mo = 0; for (let k = 0; k < 300; k++) { const q = sampleConfig(p2, rng), T = fk(p2, q).T; const x = L1 * Math.cos(q[0]) + L2 * Math.cos(q[0] + q[1]), y = L1 * Math.sin(q[0]) + L2 * Math.sin(q[0] + q[1]);
      m = Math.max(m, Math.abs(T[0][3] - x), Math.abs(T[1][3] - y)); mo = Math.max(mo, Math.abs(T[0][0] - Math.cos(q[0] + q[1])), Math.abs(T[1][0] - Math.sin(q[0] + q[1]))); }
      add('FK matches analytic 2-link formulas (position + yaw, 300 configs)', m < 1e-12 && mo < 1e-12, 'max pos err = ' + m.toExponential(2) + ', max orient err = ' + mo.toExponential(2)); }
    // 5 fast FK vs full FK
    { const r = buildPreset('scara4'); let m = 0; for (let k = 0; k < 200; k++) { const q = sampleConfig(r, rng); m = Math.max(m, vnorm(V.sub(fkPos(r, q), Pof(fk(r, q).T)))); } add('Fast position-only FK equals full matrix FK', m < 1e-12, 'max diff = ' + m.toExponential(2)); }
    // 6 analytic IK round trip
    { let m = 0, n2 = 0, bad = 0; for (let k = 0; k < 200; k++) { const q = sampleConfig(p2, rng), p = Pof(fk(p2, q).T), s = ik2R(p2, p[0], p[1], 0);
        if (!s.reachable) { bad++; continue; } for (const so of s.solutions) { const pp = Pof(fk(p2, so.q).T); m = Math.max(m, Math.hypot(pp[0] - p[0], pp[1] - p[1])); n2++; } }
      add('Analytic 2R IK → FK round trip (all returned solutions)', bad === 0 && m < 1e-9 && n2 >= 200, 'solutions checked = ' + n2 + ', max residual = ' + m.toExponential(2)); }
    { const s = ik2R(p2, 3, 0, 0); add('Analytic IK reports unreachable target', s.reachable === false && s.solutions.length === 0, s.message); }
    // 7 numeric IK
    { const r = buildPreset('ur5like'); let ok = 0, worst = 0, N = 20;
      for (let k = 0; k < N; k++) { const q = sampleConfig(r, rng), tp = Pof(fk(r, q).T), q0 = clampQ(r, q.map(v => v + (rng() - 0.5) * 0.6)); const res2 = ikDLS(r, { pos: tp }, q0, { maxIter: 400 });
        const chk = V.norm(V.sub(tp, Pof(fk(r, res2.q).T))); if (res2.converged && chk <= 1e-4 + 1e-12) ok++; worst = Math.max(worst, chk); }
      add('Numerical DLS IK (6-DOF, position) converges and verifies through FK', ok >= 18, ok + '/' + N + ' converged; verified residual of last solutions ≤ ' + worst.toExponential(2) + ' m'); }
    { const r = buildPreset('ur5like'); let ok = 0, N = 12;
      for (let k = 0; k < N; k++) { const q = sampleConfig(r, rng), T = fk(r, q).T, q0 = clampQ(r, q.map(v => v + (rng() - 0.5) * 0.4));
        const res2 = ikDLS(r, { pos: Pof(T), R: Rof(T) }, q0, { useOri: true, maxIter: 600 }); if (res2.converged) { const F = fk(r, res2.q).T; if (V.norm(V.sub(Pof(T), Pof(F))) < 1e-4 && vnorm(logRot(Mx.mul(Rof(T), Mx.T(Rof(F))))) < 1e-3 + 1e-9) ok++; } }
      add('Numerical DLS IK with orientation (6-DOF pose)', ok >= 10, ok + '/' + N + ' converged and verified'); }
    { const r = buildPreset('ur5like'), res2 = ikDLS(r, { pos: [5, 0, 0] }, r.home, { maxIter: 80 }); add('Unreachable target is reported as failure (never as success)', !res2.converged && res2.likelyUnreachable && res2.posError > 1, 'converged = ' + res2.converged + ', residual = ' + res2.posError.toFixed(3) + ' m'); }
    { const r = buildPreset('arm3'); r.joints[1].qmin = 0; r.joints[1].qmax = 10; const res2 = ikDLS(r, { pos: [0.2, 0, 0.1] }, [0, 0.1, 0], { maxIter: 150 }); add('IK enforces joint limits', qWithinLimits(r, res2.q), 'q₂ = ' + (res2.q[1] * R2D).toFixed(3) + '° with limits [0°, 10°]; converged = ' + res2.converged); }
    // 8 Jacobian
    { const r = buildPreset('ur5like'); let m = 0; for (let k = 0; k < 50; k++) { const q = sampleConfig(r, rng); m = Math.max(m, maxd(jacobian(r, q), jacobianFD(r, q))); } add('Geometric Jacobian equals finite-difference Jacobian (6-DOF)', m < 1e-6, 'max |ΔJ| = ' + m.toExponential(2)); }
    { const r = buildPreset('scara4'); let m = 0; for (let k = 0; k < 50; k++) { const q = sampleConfig(r, rng); m = Math.max(m, maxd(jacobian(r, q), jacobianFD(r, q))); } add('Jacobian with a prismatic joint (SCARA) vs finite difference', m < 1e-6, 'max |ΔJ| = ' + m.toExponential(2)); }
    { const J = jacobian(p2, [0, Math.PI / 2]); add('Planar 2-link Jacobian at q=(0,90°) = [[−0.8,−0.8],[1,0]]', Math.abs(J[0][0] + 0.8) < 1e-12 && Math.abs(J[0][1] + 0.8) < 1e-12 && Math.abs(J[1][0] - 1) < 1e-12 && Math.abs(J[1][1]) < 1e-12, 'J[0:2] = ' + JSON.stringify(J.slice(0, 2).map(r => r.map(v => +v.toFixed(6))))); }
    { const a = analyzeJacobian(jacobian(p2, [0.3, 0]), 2); add('Stretched-out arm flagged as singular', a.singular && a.smin < 1e-6, 'σ_min = ' + a.smin.toExponential(2) + ', w = ' + a.manipulability.toExponential(2)); }
    { const a = analyzeJacobian(jacobian(p2, [0.3, 1.2]), 2), analytic = L1 * L2 * Math.abs(Math.sin(1.2)); add('Manipulability |det J| = L1·L2·|sin q2| (planar)', Math.abs(a.manipulability - analytic) < 1e-9, 'computed ' + a.manipulability.toFixed(9) + ' vs ' + analytic.toFixed(9)); }
    // 9 trajectories
    { const q0 = [0.2, -0.5], qf = [1.4, 0.9], T = 2.5, tr = jointTrajectory({ type: 'cubic', q0, qf, T, dt: 0.01 }), last = tr.q.length - 1;
      const ok = tr.q[0].every((v, i) => Math.abs(v - q0[i]) < 1e-12) && tr.q[last].every((v, i) => Math.abs(v - qf[i]) < 1e-12) && Math.abs(tr.qd[0][0]) < 1e-12 && Math.abs(tr.qd[last][0]) < 1e-12;
      const u = 0.5, mid = tr.q[Math.round(last / 2)][0], expect = q0[0] + (qf[0] - q0[0]) * (3 * u * u - 2 * u ** 3); add('Cubic trajectory: endpoints, zero end velocities, q(T/2) formula', ok && Math.abs(mid - expect) < 1e-12, 'q(T/2) = ' + mid.toFixed(9) + ', formula = ' + expect.toFixed(9)); }
    { const spec = { type: 'quintic', q0: [0.1], qf: [1.0], v0: [0.3], vf: [-0.2], a0: [0.5], af: [0.1], T: 2, dt: 0.001 }, tr = jointTrajectory(spec), l = tr.q.length - 1;
      const e = [Math.abs(tr.q[0][0] - 0.1), Math.abs(tr.q[l][0] - 1.0), Math.abs(tr.qd[0][0] - 0.3), Math.abs(tr.qd[l][0] + 0.2), Math.abs(tr.qdd[0][0] - 0.5), Math.abs(tr.qdd[l][0] - 0.1)];
      add('Quintic trajectory satisfies all six boundary conditions', Math.max(...e) < 1e-10, 'max boundary error = ' + Math.max(...e).toExponential(2)); }
    { const tr = jointTrajectory({ type: 'quintic', q0: [0], qf: [1], T: 1, dt: 0.0005 }); let m = 0, m2 = 0; for (let k = 1; k < tr.t.length - 1; k++) { m = Math.max(m, Math.abs((tr.q[k + 1][0] - tr.q[k - 1][0]) / (tr.t[k + 1] - tr.t[k - 1]) - tr.qd[k][0])); m2 = Math.max(m2, Math.abs((tr.qd[k + 1][0] - tr.qd[k - 1][0]) / (tr.t[k + 1] - tr.t[k - 1]) - tr.qdd[k][0])); }
      add('Velocity/acceleration agree with numerical derivatives of position', m < 1e-5 && m2 < 1e-4, 'max |q̇ err| = ' + m.toExponential(2) + ', max |q̈ err| = ' + m2.toExponential(2)); }
    { const tr = jointTrajectory({ type: 'cubic', q0: [0], qf: [4], T: 1, dt: 0.1 }), w = trajectoryChecks({ joints: [makeJoint({ qmin: -90, qmax: 90 })] }, tr); add('Trajectory limit violation is detected', w.length === 1, w[0] || 'no warning'); }
    { const c = cartesianLineTrajectory(p2, [0.3, 0.5], [3, 0, 0], 1, 0.1); add('Cartesian trajectory reports failed samples for unreachable end point', !c.ok && c.failed.length > 0, c.failed.length + ' failed sample(s)'); }
    // 10 dynamics vs analytic
    { const r = buildPreset('planar2'), [A, B] = r.joints, m1 = A.mass, m2 = B.mass, l1 = A.a, l2 = B.a, lc1 = -A.com[0], lc2 = -B.com[0], I1 = A.inertia[2], I2 = B.inertia[2], g = 9.81; let eM = 0, eC = 0, eG = 0;
      for (let k = 0; k < 40; k++) { const q = sampleConfig(r, rng), qd = [rng() * 2 - 1, rng() * 2 - 1], c2 = Math.cos(q[1]), s2 = Math.sin(q[1]);
        const M = massMatrix(r, q), G = gravityVector(r, q, [0, -g, 0]), Cq = Mx.mulVec(coriolisMatrix(r, q, qd), qd);
        const M11 = m1 * lc1 ** 2 + I1 + m2 * (l1 ** 2 + lc2 ** 2 + 2 * l1 * lc2 * c2) + I2, M12 = m2 * (lc2 ** 2 + l1 * lc2 * c2) + I2, M22 = m2 * lc2 ** 2 + I2, h = -m2 * l1 * lc2 * s2;
        eM = Math.max(eM, Math.abs(M[0][0] - M11), Math.abs(M[0][1] - M12), Math.abs(M[1][0] - M12), Math.abs(M[1][1] - M22));
        const c1 = h * qd[1] * qd[0] + h * (qd[0] + qd[1]) * qd[1], c2v = -h * qd[0] * qd[0]; eC = Math.max(eC, Math.abs(Cq[0] - c1), Math.abs(Cq[1] - c2v));
        const g1 = (m1 * lc1 + m2 * l1) * g * Math.cos(q[0]) + m2 * lc2 * g * Math.cos(q[0] + q[1]), g2 = m2 * lc2 * g * Math.cos(q[0] + q[1]); eG = Math.max(eG, Math.abs(G[0] - g1), Math.abs(G[1] - g2)); }
      add('Dynamics: M(q), C(q,q̇)q̇, g(q) match textbook 2-link formulas', eM < 1e-9 && eC < 1e-6 && eG < 1e-9, 'max err: M ' + eM.toExponential(1) + ', Cq̇ ' + eC.toExponential(1) + ', g ' + eG.toExponential(1)); }
    { const r = buildPreset('ur5like'); let sym = 0, pd = true; for (let k = 0; k < 20; k++) { const M = massMatrix(r, sampleConfig(r, rng)); for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) sym = Math.max(sym, Math.abs(M[i][j] - M[j][i])); if (Mx.eigSym(M)[5] <= 0) pd = false; }
      add('Mass matrix is symmetric positive-definite (6-DOF)', sym < 1e-12 && pd, 'max asymmetry = ' + sym.toExponential(2)); }
    { const r = buildPreset('scara4'), g = r.gravity; let m = 0; for (let k = 0; k < 20; k++) { const q = sampleConfig(r, rng), qd = q.map(() => rng() - 0.5), tau = q.map(() => rng() * 4 - 2), fd = forwardDynamics(r, q, qd, tau, g), id = inverseDynamics(r, q, qd, fd.qdd, g); m = Math.max(m, ...id.tau.map((t, i) => Math.abs(t - tau[i]))); }
      add('Forward ∘ inverse dynamics round trip (SCARA with prismatic joint)', m < 1e-9, 'max torque mismatch = ' + m.toExponential(2)); }
    { const r = buildPreset('arm3'), sim = simulateForward(r, [0.4, 0.3, -0.5], [0.5, -0.4, 0.3], [0, 0, 0], 1.0, 0.002, r.gravity); const E = sim.energy, drift = Math.max(...E.map(e => Math.abs(e - E[0]))); add('Energy conserved in torque-free RK4 forward simulation', drift < 1e-6 * (1 + Math.abs(E[0])), 'max |E − E₀| = ' + drift.toExponential(2) + ' J'); }
    // 11 robustness
    { const bad = validateRobot({ joints: [{ type: 'R', a: NaN }] }), bad2 = validateProject({ format: 'other' }), bad3 = validateProject(null); add('Schema validation rejects invalid data safely', !bad.ok && !bad2.ok && !bad3.ok, 'errors reported: ' + bad.errors.length + ', ' + bad2.errors.length + ', ' + bad3.errors.length); }
    { const r = buildPreset('arm3'); const proj = { format: 'robolab-web-project', version: 1, robot: cloneRobot(r), q: r.home }; const v = validateProject(JSON.parse(JSON.stringify(proj))); add('Project JSON round-trips through validation', v.ok && v.robot.joints.length === 3 && maxd([v.q], [r.home]) < 1e-15, v.ok ? 'ok' : v.errors.join('; ')); }
    { let threw = false; try { jointTrajectory({ type: 'cubic', q0: [0], qf: [1], T: 0, dt: 0.1 }); } catch (e) { threw = true; } add('Invalid trajectory input raises a clear error (no crash)', threw, 'T = 0 rejected'); }
    return res;
  }

  return { D2R, R2D, clamp, wrapPi, isNum, V, Mx, eye4, Rof, Pof, colOf, dhMatrix, mdhMatrix, convertConvention, autoInertialAt, invT, rpyToR, rToRPY, rotationCheck, logRot, makeJoint, autoInertial,
    jointLimitsSI, jointDisplayScale, clampQ, qWithinLimits, reachEstimate, buildPreset, PRESET_IDS, cloneRobot, linkTransform, fk, fkPos, jacobian, jacobianFromFrames,
    jacobianFD, maxAbsDiff, analyzeJacobian, jointVelocityFromTwist, makeRng, ikDLS, ikMulti, isPlanar2R, ik2R, qDistance, polyCoeffs, evalPoly, jointTrajectory,
    trajectoryChecks, cartesianLineTrajectory, TRAJ_MAX_SAMPLES, massMatrix, gravityVector, coriolisMatrix, inverseDynamics, forwardDynamics, energy, simulateForward,
    trajectoryTorques, sampleConfig, validateRobot, validateProject, selfTests, vnorm };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RL;
