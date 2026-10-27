# Changelog

All notable changes to Ken’s RoboLabs are recorded here.
The app version is available at `window.APP_VERSION` and in every exported report.

## [6.1.0] — 2026-10-27 — 3D Reachable Workspace

The Workspace Analysis page becomes an **interactive 3D reachable volume**. The flat orthographic scatter that shipped in 6.0.0 is kept, but only as the WebGL fallback and the figure the printable report uses — the primary view is now a live three.js point cloud. Everything remains static and GitHub-Pages-only.

### Added
- **Live 3D point cloud of the sampled workspace.** `#workspace3d` draws the sampled tool-centre points on the page's own three.js scene, camera and orbit controls. Drag to orbit, scroll to zoom, Shift-drag to pan. `z` is up (matching the robot viewport) and the dot colour encodes height. Labelled X/Y/Z axes (red/green/blue) and a ground grid give the volume its frame even before anything is sampled.
- **View controls.** `Fit 3D` re-centres on the sampled bounds, and three preset views (**Isometric**, **Top (XY)**, **Front (XZ)**) snap the orbit camera. A red ✚ marks the live tool centre point and follows the joints (`ws3dTick`) without a render loop — the view is drawn on demand.
- **Graceful fallback.** If three.js or WebGL is unavailable, `initWorkspace3D()` returns `false`, the 3D canvas hides, both the 3D note and the orthographic projection are revealed, and the page still samples, summarises and exports CSV.
- **`tests/ui_workspace3d_test.js`** — a static-wiring pass plus two jsdom passes (three.js present with a stubbed `WebGLRenderer`; three.js absent). It asserts the 300-point coloured cloud, ≥3 axis objects, the grid, the fitted camera, the live-TCP marker, the preset views and `Fit 3D`, the 3D canvas shown with the 2D fallback hidden, the hidden 2D canvas still drawn for the report, and the no-three.js degradation path — all with no JS errors.

### Changed
- **The Workspace Analysis panel is one 3D panel.** The "Projection" selector (`#workspaceProjection`) is removed — there is nothing to project; the control row now carries the sample count, **Sample workspace** and **Export points CSV** above the 3D canvas. The orthographic canvas moved into a hidden `#ws2dFallback` block, with the summary below.
- **The 2D canvas is retained on purpose.** It is the WebGL fallback *and* the source of the printable-report figure — a WebGL canvas without `preserveDrawingBuffer` captures blank, so `canvasPng` keeps reading the orthographic canvas (still drawn at 900 logical px).
- **The sampler no longer reads the projection control** (`proj` falls back to `'xy'`), and the page-shown handler renders the 3D view even before any sampling so the axes and grid are visible immediately.
- **Version unified to 6.1.0** across `window.APP_VERSION`, `<title>`, `meta[application-version]`, the Open Graph tags, the app-bar tag, `package.json` and the release docs. The `engine/practice.js` and `assets/practice.js` layers keep their own `6.0.0` version, as the v5 layer keeps `5.0.0`.

### Verification (2026-10-27)
- `tests/ui_workspace3d_test.js`: **23/23** (static wiring + jsdom with and without three.js).
- Full `npm test` exits **0**: engine self-tests still **30/30** and the in-browser validation harness still reports **0 FAIL of 60 badges**; the legacy FK drill is untouched.

## [6.0.0] — 2026-10-27 — Practice Modules

The Learning Center becomes a set of **self-study practice modules**. Each module is reference documentation, a **generated quiz** and a **worked solution** — there is no lecture voice, and every published answer is produced by the real Modified-DH maths rather than typed in by hand. The reachable-workspace plot is also corrected.

### Added
- **Practice modules (eight).** `engine/practice.js` defines the catalogue — Modified-DH parameters, frame assignment and transform order, forward kinematics, inverse kinematics, the Jacobian and singularities, trajectory smoothness, the reachable workspace, and dynamics with payload. Each ships `doc` (reference), `figures` and a `makeQuiz(rng)` builder.
- **Generated quizzes with independent verification.** Every question is built from a fresh random DH row, 2R arm, target or payload, and each module carries a `verify(q)` that re-derives the answer through a *different* path from the one used to ask it: forward kinematics (`RL.fk`) for the FK and DH-row questions, the closed-form 2R solver (`RL.ik2R` + FK) for IK, the analytic Jacobian (`RL.jacobian`) for the determinant and column norms, and the core trajectory sampler (`RL.jointTrajectory`) for the profile peak velocities. `PRACTICE.selfTests()` re-derives all 384 generated questions across six seeds and reports the worst residual (FK 0.0, IK 1.8e-13 mm, Jacobian 0.0, trajectory 0.0 °/s). Tolerances are published on each question.
- **A practice UI layer.** `assets/practice.js` mounts a module navigator, the reference text, the figures and the quiz into `#practiceModules`, with **Check**, **Show solution** and per-module progress remembered in `localStorage` (`robolabs-practice-progress`). `assets/practice.css` carries the tropical mint/teal identity.
- **Eight generated concept figures.** `tools/gen_figures.js` now also draws the documentation diagrams from the real maths — the four DH parameters, transform order, a 2R FK sketch, the two IK branches, a velocity ellipsoid from the singular values of J, cubic/quintic/S-curve profiles from the core sampler, the three workspace projections and the gravity-torque moment arm. The generator writes 16 committed SVGs in total (six robot wireframes, two workspace plots, eight concepts), so the site stays static.
- **`tests/ui_practice_test.js`** — a Node pass over `engine/practice.js` (catalogue, generation determinism, every `verify`, the self-tests) plus a jsdom pass over the mounted UI (navigator, documentation, figures, checking a correct and a wrong numeric answer, a multiple-choice answer, reveal/hide solution and progress persistence).

### Changed
- **The Learning Center is now the practice modules.** The four static teaching panels and the "chosen transformation order" panel are replaced by a hero and `<div id="practiceModules">`. The v3 learning-outcome banner and the eight-step frame-assignment checklist (`#v3FrameChecklist`) stay exactly as they were.
- **The legacy forward-kinematics drill gained a "Show solution" button** (`#qSolution`, `#qSol`). It prints the running frame origin after each link transform and then the tool frame. The exercise, its IDs, its score and the 30/30 `quizNew()` cross-check are untouched — the new affordance is purely additive.
- `engine/practice.js` + `assets/practice.js` + `assets/practice.css` are new static layers loaded after v5, so the 4 000-line `index.html` is not destabilised.
- **Version unified to 6.0.0** across `window.APP_VERSION`, `<title>`, the Open Graph title, the app-bar tag, `meta[application-version]`, `package.json` and the release docs.

### Fixed
- **The workspace visualiser used two different scales.** `drawWorkspaceCanvas` scaled X and Y independently, so the sampled reachable workspace was stretched to fill the canvas and a disc could look like an ellipse. It now uses a single scale for both axes (equal aspect), sizes for the device pixel ratio so it is crisp on retina displays, draws labelled ticks with units and a plane label, and marks the live TCP position (`✚`). The scatter is redrawn when the projection changes and when the page is shown (the canvas has no width while the panel is hidden).

### Verification (2026-10-27)
- `engine/practice.js` self-tests: **13/13** (8 module verifications + FK, IK, Jacobian, trajectory cross-checks + catalogue completeness), with machine-precision residuals.
- `tools/gen_figures.js` writes **16 SVGs**, all free of `NaN`/`undefined`/`Infinity`.
- Node + jsdom suites pass; the legacy FK drill still scores `1 / 1`, `1 / 2` and matches live FK 30/30.

## [5.0.0] — 2026-10-27 — Professional Credibility

The release that closes the gap to industrial toolchains: real 3D robot models, URDF in and out, and a validation harness that proves every claim **in your browser**. Everything remains static and GitHub-Pages-only — no account, server, database or upload.

### Added
- **Premade 3D models (six arms).** UR5-style 6R, PUMA 560-style, IRB 120-style, a 7-DOF redundant arm, a SCARA RRPR and a 2R planar. Each one is **procedurally generated industrial geometry driven by its real DH parameters** (housings, shoulder castings, cable ribs, wrist rings, tool flange) rather than a multi-megabyte CAD binary, so the whole library still ships as static files. `engine/v5.js` also parses inline `<mesh>` assets (minimal hand-written STL — ASCII and binary — and OBJ parsers, no CDN and no extra Three.js loaders).
- **Both representations, always.** Every premade model exists as a **link/skeleton** robot *and* as a **3D model**, and the matching teaching-robot card gains a "Load 3D model" button next to its existing "Load" button. A viewport switch (`Link (skeleton) ↔ 3D model`) toggles the representation of whatever is loaded; the choice is remembered in `localStorage`. If the model renderer ever fails it falls back to the stock skeleton view instead of showing a blank canvas.
- **URDF export and import (B5.1 / B5.10).** `engine/v5.js` parses `<robot>` documents, infers the Modified-DH (Craig) table one joint at a time, and reports the decomposition residual — so an approximate conversion can never be mistaken for an exact one. Export writes a URDF whose joint origin is the zero-configuration DH transform and whose `theta` column carries the live joint angle: the file matches this app's own DH table, re-imports into the pose you were looking at, and is **byte-identical to the shipped `assets/robots/*.urdf`**. A classical-DH robot is converted to modified DH first (exact) because classical DH cannot be written as a single URDF joint. A nonzero tool frame is written as a trailing fixed joint and read back as the tool frame.
- **Premade URDF files.** `assets/robots/ur5e.urdf`, `puma560`, `irb120`, `iiwa14`, `scara4`, `planar2r` — downloadable from the library and the Professional page, and regenerated byte-for-byte by the exporter.
- **Professional page.** Nine panels: the validation harness, URDF interop, link inertia tensors, the convention reference, trajectory v2, workspace metrics, redundancy, the model catalogue and the provenance/accessibility/privacy statement.
- **Validation harness (B5.11).** 57 checks run live in the browser and are reported as PASS/FAIL badges in four groups — `core` (30 engine checks), `v5` (20), `parity` (page FK ≡ engine FK) and `library` (every premade model ≡ its library preset, bit for bit). Tolerances are printed on the page.
- **Full inertial parameters (B5.3).** `inertiaToMatrix()` normalises the legacy diagonal, a URDF 6-vector `[ixx,ixy,ixz,iyy,iyz,izz]` or a full symmetric 3×3 tensor, and the mass matrix uses it; `validateProject` accepts all three forms. `reflectedInertia(n, I_m) = n²I_m` is exposed for geared joints.
- **Trajectory v2 (B5.7).** Trapezoidal and jerk-limited S-curve profiles with synchronised, per-joint durations and explicit velocity/acceleration residual checks.
- **Workspace v2 (B5.8).** Reachable vs dexterous sets, computed from the singular values of the geometric Jacobian; it reports `dexterityAvailable:false` and a full-rank fraction honestly when no sampled pose is well conditioned (for example a 3-DOF planar arm).
- **Redundancy (B5.6).** Damped null-space projection for the 7-DOF arm, with the TCP drift and joint motion reported so secondary motion can be seen without moving the tool.
- **Credibility (F5.1–F5.4).** Per-model sources, an educational-model disclaimer, and an accessibility/privacy/hosting statement — all on the Professional page.
- **`tests/ui_v5_test.js`** — engine and on-disk-artefact checks plus a jsdom pass over the model loader, the UI export and the Professional page.

### Changed
- **Version unified to 5.0.0** across `window.APP_VERSION`, `<title>`, the Open Graph title, the app-bar tag, `meta[application-version]`, `package.json`, the welcome tour and every exported report.
- **`engine/v5.js` + `assets/v5.js` + `assets/v5.css`** are new static layers, loaded after the app so the 4 000-line `index.html` is not destabilised. `engine/core.js` (and its inline copy) gained only `inertiaToMatrix` plus the wider inertia acceptance; the FK/IK/Jacobian/dynamics formulas are unchanged.
- `docs/ROADMAP.md` marks the v5 workstreams that shipped.
- The `.github/workflows/pages.yml` staging step now copies `engine/` into the artifact and **fails the build if fewer than six premade URDF files are staged**.
- Colour and contrast pass with a warm yellow page wash (motivated by the v3 accessibility review); the learning-outcome banners now cover **12** pages.

### Fixed
- **Short S-curve moves finished short of the target.** In `sCurveProfile`, the mirrored jerk phase claimed the maximum acceleration `amax` for its distance even when the move was too short to reach `amax` (a triangular profile, no cruise phase), so the sampled profile stopped a few percent short of the goal. The phase now uses the acceleration the ramp actually reached (`jmax·tj`, which equals `amax` only when the peak was reached), and an S-curve move now lands exactly on the target with zero end velocity.
- **Imported URDFs had `NaN` joint limits.** `urdfToRobot` wrote only `min`/`max`, while `jointLimitsSI`, `sampleConfig`, `validateRobot` and `loadRLRobot` read `qmin`/`qmax`; a URDF imported into the workspace then produced `NaN` in the workspace and dynamics panels. The importer now writes both pairs, `loadRLRobot` is tolerant of the legacy names, and the round-trip self-test compares limits.
- **Sign of floating-point zero flipped a DH twist.** `dhFromTransform` compared `atan2` arguments that could be `-0`, returning `α = −180` where the app's own table says `+180` (SCARA joint 3). Negative zeros are now snapped before the branch.
- **Export vs library mismatch.** The exporter used a zero `theta` offset, so an exported file did not reproduce the pose on screen and was not identical to the shipped `assets/robots/*.urdf`. A new `exportRobot()` bakes the live joint angle into `theta`, and `exportName()` gives the document the loaded model's id.

### Verification (2026-10-27)
- `engine/v5.js` self-tests **20/20**; in-browser validation harness **57/57**, 0 FAIL badges, groups `core, v5, parity, library`.
- All six premade models are parameter- and FK-identical to their library presets (zero difference), all six on-disk URDFs re-import with 0 warnings and agree with FK to ≤ 2.4e-16, and the UI export is byte-identical to the shipped files.
- All six models render in 3D-model mode (42–99 meshes) and link mode (9–17); the model-mode toggle round-trips; the Professional page reports no `NaN`; workspace CSV exports 3 359 rows with reachable and dexterous points.
- Local preview: `python -m http.server 8123`, then `http://127.0.0.1:8123/`. The jsdom suites require Node; they run in GitHub Actions on every push.

## [3.0.0] — 2026-10-26 — Trust & Polish

The first release positioned as a professional learning product rather than a feature demo.

### Added
- **First-run tour**: a six-step, skippable spotlight tour (welcome → tree → viewport → MDH table → inspector → Learning Center), persisted in `localStorage` and reopenable with `?` or the app-bar help button.
- **Mobile navigation**: a fixed bottom bar (Workspace, Library, Learn, Analyze, More) and a full “All sections” sheet that reaches all 11 pages at 360 px.
- **Viewport HUD**: LIVE MDH chip, X/Y/Z legend and an orbit/zoom hint that never intercepts pointer events.
- **3D boot state**: shimmer and “Initialising 3D workcell…” while WebGL starts, with a timeout fallback.
- **Pointer ripple**, card lift, page transitions, tropical underline, pulsing status dots and animated selected-joint accent.
- **Learning outcomes (A3.3):** a one-line “After this page you can…” banner on all 11 pages.
- **Frame-assignment checklist (A3.4):** eight tickable steps in the Learning Center, with a print button that prints only the checklist.
- **PNG app icons** (192 and 512 px) referenced from `site.webmanifest`.
- **`tests/ui_v3_test.js`**: 12 checks for outcomes, checklist, sanitising, version consistency, release assets and licence.
- **`assets/v3.css`**: a separate motion/visual layer with design tokens, so the inline v2 theme is not rewritten.
- **Static assets**: `favicon.svg`, `site.webmanifest`, `404.html`, `robots.txt`, `sitemap.xml`.
- **`docs/ROADMAP.md`**: the full v3/v4/v5 implementation plan, including visual and motion workstreams.
- **`docs/V3_RELEASE_NOTES.md`**: what changed, how to verify and known limits.

### Changed
- App version, page title, meta description, Open Graph title and app-bar tag now say **v3.0.0**.
- Sidebar label “Inverse Kinematics (2R)” → “Inverse Kinematics”, matching the general DLS solver that already existed.
- The report footer and every export now carry `Ken’s RoboLabs v3.0.0`.
- The app bar gains a subtle elevation after scrolling; the brand logo tilts on hover.
- `README.md` now opens with the product, outcomes and roadmap, and points release history to this changelog.

### Accessibility
- Skip link to `#mainContent`.
- Landmarks and labels for the sidebar/top navigation; `aria-current="page"` stays in sync.
- Polite live regions for IK, dynamics, trajectory, workspace, status and self-test results.
- The toast is a `status` region.
- Accessible names for icon-only buttons.
- Dialog/sheet and tour focus management, Escape to close, focus returned to the trigger.
- Full `prefers-reduced-motion` support and print styles.

### Security
- User-controlled joint names are stripped of `< > & " '` and control characters at every input boundary, and re-checked before every render. This closes the stored-XSS path through crafted share links and JSON imports.
- Tool offsets and base height from share/import are clamped to finite ranges.
- Defence-in-depth `renderAll` wrapper keeps legacy `innerHTML` renderers safe without a v4-scale rewrite.

### Fixed
- Navigation is reachable on phones below 800 px (the sidebar and top nav were both hidden).
- Mobile content no longer sits under the fixed bottom bar.

### Release hygiene
- `LICENSE` now credits Kanishk Patel (the `<YOUR NAME>` placeholder is gone).
- Sample files moved to `docs/examples/`; a byte-identical duplicate PNG was deleted.
- The v2–v7 development log moved from `README.md` to `docs/HISTORY.md`.

### Verification (2026-10-26)
- Engine self-tests 30/30; smoke, audit, features, export, collision, snapshot and v3 suites pass with no JS errors (Node 22, jsdom).

### Known limit found during release verification
- The dynamics simulation (fixed 2 ms RK4) can drift more than 1e-3 in relative energy on some random poses (up to about 4e-3 observed on the UR5-style arm over a 2 s free swing). The earlier “worst 5.5e-4” figure held only for the poses tested then. v3 leaves the engine untouched, so `tests/ui_audit_test.js` now uses a fixed random seed and is reproducible; an adaptive or smaller step for stiff poses is planned for v3.1/v4.

### Notes
- Engine mathematics (FK, IK, Jacobian, dynamics, collision) is unchanged in v3.
- The working tree previously showed `.github/workflows/static.yml` deleted but uncommitted. Decide intentionally: restore it or replace it with a tested Pages workflow in v4.

## [2.0.1] — previous

Export fixes, report layout, 3D image capture, share links and the 16-robot library. See the historical sections in `README.md` for the v2–v7 feature log.
