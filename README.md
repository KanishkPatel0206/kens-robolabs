# 🌺 Ken’s RoboLabs v6.1 — Manipulator Kinematics Studio

**🌐 Live demo: https://kanishkpatel0206.github.io/kens-robolabs/**

Ken’s RoboLabs is a browser-based manipulator-robotics studio built around Craig-style **Modified Denavit–Hartenberg** parameters. It pairs a colour-coded editable MDH table and tool frame with a real 3D workcell (prismatic rails, floor and collision checking), 16 teaching robots plus **six premade 3D arms**, forward and inverse kinematics, an analytic Jacobian, trajectories, workspace analysis, full dynamics, **URDF import/export** and report-ready exports. It runs entirely in the browser; nothing is uploaded.

It is designed as a **learning tool**: every number stays visible, every solver reports why it failed, and the export turns the robot on screen into a worked derivation for a lab report.

## Start here

1. **Open the demo** and let the six-step tour run (press `?` to reopen it).
2. Pick a robot in **Robot Library**, or edit the MDH table directly.
3. Read the transformation chain in **Transformation Matrices** and **Multiplication Steps**.
4. Use **Forward/Inverse Kinematics**, **Jacobian**, **Trajectory**, **Workspace** and **Dynamics** to test the model.
5. Go to **Export & Report** for a printable derivation, LaTeX, Markdown, MATLAB, Python, PNG or CSV.

## v6.1 — Practice Modules + 3D workspace (current release)

v6 turns the Learning Center into a set of **self-study practice modules** — documentation, a generated quiz and a worked solution for each topic, with no lecture voice and no server — and v6.1 makes the Workspace Analysis page an **interactive 3D reachable volume**:

- **Eight practice modules:** Modified-DH parameters, frame assignment and transform order, forward kinematics, inverse kinematics, the Jacobian and singularities, trajectory smoothness, the reachable workspace, and dynamics with payload.
- **Generated, engine-verified questions.** `engine/practice.js` builds each quiz from the real Modified-DH maths and re-derives every published answer through a *different* code path (forward kinematics, the analytic Jacobian, the closed-form 2R solver, the core trajectory sampler). `PRACTICE.selfTests()` re-derives all 384 generated questions; the worst residual is machine precision. Tolerances are printed on each question.
- **Reference + figures + worked solutions.** Each module ships concise reference notes, figures drawn from its own maths (`tools/gen_figures.js` writes 16 committed SVGs), and a **Show solution** on every question. **Check** grades your answer and per-module progress is remembered in this browser only (`localStorage`).
- **Interactive 3D workspace (v6.1).** The Workspace Analysis page is now a live three.js point cloud of the sampled reachable volume — orbit, zoom, pan, colour by height, labelled X/Y/Z axes and a red ✚ that follows the live TCP. If WebGL is unavailable it falls back to the equal-aspect orthographic canvas, which is also the figure the printable report uses.

**Release docs:** [`CHANGELOG.md`](CHANGELOG.md) · [`docs/ROADMAP.md`](docs/ROADMAP.md)

## v5.0 — Professional Credibility

v5 adds the layer industrial users ask for first, still with no server and no upload:

- **Premade 3D models:** six library arms — UR5-style 6R, PUMA 560-style, IRB 120-style, a 7-DOF redundant arm, a SCARA RRPR and a 2R planar. Each has **both** a link/skeleton view and a detailed 3D model, plus a downloadable URDF; geometry is generated from the real DH parameters, so the kinematics are the trustworthy part.
- **URDF import/export:** infer a Modified-DH table from any URDF one joint at a time (the decomposition residual is reported, so an approximation is never mistaken for an exact match), or export the robot on screen as a URDF that re-imports into the same pose — byte-identical to the shipped `assets/robots/*.urdf`.
- **Professional page:** a live validation harness (57 checks, PASS/FAIL badges), full 3×3 link inertia tensors, the convention reference, trajectory v2 (trapezoidal and jerk-limited S-curve), workspace reachable-vs-dexterous metrics, null-space redundancy, the model catalogue and a provenance/accessibility/privacy statement.
- **Viewport switch:** `Link (skeleton) ↔ 3D model`, remembered between visits, falling back to the skeleton view if the model renderer ever fails.

**Release docs:** [`CHANGELOG.md`](CHANGELOG.md) · [`docs/ROADMAP.md`](docs/ROADMAP.md)

## v3.0 — Trust & Polish

v3 added no new robotics mathematics. It made the studio safe, usable on a phone and presentable to a class or reviewer.

- **Mobile navigation:** bottom bar (Workspace, Library, Learn, Analyze, More) plus an “All sections” sheet that reaches all 11 pages.
- **First-run tour:** six spotlight steps (welcome, tree, viewport, MDH table, inspector, Learning Center) with keyboard support, persisted and reopenable with `?`.
- **Visual refresh and motion:** ambient paper gradients, page transitions, tropical hero underline, card lift, pointer ripples, LIVE MDH viewport HUD, 3D boot shimmer, animated joint/status states — all disabled under `prefers-reduced-motion`.
- **Accessibility:** skip link, landmarks, `aria-current`, polite live regions, labelled icon buttons, dialog focus management, print styles.
- **Security:** joint names are sanitised at the table, inspector, import and share-link boundaries, with a render guard as defence-in-depth.
- **Learning outcomes and checklist:** every page states what you can do after it, and the Learning Center has a printable frame-assignment checklist.
- **Release assets:** `favicon.svg`, PNG app icons, `site.webmanifest`, custom `404.html`, `robots.txt`, `sitemap.xml`.

**Release docs:** [`CHANGELOG.md`](CHANGELOG.md) · [`docs/V3_RELEASE_NOTES.md`](docs/V3_RELEASE_NOTES.md) · [`docs/ROADMAP.md`](docs/ROADMAP.md)

### Roadmap at a glance

| Release | Theme | Outcome |
|---|---|---|
| **v3** | Trust & Polish | Safe, accessible, mobile-ready studio with onboarding |
| **v4** | Learn & Teach | Six-module course, auto-graded labs, progress, instructor mode |
| **v5** | Professional Credibility | Premade 3D models, URDF import/export, full inertia, validation harness, workspace v2, redundancy |
| **v6** | Practice Modules | Self-study Learning Center: reference + engine-verified quizzes + worked solutions, corrected workspace plot |
| **v6.1** | 3D Workspace | Workspace Analysis is an interactive 3D reachable volume (orbit/zoom/pan, height colour, live TCP), with the orthographic canvas as the WebGL fallback and report figure |

The complete task plan — including visual and animation workstreams, acceptance criteria and risks — is in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Run
**Online:** open the live demo above. **Locally:** open `index.html` in Chrome, Edge or Firefox (three.js is bundled in `vendor/`, so 3D works offline; only the Google Fonts are optional, system fonts are the fallback). Keep `assets/` (the `v3`/`v5`/`practice` visual layers and `assets/robots/*.urdf`) and `engine/` beside `index.html`. `node tests/run_selftests.js` runs the 30 engine checks; `npm i && npm test` runs the engine, the jsdom UI suites and the v5/practice checks.

**Share a robot:** press **🔗 Share** to copy a link that contains your whole robot, for example `https://kanishkpatel0206.github.io/kens-robolabs/#s=…`.

> **Release history:** the earlier v2–v7 development log now lives in [`docs/HISTORY.md`](docs/HISTORY.md). New changes go in [`CHANGELOG.md`](CHANGELOG.md); the forward plan lives in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Publish on GitHub Pages
This project is published from the `main` branch root. To publish your own copy:
1. Create a repository and upload **the contents of this folder** (keep `index.html` at the repository root, with `vendor/` beside it).
2. Keep `LICENSE` (it already credits the authors; add your own line if you modify it).
3. In the repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save.**
4. After about a minute the site is live at `https://<user>.github.io/<repository>/`.
The site is fully static: no build step and no server. All paths are relative, so it works under a `/repository/` sub-path.

## Notes and limits
- Units on the page stay mm/degrees; the engine works in m/rad internally.
- Premade 3D models are **procedurally generated** from the DH parameters, not manufacturer CAD assemblies; the URDF files are the machine-readable artefact and the numbers are the trustworthy part. Model names say “-style” for that reason.
- URDF export follows the Modified (Craig) DH convention: each joint origin is the zero-configuration DH transform and the `theta` column carries the live joint angle, so an exported file matches this app's DH table and the shipped `assets/robots/*.urdf`. Import reports the DH-decomposition residual instead of silently approximating.
- `engine/v5.js`, `assets/v5.js` and `assets/v5.css` are optional layers: if they fail to load, the studio falls back to the link/skeleton view and the Professional page says the layer is unavailable.
- Link masses are slender-rod estimates (default 1 kg per link, editable on the Dynamics page). Planar arms lying in the XY plane have zero gravity torque with −Z gravity; choose −Y gravity for a vertical plane.
- Joint-limit-aware numerical IK can still fail near singularities; it then reports the best attempt instead of claiming success.
- Presets are teaching models, not vendor-accurate robots.

## Credits and licence
MIT licensed. © 2026 Kanishk Patel (UI and integration) and © 2026 Atharva Bhosale (RoboLab Web engine). three.js is MIT licensed. See `LICENSE` and `NOTICE.md`.
