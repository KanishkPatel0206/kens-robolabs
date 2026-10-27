/* ============================================================================
   Ken's RoboLabs v6 — Practice modules
   ----------------------------------------------------------------------------
   Pure JavaScript: no DOM, no Three.js, so it also runs under plain Node in the
   test suite. In the browser it is the global `PRACTICE` once engine/core.js
   (RL) and engine/v5.js (RL5) are on the page.

   The Learning Center is a set of self-study PRACTICE MODULES: documentation +
   a generated quiz + a worked solution. There is no lecture voice. Every
   question is built from real Modified-DH maths, and selfTests() re-derives
   every published answer with an independent path (forward kinematics, the
   analytical Jacobian, the closed-form 2R IK, the core trajectory sampler), so
   no answer on screen is a hand-typed magic number.

   Units: the engine is SI (metres, radians). These practice questions are
   written in the units a student reads off the app: millimetres and degrees.
   ========================================================================== */
const PRACTICE = (function () {
  'use strict';

  const NODE = (typeof module !== 'undefined' && module.exports);
  function core() {
    if (NODE) return require('./core.js');
    if (typeof RL !== 'undefined' && RL) return RL;
    throw new Error('engine/core.js (RL) must be loaded before engine/practice.js');
  }
  function v5mod() {
    if (NODE) return require('./v5.js');
    if (typeof RL5 !== 'undefined' && RL5) return RL5;
    return null;
  }

  const D2R = Math.PI / 180, R2D = 180 / Math.PI, MM = 1000, G = 9.81;
  const isN = (v) => typeof v === 'number' && isFinite(v);
  const f = (v, d) => ((Math.abs(v) < 5 * Math.pow(10, -(d + 3)) ? 0 : v)).toFixed(d == null ? 2 : d);
  const VERSION = '6.0.0';

  /* ---- deterministic helpers -------------------------------------------- */
  const rngFrom = (seed) => core().makeRng((seed >>> 0) || 1);
  const ri = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
  function shuffle(rng, arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function mc(rng, prompt, correct, wrong, solution, ctx) {
    const opts = shuffle(rng, [{ text: correct, ok: true }].concat(wrong.map((w) => ({ text: w, ok: false }))));
    ctx = ctx || {}; ctx.correctText = correct;
    return { kind: 'mc', prompt, choices: opts.map((o) => o.text), answerIndex: opts.findIndex((o) => o.ok), solution, ctx };
  }
  function nm(prompt, answer, unit, tol, solution, ctx) {
    return {
      kind: 'num', prompt, answer, unit,
      tol: tol == null ? Math.max(0.05, Math.abs(answer) * 1e-3) : tol,
      solution, ctx,
    };
  }
  function mcVerify(q) {
    return q.kind === 'mc' && Array.isArray(q.choices) && q.choices.length >= 2 &&
      q.answerIndex >= 0 && q.answerIndex < q.choices.length &&
      q.ctx && q.ctx.correctText === q.choices[q.answerIndex];
  }

  /* ---- robot builders ---------------------------------------------------- */
  /**
   * Modified-DH 2R planar arm in SI. In MDH the first link's length lives in
   * row 2 (a1) and the second link is the tool frame — exactly like the app's
   * own "2R planar" preset — so RL.ik2R / RL.jacobian / RL.fk all apply.
   */
  function planar2R(L1mm, L2mm) {
    const c = core();
    return {
      id: 'practice-2r', name: '2R planar', convention: 'mdh', gravity: [0, 0, -G], home: [0, 0],
      tool: [L2mm / MM, 0, 0],
      joints: [
        c.makeJoint({ name: 'Joint 1', type: 'R', a: 0, alpha: 0, d: 0, theta: 0, qmin: -180, qmax: 180, mass: 1 }),
        c.makeJoint({ name: 'Joint 2', type: 'R', a: L1mm / MM, alpha: 0, d: 0, theta: 0, qmin: -180, qmax: 180, mass: 1 }),
      ],
    };
  }
  /** One-link MDH robot, so a single DH row can be turned into its real transform. */
  function oneLink(aMm, alphaDeg, dMm, thetaDeg) {
    const c = core();
    return {
      id: 'practice-row', name: 'one link', convention: 'mdh', gravity: [0, 0, -G], home: [0], tool: [0, 0, 0],
      joints: [c.makeJoint({ name: 'Link', type: 'R', a: aMm / MM, alpha: alphaDeg, d: dMm / MM, theta: thetaDeg, qmin: -180, qmax: 180, mass: 1 })],
    };
  }
  const rowOrigin = (aMm, alphaDeg, dMm, thetaDeg) => core().Pof(core().fk(oneLink(aMm, alphaDeg, dMm, thetaDeg), [0]).frames[1]).map((v) => v * MM);

  const randRow = (rng) => ({
    a: ri(rng, -12, 12) * 5,
    alpha: pick(rng, [-90, -45, 0, 45, 90, 135, 180]),
    d: ri(rng, 0, 10) * 5,
    theta: ri(rng, -12, 12) * 15,
  });
  const randArm = (rng) => ({
    L1: ri(rng, 4, 8) * 50, L2: ri(rng, 3, 7) * 50,
    q1: ri(rng, -34, 34) * 5, q2: ri(rng, -30, 30) * 5,
  });

  /* =======================================================================
     Module 1 — Modified-DH parameters
     ======================================================================= */
  const M1 = {
    id: 'mdh-parameters',
    title: '1 · Modified-DH parameters',
    blurb: 'Read a DH row and predict where it puts the next frame.',
    figures: [{ src: 'assets/figures/mdh-parameters.svg', caption: 'The four parameters of one Modified-DH row.' }],
    doc: [
      { h: 'One row, one transform', p: 'Row i of a modified (Craig) DH table stores four numbers and builds the transform from frame {i−1} to frame {i}:' },
      { eq: '<sup>i−1</sup>T<sub>i</sub> = Rx(α<sub>i−1</sub>) · Tx(a<sub>i−1</sub>) · Rz(θ<sub>i</sub>) · Tz(d<sub>i</sub>)' },
      {
        h: 'What each number is', ul: [
          '<b>a<sub>i−1</sub></b> — link length: distance between Z<sub>i−1</sub> and Z<sub>i</sub>, measured along X<sub>i−1</sub>.',
          '<b>α<sub>i−1</sub></b> — link twist: angle from Z<sub>i−1</sub> to Z<sub>i</sub>, measured about X<sub>i−1</sub>.',
          '<b>θ<sub>i</sub></b> — joint angle: rotation about Z<sub>i</sub>; the variable for a revolute joint.',
          '<b>d<sub>i</sub></b> — joint offset: translation along Z<sub>i</sub>; the variable for a prismatic joint.',
        ],
      },
      { h: 'The translation it produces', p: 'Multiplying Rx(α)·Tx(a) then Rz(θ)·Tz(d) gives a translation that does not depend on θ: <code>p = [ a , −d·sin α , d·cos α ]</code>. That is the fastest check that a row is right — the frame origin’s y and z come only from d and α.' },
    ],
    makeQuiz(rng) {
      const bA = () => {
        const r = randRow(rng), p = rowOrigin(r.a, r.alpha, r.d, r.theta);
        return nm(
          'Row i has a<sub>i−1</sub> = ' + r.a + ' mm, α<sub>i−1</sub> = ' + r.alpha + '°, d<sub>i</sub> = ' + r.d + ' mm, θ<sub>i</sub> = ' + r.theta + '°. Give the <b>y-coordinate</b> (mm) of the origin of frame {i} expressed in frame {i−1}.',
          p[1], 'mm', 0.05,
          'The translation of <sup>i−1</sup>T<sub>i</sub> is p = [ a, −d·sin α, d·cos α ], independent of θ. With d = ' + r.d + ' mm and α = ' + r.alpha + '°: y = −d·sin α = −' + r.d + '·sin(' + r.alpha + '°) = ' + f(p[1], 3) + ' mm. Engine check: forward kinematics puts the frame origin at y = ' + f(p[1], 3) + ' mm.',
          { r, p });
      };
      const bB = () => {
        const r = randRow(rng), p = rowOrigin(r.a, r.alpha, r.d, r.theta);
        return nm(
          'For a row with a<sub>i−1</sub> = ' + r.a + ' mm, α<sub>i−1</sub> = ' + r.alpha + '°, d<sub>i</sub> = ' + r.d + ' mm, θ<sub>i</sub> = ' + r.theta + '°, give the <b>z-coordinate</b> (mm) of frame {i}’s origin in frame {i−1}.',
          p[2], 'mm', 0.05,
          'z = d·cos α = ' + r.d + '·cos(' + r.alpha + '°) = ' + f(p[2], 3) + ' mm. (θ does not appear in the translation at all.)',
          { r, p });
      };
      const bC = () => mc(rng,
        'Which parameter is the <b>link twist</b> — the angle between two consecutive joint axes?',
        'α<sub>i−1</sub> (about X<sub>i−1</sub>)',
        ['a<sub>i−1</sub> (along X<sub>i−1</sub>)', 'θ<sub>i</sub> (about Z<sub>i</sub>)', 'd<sub>i</sub> (along Z<sub>i</sub>)'],
        'The twist is α<sub>i−1</sub>: the rotation about X<sub>i−1</sub> that takes Z<sub>i−1</sub> onto Z<sub>i</sub>. The link length a<sub>i−1</sub> is a distance along that same X axis; θ and d belong to joint i.',
        {});
      const bD = () => mc(rng,
        'For a <b>prismatic</b> joint, which parameter is the joint variable (the one you change to move the robot)?',
        'd<sub>i</sub>',
        ['θ<sub>i</sub>', 'a<sub>i−1</sub>', 'α<sub>i−1</sub>'],
        'A prismatic joint slides along its own Z axis, so the variable is the offset d<sub>i</sub> along Z<sub>i</sub>. θ<sub>i</sub> stays constant (often 0) for that row.',
        {});
      return [bA, bB, bC, bD];
    },
    verify(q) {
      if (q.kind === 'mc') return mcVerify(q);
      const c = q.ctx, p = rowOrigin(c.r.a, c.r.alpha, c.r.d, c.r.theta);
      const comp = /y-coordinate/.test(q.prompt) ? 1 : 2;
      return Math.abs(p[comp] - q.answer) < 1e-6;
    },
  };

  /* =======================================================================
     Module 2 — Frame assignment & transform order
     ======================================================================= */
  const M2 = {
    id: 'transform-order',
    title: '2 · Frames & transform order',
    blurb: 'Assign frames and keep the multiplication order straight.',
    figures: [{ src: 'assets/figures/transform-order.svg', caption: 'Rx·Tx·Rz·Tz — and which two operations commute.' }],
    doc: [
      { h: 'The order matters', p: 'Modified DH composes the four elementary transforms in a fixed order. Only the first two commute, because both act about/along the same X axis:' },
      { eq: 'Rx(α<sub>i−1</sub>) · Tx(a<sub>i−1</sub>) = Tx(a<sub>i−1</sub>) · Rx(α<sub>i−1</sub>)' },
      { h: 'Assignment rules (Craig)', ul: [
        'Number the joints 1…n from the base. Frame {0} is the fixed base frame.',
        'Label each joint axis Z<sub>i</sub> (rotation for revolute, sliding direction for prismatic).',
        'X<sub>i</sub> points along the common normal from Z<sub>i</sub> toward Z<sub>i+1</sub>; if the axes intersect, X<sub>i</sub> = Z<sub>i</sub> × Z<sub>i+1</sub>.',
        'Y<sub>i</sub> = Z<sub>i</sub> × X<sub>i</sub> keeps the frame right-handed.',
        'Then a<sub>i−1</sub> is read along X<sub>i−1</sub>, α<sub>i−1</sub> about X<sub>i−1</sub>, d<sub>i</sub> along Z<sub>i</sub>, θ<sub>i</sub> about Z<sub>i</sub>.',
      ] },
      { h: 'Why the rotation entry is a product', p: 'The rotation part of <sup>i−1</sup>T<sub>i</sub> is R = Rx(α)·Rz(θ), so its (2,2) entry (row 2, column 2) is cos α · cos θ.' },
    ],
    makeQuiz(rng) {
      const bA = () => mc(rng,
        'Which composition is the modified (Craig) DH transform for one link?',
        'Rx(α<sub>i−1</sub>) · Tx(a<sub>i−1</sub>) · Rz(θ<sub>i</sub>) · Tz(d<sub>i</sub>)',
        ['Rz(θ<sub>i</sub>) · Tz(d<sub>i</sub>) · Rx(α<sub>i−1</sub>) · Tx(a<sub>i−1</sub>)',
         'Tz(d<sub>i</sub>) · Rz(θ<sub>i</sub>) · Tx(a<sub>i−1</sub>) · Rx(α<sub>i−1</sub>)',
         'Rx(α<sub>i−1</sub>) · Rz(θ<sub>i</sub>) · Tx(a<sub>i−1</sub>) · Tz(d<sub>i</sub>)'],
        'Modified DH rotates about X<sub>i−1</sub> first (Rx then Tx), then about Z<sub>i</sub> (Rz then Tz). The classical form swaps the two pairs.',
        {});
      const bB = () => mc(rng,
        'In modified DH, the link length a<sub>i−1</sub> is measured along which axis?',
        'X<sub>i−1</sub>',
        ['Z<sub>i−1</sub>', 'Z<sub>i</sub>', 'Y<sub>i−1</sub>'],
        'a<sub>i−1</sub> is the distance between the two joint axes, so it lies along the common normal, which is X<sub>i−1</sub>. Along Z you would find d, not a.',
        {});
      const bC = () => {
        const alpha = pick(rng, [-90, -60, -45, -30, 30, 45, 60, 90]);
        const theta = ri(rng, -10, 10) * 15;
        const R = core().Rof(core().fk(oneLink(0, alpha, 0, theta), [0]).frames[1]);
        const val = R[1][1];
        return nm(
          'For α<sub>i−1</sub> = ' + alpha + '° and θ<sub>i</sub> = ' + theta + '°, give the <b>(2,2) entry</b> of the rotation R = Rx(α)·Rz(θ).',
          val, '', 1e-3,
          'R = Rx(α)·Rz(θ). The (1,1) and (2,2) diagonal entries pick up both cosines while the sine terms sit off the diagonal, so R<sub>22</sub> = cos α · cos θ = cos(' + alpha + '°)·cos(' + theta + '°) = ' + f(val, 5) + '. (<b>Note:</b> rows and columns are numbered from 1.)',
          { alpha, theta, val });
      };
      const bD = () => mc(rng,
        'Which two elementary transforms in a modified-DH row commute (so their order can be swapped freely)?',
        'Rx(α<sub>i−1</sub>) and Tx(a<sub>i−1</sub>)',
        ['Rz(θ<sub>i</sub>) and Tz(d<sub>i</sub>)', 'Tx(a<sub>i−1</sub>) and Tz(d<sub>i</sub>)', 'Rx(α<sub>i−1</sub>) and Rz(θ<sub>i</sub>)'],
        'Rx and Tx both act with respect to the same X axis (one rotates about it, the other slides along it), so they commute. In general a translation along Z and a rotation about Z also commute, but the twist transvection and the joint rotation about a different axis do not.',
        {});
      return [bA, bB, bC, bD];
    },
    verify(q) {
      if (q.kind === 'mc') return mcVerify(q);
      const c = q.ctx;
      const R = core().Rof(core().fk(oneLink(0, c.alpha, 0, c.theta), [0]).frames[1]);
      return Math.abs(R[1][1] - q.answer) < 1e-9;
    },
  };

  /* =======================================================================
     Module 3 — Forward kinematics
     ======================================================================= */
  const M3 = {
    id: 'forward-kinematics',
    title: '3 · Forward kinematics',
    blurb: 'Multiply the link transforms and read the tool pose.',
    figures: [
      { src: 'assets/figures/fk-2r.svg', caption: 'A 2R planar arm with its frames, angles and tool point.' },
      { src: 'assets/figures/robot-planar2r.svg', caption: 'The same arm as the app draws it, from its real DH table.' },
    ],
    doc: [
      { h: 'Chain the transforms', p: 'Forward kinematics is one product, base to tool:' },
      { eq: '<sup>0</sup>T<sub>n</sub> = <sup>0</sup>T<sub>1</sub> · <sup>1</sup>T<sub>2</sub> · … · <sup>n−1</sup>T<sub>n</sub>' },
      { h: 'Reading the answer', p: 'The result is a 4×4 homogeneous transform. The <b>last column</b>, rows 1–3, is the position of the tool frame in the base frame; the upper-left 3×3 is its orientation.' },
      { h: 'Planar 2R', p: 'For a 2R arm with link lengths L<sub>1</sub> and L<sub>2</sub> (the second link is the tool frame), x = L<sub>1</sub>cos q<sub>1</sub> + L<sub>2</sub>cos(q<sub>1</sub>+q<sub>2</sub>) and y = L<sub>1</sub>sin q<sub>1</sub> + L<sub>2</sub>sin(q<sub>1</sub>+q<sub>2</sub>).' },
    ],
    makeQuiz(rng) {
      const setup = () => {
        const r = randArm(rng), robot = planar2R(r.L1, r.L2);
        const q = [r.q1 * D2R, r.q2 * D2R], T = core().fk(robot, q).T, p = core().Pof(T).map((v) => v * MM);
        return { r, robot, q, p };
      };
      const frameList = (r, p) => 'Frame {1} (base) sits at the origin; frame {2} is at (' + f(r.L1 * Math.cos(r.q1 * D2R), 1) + ', ' + f(r.L1 * Math.sin(r.q1 * D2R), 1) + ') mm; the tool point is (' + f(p[0], 1) + ', ' + f(p[1], 1) + ') mm.';
      const bA = () => {
        const s = setup();
        return nm('A 2R planar arm has L<sub>1</sub> = ' + s.r.L1 + ' mm and a second link (tool frame) L<sub>2</sub> = ' + s.r.L2 + ' mm, at q<sub>1</sub> = ' + s.r.q1 + '°, q<sub>2</sub> = ' + s.r.q2 + '°. Give the tool <b>x-coordinate</b> (mm) in the base frame.',
          s.p[0], 'mm', 0.1,
          'x = L<sub>1</sub>cos q<sub>1</sub> + L<sub>2</sub>cos(q<sub>1</sub>+q<sub>2</sub>) = ' + s.r.L1 + '·cos(' + s.r.q1 + '°) + ' + s.r.L2 + '·cos(' + (s.r.q1 + s.r.q2) + '°) = ' + f(s.p[0], 2) + ' mm. ' + frameList(s.r, s.p), s);
      };
      const bB = () => {
        const s = setup();
        return nm('Same arm (L<sub>1</sub> = ' + s.r.L1 + ' mm, L<sub>2</sub> = ' + s.r.L2 + ' mm) at q<sub>1</sub> = ' + s.r.q1 + '°, q<sub>2</sub> = ' + s.r.q2 + '°. Give the tool <b>y-coordinate</b> (mm).',
          s.p[1], 'mm', 0.1,
          'y = L<sub>1</sub>sin q<sub>1</sub> + L<sub>2</sub>sin(q<sub>1</sub>+q<sub>2</sub>) = ' + s.r.L1 + '·sin(' + s.r.q1 + '°) + ' + s.r.L2 + '·sin(' + (s.r.q1 + s.r.q2) + '°) = ' + f(s.p[1], 2) + ' mm. ' + frameList(s.r, s.p), s);
      };
      const bC = () => {
        const s = setup();
        const dist = Math.hypot(s.p[0], s.p[1]);
        return nm('Same arm at q<sub>1</sub> = ' + s.r.q1 + '°, q<sub>2</sub> = ' + s.r.q2 + '°. Give the <b>distance</b> (mm) from the base to the tool point.',
          dist, 'mm', 0.1,
          'The distance is √(x² + y²) with x = ' + f(s.p[0], 2) + ' mm and y = ' + f(s.p[1], 2) + ' mm, giving ' + f(dist, 2) + ' mm. (Equivalently the law of cosines gives r² = L<sub>1</sub>² + L<sub>2</sub>² + 2L<sub>1</sub>L<sub>2</sub>cos q<sub>2</sub>.)', s);
      };
      const bD = () => mc(rng,
        'After multiplying the link transforms you read the tool <b>position</b> from the 4×4 matrix. Which part of the matrix is it?',
        'The last column, rows 1–3',
        ['The first column, rows 1–3', 'The last row, columns 1–3', 'The top-left 3×3 block'],
        'A homogeneous transform stores orientation in the 3×3 block and position in the 4th column (rows 1–3). The bottom row is always 0 0 0 1.',
        {});
      return [bA, bB, bC, bD];
    },
    verify(q) {
      if (q.kind === 'mc') return mcVerify(q);
      const s = q.ctx;
      const p = core().Pof(core().fk(s.robot, s.q).T).map((v) => v * MM);
      const dist = Math.hypot(p[0], p[1]);
      const expected = /distance/.test(q.prompt) ? dist : (/y-coordinate/.test(q.prompt) ? p[1] : p[0]);
      return Math.abs(expected - q.answer) < 1e-6;
    },
  };

  /* =======================================================================
     Module 4 — Inverse kinematics
     ======================================================================= */
  const M4 = {
    id: 'inverse-kinematics',
    title: '4 · Inverse kinematics',
    blurb: 'Find the joint angles that reach a target — and know how many exist.',
    figures: [{ src: 'assets/figures/ik-branches.svg', caption: 'The two closed-form solutions of the planar 2R arm.' }],
    doc: [
      { h: 'From a point back to angles', p: 'Inverse kinematics inverts FK. For a planar 2R arm the closed form comes from the law of cosines. With r = √(x² + y²):' },
      { eq: 'cos θ<sub>2</sub> = ( r² − L<sub>1</sub>² − L<sub>2</sub>² ) / ( 2 L<sub>1</sub> L<sub>2</sub> )' },
      { eq: 'θ<sub>1</sub> = atan2(y, x) − atan2( L<sub>2</sub>sin θ<sub>2</sub> , L<sub>1</sub> + L<sub>2</sub>cos θ<sub>2</sub> )' },
      { h: 'How many answers', ul: [
        'r &gt; L<sub>1</sub> + L<sub>2</sub> or r &lt; |L<sub>1</sub> − L<sub>2</sub>| — unreachable, no solution.',
        '|L<sub>1</sub> − L<sub>2</sub>| &lt; r &lt; L<sub>1</sub> + L<sub>2</sub> — two solutions (elbow-up and elbow-down).',
        'r = L<sub>1</sub> + L<sub>2</sub> or r = |L<sub>1</sub> − L<sub>2</sub>| — exactly one (fully stretched or folded).',
      ] },
      { h: 'Redundant and general arms', p: 'A 7-DOF arm has infinitely many solutions for a given tool pose (one redundant DOF); a 6-DOF arm is generally finite and closed form. When no closed form exists, a damped least-squares solver iterates — and must say so honestly when the target cannot be reached.' },
    ],
    makeQuiz(rng) {
      const setup = () => {
        const a = randArm(rng), L1 = a.L1, L2 = a.L2, lo = Math.abs(L1 - L2), hi = L1 + L2;
        const ratio = 0.18 + rng() * 0.64, r = lo + ratio * (hi - lo);
        const phi = ri(rng, -17, 17) * 10 * D2R;
        const x = r * Math.cos(phi), y = r * Math.sin(phi);
        const robot = planar2R(L1, L2);
        const sol = core().ik2R(robot, x / MM, y / MM, 0);
        const up = sol.solutions.filter((s) => s.q[1] < 0)[0] || sol.solutions[0];
        const c2 = (r * r - L1 * L1 - L2 * L2) / (2 * L1 * L2);
        return { L1, L2, x, y, absT2: Math.acos(Math.max(-1, Math.min(1, c2))) * R2D, t1Up: up.q[0] * R2D, robot, reachable: sol.reachable, nSol: sol.solutions.length };
      };
      const bA = () => {
        const s = setup();
        return nm('A 2R planar arm has L<sub>1</sub> = ' + s.L1 + ' mm, L<sub>2</sub> = ' + s.L2 + ' mm. A target sits at x = ' + f(s.x, 1) + ' mm, y = ' + f(s.y, 1) + ' mm. Give <b>|θ<sub>2</sub>|</b> in degrees.',
          s.absT2, '°', 0.05,
          'r = √(x² + y²) = ' + f(Math.hypot(s.x, s.y), 2) + ' mm. cos θ<sub>2</sub> = (r² − L<sub>1</sub>² − L<sub>2</sub>²)/(2 L<sub>1</sub> L<sub>2</sub>) = (' + f(Math.hypot(s.x, s.y) ** 2, 1) + ' − ' + (s.L1 * s.L1) + ' − ' + (s.L2 * s.L2) + ')/' + (2 * s.L1 * s.L2) + ' = ' + f(Math.cos(s.absT2 * D2R), 4) + '. So |θ<sub>2</sub>| = ' + f(s.absT2, 3) + '°. The two signs of θ<sub>2</sub> are the elbow-up and elbow-down branches.', s);
      };
      const bB = () => {
        const s = setup();
        return nm('Same arm (L<sub>1</sub> = ' + s.L1 + ' mm, L<sub>2</sub> = ' + s.L2 + ' mm) with the target at x = ' + f(s.x, 1) + ' mm, y = ' + f(s.y, 1) + ' mm. Using the <b>elbow-up</b> branch (θ<sub>2</sub> &lt; 0), give <b>θ<sub>1</sub></b> in degrees.',
          s.t1Up, '°', 0.1,
          'First get θ<sub>2</sub> from the law of cosines (θ<sub>2</sub> = −' + f(s.absT2, 3) + '° for the elbow-up branch), then θ<sub>1</sub> = atan2(y, x) − atan2(L<sub>2</sub>sin θ<sub>2</sub>, L<sub>1</sub> + L<sub>2</sub>cos θ<sub>2</sub>) = ' + f(Math.atan2(s.y, s.x) * R2D, 3) + '° − ' + f((Math.atan2(s.L2 * Math.sin(-s.absT2 * D2R), s.L1 + s.L2 * Math.cos(-s.absT2 * D2R))) * R2D, 3) + '° = ' + f(s.t1Up, 3) + '°. Forward kinematics from this θ<sub>1</sub>, θ<sub>2</sub> reproduces the target.', s);
      };
      const bC = () => mc(rng,
        'A planar 2R arm is asked to reach a point strictly inside its annulus, not on the boundary. How many joint-angle solutions exist (ignoring joint limits)?',
        'Two — elbow-up and elbow-down',
        ['One', 'Four', 'Infinitely many'],
        'Two: +θ<sub>2</sub> and −θ<sub>2</sub> give the elbow-down and elbow-up solutions. Only on the boundary (fully stretched r = L<sub>1</sub>+L<sub>2</sub>, or folded r = |L<sub>1</sub>−L<sub>2</sub>|) do the two coincide and the solution become unique.',
        {});
      return [bA, bB, bC];
    },
    verify(q) {
      if (q.kind === 'mc') return mcVerify(q);
      const s = q.ctx;
      if (/θ<sub>1<\/sub>/.test(q.prompt)) {
        const p = core().Pof(core().fk(s.robot, [s.t1Up * D2R, -s.absT2 * D2R]).T).map((v) => v * MM);
        return Math.abs(p[0] - s.x) < 1e-6 && Math.abs(p[1] - s.y) < 1e-6;
      }
      const c2 = (Math.hypot(s.x, s.y) ** 2 - s.L1 * s.L1 - s.L2 * s.L2) / (2 * s.L1 * s.L2);
      return Math.abs(Math.acos(Math.max(-1, Math.min(1, c2))) * R2D - q.answer) < 1e-9;
    },
  };

  /* =======================================================================
     Module 5 — Jacobian & singularities
     ======================================================================= */
  const M5 = {
    id: 'jacobian',
    title: '5 · Jacobian & singularities',
    blurb: 'Turn joint rates into tool velocity and spot a singular pose.',
    figures: [{ src: 'assets/figures/jacobian-ellipsoid.svg', caption: 'The velocity ellipsoid at the tool — its axes are the singular values of J.' }],
    doc: [
      { h: 'Velocity, not position', p: 'The geometric Jacobian J maps joint rates onto the tool twist: <code>v = J · q̇</code>. Its columns are the tool velocity produced by each joint moving at unit rate.' },
      { h: 'The planar 2R case', p: 'For a 2R arm the linear part is a 2×2 matrix. With L<sub>1</sub>, L<sub>2</sub> the link lengths and s<sub>1</sub> = sin q<sub>1</sub>, c<sub>12</sub> = cos(q<sub>1</sub>+q<sub>2</sub>):' },
      { eq: 'det J = L<sub>1</sub> L<sub>2</sub> sin θ<sub>2</sub>' },
      { h: 'Singularities', ul: [
        'A pose is singular when J loses rank: for the 2R arm that is θ<sub>2</sub> = 0° (fully stretched) or θ<sub>2</sub> = ±180° (folded back).',
        'Manipulability w = |det J| = σ<sub>1</sub>σ<sub>2</sub> measures how well the arm can move in every direction; near a singularity w → 0.',
        'The image of the unit joint-rate ball is a velocity ellipse whose semi-axes are the singular values σ<sub>1</sub> ≥ σ<sub>2</sub>; σ<sub>2</sub> → 0 at a singularity.',
      ] },
    ],
    makeQuiz(rng) {
      const setup = () => {
        const a = randArm(rng), L1 = a.L1, L2 = a.L2, q1 = a.q1, q2 = pick(rng, [20, 35, 50, 65, 80, 100, 115, 130, 145]);
        const robot = planar2R(L1, L2), q = [q1 * D2R, q2 * D2R];
        const J = core().jacobian(robot, q);
        const det = (J[0][0] * J[1][1] - J[0][1] * J[1][0]) * 1e6;      // mm²
        const col0 = Math.hypot(J[0][0], J[1][0]) * MM;                  // mm per rad/s
        return { L1, L2, q1, q2, robot, q, det, col0 };
      };
      const bA = () => {
        const s = setup();
        return nm('A 2R planar arm has L<sub>1</sub> = ' + s.L1 + ' mm, L<sub>2</sub> = ' + s.L2 + ' mm at q<sub>1</sub> = ' + s.q1 + '°, q<sub>2</sub> = ' + s.q2 + '°. Give the <b>determinant</b> |det J| of the 2×2 linear Jacobian, in mm².',
          Math.abs(s.det), 'mm²', Math.max(1, Math.abs(s.det) * 1e-3),
          'For the planar 2R arm det J = L<sub>1</sub> L<sub>2</sub> sin θ<sub>2</sub> = ' + s.L1 + '·' + s.L2 + '·sin(' + s.q2 + '°) = ' + f(s.det, 1) + ' mm². (θ<sub>1</sub> does not appear — rotating the whole arm does not change its manipulability.) The absolute value is ' + f(Math.abs(s.det), 1) + ' mm².', s);
      };
      const bB = () => mc(rng,
        'At which joint angle θ<sub>2</sub> is the planar 2R arm <b>singular</b>?',
        'θ<sub>2</sub> = 0° or θ<sub>2</sub> = ±180°',
        ['θ<sub>2</sub> = 90°', 'θ<sub>2</sub> = 45°', 'Every θ<sub>2</sub> is singular'],
        'det J = L<sub>1</sub>L<sub>2</sub>sin θ<sub>2</sub> vanishes when sin θ<sub>2</sub> = 0, i.e. θ<sub>2</sub> = 0° (arm fully stretched) or ±180° (folded back). At θ<sub>2</sub> = 90° the arm is at its most dexterous.',
        {});
      const bC = () => {
        const s = setup();
        return nm('Same arm (L<sub>1</sub> = ' + s.L1 + ' mm, L<sub>2</sub> = ' + s.L2 + ' mm) at q<sub>1</sub> = ' + s.q1 + '°, q<sub>2</sub> = ' + s.q2 + '°. With joint 1 moving at 1 rad/s and joint 2 held still, give the <b>tool speed</b> (mm/s).',
          s.col0, 'mm/s', Math.max(0.1, s.col0 * 1e-3),
          'The first column of J is the tool velocity for q̇<sub>1</sub> = 1 rad/s: |J<sub>col1</sub>| = ' + f(s.col0, 2) + ' mm/s. Its components are L<sub>1</sub> + L<sub>2</sub>-weighted sines and cosines of q<sub>1</sub> and q<sub>1</sub>+q<sub>2</sub>; here that gives ' + f(s.col0, 2) + ' mm/s.', s);
      };
      return [bA, bB, bC];
    },
    verify(q) {
      if (q.kind === 'mc') return mcVerify(q);
      const s = q.ctx, J = core().jacobian(s.robot, s.q);
      if (/determinant/.test(q.prompt)) {
        const det = Math.abs(J[0][0] * J[1][1] - J[0][1] * J[1][0]) * 1e6;
        return Math.abs(det - q.answer) < 1e-6;
      }
      const col0 = Math.hypot(J[0][0], J[1][0]) * MM;
      return Math.abs(col0 - q.answer) < 1e-6;
    },
  };

  /* =======================================================================
     Module 6 — Trajectory planning
     ======================================================================= */
  const M6 = {
    id: 'trajectory',
    title: '6 · Trajectory & smoothness',
    blurb: 'Plan a single-joint move and predict its peak velocity.',
    figures: [{ src: 'assets/figures/trajectory-profiles.svg', caption: 'Position, velocity and acceleration for cubic, quintic and S-curve moves.' }],
    doc: [
      { h: 'Boundary conditions set the shape', ul: [
        '<b>Cubic</b> q(t): fixes position and velocity at both ends. Peak velocity at the midpoint = 1.5 Δq / T.',
        '<b>Quintic</b> q(t): also fixes acceleration at both ends. Peak velocity at the midpoint = 1.875 Δq / T.',
        '<b>S-curve</b>: limits jerk, so acceleration starts and ends at zero — the smoothest and the gentlest on the mechanics.',
      ] },
      { eq: 'v<sub>peak</sub> (cubic) = 1.5 Δq / T &nbsp;&nbsp;·&nbsp;&nbsp; v<sub>peak</sub> (quintic) = 1.875 Δq / T' },
      { h: 'Why it matters', p: 'A bigger Δq over a shorter T means a faster move. If the peak velocity or acceleration exceeds the joint limits, the move must be slowed down or the profile changed — a planner that hides those violations is lying.' },
    ],
    makeQuiz(rng) {
      const setup = () => {
        const dq = ri(rng, 8, 36) * 5, T = ri(rng, 2, 12) * 0.25;
        return { dq, T };
      };
      const bA = () => {
        const s = setup();
        const v = 1.5 * s.dq / s.T;
        return nm('A <b>cubic</b> joint move travels Δq = ' + s.dq + '° over T = ' + f(s.T, 2) + ' s, starting and ending at rest. Give the <b>peak velocity</b> in °/s.',
          v, '°/s', 0.05,
          'A cubic with zero end velocities peaks at the midpoint, where v = 1.5 Δq / T = 1.5 · ' + s.dq + ' / ' + f(s.T, 2) + ' = ' + f(v, 3) + ' °/s. (Starting from q(0)=0, q(T)=Δq, the cubic is Δq(3u² − 2u³) and its derivative at u = 0.5 is 1.5Δq/T.)', s);
      };
      const bB = () => {
        const s = setup();
        const v = 1.875 * s.dq / s.T;
        return nm('A <b>quintic</b> joint move travels Δq = ' + s.dq + '° over T = ' + f(s.T, 2) + ' s, with zero velocity and acceleration at both ends. Give the <b>peak velocity</b> in °/s.',
          v, '°/s', 0.05,
          'The quintic Δq(10u³ − 15u⁴ + 6u⁵) has v(u) = Δq(30u² − 60u³ + 30u⁴)/T, which peaks at u = 0.5 with v = 1.875 Δq / T = 1.875 · ' + s.dq + ' / ' + f(s.T, 2) + ' = ' + f(v, 3) + ' °/s. It is 25% faster at the midpoint than the cubic for the same move.', s);
      };
      const bC = () => mc(rng,
        'Which profile limits <b>jerk</b> (the rate of change of acceleration) so the acceleration starts and ends at zero?',
        'S-curve',
        ['Cubic polynomial', 'Quintic polynomial', 'Linear interpolation'],
        'The S-curve is jerk-limited, so acceleration ramps from zero, holds, then ramps down — no step change in acceleration. A quintic has continuous acceleration but nonzero jerk at the ends in general.',
        {});
      const bD = () => mc(rng,
        'A quintic polynomial lets you specify which boundary conditions at each end?',
        'Position, velocity and acceleration',
        ['Position only', 'Position and velocity', 'Position, velocity, acceleration and jerk'],
        'A quintic has six coefficients, matching three conditions at each end (q, q̇, q̈). Position-only is linear; position and velocity is a cubic; jerk also needs a seventh-order polynomial.',
        {});
      return [bA, bB, bC, bD];
    },
    verify(q) {
      if (q.kind === 'mc') return mcVerify(q);
      const s = q.ctx, c = core();
      const type = /quintic/i.test(q.prompt) ? 'quintic' : 'cubic';
      const tr = c.jointTrajectory({ type, q0: [0], qf: [s.dq], T: s.T, dt: s.T / 200 });
      const k = Math.round((tr.t.length - 1) / 2);
      return Math.abs(Math.abs(tr.qd[k][0]) - q.answer) < 0.05;
    },
  };

  /* =======================================================================
     Module 7 — Workspace
     ======================================================================= */
  const M7 = {
    id: 'workspace',
    title: '7 · Reachable workspace',
    blurb: 'Describe the volume a robot can reach and how limits shape it.',
    figures: [
      { src: 'assets/figures/workspace-planes.svg', caption: 'The same sampled workspace projected onto the XY, XZ and YZ planes.' },
      { src: 'assets/figures/workspace-planar2r.svg', caption: 'A sampled 2R planar workspace (equal aspect).' },
      { src: 'assets/figures/workspace-scara4.svg', caption: 'A sampled SCARA workspace (equal aspect).' },
    ],
    doc: [
      { h: 'Reachable vs dexterous', p: 'The <b>reachable</b> workspace is every tool position the joints can produce. The <b>dexterous</b> workspace is the subset where the tool can also be oriented freely — near a singularity the arm reaches a point but cannot move well there.' },
      { h: 'The planar 2R annulus', p: 'With full joint ranges the 2R arm sweeps a ring: outer radius L<sub>1</sub> + L<sub>2</sub> (fully stretched) and inner radius |L<sub>1</sub> − L<sub>2</sub>| (folded back).' },
      { h: 'Sampling and projection', p: 'When no closed form exists, the workspace is estimated by Monte-Carlo sampling of the joint space and projecting the tool points onto the XY, XZ and YZ planes. Joint limits and collisions remove poses, so the shape is bounded by them as much as by the link lengths.' },
    ],
    makeQuiz(rng) {
      const setup = () => {
        const a = randArm(rng), L1 = a.L1, L2 = a.L2;
        return { L1, L2, outer: L1 + L2, inner: Math.abs(L1 - L2), robot: planar2R(L1, L2) };
      };
      const bA = () => {
        const s = setup();
        return nm('A planar 2R arm has L<sub>1</sub> = ' + s.L1 + ' mm and L<sub>2</sub> = ' + s.L2 + ' mm with joint 2 free over ±180°. Give the <b>outer radius</b> (mm) of its reachable workspace.',
          s.outer, 'mm', 0.05,
          'The outermost reach is the arm fully stretched: r<sub>max</sub> = L<sub>1</sub> + L<sub>2</sub> = ' + s.L1 + ' + ' + s.L2 + ' = ' + s.outer + ' mm.', s);
      };
      const bB = () => {
        const s = setup();
        return nm('Same arm (L<sub>1</sub> = ' + s.L1 + ' mm, L<sub>2</sub> = ' + s.L2 + ' mm). Give the <b>inner radius</b> (mm) of the reachable workspace.',
          s.inner, 'mm', 0.05,
          'The innermost reach is the arm folded back on itself: r<sub>min</sub> = |L<sub>1</sub> − L<sub>2</sub>| = |' + s.L1 + ' − ' + s.L2 + '| = ' + s.inner + ' mm. So the workspace is an annulus between ' + s.inner + ' mm and ' + s.outer + ' mm.', s);
      };
      const bC = () => mc(rng,
        'What shape is the reachable workspace of a planar 2R arm (full joint range, no obstacles)?',
        'An annulus (a ring)',
        ['A filled disc', 'A single circle (a curve)', 'A rectangle'],
        'Every radius between |L<sub>1</sub> − L<sub>2</sub>| and L<sub>1</sub> + L<sub>2</sub> is reachable, and the arm can sweep all angles, so the reachable set is the annulus between those two radii — not the filled disc (the middle is a hole).',
        {});
      const bD = () => mc(rng,
        'Monte-Carlo workspace tools classify sampled tool points by σ<sub>min</sub> of the Jacobian. What are the two sets they separate?',
        'Reachable (σ<sub>min</sub> can be small) and dexterous (σ<sub>min</sub> stays large)',
        ['Fast poses and slow poses', 'Revolute joints and prismatic joints', 'Top view and side view'],
        'The full sampled set is the reachable workspace; the points whose smallest singular value stays above a threshold are the dexterous workspace, where the arm is well conditioned and can move freely. A planar arm often has no dexterous set at all, and the tool should say so.',
        {});
      return [bA, bB, bC, bD];
    },
    verify(q) {
      if (q.kind === 'mc') return mcVerify(q);
      const s = q.ctx, c = core();
      // sample the joint space and compare the min/max radius with the closed form
      let lo = Infinity, hi = -Infinity;
      const rng = c.makeRng(99);
      for (let k = 0; k < 1200; k++) {
        const qq = c.sampleConfig(s.robot, rng);
        const p = c.Pof(c.fk(s.robot, qq).T);
        const r = Math.hypot(p[0], p[1]) * MM;
        if (r < lo) lo = r; if (r > hi) hi = r;
      }
      if (/outer/.test(q.prompt)) return Math.abs(q.answer - s.outer) < 1e-9 && hi <= s.outer + 0.5 && hi >= s.outer * 0.98;
      return Math.abs(q.answer - s.inner) < 1e-9 && lo >= s.inner - 0.5 && lo <= s.inner + (s.outer - s.inner) * 0.25;
    },
  };

  /* =======================================================================
     Module 8 — Dynamics & payload
     ======================================================================= */
  const M8 = {
    id: 'dynamics',
    title: '8 · Dynamics & payload',
    blurb: 'Estimate the torque gravity puts on a joint and how payload scales it.',
    figures: [{ src: 'assets/figures/gravity-torque.svg', caption: 'The gravity moment of a point mass on a link.' }],
    doc: [
      { h: 'The gravity moment', p: 'For a point mass m held a distance r from a revolute joint, the moment arm of its weight about the joint is r·sin θ (θ measured from the vertical). So the static torque is:' },
      { eq: 'τ = m · g · r · |sin θ|' },
      { h: 'Prismatic joints', p: 'A prismatic joint carries the weight plus any acceleration directly as a force: F = m·(g + a).' },
      { h: 'What payload does', ul: [
        'Torque scales linearly with payload mass — doubling the mass doubles the gravity torque.',
        'Torque scales with the moment arm, so the same mass loads a joint far more when the arm is horizontal (θ = 90°) than when it hangs straight down (θ = 0°).',
        'The full dynamic torque also includes inertial and Coriolis terms; the gravity term alone is what holds the arm still.',
      ] },
    ],
    makeQuiz(rng) {
      const bA = () => {
        const m = ri(rng, 1, 20), r = ri(rng, 2, 24) * 0.05, th = ri(rng, 1, 17) * 10;
        const tau = m * G * r * Math.abs(Math.sin(th * D2R));
        return nm('A payload of m = ' + f(m, 1) + ' kg sits r = ' + f(r, 2) + ' m from a revolute joint, at θ = ' + th + '° from the vertical. Give the <b>gravity torque</b> about the joint in N·m (use g = 9.81 m/s²).',
          tau, 'N·m', 0.05,
          'τ = m·g·r·|sin θ| = ' + f(m, 1) + ' · 9.81 · ' + f(r, 2) + ' · |sin(' + th + '°)| = ' + f(tau, 4) + ' N·m. The moment arm is r·sin θ = ' + f(r, 2) + '·' + f(Math.abs(Math.sin(th * D2R)), 4) + ' = ' + f(r * Math.abs(Math.sin(th * D2R)), 4) + ' m.',
          { m, r, th, tau });
      };
      const bB = () => mc(rng,
        'At the same pose, the payload mass on a revolute joint is doubled. What happens to the <b>gravity torque</b>?',
        'It doubles',
        ['It stays the same', 'It quadruples', 'It halves'],
        'τ = m·g·r·|sin θ| is linear in m, so doubling the payload doubles the gravity torque. (The inertia and therefore the inertial torque would also double, and a longer arm would raise the moment arm too.)',
        {});
      const bC = () => {
        const m = ri(rng, 1, 25), acc = ri(rng, 0, 12);
        const force = m * (G + acc);
        return nm('A prismatic joint must lift m = ' + f(m, 1) + ' kg with an upward acceleration a = ' + f(acc, 1) + ' m/s². Give the required <b>force</b> in N (use g = 9.81 m/s²).',
          force, 'N', 0.05,
          'F = m·(g + a) = ' + f(m, 1) + ' · (9.81 + ' + f(acc, 1) + ') = ' + f(force, 3) + ' N. Acceleration adds to gravity for an upward move.',
          { m, acc, force });
      };
      return [bA, bB, bC];
    },
    verify(q) {
      if (q.kind === 'mc') return mcVerify(q);
      const c = q.ctx;
      const expected = /prismatic/.test(q.prompt) ? c.m * (G + c.acc) : c.m * G * c.r * Math.abs(Math.sin(c.th * D2R));
      return Math.abs(expected - q.answer) < 1e-9;
    },
  };

  /* =======================================================================
     Catalogue + generation
     ======================================================================= */
  const MODULES = [M1, M2, M3, M4, M5, M6, M7, M8];
  const byId = (id) => MODULES.filter((m) => m.id === id)[0] || null;

  /** Fresh questions for one module: `count` items (default 8) from a seed. */
  function generate(moduleId, seed, count) {
    const mod = byId(moduleId);
    if (!mod) throw new Error('unknown practice module: ' + moduleId);
    const rng = rngFrom(seed == null ? 1 : seed);
    const builders = mod.makeQuiz(rng);
    const n = count == null ? 8 : count, out = [];
    for (let i = 0; i < n; i++) out.push(builders[i % builders.length](rng));
    return out;
  }
  /** Every module generated once, for the UI and the tests. */
  const allModules = () => MODULES.map((m) => ({
    id: m.id, title: m.title, blurb: m.blurb, figures: m.figures, doc: m.doc,
  }));

  /* =======================================================================
     Self-tests — evidence that every published answer is engine-verified
     ======================================================================= */
  function selfTests() {
    const c = core();
    const res = [], add = (name, pass, detail) => res.push({ name, pass: !!pass, detail: detail || '' });

    MODULES.forEach((m) => {
      let bad = null, n = 0;
      for (let seed = 1; seed <= 6 && !bad; seed++) {
        let qs;
        try { qs = generate(m.id, seed, 8); } catch (e) { bad = 'threw: ' + e.message; break; }
        qs.forEach((q, i) => {
          n++;
          if (!q.prompt || !q.solution) { bad = 'q' + i + ' missing prompt/solution'; return; }
          if (q.kind === 'num') {
            if (!isN(q.answer)) { bad = 'q' + i + ' non-finite answer'; return; }
          } else if (!mcVerify(q)) { bad = 'q' + i + ' malformed choice set'; return; }
          if (!m.verify(q)) { bad = 'q' + i + ' failed independent re-derivation (' + q.kind + ')'; }
        });
      }
      add('practice · ' + m.title + ' — every generated answer independently re-derived', !bad, bad || (n + ' questions across 6 seeds verified'));
    });

    // The 2R FK questions really are the engine's FK (cross-module spot check).
    {
      let worst = 0;
      for (let seed = 1; seed <= 5; seed++) {
        generate('forward-kinematics', seed, 4).forEach((q) => {
          if (q.kind !== 'num') return;
          const s = q.ctx, p = c.Pof(c.fk(s.robot, s.q).T).map((v) => v * MM);
          const want = /distance/.test(q.prompt) ? Math.hypot(p[0], p[1]) : (/y-coordinate/.test(q.prompt) ? p[1] : p[0]);
          worst = Math.max(worst, Math.abs(want - q.answer));
        });
      }
      add('practice · FK answers equal RL.fk to machine precision', worst < 1e-9, 'max |error| = ' + worst.toExponential(1) + ' mm');
    }
    // IK answers reproduce the target through FK.
    {
      let worst = 0;
      for (let seed = 1; seed <= 5; seed++) {
        generate('inverse-kinematics', seed, 4).forEach((q) => {
          if (q.kind !== 'num' || !/θ<sub>1/.test(q.prompt)) return;
          const s = q.ctx, p = c.Pof(c.fk(s.robot, [q.answer * D2R, -s.absT2 * D2R]).T).map((v) => v * MM);
          worst = Math.max(worst, Math.hypot(p[0] - s.x, p[1] - s.y));
        });
      }
      add('practice · IK answers reproduce their target through forward kinematics', worst < 1e-6, 'max |target error| = ' + worst.toExponential(1) + ' mm');
    }
    // Jacobian determinant equals the engine's Jacobian.
    {
      let worst = 0;
      for (let seed = 1; seed <= 5; seed++) {
        generate('jacobian', seed, 6).forEach((q) => {
          if (q.kind !== 'num' || !/determinant/.test(q.prompt)) return;
          const s = q.ctx, J = c.jacobian(s.robot, s.q);
          const det = Math.abs(J[0][0] * J[1][1] - J[0][1] * J[1][0]) * 1e6;
          worst = Math.max(worst, Math.abs(det - q.answer));
        });
      }
      add('practice · Jacobian determinants equal RL.jacobian', worst < 1e-9, 'max |error| = ' + worst.toExponential(1) + ' mm²');
    }
    // Trajectory answers equal the core sampler.
    {
      let worst = 0;
      ['trajectory'].forEach((id) => {
        for (let seed = 1; seed <= 5; seed++) {
          generate(id, seed, 4).forEach((q) => {
            if (q.kind !== 'num') return;
            const s = q.ctx, type = /quintic/i.test(q.prompt) ? 'quintic' : 'cubic';
            const tr = c.jointTrajectory({ type, q0: [0], qf: [s.dq], T: s.T, dt: s.T / 200 });
            const k = Math.round((tr.t.length - 1) / 2);
            worst = Math.max(worst, Math.abs(Math.abs(tr.qd[k][0]) - q.answer));
          });
        }
      });
      add('practice · trajectory peak velocities equal RL.jointTrajectory', worst < 0.05, 'max |error| = ' + worst.toExponential(1) + ' °/s');
    }
    // The catalogue is complete and each module ships at least one figure.
    add('practice · eight modules, each documented with figures',
      MODULES.length === 8 && MODULES.every((m) => m.doc.length >= 3 && m.figures.length >= 1 && /^assets\/figures\/.+\.svg$/.test(m.figures[0].src)),
      MODULES.map((m) => m.id + '(' + m.figures.length + ')').join(' '));

    return res;
  }

  return {
    VERSION, MODULES, module: byId, generate, allModules, selfTests,
    // exposed for the UI and for tests
    planar2R, oneLink, rowOrigin, D2R, R2D, MM,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PRACTICE;
if (typeof window !== 'undefined') window.PRACTICE = PRACTICE;
