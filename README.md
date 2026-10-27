# 🌺 Ken’s RoboLabs v3 — Manipulator Kinematics Studio

**🌐 Live demo: https://kanishkpatel0206.github.io/kens-robolabs/**

Ken’s RoboLabs is a browser-based manipulator-robotics studio built around Craig-style **Modified Denavit–Hartenberg** parameters. It pairs a colour-coded editable MDH table and tool frame with a real 3D workcell (prismatic rails, floor and collision checking), 16 robot models, forward and inverse kinematics, an analytic Jacobian, trajectories, workspace analysis, full dynamics and report-ready exports. It runs entirely in the browser; nothing is uploaded.

It is designed as a **learning tool**: every number stays visible, every solver reports why it failed, and the export turns the robot on screen into a worked derivation for a lab report.

## Start here

1. **Open the demo** and let the six-step tour run (press `?` to reopen it).
2. Pick a robot in **Robot Library**, or edit the MDH table directly.
3. Read the transformation chain in **Transformation Matrices** and **Multiplication Steps**.
4. Use **Forward/Inverse Kinematics**, **Jacobian**, **Trajectory**, **Workspace** and **Dynamics** to test the model.
5. Go to **Export & Report** for a printable derivation, LaTeX, Markdown, MATLAB, Python, PNG or CSV.

## v3.0 — Trust & Polish (current release)

v3 adds no new robotics mathematics. It makes the existing studio safe, usable on a phone and presentable to a class or reviewer.

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
| **v5** | Professional Credibility | URDF, classical/MDH toggle, full inertia, analytic 6R IK, validation, LMS export |

The complete task plan — including visual and animation workstreams, acceptance criteria and risks — is in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Run
**Online:** open the live demo above. **Locally:** open `index.html` in Chrome, Edge or Firefox (three.js is bundled in `vendor/`, so 3D works offline; only the Google Fonts are optional, system fonts are the fallback). The v3 visual layer is in `assets/v3.css`; keep it beside `index.html`. `node tests/run_selftests.js` runs the 30 engine checks; `npm i && npm test` runs everything.

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
- Link masses are slender-rod estimates (default 1 kg per link, editable on the Dynamics page). Planar arms lying in the XY plane have zero gravity torque with −Z gravity; choose −Y gravity for a vertical plane.
- Joint-limit-aware numerical IK can still fail near singularities; it then reports the best attempt instead of claiming success.
- Presets are teaching models, not vendor-accurate robots.

## Credits and licence
MIT licensed. © 2026 Kanishk Patel (UI and integration) and © 2026 Atharva Bhosale (RoboLab Web engine). three.js is MIT licensed. See `LICENSE` and `NOTICE.md`.
