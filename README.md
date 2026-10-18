# ✳ Crayon Robotics Lab v2 — Verified Modified-DH Workspace

**🌐 Live demo: https://kanishkpatel0206.github.io/crayon-robotics-lab/**

An interactive robot-kinematics studio built around Craig-style **Modified Denavit–Hartenberg** parameters: a colour-coded editable MDH table with a tool frame, a real 3D viewer (with prismatic rails, floor and collision checking), 16 robot presets, forward and inverse kinematics, Jacobian, trajectories, workspace analysis and full dynamics. It runs entirely in your browser; nothing is uploaded.

Your Crayon layout and light theme (sidebar, hero cards, pill tabs, 3D viewport), running on a numerically verified robotics engine.

## Run
**Online:** open the live demo above. **Locally:** open `index.html` in Chrome, Edge or Firefox (three.js is bundled in `vendor/`, so 3D works offline; only the Google Fonts are optional, system fonts are the fallback). `node tests/run_selftests.js` runs the 30 engine checks.

**Share a robot:** press **🔗 Share** to copy a link that contains your whole robot, for example `https://kanishkpatel0206.github.io/crayon-robotics-lab/#s=…`.

## v2 — Export & Report (new sidebar page)
Turn the robot on screen into class-report material:
- **Printable report:** title, name, course and date; the MDH table (variable cells marked, tool frame row); a **worked derivation** (every link matrix ⁱ⁻¹Tᵢ with the numbers substituted, then the final ⁰Tₙ and tool position); Jacobian with singular values; gravity torques; trajectory table and plots; workspace summary and plot; a 3D figure with caption. Tick the sections you want and choose 2/3/4/6 decimals. Open it and press **Print / Save as PDF**, or download it as `.html`.
- **Copy for Word / Docs:** puts the report on the clipboard as formatted tables.
- **LaTeX** (`tabular` + `bmatrix`), **Markdown**, **MATLAB** (Peter Corke Robotics Toolbox, modified DH) and **Python** (NumPy) export. Shift+click copies instead of downloading.
- **Images:** 3D view as PNG (SVG if WebGL is unavailable); trajectory position/velocity/acceleration and workspace plots as PNG.
- **CSV:** link matrices, Jacobian, current pose + tool position, gravity torques, trajectory.
- Every report carries the date, the app version, the engine self-test result (30/30) and a **share link** that reopens the exact robot.

Verified by tests: the generated Python reproduces the page's forward kinematics on all 16 robots (5·10⁻⁵ mm), LaTeX/Markdown/MATLAB structure, CSV shapes, report content and the download/clipboard buttons (`tests/ui_export_test.js`, needs Python with NumPy).

### 2.0.1 — export fixes
- **3D image export fixed** (it produced an empty pale-blue picture). The snapshot now uses its own offscreen renderer and a camera that frames the whole robot (including the full travel of prismatic rails), so it works even while the 3D tab is hidden, and it refuses to return a blank image (the report then says so instead of showing an empty box). Coordinate frames can be included in the image.
- Report: the figure comes first; derivation blocks no longer split across pages; proper ⁰T₁ notation and units; robot shown by name ("Stanford arm RRPRRR"); a short "Open this exact robot" link instead of a very long URL that ran off the page; colours print correctly; share links made from a local file point to the published site.
- Tip: in the print dialog turn **off** "Headers and footers" and turn **on** "Background graphics".

## What changed under the hood
| Page | Before | Now |
|---|---|---|
| Jacobian | finite-difference, position only (3×n) | analytic **6×n geometric Jacobian**, singular values (linear and 6D), condition, manipulability, singularity flag, finite-difference cross-check, angular velocity, **resolved-rate** solver |
| Inverse kinematics | position-only DLS | DLS with **optional orientation (roll/pitch/yaw)**, **multi-start**, joint limits, several distinct solutions, every answer **re-checked by FK**, honest failure reasons, **Apply** button |
| Dynamics | single-joint τ ≈ mgr·sin θ + Iα guess | full **M(q), C(q,q̇)q̇, g(q)**, inverse dynamics, selectable gravity direction, editable link masses, **RK4 forward simulation** with energy-drift check, play on robot |
| Trajectory | single joint | adds a **synchronised all-joint move** to the last IK solution with limit checks |
| Learning | – | in-page **self-test runner** (30 checks) |
| Project | export only | **JSON import** with validation |

All of it uses the Craig order `Rx(α[i-1]) Tx(a[i-1]) Rz(θ[i]) Tz(d[i])` plus the tool offset, exactly as the page's own forward kinematics. The engine's FK was compared with the page's FK on all 7 presets (identical), and a built-in test proves Modified DH ≡ classical DH for FK, Jacobian, M(q) and g(q).

## v4 additions
**Proper Modified-DH table** — columns in Craig order **α(i−1) · a(i−1) · θ(i) · d(i)**, colour-coded, with the joint-variable cell highlighted (θ for revolute, d for prismatic), min/max limits, an editable **tool frame row** (extra fixed frame: a_n along x, d_(n+1) along z), the transform banner and a live summary (DOF · joint string · reach). Row tools: move up/down, duplicate, insert, delete; Zero pose, Random pose, CSV and a "Load a robot…" menu.

**16 robots** (7 original + 8 new + Custom): PUMA 560-style, UR5-style (matches the published zero-pose TCP −817.25, −191.45, −5.49 mm), IRB 120-style, Stanford arm (RRPRRR), 7-DOF redundant LBR-style arm, SCARA RRPR, Cylindrical RPP, Spherical RRP. Library cards show DOF, joint string and reach.

**Fixed**
- Switching a joint Prismatic → Revolute left the limits at [−250, 0]; now resets to ±180°.
- Limits could be inverted (min ≥ max) or leave the joint outside its range; now corrected automatically.
- The tool offset could not be edited and was x-only; now x and z, saved/exported/imported.
- Export now includes the explicit `mdh_table`; import validates ranges.

Tests: `node tests/run_selftests.js` (engine, 30 checks) and `npm i jsdom && node tests/ui_smoke_test.js` (24 UI checks across all robots).

## v5 — prismatic joints, visualizer and audit fixes
**3D visualizer rewritten around the real Modified-DH geometry.** Each link is drawn as its true path: a(i−1) along x(i−1), then d(i) along z(i) (verified to close on the FK origin for all 16 robots to 1e-13). **Prismatic joints** now show a grey slide rail across the full min…max range, red end-stops, a rod that grows with d, and a carriage block at the current position. **Revolute joints** are cylinders along their z axis. The selected joint glows.

**Fixed**
- Prismatic joints had no nudge buttons; now ±1 / ±10 mm and "min".
- Inspector type switch forced limits [−250, 0] (conflicting with the table) and could leave d out of range. Table and inspector now share one validated edit path: type switch, min<max, and the variable is always clamped into its limits.
- Joint cards showed d twice for prismatic joints; now Craig-ordered chips with the variable highlighted, a range bar and an AT LIMIT flag.
- Dragging a slider pushed a new undo entry on every tick (undo history flooded); now one entry per drag.
- Undo/redo and Save ignored the tool frame; they now restore joints + tool x/z. Stored/corrupt projects are sanitised at startup.
- **Dynamics:** the slender-rod inertia estimate gave near-zero inertia to very short links (e.g. IRB-120 wrist), making the 5 ms RK4 simulation blow up (energy ~1e60). Added a minimum link inertia (~40 mm body radius) and a 2 ms step; the simulation now warns if the motion is still numerically stiff. Worst energy drift over a 2 s free swing across all 16 robots: 5.5e-4 (relative).

Tests: `node tests/run_selftests.js` (30 engine checks); with `npm i jsdom`: `node tests/ui_smoke_test.js` (table, library, IK) and `node tests/ui_audit_test.js` (geometry, render, Jacobian vs finite differences, energy, NaN scan of every page for every robot, inspector/nudge/undo/save).


## Publish on GitHub Pages
This project is published from the `main` branch root. To publish your own copy:
1. Create a repository and upload **the contents of this folder** (keep `index.html` at the repository root, with `vendor/` beside it).
2. Edit `LICENSE` and replace `<YOUR NAME>`.
3. In the repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save.**
4. After about a minute the site is live at `https://<user>.github.io/<repository>/`.
The site is fully static: no build step and no server. All paths are relative, so it works under a `/repository/` sub-path.

## v7 — quick features
- **🔗 Share:** copies a link that contains the whole robot (joints, tool frame, base height); opening it loads that robot.
- **Keyboard:** ← / → move the selected joint (Shift ×10), [ ] choose a joint, Ctrl+Z / Ctrl+Y undo/redo, P presentation mode.
- **⛶ Present:** clean fullscreen layout for lectures (P or Esc to exit).
- **Payload test** (Dynamics page): extra joint torque/force from a mass at the tool, via the Jacobian transpose.
- **Quick quiz** (Learning Center): compute the tool position from a random Modified-DH table; scored.
- **Fixes:** undo, save and export now include the base height; Random pose always finds a collision-free pose; Zero pose raises the base height if the arm would hit the floor.

## v6 — collision model and scrollable UI
**Collision.** Every link, joint housing, prismatic rod/carriage and the tool is a capsule. Checked against a **floor** (with an adjustable *Base height*; a pedestal is drawn under the base), the **pedestal**, and **self-collision** between non-neighbouring links (links joined through zero-length wrist joints count as connected). Colliding links turn **red** in 3D and a status pill names the culprit (floor / pedestal / J2↔J5). With *Block collisions* on, any move from a clear pose that would collide (slider, nudge, table, IK apply, trajectory, animation) is refused with a message. Presets pick a base height automatically so every robot loads clear of the floor. IK solutions are tagged "⚠ collides" and listed last; the workspace sampler can exclude colliding poses.

**Scrolling and responsiveness.** Sticky, internally scrolling sidebar; joint tree and inspector scroll independently while the 3D view stays in place; tables get sticky headers and a bounded height; plot canvases scale to their container; the 3D view height adapts to the window; below 1000 px the sidebar becomes a horizontal strip; thin themed scrollbars; back-to-top button.

Tests added: `node tests/ui_collision_test.js` (all 16 presets load clear, 600 random moves never end in collision, floor/pedestal detection, status pill, workspace filter, scroll rules).

## Notes and limits
- Units on the page stay mm/degrees; the engine works in m/rad internally.
- Link masses are slender-rod estimates (default 1 kg per link, editable on the Dynamics page). Planar arms lying in the XY plane have zero gravity torque with −Z gravity; choose −Y gravity for a vertical plane.
- Joint-limit-aware numerical IK can still fail near singularities; it then reports the best attempt instead of claiming success.
- Presets are teaching models, not vendor-accurate robots.

## Credits and licence
MIT licensed. © 2026 Kanishk Patel (UI and integration) and © 2026 Atharva Bhosale (RoboLab Web engine). three.js is MIT licensed. See `LICENSE` and `NOTICE.md`.
