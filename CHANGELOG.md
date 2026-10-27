# Changelog

All notable changes to Ken’s RoboLabs are recorded here.
The app version is available at `window.APP_VERSION` and in every exported report.

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
