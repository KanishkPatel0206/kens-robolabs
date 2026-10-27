# Ken’s RoboLabs — v3 / v4 / v5 Implementation Plan

Status: **v3 complete** (two external gates open: post-deploy Lighthouse and a two-user pilot). **v4 in progress** — E4.1 single router shipped. Hosted as a static site on **GitHub Pages only**.
Owner: Kanishk Patel (product, UI, integration) · Atharva Bhosale (engine)
Last updated: 2026-10-27

---

## 1. Product direction

Ken’s RoboLabs is a browser-based manipulator-kinematics studio for:

- **Students** learning frames, Modified DH, FK, IK, Jacobians, trajectories and dynamics.
- **Instructors** who need a visual, zero-install lab for lectures and assignments.
- **Working engineers** who need a quick sanity check on a manipulator model before moving to ROS 2, Pinocchio, MuJoCo or MATLAB.

The v3–v5 programme turns the current feature-rich demo into a **professional learning product** without losing the friendly tropical Ken’s RoboLabs identity.

### Guiding principles

1. **Teach the sequence, not just the tool.** Every feature must answer "what should the learner do next?"
2. **Show your work.** Numbers, assumptions, verification and failure reasons stay visible.
3. **Trust is a feature.** Escaped input, reproducible tests, cited data and honest limits.
4. **Motion with intent.** Animation explains a concept (frame, joint, transform); it never decorates for its own sake.
5. **Static-only.** GitHub Pages is the entire runtime: no account, server or database, ever.
6. **One release, one story.** Clear versioning, changelog, roadmap and release notes.

### Hosting model — GitHub Pages only

Every release ships as static files served by GitHub Pages. There is no runtime we operate, no database, no secret and no API we control — and none is planned.

**Hard constraints**

- **Static output only.** The build may use Node/esbuild in GitHub Actions, but the published artifact is HTML/CSS/JS/assets under the repository sub-path.
- **No accounts, no server auth.** Identity, where needed, is a self-declared display name stored locally.
- **Client-side state.** Persistence is `localStorage`/IndexedDB with explicit export/import (JSON), never a remote store.
- **Sharing is by value, not by reference.** Share links, assignment links and presets carry their payload in the URL/hash or in a downloaded file; nothing is uploaded.
- **No multi-user or live features.** Classroom live mode, server-side gradebooks and realtime collaboration are out of scope for this programme.
- **No student PII.** Nothing leaves the browser; instructor exports are files the instructor downloads.
- **Sub-path-safe URLs.** All assets resolve under `https://<user>.github.io/<repo>/`; no root-absolute paths.
- **Offline-capable by default.** The studio and lessons work from a static cache (or a direct `index.html` open) with graceful font fallbacks.
- **Optional, privacy-preserving analytics only** — aggregate counts behind consent, never per-student tracking.

**What this rules out, and the static substitute**

| Wanted | Server-less substitute |
|---|---|
| User accounts / login | No accounts; local profile name + export/import |
| Cloud progress sync | `localStorage` + downloadable progress JSON |
| Instructor dashboard | Assignment link + CSV export the instructor collects |
| LMS deep integration | Downloadable SCORM package and xAPI statement files (no LTI server) |
| Realtime collaboration | Share a self-contained link/file; no live session |
| Server-side grading | Tamper-evident checks run in the browser; evidence is a printable record, not an invigilated exam |

---

## 2. Release map

| Release | Theme | Primary audience | Exit criteria |
|---|---|---|---|
| **v3.0 — Trust & Polish** | Make the existing studio feel professional, safe and usable on every device. | Everyone | No critical accessibility/security defects; mobile navigation works; first-run onboarding; consistent motion system; v3 release notes. |
| **v4.0 — Learn & Teach** | Turn the studio into a structured course with assessment and instructor tools. | Students, instructors | 6 modules with objectives, labs, auto-graded checks, local progress tracking and instructor assignment links — all client-side. |
| **v5.0 — Professional Credibility** | Close the gap to industrial workflows and trusted robotics toolchains. | Engineers, institutions | URDF import, classical/MDH toggle, analytic 6R IK, full inertial parameters, reference validation, downloadable LMS packages. |

---

## 3. Cross-cutting workstreams

| ID | Workstream | v3 | v4 | v5 |
|---|---|---|---|---|
| **A** | Curriculum & assessment | Curriculum skeleton, learning outcomes copy | 6 modules, question bank, mastery tracking | Certification exam, instructor analytics |
| **B** | Robotics depth | Frame-assignment checklist (static) | Guided frame wizard, analytic 6R IK | URDF, classical DH, full inertia, validation |
| **C** | UX, visual & motion | Design tokens, page transitions, viewport HUD, mobile nav, tour | Lesson player, progress rail, lab cards, animated frame build-up | Workspace/planning visuals, singularity ellipsoids |
| **D** | Accessibility | Skip link, ARIA live regions, focus management, reduced motion | Keyboard-complete lessons, captions for animations | WCAG 2.2 AA audit, accessibility statement |
| **E** | Engineering & QA | Sanitised names, mobile nav, external CSS, browser smoke test | Single router/state, ES-module split, Playwright + axe in GitHub Actions, static PR previews | Type checks, coverage thresholds, performance budget |
| **F** | Release & growth | README restructure, CHANGELOG, 404/manifest/robots, roadmap | Landing page, instructor guide, demo video | Citation, SCORM/xAPI docs, accessibility statement |

---

## 4. v3.0 — Trust & Polish

**Goal:** a first-time visitor on a laptop or phone can understand the product, navigate it, and trust it — without reading the README.

### 4.1 Product and content

| # | Task | Detail | Acceptance |
|---|---|---|---|
| A3.1 | Version story | One version string in UI, reports, README and changelog. | `3.0.0` appears consistently. |
| A3.2 | README restructure | What it is, who it is for, quick start, feature tour, roadmap link, history moved to `CHANGELOG.md`. | A new visitor understands the product in 60 seconds. |
| A3.3 | Learning outcomes copy | Add plain-language outcomes to the Learning Center and hero. | Each major page states what the learner can do after it. |
| A3.4 | Frame-assignment checklist | A static, printable checklist that mirrors the guided wizard in v4. | Checklist visible in the Learning Center. |
| A3.5 | Release notes | `docs/V3_RELEASE_NOTES.md` with what changed and how to verify. | Notes published with the release. |

### 4.2 Visual and motion system

| # | Task | Detail | Acceptance |
|---|---|---|---|
| C3.1 | Design tokens | Add surfaces, accent glow, motion durations and easing curves as CSS variables. | No hard-coded animation timings in new components. |
| C3.2 | Ambient background | Soft directional gradients on the paper surface; keep the dot-grid viewport. | No contrast regression; no layout shift. |
| C3.3 | Page transitions | 320 ms fade/translate on section change; stagger-free so it stays fast. | Navigating 10 pages feels continuous. |
| C3.4 | Card and button motion | Hover lift for content cards, press feedback, offset shadows preserved. | No motion on touch-only devices for hover effects. |
| C3.5 | Ripple feedback | Pointer-positioned ripple on primary/gold/nav buttons. | Removed automatically; disabled for reduced motion. |
| C3.6 | Viewport HUD | LIVE chip, axis legend and "drag to orbit · scroll to zoom" hint. | HUD never blocks pointer events. |
| C3.7 | 3D loading state | Shimmer + "Initialising 3D workcell…" until WebGL is ready, with timeout fallback. | No blank canvas on slow devices. |
| C3.8 | Micro-states | Pulsing engine/status dot, selected-joint accent, table/matrix hover, animated tab state. | Motion is subtle and consistent. |
| C3.9 | Reduced motion | All animations respect `prefers-reduced-motion`. | Page is fully usable with motion disabled. |
| C3.10 | Mobile navigation | Bottom bar (Workspace, Library, Learn, Analyze, More) + full-sheet section list. | Every page reachable at 360 px width. |
| C3.11 | First-run tour | Six-step spotlight tour: welcome, tree, viewport, table, inspector, Learning Center. | Skippable, persisted, keyboard operable, re-openable. |

### 4.3 Accessibility

| # | Task | Detail | Acceptance |
|---|---|---|---|
| D3.1 | Skip link | First focusable element jumps to `main`. | Visible on keyboard focus. |
| D3.2 | Navigation semantics | `nav` landmarks, `aria-label`, `aria-current="page"` synced with route. | Screen reader announces current section. |
| D3.3 | Live regions | Results, status and toast exposed as polite live regions. | Solver completion is announced. |
| D3.4 | Focus management | Dialog/sheet focus trap, Escape to close, focus restored to trigger. | No keyboard trap outside dialogs. |
| D3.5 | Icon labels | All icon-only buttons have accessible names. | Axe reports no "button-name" violations. |
| D3.6 | Reduced motion + print | Motion off and print styles hide chrome/HUD. | Print/PDF remains clean. |

### 4.4 Security and correctness

| # | Task | Detail | Acceptance |
|---|---|---|---|
| E3.1 | Name sanitisation | User-controlled joint names stripped of HTML metacharacters at every input boundary and re-checked before render. | Crafted share link/import cannot inject markup. |
| E3.2 | Numeric hardening | Clamp tool offsets/base height from share/import to finite ranges. | Malformed links do not produce `NaN`/`Infinity`. |
| E3.3 | Escape in renderers | Defence-in-depth wrapper around `renderAll`. | XSS regression test passes. |
| E3.4 | Keep engine maths untouched | No changes to FK/IK/dynamics formulas in v3. | Existing 30 engine checks still pass. |

### 4.5 Engineering and release

| # | Task | Detail | Acceptance |
|---|---|---|---|
| E3.5 | External style layer | v3 CSS in `assets/v3.css`; inline JS kept for single-file offline use. | `index.html` remains directly openable. |
| E3.6 | Browser smoke test | Load, navigate all pages, open/close tour and sheet, check console. Run in jsdom (all suites, zero JS errors); a real-Chromium Playwright pass is scheduled for v3.1/v4 CI. | Zero uncaught errors. |
| E3.7 | Static assets | `favicon.svg`, `site.webmanifest`, `404.html`, `robots.txt`, `sitemap.xml`. | All resolve under the GitHub Pages sub-path. |
| E3.8 | Release hygiene | `CHANGELOG.md`, `docs/ROADMAP.md`, `docs/V3_RELEASE_NOTES.md`; LICENSE fixed; Pages deploy + test workflow in `.github/workflows/pages.yml`. | Repository tells a coherent story. |

### 4.6 v3 definition of done

- [x] Mobile navigation reaches all 11 pages.
- [x] First-run tour works with mouse and keyboard and can be skipped.
- [x] Joint names are sanitised; share-link injection is blocked.
- [x] Skip link, live regions, current-page semantics and reduced motion.
- [x] Visual refresh and motion system shipped.
- [x] 404/manifest/robots/sitemap/favicon present.
- [x] README, changelog and roadmap updated.
- [x] Final 30/30 engine checks re-run (Node 22, 2026-10-26); all UI suites also pass.
- [x] Learning-outcome banners on all 11 pages and the printable frame-assignment checklist (A3.3, A3.4).
- [x] `LICENSE` credits Kanishk Patel; repo root cleaned; PNG manifest icons added.
- [ ] Lighthouse mobile ≥ 90 performance / 100 accessibility after deployment.
- [ ] Two-user pilot: one student, one instructor.

---

### Known limits carried out of v3

| Limit | Detail | Planned fix |
|---|---|---|
| RK4 energy drift on stiff poses | Fixed 2 ms step; up to ~4e-3 relative drift observed on random UR5-style poses (typical < 5e-4). The simulation already warns when stiff. | Adaptive step or sub-stepping in v3.1/v4 (engine change, so it needs its own release). |
| No real-browser test run | Suites run in jsdom. | Playwright + axe in CI (E4.4/E4.5). |

---

## 5. v4.0 — Learn & Teach

**Goal:** a student can complete a structured manipulator course in the browser; an instructor can assign it and collect evidence — **entirely on GitHub Pages, with no server, account or database**.

### 5.1 Curriculum

| # | Module | Key lab | Auto-graded checks |
|---|---|---|---|
| M1 | Rotations & homogeneous transforms | Build a transform from R and p; verify against the page | 5 |
| M2 | Frames & DH conventions | Guided frame assignment wizard | 6 |
| M3 | Forward kinematics | Build a 3R chain; match TCP to 1 mm | 5 |
| M4 | Inverse kinematics | Solve 2R analytically; 6R with DLS; choose branch | 6 |
| M5 | Jacobian & singularities | Find a singular pose; compute manipulability | 5 |
| M6 | Trajectories & dynamics | Time-scale a move; check torque and energy | 6 |
| Capstone | Pick-and-place cell | Reach, collision, cycle time, payload | Rubric |

### 5.2 Features

| # | Task | Detail | Static-hosting approach |
|---|---|---|---|
| A4.1 | Lesson player | Left rail of modules, lesson body, lab, checkpoint, next. | Client-side routing; deep-linkable as `#/lesson/M3`. |
| A4.2 | Guided frame wizard | Place z, common normal, x, origin; auto-fill DH row; explain errors. | Runs in-page; no upload or inference call. |
| A4.3 | Question engine | Parameterised templates, tolerance, hints, misconception feedback. | Seeded PRNG so a reload is reproducible; seed travels in the assignment link. |
| A4.4 | Progress store | Versioned `localStorage` schema, per-objective mastery, reset/export/import. | JSON export/import is the only transport; no sync. |
| A4.5 | Instructor mode | Assignment link (robot + target + constraints), class code, CSV export. | Everything encoded in the link or downloaded file; no class server. |
| A4.6 | Analytic 6R IK | Spherical-wrist solver with branch listing and FK verification. | Client-side maths only. |
| A4.7 | Certification exam | Timed, randomised, pass mark, printable evidence. | Timer and state stay local; evidence is a printable page, not an invigilated exam. |

### 5.3 Visual and motion work

| # | Task | Detail |
|---|---|---|
| C4.1 | Progress rail | Animated module progress with completion states. |
| C4.2 | Frame build-up animation | Step-through z-axis → common normal → x-axis → DH row. |
| C4.3 | Lab cards | Before/after mini-diagrams, "what you will prove" line. |
| C4.4 | Checkpoint reveal | Answer → reasoning → worked derivation, staged with reduced-motion support. |
| C4.5 | Tour v2 | Contextual per-module tour (stored locally), replacing the single global tour. |

### 5.4 Engineering

| # | Task | Detail | Status |
|---|---|---|---|
| E4.1 | Router extraction | One page router; DOM-derived page list; the five duplicate `[data-page]` listeners removed. | **Done** — v4 baseline. |
| E4.2 | State store | Single source of truth for joints/preset/tool/selection, versioned snapshots, undo/redo, `localStorage` adapter with export/import. | Next. |
| E4.3 | Module split | `src/engine`, `src/state`, `src/ui`, `src/lessons`; either native ES modules served directly or bundled to static files in CI. Must resolve under the Pages sub-path. | Planned. |
| E4.4 | Test suite | Vitest for logic, Playwright for flows, axe for accessibility — executed in GitHub Actions on Chromium, Firefox and WebKit. | Planned (runs in CI, not locally). |
| E4.5 | CI + Pages | Test → build → deploy; PR preview via a static artifact/Pages environment. No server step. | `pages.yml` exists; extend it. |
| E4.6 | Offline + base-path | Service-worker cache for the studio and lessons; audit every URL against the sub-path; `404.html` fallback for deep links. | Planned. |
| E4.7 | Privacy audit | Assert no third-party requests beyond fonts (and optional consent analytics); publish a one-page data map. | Planned. |

### 5.5 v4 exit criteria

- Six modules playable end-to-end on desktop and tablet.
- Progress survives reload, exports to JSON and re-imports losslessly.
- An instructor can build an assignment link and export attempt data as CSV — with no server.
- Playwright (Chromium, Firefox, WebKit) and axe are green in GitHub Actions.
- The site works from `https://<user>.github.io/<repo>/` with no root-absolute URLs.
- No request carries student data off the device.
- No inline event handlers in new code.

---

## 6. v5.0 — Professional Credibility

**Goal:** an engineer can bring a real manipulator model into the lab, compare it with trusted toolchains, and export it to their workflow.

### 6.1 Robotics depth

| # | Task | Detail | Acceptance |
|---|---|---|---|
| B5.1 | URDF import | Parse links/joints, infer DH, flag unsupported constructs. | UR5/iiwa sample loads and FK matches URDF within 0.1 mm. |
| B5.2 | Classical vs Modified DH | UI toggle with conversion and a side-by-side table. | FK/Jacobian identical after conversion. |
| B5.3 | Full inertial parameters | COM vector and 3×3 inertia tensor per link; motor inertia/gear ratio. | Mass matrix positive-definite across sampled poses. |
| B5.4 | Friction model | Coulomb + viscous + stiction approximation. | Hysteresis demo matches expected sign behaviour. |
| B5.5 | Analytic 6R IK | Spherical wrist, all branches, joint-limit filtering. | Matches DLS on 1,000 random reachable poses. |
| B5.6 | Redundancy | Null-space projection for the 7-DOF arm. | Secondary task improves without moving the TCP. |
| B5.7 | Trajectory v2 | Trapezoidal/S-curve, Cartesian line, blending, jerk limits. | Limit checks pass for every sample. |
| B5.8 | Workspace v2 | Reachable vs dexterous, manipulability ellipsoids, singularity map. | Visual overlay matches computed metrics. |
| B5.9 | Planning demo | RRT-Connect around capsule obstacles. | Finds a collision-free path in the demo cell. |
| B5.10 | Interop | Export URDF, ROS 2/MoveIt SRDF, Pinocchio, MuJoCo, MATLAB/Python. | Round-trip imports cleanly. |
| B5.11 | Validation page | Compare against Pinocchio/Robotics Toolbox; publish max errors and seeds. | Reproducible report in CI. |

### 6.2 Visual and motion work

| # | Task | Detail |
|---|---|---|
| C5.1 | Joint-axis gizmos | Labelled \(z_i\), rotation arrows, frame labels in 3D. |
| C5.2 | Target gizmo | Draggable TCP target with live IK preview. |
| C5.3 | Ghost pose | Translucent start/goal robots and Cartesian path ribbon. |
| C5.4 | Manipulability ellipsoid | Translucent ellipsoid sized by singular values. |
| C5.5 | Collision inspector | Colour-coded capsule pairs and a "why" panel. |
| C5.6 | Planner playback | Scrubbable path with velocity profile. |
| C5.7 | Presentation mode v2 | Lecture annotations, hide answers, laser-pointer style highlight. |

### 6.3 Credibility and compliance

| # | Task | Detail |
|---|---|---|
| F5.1 | Reference citations | Craig, Spong, Corke, Siciliano, vendor datasheets, with links. |
| F5.2 | Data provenance | Each preset states source, assumptions and known deviations. |
| F5.3 | Accessibility statement | WCAG 2.2 AA target, known gaps, contact route. |
| F5.4 | Privacy note | Local-first data, optional consent analytics, no cookies for tracking, no student PII leaving the device. |
| F5.5 | LMS packaging | Downloadable SCORM 1.2 package and xAPI statement JSON. **LTI 1.3 is out of scope** — it requires a hosted tool consumer/server, which GitHub Pages cannot provide. |
| F5.6 | Licensing review | Written confirmation from engine author for commercial distribution. |
| F5.7 | Performance budget | ≤ 250 KB initial JS gzip, ≤ 2.5 s LCP on mid-range mobile. |

### 6.4 v5 exit criteria

- URDF round-trip and FK parity demonstrated on at least three real robots.
- Validation page reproducible in CI with published tolerances.
- All learning content mapped to outcomes and assessment.
- Accessibility and privacy statements published.
- Commercial licensing clarified.
- No v5 feature requires a backend; all interop and LMS output is file-based.

---

## 7. Visual and motion specification

### 7.1 Tokens

| Token | Value | Use |
|---|---|---|
| `--v3-ease` | `cubic-bezier(.22, 1, .36, 1)` | Enter/move |
| `--v3-ease-in` | `cubic-bezier(.4, 0, 1, 1)` | Exit |
| `--v3-fast` | `140ms` | Hover/press |
| `--v3-base` | `240ms` | Cards, tabs |
| `--v3-slow` | `360ms` | Page and sheet |
| `--v3-radius` | `16px` | Panels |

### 7.2 Motion rules

- Animate **opacity and transform only**; never animate layout properties.
- Page transitions ≤ 360 ms; no stagger on dense pages.
- Ripple only on pointer input, never on keyboard activation.
- `prefers-reduced-motion` collapses all durations to 0.001 ms and disables ambient loops.
- Animations must not delay input; overlays use `pointer-events: none` where appropriate.
- The 3D scene keeps its own interaction model; HUD is non-interactive.

### 7.3 Visual hierarchy

1. **Hero** states the page goal and the MDH rule.
2. **Work surface** (tree, viewport, inspector) is always the visual centre.
3. **Analysis** sits below in tabs or panels.
4. **Motion** draws the eye to changed values, then settles.

---

## 8. Test and release checklist (every phase)

### Automated (GitHub Actions)

- [ ] `node tests/run_selftests.js` — 30/30 engine checks.
- [ ] `node tests/ui_smoke_test.js` — 24 UI checks (requires `jsdom`).
- [ ] `node tests/ui_audit_test.js` — geometry/Jacobian/energy/NaN audit.
- [ ] Playwright: load, navigate, tour, mobile sheet, share round-trip.
- [ ] axe-core: no serious/critical violations.
- [ ] Lighthouse: mobile performance/accessibility budgets (post-deploy).
- [ ] Base-path audit: every asset and route resolves under the repo sub-path.

### Local preview (no Node required)

- [ ] `python -m http.server 8123` → http://127.0.0.1:8123/
- [ ] Direct `index.html` open still works as the offline fallback.

### Manual

- [ ] 360 px, 768 px, 1280 px, 1920 px layouts.
- [ ] Keyboard-only pass: skip link → nav → table → inspector → dialog.
- [ ] Reduced-motion pass.
- [ ] Crafted share link with `<img onerror>` in a joint name is rendered as text.
- [ ] Print/PDF report remains clean.
- [ ] Offline: open `index.html` directly; 3D works; fonts fall back.

### Deployment (GitHub Pages)

- **Local check:** `python -m http.server 8123` from the repo root, then open `http://127.0.0.1:8123/`.
- **Production:** push to `main`; `.github/workflows/pages.yml` runs the tests, uploads the static artifact and deploys it to Pages.
- **Artifact:** static files only. No secrets, environment variables or server processes are needed at runtime.
- **Caching:** content-hashed asset filenames (or a version query) per release; `404.html` handles unknown deep links.
- **Rollback:** revert the release commit and re-run the workflow — there is no database migration to undo.

---

## 9. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Adding features to the patchwork increases regressions | High | v4 router/state refactor before new modules (E4.1 done, E4.2 next). |
| Visual effects hurt performance on low-end devices | Medium | Transform/opacity only, reduced motion, Lighthouse budget. |
| Mobility/accessibility claims outpace reality | High | Manual + automated audits; publish known gaps. |
| Preset data mistaken for vendor-accurate models | High | Provenance labels, "educational model" disclaimers, v5 citations. |
| Scope creep in v3 | Medium | v3 is frozen to trust/polish; curriculum waits for v4. |
| Single maintainer bandwidth | High | Small releases, changelog, tests, documented architecture. |
| GitHub Pages limits mistaken for missing features | Medium | Every v4/v5 feature is designed client-side; this document states the substitutes explicitly. |
| Sub-path or deep-link breakage after deploy | High | Relative URLs, `404.html` fallback, base-path audit in CI. |
| Browser-storage loss wipes progress | Medium | Versioned schema, export/import, visible "download progress" action, graceful reset. |

---

## 10. Backlog after v5

- Multi-robot workcell and hand-eye calibration.
- Force/impedance control labs.
- Real hardware bridge (ROS 2 WebSocket) — requires a **local companion app** outside the hosted site; explicitly not part of the Pages build.
- Classroom live mode and polls — out of scope while the product is static-only; substitute is a shared assignment link.
- Localisation (English, Hindi, Marathi).
- Dark/high-contrast theme.
- Mobile-native app shell.
