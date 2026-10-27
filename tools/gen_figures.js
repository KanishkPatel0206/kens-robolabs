/* ============================================================================
   Generates the practice-module figures that come from real robot maths.

   Node only (no browser, no Three.js):
     * an axonometric wireframe of each premade model, drawn from its actual
       Modified-DH geometry and home pose (assets/figures/robot-<id>.svg);
     * equal-aspect reachable-vs-dexterous workspace plots for two models
       (assets/figures/workspace-<id>.svg).

   Run:  node tools/gen_figures.js
   The files it writes are committed, so the site stays static.
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const RL = require('../engine/core.js');
const RL5 = require('../engine/v5.js');

const OUT = path.join(__dirname, '..', 'assets', 'figures');
fs.mkdirSync(OUT, { recursive: true });

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const f1 = (v) => (Math.abs(v) < 1e-9 ? 0 : +v.toFixed(1));

/* ---- projection -------------------------------------------------------- */
function makeProj(azDeg, elDeg) {
  const az = azDeg * Math.PI / 180, el = elDeg * Math.PI / 180;
  const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
  return function proj(p) {                    // p in mm, Z is up
    const x1 = p[0] * ca + p[1] * sa;
    const depth = -p[0] * sa + p[1] * ca;
    const up = p[2] * ce - depth * se;
    return [x1, -up];
  };
}

const VIEW = {                                // az, el, label per model
  ur5e: [-35, 18], puma560: [-40, 16], irb120: [-32, 18],
  iiwa14: [-35, 18], scara4: [-18, 12], planar2r: [0, 3],
};

function robotSVG(model) {
  const robot = RL5.modelToRobot(model);
  const q = robot.joints.map(() => 0);        // the model's theta/d is the home pose
  const f = RL.fk(robot, q);
  const tool = robot.tool || [0, 0, 0];
  const R = RL.Rof(f.T), tip = RL.Pof(f.T);
  const toolTip = [
    tip[0] + R[0][0] * tool[0] + R[0][2] * tool[2],
    tip[1] + R[1][0] * tool[0] + R[1][2] * tool[2],
    tip[2] + R[2][0] * tool[0] + R[2][2] * tool[2],
  ];
  const raw = f.frames.map(RL.Pof).map((p) => p.map(v => v * 1000));
  raw.push(toolTip.map(v => v * 1000));

  // Collapse runs of coincident frame origins (a=0 and d=0 links) so the chain
  // is one clean polyline and no zero-length segment or duplicate dot is drawn.
  const pts = [];
  raw.forEach((p) => {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > 1e-6) pts.push(p);
  });
  const labels = [];                          // which original joint index each kept point is
  let ri = 0;
  raw.forEach((p, i) => { if (pts.includes(p)) labels.push(i); });

  const [az, el] = VIEW[model.id] || [-35, 18];
  const proj = makeProj(az, el);
  const P = pts.map(proj);

  const W = 480, H = 360, pad = 52;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  P.forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
  const spanX = x1 - x0 || 1, spanY = y1 - y0 || 1;
  const s = Math.min((W - 2 * pad) / spanX, (H - 2 * pad - 14) / spanY);
  const ox = (W - s * spanX) / 2 - s * x0, oy = (H - 14 - s * spanY) / 2 - s * y0 + 6;
  const M = ([x, y]) => [ox + s * x, oy + s * y];

  const sp = P.map(M);
  const G = 520;                              // floor grid half-extent (mm)
  let ground = '';
  for (let k = -2; k <= 2; k++) {
    const a = M(proj([k * G / 2, -G, 0])), b = M(proj([k * G / 2, G, 0]));
    const c = M(proj([-G, k * G / 2, 0])), d = M(proj([G, k * G / 2, 0]));
    ground += `<line x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}"/><line x1="${f1(c[0])}" y1="${f1(c[1])}" x2="${f1(d[0])}" y2="${f1(d[1])}"/>`;
  }

  const seg = [];
  for (let i = 1; i < sp.length; i++) seg.push(`M ${f1(sp[i - 1][0])} ${f1(sp[i - 1][1])} L ${f1(sp[i][0])} ${f1(sp[i][1])}`);
  const path = seg.join(' ');
  const dots = sp.slice(0, pts.length - 1).map(([x, y], i) => {
    const ji = labels[i] === undefined ? i : labels[i];
    const name = ji === 0 ? 'base' : 'J' + ji;
    return `<circle cx="${f1(x)}" cy="${f1(y)}" r="${ji === 0 ? 5.5 : 5}" class="j"/><text x="${f1(x + 8)}" y="${f1(y - 6)}" class="lbl">${name}</text>`;
  }).join('');
  const tcp = sp[sp.length - 1];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(model.name)} wireframe drawn from its Modified-DH parameters">
<style>
.bg{fill:#ffffff}.grid{stroke:#dceee7;stroke-width:1}
.link{stroke:#0b7a5c;stroke-width:6;stroke-linecap:round;stroke-linejoin:round;fill:none}
.shadow{stroke:#0b7a5c;opacity:.14;stroke-width:10;stroke-linecap:round;stroke-linejoin:round;fill:none}
.base{fill:#164049}.j{fill:#2273ca;stroke:#fff;stroke-width:1.6}.tcp{fill:#c92b34;stroke:#fff;stroke-width:1.6}
.lbl{font:600 10px 'JetBrains Mono',monospace;fill:#2c5866}.title{font:700 13px Outfit,sans-serif;fill:#164049}
.sub{font:500 10px 'JetBrains Mono',monospace;fill:#5b7f86}
</style>
<defs><clipPath id="c"><rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="8"/></clipPath></defs>
<rect class="bg" width="${W}" height="${H}" rx="10"/>
<g clip-path="url(#c)"><g class="grid">${ground}</g></g>
<circle class="base" cx="${f1(sp[0][0])}" cy="${f1(sp[0][1] + 7)}" r="11"/>
<g clip-path="url(#c)"><path class="shadow" d="${path}" transform="translate(3 5)"/><path class="link" d="${path}"/></g>
${dots}
<circle class="tcp" cx="${f1(tcp[0])}" cy="${f1(tcp[1])}" r="4.5"/><text x="${f1(tcp[0] + 8)}" y="${f1(tcp[1] + 14)}" class="lbl">TCP</text>
<text x="14" y="24" class="title">${esc(model.name)}</text>
<text x="14" y="40" class="sub">${model.dof} DOF · ${esc(model.joints.map(j => j.type === 'P' ? 'P' : 'R').join(''))} · drawn from its DH table</text>
<text x="14" y="${H - 12}" class="sub">reach ≈ ${model.reach} mm · ${esc(model.maker)}</text>
</svg>\n`;
}

function workspaceSVG(model, opts) {
  opts = opts || {};
  const robot = RL5.modelToRobot(model);
  const w = RL5.workspaceMetrics(robot, { samples: opts.samples || 1400, seed: 7 });
  const mm = (p) => [p[0] * 1000, p[1] * 1000];      // XY plane
  const reach = w.reachable.map(mm), dex = w.dexterous.map(mm);
  const all = reach.concat(dex);
  const W = 480, H = 360, pad = 40;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  all.forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
  const spanX = x1 - x0 || 1, spanY = y1 - y0 || 1;
  const s = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY);           // equal aspect
  const ox = (W - s * spanX) / 2 - s * x0, oy = (H - s * spanY) / 2 - s * y0;
  const M = ([x, y]) => [ox + s * x, oy - s * y];
  const dots = (arr, cls) => arr.map(([x, y]) => { const [sx, sy] = M([x, y]); return `<circle class="${cls}" cx="${f1(sx)}" cy="${f1(sy)}" r="1.7"/>`; }).join('');
  const ticks = [];
  const step = Math.max(50, Math.round(spanX / 5 / 50) * 50);
  for (let v = Math.ceil(x0 / step) * step; v <= x1; v += step) {
    const [sx] = M([v, 0]);
    ticks.push(`<line class="tick" x1="${f1(sx)}" y1="${pad}" x2="${f1(sx)}" y2="${H - pad}"/><text x="${f1(sx)}" y="${H - pad + 12}" class="ax">${v}</text>`);
  }
  for (let v = Math.ceil(y0 / step) * step; v <= y1; v += step) {
    const [, sy] = M([0, v]);
    ticks.push(`<line class="tick" x1="${pad}" y1="${f1(sy)}" x2="${W - pad}" y2="${f1(sy)}"/><text x="6" y="${f1(sy + 3)}" class="ax">${v}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Reachable and dexterous workspace of ${esc(model.name)} in the XY plane, equal aspect">
<style>
.bg{fill:#fff}.tick{stroke:#e2f1ec;stroke-width:1}.ax{font:9px 'JetBrains Mono',monospace;fill:#5b7f86}
.r{fill:#9fb8b3;opacity:.5}.d{fill:#0b7a5c;opacity:.42}
.title{font:700 13px Outfit,sans-serif;fill:#164049}.sub{font:500 10px 'JetBrains Mono',monospace;fill:#5b7f86}
</style>
<rect class="bg" width="${W}" height="${H}" rx="10"/>
${ticks.join('')}
${dots(reach, 'r')}
${dots(dex, 'd')}
<text x="14" y="24" class="title">${esc(model.name)} — workspace (XY, equal aspect)</text>
<text x="14" y="40" class="sub">grey reachable ${reach.length} · green dexterous ${dex.length} · axes in mm</text>
<circle cx="${W - 96}" cy="${H - 16}" r="4" fill="#9fb8b3"/><text x="${W - 86}" y="${H - 12}" class="ax">reachable</text>
<circle cx="${W - 190}" cy="${H - 16}" r="4" fill="#0b7a5c"/><text x="${W - 180}" y="${H - 12}" class="ax">dexterous</text>
</svg>\n`;
}

/* ==========================================================================
   Concept figures — the documentation diagrams for the practice modules.
   The curve/diagram data is computed from the real maths (FK, analytical IK,
   the Jacobian's singular values, the core trajectory sampler, sampled
   workspace), so a diagram can never drift from the engine.
   ========================================================================== */
const INK = '#082f3c', MUTED = '#3a5c63', TEAL = '#06617c', LINE = '#a3cdbe', SUN = '#bf8a1e',
  GREEN = '#0b7a5c', RED = '#c92b34', BLUE = '#2273ca', MINT = '#cde7dc';
const CSS = `<style>
.bg{fill:#fff}.frame{fill:none;stroke:${LINE};stroke-width:1.5}
.ttl{font:700 16px Outfit,system-ui,sans-serif;fill:${INK}}
.sub{font:12px Outfit,system-ui,sans-serif;fill:${MUTED}}
.lab{font:700 11px 'JetBrains Mono',ui-monospace,monospace;fill:${INK}}
.mono{font:11px 'JetBrains Mono',ui-monospace,monospace;fill:${MUTED}}
.zh{stroke:${TEAL};stroke-width:2.6;fill:none;stroke-linecap:round}
.xh{stroke:${RED};stroke-width:2.4;fill:none;stroke-linecap:round}
.yh{stroke:${GREEN};stroke-width:2.4;fill:none;stroke-linecap:round}
.dash{stroke:${TEAL};stroke-width:1.5;stroke-dasharray:5 5;fill:none}
.dim{stroke:${SUN};stroke-width:1.4;fill:none}
.ang{stroke:${GREEN};stroke-width:1.8;fill:none}
.grid{stroke:#e6f1ec;stroke-width:1}.ax0{stroke:#cfe3db;stroke-width:1.4}
.dot{fill:${INK}}.hot{fill:${RED}}.pivot{fill:${INK}}
.link{stroke:${GREEN};stroke-width:7;stroke-linecap:round;fill:none}
.link2{stroke:${BLUE};stroke-width:3.4;stroke-dasharray:8 5;fill:none;stroke-linecap:round}
.chip{fill:#f1fbf6;stroke:${LINE};stroke-width:1}
</style>`;
const svg = (W, H, label, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
${CSS}
<rect class="bg" width="${W}" height="${H}" rx="12"/>
${body}
</svg>\n`;
/** Small arrowhead triangle pointing along `ang` degrees at (x,y). */
function tri(x, y, ang, size, fill) {
  const a = ang * Math.PI / 180, s = size || 7;
  return `<polygon points="${f1(x)},${f1(y)} ${f1(x - s * Math.cos(a - 0.42))},${f1(y - s * Math.sin(a - 0.42))} ${f1(x - s * Math.cos(a + 0.42))},${f1(y - s * Math.sin(a + 0.42))}" fill="${fill}"/>`;
}
/** Dimension line between two points, arrowheads at both ends. */
function dline(x1, y1, x2, y2, fill) {
  const ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI, col = fill || SUN;
  return `<line class="dim" x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="${col}"/>${tri(x2, y2, ang, 7, col)}${tri(x1, y1, ang + 180, 7, col)}`;
}
const A = (cx, cy, r, a0, a1) => {      // arc path, angles in degrees, screen coords
  const p0 = [cx + r * Math.cos(a0 * Math.PI / 180), cy + r * Math.sin(a0 * Math.PI / 180)];
  const p1 = [cx + r * Math.cos(a1 * Math.PI / 180), cy + r * Math.sin(a1 * Math.PI / 180)];
  const sweep = ((a1 - a0 + 540) % 360) - 180 > 0 ? 1 : 0;
  return `M ${f1(p0[0])} ${f1(p0[1])} A ${r} ${r} 0 0 ${sweep} ${f1(p1[0])} ${f1(p1[1])}`;
};
const poly = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'} ${f1(p[0])} ${f1(p[1])}`).join(' ');

function figMDH() {
  const W = 720, H = 470, d = 18 * Math.PI / 180, dx = Math.sin(d), dy = -Math.cos(d);
  const O2p = [500, 300], top = [O2p[0] + 235 * dx, O2p[1] + 235 * dy], bot = [O2p[0] - 80 * dx, O2p[1] - 80 * dy];
  const O1 = [210, 300], O2 = [O2p[0] + 95 * dx, O2p[1] + 95 * dy];
  let b = `<text class="ttl" x="26" y="34">Modified (Craig) DH — the four link parameters</text>
<text class="sub" x="26" y="55">Each row i turns frame {i−1} into frame {i}:  T = Rx(α) · Tx(a) · Rz(θ) · Tz(d)</text>`;
  // axes
  b += `<path class="dash" d="M 210 372 L 210 96"/>${tri(210, 96, -90, 7, TEAL)}`;
  b += `<path class="dash" d="M ${f1(bot[0])} ${f1(bot[1])} L ${f1(top[0])} ${f1(top[1])}"/>`;
  // common normal + a(i-1) dimension
  b += `<path class="dim" d="M 210 300 L 500 300"/>`;
  b += `<path class="dim" d="M 210 300 L 210 332 M 500 300 L 500 332"/>`;
  b += dline(210, 332, 500, 332);
  b += `<text class="lab" x="352" y="352" text-anchor="middle">a(i−1)</text>`;
  // d(i) along Z(i)
  b += dline(O2p[0], O2p[1], O2[0], O2[1]);
  b += `<text class="lab" x="${f1(O2[0] + 16)}" y="${f1(O2[1] + 14)}">d(i)</text>`;
  // frames
  b += `<path class="xh" d="M ${O1[0]} ${O1[1]} L ${O1[0] + 78} ${O1[1]}"/>${tri(O1[0] + 78, O1[1], 0, 7, RED)}`;
  b += `<path class="yh" d="M ${O1[0]} ${O1[1]} L ${O1[0] - 44} ${O1[1] - 44}"/>${tri(O1[0] - 44, O1[1] - 44, -135, 7, GREEN)}`;
  b += `<text class="lab" x="${O1[0] + 84}" y="${O1[1] + 4}">X(i−1)</text>`;
  b += `<text class="lab" x="${O1[0] - 50}" y="${O1[1] - 50}" text-anchor="end">Y(i−1)</text>`;
  b += `<circle class="dot" cx="${O1[0]}" cy="${O1[1]}" r="4"/><circle class="dot" cx="${f1(O2[0])}" cy="${f1(O2[1])}" r="4"/>`;
  // alpha arc
  b += `<path class="ang" d="${A(O1[0], O1[1], 46, -90, -90 + 18)}"/>${tri(O1[0] + 46 * Math.cos((-72) * Math.PI / 180), O1[1] + 46 * Math.sin((-72) * Math.PI / 180), -72, 6, GREEN)}`;
  b += `<text class="lab" x="${O1[0] + 54}" y="${O1[1] - 40}">α(i−1)</text>`;
  // theta_i at frame i
  b += `<path class="dash" d="M ${O2[0]} ${O2[1]} L ${O2[0] + 84} ${O2[1]}"/>`;
  b += `<path class="xh" d="M ${O2[0]} ${O2[1]} L ${f1(O2[0] + 70 * Math.cos(-40 * Math.PI / 180))} ${f1(O2[1] + 70 * Math.sin(-40 * Math.PI / 180))}"/>`;
  b += `<path class="ang" d="${A(O2[0], O2[1], 40, 0, -40)}"/>`;
  b += `<text class="lab" x="${O2[0] + 46}" y="${O2[1] - 26}">θ(i)</text>`;
  b += `<text class="lab" x="${O2[0] + 82}" y="${O2[1] + 4}">X(i)</text>`;
  b += `<text class="lab" x="204" y="90" text-anchor="end">Z(i−1)</text>`;
  b += `<text class="lab" x="${f1(top[0] + 6)}" y="${f1(top[1])}">Z(i)</text>`;
  b += `<text class="mono" x="150" y="${O1[1] + 20}" text-anchor="end">frame {i−1}</text>`;
  b += `<text class="mono" x="${f1(O2[0] - 74)}" y="${f1(O2[1] - 8)}" text-anchor="end">frame {i}</text>`;
  b += `<text class="mono" x="26" y="${H - 16}">α(i−1) twist about X(i−1)  ·  a(i−1) length along X(i−1)  ·  θ(i) angle about Z(i)  ·  d(i) offset along Z(i)</text>`;
  return svg(W, H, 'The four Modified-DH parameters of one row', b);
}

function figTransformOrder() {
  const W = 790, H = 300, y = 112, bw = 150, bh = 74, xs = [30, 215, 400, 585];
  const items = [['Rx(α<sub>i−1</sub>)', 'twist about X'], ['Tx(a<sub>i−1</sub>)', 'length along X'], ['Rz(θ<sub>i</sub>)', 'angle about Z'], ['Tz(d<sub>i</sub>)', 'offset along Z']];
  let b = `<text class="ttl" x="26" y="34">Modified-DH transform order</text>
<text class="sub" x="26" y="55">The four elementary transforms multiply left to right inside one 4×4 link matrix.</text>`;
  items.forEach((it, i) => {
    const x = xs[i];
    b += `<rect class="chip" x="${x}" y="${y}" width="${bw}" height="${bh}" rx="12"/>`;
    b += `<text class="lab" x="${x + bw / 2}" y="${y + 32}" text-anchor="middle">${it[0]}</text>`;
    b += `<text class="mono" x="${x + bw / 2}" y="${y + 52}" text-anchor="middle">${it[1]}</text>`;
    if (i < 3) { const gx = x + bw; b += `<line class="dim" x1="${gx + 6}" y1="${y + bh / 2}" x2="${gx + 27}" y2="${y + bh / 2}" stroke="${TEAL}"/>${tri(gx + 29, y + bh / 2, 0, 7, TEAL)}`; }
  });
  b += `<text class="mono" x="30" y="${y - 12}">frame {i−1}</text>`;
  b += `<text class="mono" x="${xs[3] + bw + 6}" y="${y - 12}">frame {i}</text>`;
  b += `<text class="lab" x="${xs[0]}" y="${y + bh + 34}">commute: both act about / along X(i−1)</text>`;
  b += `<line class="ang" x1="${xs[0]}" y1="${y + bh + 12}" x2="${xs[1] + bw}" y2="${y + bh + 12}" stroke="${GREEN}"/>`;
  b += `<text class="lab" x="${xs[2]}" y="${y + bh + 34}">commute: both act about / along Z(i)</text>`;
  b += `<line class="ang" x1="${xs[2]}" y1="${y + bh + 12}" x2="${xs[3] + bw}" y2="${y + bh + 12}" stroke="${GREEN}"/>`;
  b += `<text class="mono" x="30" y="${H - 34}">Swapping a twist about X with the joint rotation about Z (or a Z translation with an X translation) changes the link — the order is part of the model.</text>`;
  b += `<text class="lab" x="30" y="${H - 14}">i−1T(i) = A1 · A2 · A3 · A4</text>`;
  return svg(W, H, 'Modified-DH transform order and which operations commute', b);
}

function figFK2R() {
  const W = 700, H = 470, L1 = 280, L2 = 200, q1 = 40, q2 = 55;
  const robot = { id: 'fk', name: '2R', convention: 'mdh', gravity: [0, 0, -9.81], home: [0, 0], tool: [L2 / 1000, 0, 0],
    joints: [RL.makeJoint({ type: 'R', a: 0, alpha: 0, d: 0, theta: 0 }), RL.makeJoint({ type: 'R', a: L1 / 1000, alpha: 0, d: 0, theta: 0 })] };
  const f = RL.fk(robot, [q1 * Math.PI / 180, q2 * Math.PI / 180]);
  const P1 = RL.Pof(f.frames[2]).map((v) => v * 1000), TCP = RL.Pof(f.T).map((v) => v * 1000);
  const s = 0.95, base = [150, 430], M = ([x, y]) => [base[0] + s * x, base[1] - s * y];
  const b0 = base, b1 = M(P1), b2 = M(TCP);
  let b = `<text class="ttl" x="26" y="32">Forward kinematics — 2R planar arm</text>
<text class="sub" x="26" y="52">Multiply the two link transforms, then the tool frame, and read the last column.</text>`;
  b += `<line class="ax0" x1="60" y1="${base[1]}" x2="660" y2="${base[1]}"/>`;
  b += `<rect class="chip" x="18" y="72" width="352" height="92" rx="10"/>`;
  b += `<text class="lab" x="32" y="94">i=1  a0 = 0, α0 = 0, θ1 = ${q1}°, d1 = 0</text>`;
  b += `<text class="lab" x="32" y="116">i=2  a1 = ${L1} mm, α1 = 0, θ2 = ${q2}°, d2 = 0</text>`;
  b += `<text class="lab" x="32" y="138">tool  L2 = ${L2} mm along X2</text>`;
  b += `<text class="mono" x="32" y="157">0T2 = 0T1 · 1T2   ·   TCP = 0T2 · tool</text>`;
  b += `<path class="link" d="M ${f1(b0[0])} ${f1(b0[1])} L ${f1(b1[0])} ${f1(b1[1])} L ${f1(b2[0])} ${f1(b2[1])}"/>`;
  b += `<path class="dash" d="M ${f1(b0[0])} ${f1(b0[1])} L ${f1(b2[0])} ${f1(b2[1])}"/>`;
  b += `<circle class="pivot" cx="${b0[0]}" cy="${b0[1]}" r="9"/><circle class="dot" cx="${f1(b1[0])}" cy="${f1(b1[1])}" r="6"/><circle class="hot" cx="${f1(b2[0])}" cy="${f1(b2[1])}" r="7"/>`;
  b += `<path class="xh" d="M ${b0[0]} ${b0[1]} L ${b0[0] + 58} ${b0[1]}"/>${tri(b0[0] + 58, b0[1], 0, 6, RED)}<text class="lab" x="${b0[0] + 62}" y="${b0[1] + 4}">X</text>`;
  b += `<path class="yh" d="M ${b0[0]} ${b0[1]} L ${b0[0]} ${b0[1] - 58}"/>${tri(b0[0], b0[1] - 58, -90, 6, GREEN)}<text class="lab" x="${b0[0] - 4}" y="${b0[1] - 64}" text-anchor="end">Y</text>`;
  b += `<path class="ang" d="${A(b0[0], b0[1], 66, 0, -q1)}"/>`;
  b += `<text class="lab" x="${b0[0] + 74}" y="${b0[1] - 44}">q1 = ${q1}°</text>`;
  b += `<path class="ang" d="${A(b1[0], b1[1], 48, -q1, -(q1 + q2))}"/>`;
  b += `<text class="lab" x="${f1(b1[0] + 40)}" y="${f1(b1[1] - 34)}">q2 = ${q2}°</text>`;
  b += `<text class="lab" x="${f1((b0[0] + b1[0]) / 2 + 10)}" y="${f1((b0[1] + b1[1]) / 2 - 6)}">L1 = ${L1}</text>`;
  b += `<text class="lab" x="${f1((b1[0] + b2[0]) / 2 + 12)}" y="${f1((b1[1] + b2[1]) / 2 + 4)}">L2 = ${L2}</text>`;
  b += `<text class="lab" x="${f1(b2[0] + 12)}" y="${f1(b2[1] - 10)}">TCP (${f1(TCP[0])}, ${f1(TCP[1])}) mm</text>`;
  b += `<text class="mono" x="26" y="${H - 16}">x = L1cos q1 + L2cos(q1+q2)   ·   y = L1sin q1 + L2sin(q1+q2)</text>`;
  return svg(W, H, 'Forward kinematics of a 2R planar arm', b);
}

function figIKBranches() {
  const W = 700, H = 470, L1 = 220, L2 = 180, x = 280, y = 200, base = [150, 420], s = 1.05;
  const robot = { id: 'ik', name: '2R', convention: 'mdh', gravity: [0, 0, -9.81], home: [0, 0], tool: [L2 / 1000, 0, 0],
    joints: [RL.makeJoint({ type: 'R', a: 0, alpha: 0, d: 0, theta: 0, qmin: -180, qmax: 180 }), RL.makeJoint({ type: 'R', a: L1 / 1000, alpha: 0, d: 0, theta: 0, qmin: -180, qmax: 180 })] };
  const sol = RL.ik2R(robot, x / 1000, y / 1000, 0);
  const M = ([mx, my]) => [base[0] + s * mx, base[1] - s * my];
  const T = M([x, y]);
  const branches = sol.solutions.map((q) => {
    const f = RL.fk(robot, q.q), p1 = RL.Pof(f.frames[2]).map((v) => v * 1000);
    return { q: q.q, label: q.label, p1: M(p1), tcp: M(RL.Pof(f.T).map((v) => v * 1000)) };
  });
  const colors = [GREEN, BLUE], dashed = ['', ' stroke-dasharray="9 6"'];
  let b = `<text class="ttl" x="26" y="32">Inverse kinematics — the two branches</text>
<text class="sub" x="26" y="52">A point inside the annulus has two solutions: elbow-down (θ2 &gt; 0) and elbow-up (θ2 &lt; 0).</text>`;
  b += `<rect class="chip" x="18" y="70" width="330" height="72" rx="10"/>`;
  b += `<text class="lab" x="32" y="92">cos θ2 = ( r² − L1² − L2² ) / ( 2 L1 L2 )</text>`;
  b += `<text class="lab" x="32" y="114">θ1 = atan2(y, x) − atan2(L2 sin θ2, L1 + L2 cos θ2)</text>`;
  b += `<text class="mono" x="32" y="133">L1 = ${L1} mm · L2 = ${L2} mm · target (${x}, ${y}) mm</text>`;
  b += `<line class="ax0" x1="60" y1="${base[1]}" x2="660" y2="${base[1]}"/>`;
  branches.forEach((br, i) => {
    b += `<path d="M ${f1(base[0])} ${f1(base[1])} L ${f1(br.p1[0])} ${f1(br.p1[1])} L ${f1(T[0])} ${f1(T[1])}" fill="none" stroke="${colors[i]}" stroke-width="${i ? 3 : 6.5}" stroke-linecap="round" stroke-linejoin="round"${dashed[i]}/>`;
    b += `<circle cx="${f1(br.p1[0])}" cy="${f1(br.p1[1])}" r="5.5" fill="${colors[i]}"/>`;
    const deg = (v) => (v * 180 / Math.PI).toFixed(1);
    b += `<text class="mono" x="${f1(br.p1[0] + (i ? -10 : 12))}" y="${f1(br.p1[1] + (i ? -12 : 20))}">θ1 ${deg(br.q[0])}°, θ2 ${deg(br.q[1])}°</text>`;
  });
  b += `<circle class="pivot" cx="${base[0]}" cy="${base[1]}" r="9"/><circle class="hot" cx="${f1(T[0])}" cy="${f1(T[1])}" r="7"/>`;
  b += `<text class="lab" x="${f1(T[0] + 12)}" y="${f1(T[1] - 9)}">target</text>`;
  b += `<text class="lab" x="${f1(T[0] + 12)}" y="${f1(T[1] + 8)}" fill="${GREEN}">elbow-down</text>`;
  b += `<text class="lab" x="${f1(T[0] + 12)}" y="${f1(T[1] + 25)}" fill="${BLUE}">elbow-up (dashed)</text>`;
  b += `<text class="mono" x="26" y="${H - 16}">r &gt; L1+L2 or r &lt; |L1−L2| → no solution  ·  r on the boundary → exactly one  ·  otherwise two</text>`;
  return svg(W, H, 'The two inverse-kinematics solutions of a 2R planar arm', b);
}

function figJacEllipsoid() {
  const W = 700, H = 470, L1 = 240, L2 = 200, q1 = 30, q2 = 70;
  const robot = { id: 'jac', name: '2R', convention: 'mdh', gravity: [0, 0, -9.81], home: [0, 0], tool: [L2 / 1000, 0, 0],
    joints: [RL.makeJoint({ type: 'R', a: 0, alpha: 0, d: 0, theta: 0 }), RL.makeJoint({ type: 'R', a: L1 / 1000, alpha: 0, d: 0, theta: 0 })] };
  const q = [q1 * Math.PI / 180, q2 * Math.PI / 180];
  const f = RL.fk(robot, q), P1 = RL.Pof(f.frames[2]).map((v) => v * 1000), TCP = RL.Pof(f.T).map((v) => v * 1000);
  const J = RL.jacobian(robot, q);
  // 2x2 linear block -> symmetric J J^T -> eigenvalues give sigma^2
  const a = J[0][0], c = J[0][1], e = J[1][0], g = J[1][1];
  const m00 = a * a + c * c, m11 = e * e + g * g, m01 = a * e + c * g;
  const tr = m00 + m11, det = m00 * m11 - m01 * m01, disc = Math.sqrt(Math.max(0, tr * tr - 4 * det));
  const l1 = (tr + disc) / 2, l2 = (tr - disc) / 2, s1 = Math.sqrt(l1) * 1000, s2 = Math.sqrt(Math.max(0, l2)) * 1000;
  let vx = m01, vy = l1 - m00; const vn = Math.hypot(vx, vy) || 1; vx /= vn; vy /= vn;
  const ang = Math.atan2(-vy, vx) * 180 / Math.PI;                 // screen angle
  const s = 0.9, base = [150, 420], M = ([mx, my]) => [base[0] + s * mx, base[1] - s * my];
  const b0 = base, b1 = M(P1), b2 = M(TCP), k = 0.30;
  let b = `<text class="ttl" x="26" y="32">The velocity ellipsoid at the tool</text>
<text class="sub" x="26" y="52">The image of the unit joint-rate ball is an ellipse; its semi-axes are the singular values σ1 ≥ σ2.</text>`;
  b += `<line class="ax0" x1="60" y1="${base[1]}" x2="660" y2="${base[1]}"/>`;
  b += `<path class="link" d="M ${f1(b0[0])} ${f1(b0[1])} L ${f1(b1[0])} ${f1(b1[1])} L ${f1(b2[0])} ${f1(b2[1])}"/>`;
  b += `<circle class="pivot" cx="${b0[0]}" cy="${b0[1]}" r="9"/><circle class="dot" cx="${f1(b1[0])}" cy="${f1(b1[1])}" r="6"/>`;
  b += `<ellipse cx="${f1(b2[0])}" cy="${f1(b2[1])}" rx="${f1(s1 * k)}" ry="${f1(s2 * k)}" transform="rotate(${f1(-ang)} ${f1(b2[0])} ${f1(b2[1])})" fill="${MINT}" fill-opacity="0.55" stroke="${TEAL}" stroke-width="2.4"/>`;
  const e1 = [b2[0] + s1 * k * Math.cos(-ang * Math.PI / 180), b2[1] + s1 * k * Math.sin(-ang * Math.PI / 180)];
  b += `<line class="dim" x1="${f1(b2[0])}" y1="${f1(b2[1])}" x2="${f1(e1[0])}" y2="${f1(e1[1])}" stroke="${RED}"/>`;
  b += `<text class="lab" x="${f1(e1[0] + 6)}" y="${f1(e1[1] - 4)}">σ1 = ${s1.toFixed(0)} mm/s</text>`;
  b += `<text class="lab" x="${f1(b2[0] + 10)}" y="${f1(b2[1] + 22)}">σ2 = ${s2.toFixed(0)}</text>`;
  b += `<text class="mono" x="26" y="${H - 54}">manipulability w = σ1·σ2 = |det J| = ${(s1 * s2).toFixed(0)} mm²   ·   condition number σ1/σ2 = ${(s1 / Math.max(1e-9, s2)).toFixed(1)}</text>`;
  b += `<text class="mono" x="26" y="${H - 34}">q1 = ${q1}°, q2 = ${q2}°, L1 = ${L1} mm, L2 = ${L2} mm. Rotate the whole arm (change q1) and the ellipse turns with it; change q2 and its shape changes.</text>`;
  b += `<text class="mono" x="26" y="${H - 14}">As q2 → 0° or ±180° the minor axis σ2 → 0: the pose is singular and some tool directions need unbounded joint speed.</text>`;
  return svg(W, H, 'Velocity ellipsoid of a 2R planar arm at a given pose', b);
}

function figTrajectory() {
  const W = 780, H = 610, x0 = 74, x1 = 754, panels = [[70, 200, 'position q(t)'], [258, 388, 'velocity q̇(t)'], [446, 576, 'acceleration q̈(t)']];
  const cubic = [], quintic = [];
  for (let i = 0; i <= 100; i++) {
    const u = i / 100;
    cubic.push([u, 3 * u * u - 2 * u * u * u, 6 * u - 6 * u * u, 6 - 12 * u]);
    quintic.push([u, 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5, 30 * u * u - 60 * u ** 3 + 30 * u ** 4, 60 * u - 180 * u * u + 120 * u ** 3]);
  }
  const sc = RL5.sCurveProfile(1, 2.2, 6, 40, 0.004);
  const sPts = sc.t.map((t, i) => [t / sc.T, sc.q[i], sc.qd[i], sc.qdd[i]]);
  const series = [
    { name: 'cubic', color: BLUE, pts: cubic, col: 1 },
    { name: 'quintic', color: GREEN, pts: quintic, col: 2 },
    { name: 's-curve', color: RED, pts: sPts, col: 3 },
  ];
  let b = `<text class="ttl" x="26" y="34">Trajectory profiles — cubic, quintic and S-curve</text>
<text class="sub" x="26" y="54">Same 1-unit move over the same duration; time is normalised to 0…1 in each panel.</text>`;
  const lg = [[430, 34, BLUE, 'cubic'], [530, 34, GREEN, 'quintic'], [640, 34, RED, 'S-curve']];
  lg.forEach(([lx, ly, col, nm]) => { b += `<line x1="${lx}" y1="${ly - 4}" x2="${lx + 22}" y2="${ly - 4}" stroke="${col}" stroke-width="3"/><text class="mono" x="${lx + 28}" y="${ly}">${nm}</text>`; });
  panels.forEach(([py0, py1, label], pi) => {
    let lo = Infinity, hi = -Infinity;
    series.forEach((se) => se.pts.forEach((p) => { const v = p[se.col]; if (v < lo) lo = v; if (v > hi) hi = v; }));
    if (pi === 0) { lo = Math.min(lo, 0); hi = Math.max(hi, 1); }
    const pad = 0.08 * (hi - lo || 1); lo -= pad; hi += pad;
    const X = (u) => x0 + u * (x1 - x0);
    const Y = (v) => py1 - (v - lo) / (hi - lo || 1) * (py1 - py0);
    b += `<text class="lab" x="${x0}" y="${py0 - 8}">${label}</text>`;
    for (let g = 0; g <= 4; g++) { const gy = py0 + g * (py1 - py0) / 4; b += `<line class="grid" x1="${x0}" y1="${f1(gy)}" x2="${x1}" y2="${f1(gy)}"/>`; }
    if (lo < 0 && hi > 0) b += `<line class="ax0" x1="${x0}" y1="${f1(Y(0))}" x2="${x1}" y2="${f1(Y(0))}"/>`;
    series.forEach((se) => {
      b += `<path d="${poly(se.pts.map((p) => [X(p[0]), Y(p[se.col])]))}" fill="none" stroke="${se.color}" stroke-width="2.4"/>`;
    });
    b += `<text class="mono" x="${x0 - 6}" y="${py0 + 10}" text-anchor="end">${hi.toFixed(2)}</text>`;
    b += `<text class="mono" x="${x0 - 6}" y="${py1}" text-anchor="end">${lo.toFixed(2)}</text>`;
  });
  b += `<text class="mono" x="26" y="${H - 16}">The cubic has a velocity step-free but finite-jerk start; the quintic is 25% faster at mid-move and acceleration-continuous; the S-curve limits jerk, so its acceleration leaves zero smoothly.</text>`;
  return svg(W, H, 'Position, velocity and acceleration profiles for three trajectory types', b);
}

function figWorkspacePlanes() {
  const model = RL5.MODELS.filter((m) => m.id === 'scara4')[0];
  const w = RL5.workspaceMetrics(RL5.modelToRobot(model), { samples: 1200, seed: 7 });
  const pts = (arr, f) => arr.map((p) => f(p.map((v) => v * 1000)));
  const panels = [
    { h: 'X', v: 'Y', t: 'XY · top view', get: (p) => [p[0], p[1]] },
    { h: 'X', v: 'Z', t: 'XZ · front view', get: (p) => [p[0], p[2]] },
    { h: 'Y', v: 'Z', t: 'YZ · side view', get: (p) => [p[1], p[2]] },
  ];
  const W = 900, H = 380, pw = 268, ph = 250, py = 78;
  let b = `<text class="ttl" x="26" y="34">One workspace, three projections</text>
<text class="sub" x="26" y="54">${esc(model.name)} sampled over its joint space, projected onto each plane (equal aspect). Grey = reachable, green = dexterous.</text>`;
  panels.forEach((pn, i) => {
    const px = 26 + i * (pw + 18);
    const all = w.reachable.map(pn.get).concat(w.dexterous.map(pn.get));
    let mn = [Infinity, Infinity], mx = [-Infinity, -Infinity];
    all.forEach(([a1, a2]) => { mn[0] = Math.min(mn[0], a1); mx[0] = Math.max(mx[0], a1); mn[1] = Math.min(mn[1], a2); mx[1] = Math.max(mx[1], a2); });
    const sp = [mx[0] - mn[0] || 1, mx[1] - mn[1] || 1], sc = Math.min((pw - 30) / sp[0], (ph - 30) / sp[1]);
    const ox = px + 15 + ((pw - 30) - sp[0] * sc) / 2, oy = py + ph - 15;
    const Map = ([a1, a2]) => [ox + (a1 - mn[0]) * sc, oy - (a2 - mn[1]) * sc];
    b += `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="10" fill="#fff" stroke="${LINE}"/>`;
    b += `<text class="lab" x="${px + 12}" y="${py + 20}">${pn.t}</text>`;
    const dots = (arr, cls) => arr.map(pn.get).map((p) => { const [sx, sy] = Map(p); return `<circle cx="${f1(sx)}" cy="${f1(sy)}" r="1.6" class="${cls}"/>`; }).join('');
    b += dots(w.reachable, '');
    b += `<g fill="${GREEN}" opacity="0.5">${dots(w.dexterous, '')}</g>`;
    b += `<text class="mono" x="${px + 12}" y="${py + ph - 8}">${pn.h} vs ${pn.v} (mm)</text>`;
  });
  b += `<line x1="760" y1="${py + 220} " x2="790" y2="${py + 220}" stroke="#9fb8b3" stroke-width="4"/><text class="mono" x="796" y="${py + 224}">reachable</text>`;
  b += `<line x1="760" y1="${py + 240}" x2="790" y2="${py + 240}" stroke="${GREEN}" stroke-width="4"/><text class="mono" x="796" y="${py + 244}">dexterous</text>`;
  return svg(W, H, 'A sampled workspace projected on the XY, XZ and YZ planes', b);
}

function figGravityTorque() {
  const W = 700, H = 470, O = [200, 120], r = 210, th = 40 * Math.PI / 180;
  const tip = [O[0] + r * Math.sin(th), O[1] + r * Math.cos(th)];
  const armLen = r * Math.sin(th), m = 8;
  let b = `<text class="ttl" x="26" y="32">Gravity torque on a revolute joint</text>
<text class="sub" x="26" y="52">The weight’s moment arm about the joint is r·sin θ, so the holding torque is τ = m·g·r·|sin θ|.</text>`;
  b += `<path class="dash" d="M ${O[0]} ${O[1]} L ${O[0]} ${O[1] + 250}"/>`;
  b += `<text class="mono" x="${O[0] - 10}" y="${O[1] + 262}" text-anchor="end">vertical</text>`;
  b += `<path class="link" d="M ${O[0]} ${O[1]} L ${f1(tip[0])} ${f1(tip[1])}"/>`;
  b += `<path class="dim" d="M ${O[0]} ${O[1]} L ${f1(tip[0])} ${O[1]}"/>`;
  b += `<path class="dash" d="M ${f1(tip[0])} ${O[1]} L ${f1(tip[0])} ${f1(tip[1])}"/>`;
  b += `<path d="M ${f1(tip[0])} ${O[1]} l -10 0 l 0 10" fill="none" stroke="${SUN}" stroke-width="1.4"/>`;
  b += `<text class="lab" x="${f1((O[0] + tip[0]) / 2)}" y="${O[1] - 8}" text-anchor="middle">r·sin θ = ${armLen.toFixed(0)}</text>`;
  b += `<circle class="pivot" cx="${O[0]}" cy="${O[1]}" r="9"/>`;
  b += `<circle cx="${f1(tip[0])}" cy="${f1(tip[1])}" r="17" fill="${MINT}" stroke="${GREEN}" stroke-width="2.5"/><text class="lab" x="${f1(tip[0])}" y="${f1(tip[1] + 4)}" text-anchor="middle">m</text>`;
  b += `<path class="ang" d="${A(O[0], O[1], 64, 90, 90 - 40)}"/><text class="lab" x="${O[0] + 70}" y="${O[1] + 44}">θ</text>`;
  b += `<line x1="${f1(tip[0])}" y1="${f1(tip[1] + 18)}" x2="${f1(tip[0])}" y2="${f1(tip[1] + 96)}" stroke="${RED}" stroke-width="2.6"/>${tri(f1(tip[0]), f1(tip[1] + 100), 90, 8, RED)}`;
  b += `<text class="lab" x="${f1(tip[0] + 10)}" y="${f1(tip[1] + 70)}" fill="${RED}">m·g = ${m}·9.81 N</text>`;
  b += `<rect class="chip" x="18" y="330" width="330" height="86" rx="10"/>`;
  b += `<text class="lab" x="32" y="354">τ = m · g · r · |sin θ|</text>`;
  b += `<text class="mono" x="32" y="376">Straight down (θ = 0°): τ = 0 — no moment arm.</text>`;
  b += `<text class="mono" x="32" y="394">Horizontal (θ = 90°): τ = m·g·r — the maximum.</text>`;
  b += `<text class="mono" x="32" y="410">Doubling the payload doubles τ.</text>`;
  // inset tau(theta) curve
  const px0 = 420, py0 = 350, px1 = 668, py1 = 220;
  const N = 60, pts = [];
  for (let i = 0; i <= N; i++) { const t = i / N * Math.PI; pts.push([px0 + (t / Math.PI) * (px1 - px0), py1 + 1 - Math.sin(t) * (py1 - 60)]); }
  b += `<rect x="${px0 - 10}" y="${py1 - 40}" width="${px1 - px0 + 30}" height="${py0 - py1 + 70}" rx="10" fill="#fff" stroke="${LINE}"/>`;
  b += `<text class="lab" x="${px0}" y="${py1 - 20}">τ(θ) ∝ sin θ</text>`;
  b += `<path class="dim" d="M ${px0} ${py1} L ${px1} ${py1}"/>`;
  b += `<path d="${poly(pts)}" fill="none" stroke="${GREEN}" stroke-width="2.6"/>`;
  b += `<text class="mono" x="${px0}" y="${py1 + 16}">0°</text><text class="mono" x="${(px0 + px1) / 2 - 10}" y="${py1 + 16}">90°</text><text class="mono" x="${px1 - 18}" y="${py1 + 16}">180°</text>`;
  b += `<text class="mono" x="26" y="${H - 16}">This is the static gravity term. The full joint torque also carries inertial (I·q̈) and Coriolis terms.</text>`;
  return svg(W, H, 'Gravity torque on a revolute joint and its moment arm', b);
}

const CONCEPTS = {
  'mdh-parameters': figMDH,
  'transform-order': figTransformOrder,
  'fk-2r': figFK2R,
  'ik-branches': figIKBranches,
  'jacobian-ellipsoid': figJacEllipsoid,
  'trajectory-profiles': figTrajectory,
  'workspace-planes': figWorkspacePlanes,
  'gravity-torque': figGravityTorque,
};

let n = 0;
RL5.MODELS.forEach((m) => {
  fs.writeFileSync(path.join(OUT, `robot-${m.id}.svg`), robotSVG(m));
  n++; console.log('wrote', `robot-${m.id}.svg`);
});
['planar2r', 'scara4'].forEach((id) => {
  const m = RL5.MODELS.filter((x) => x.id === id)[0];
  fs.writeFileSync(path.join(OUT, `workspace-${id}.svg`), workspaceSVG(m));
  n++; console.log('wrote', `workspace-${id}.svg`);
});
Object.keys(CONCEPTS).forEach((name) => {
  fs.writeFileSync(path.join(OUT, `${name}.svg`), CONCEPTS[name]());
  n++; console.log('wrote', `${name}.svg`);
});
console.log(`\n${n} figure(s) written to assets/figures/`);
