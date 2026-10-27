# Ken’s RoboLabs v3.0.0 — Release Notes

Released: 2026-10-26
Theme: **Trust & Polish**

v3 does not add new robotics mathematics. It makes the existing studio safe, navigable and presentable enough to put in front of a class or a professional reviewer.

---

## What to try first

1. Open the app and let the **six-step tour** run (or press `?`).
2. Resize the browser to phone width and use the **bottom navigation**; open **More** to reach every section.
3. Rename a joint to `<img src=x onerror=alert(1)>` and confirm it renders as text.
4. Open a share link with the same payload; confirm it is also harmless.
5. Press `Tab` from the top of the page to reach the **skip link**.
6. Enable **Reduce motion** in your OS and confirm transitions stop.

---

## Highlights

### Navigation
- Fixed bottom bar on screens ≤ 800 px: Workspace, Library, Learn, Analyze, More.
- “All sections” sheet with all 11 pages and shortcuts to Tour, Present and Share.
- `aria-current="page"` and active states stay in sync with the existing router.

### Onboarding
- Six spotlight steps: welcome, kinematic tree, 3D workcell, MDH table, inspector, Learning Center.
- Keyboard: `←`/`→` to move, `Enter` on Next, `Esc` to leave; focus is trapped in the card.
- Persisted so it does not reappear; force it with `?tour=1`, disable with `?tour=0`.

### Visual system
- Ambient paper gradients, tropical hero underline, page transitions, card lift, pointer ripples.
- LIVE MDH HUD with axis legend and orbit hint.
- Shimmer boot state for the 3D viewport.
- Animated selected-joint accent, status pulses, table/matrix hover.
- Everything collapses under `prefers-reduced-motion`.

### Accessibility
- Skip link, landmarks, labels, live regions, icon-button names.
- Dialog focus management and focus restoration.
- Print styles that remove chrome, HUD and overlays.

### Learning content
- Every page opens with an “After this page you can…” outcome.
- The Learning Center has an eight-step, printable **frame-assignment checklist**.

### Security
- Joint names are sanitised at the table, inspector, import and share-link boundaries.
- A `renderAll` guard re-sanitises names before any legacy `innerHTML` renderer runs.
- Tool offsets and base height are clamped to finite values.

---

## Verification

### Browser (manual)

- [ ] Load with the console open: no uncaught errors.
- [ ] Navigate all 11 pages on desktop.
- [ ] At 360 px: bottom bar works; More sheet reaches every page; content is not obscured.
- [ ] Tour opens with `?`, can be completed, skipped and reopened.
- [ ] `Esc` closes the sheet and the tour.
- [ ] Renaming a joint with HTML renders as plain text in the tree, table, inspector, dynamics and payload views.
- [ ] A crafted `#s=` share link loads without executing markup.
- [ ] 3D view shows the boot shimmer then the robot.
- [ ] Reduced-motion mode removes transitions.
- [ ] Print preview of the report is unchanged and clean.

### Engine

```bash
npm i
npm test            # everything
node tests/run_selftests.js
node tests/ui_v3_test.js
node tests/ui_smoke_test.js
node tests/ui_audit_test.js
```

Expected: 30/30 engine checks and no UI regressions. These commands require Node 18+.

---

## Known limits in v3

- Dynamics simulation: fixed-step RK4 can drift up to ~4e-3 (relative energy) on some stiff random poses; typical drift is below 5e-4 and the page warns when a motion is stiff.
- The legacy UI remains a set of layered scripts; v4 replaces the router and state layer. v3 adds guards rather than a full refactor.
- The tour is a single global flow; contextual per-module tours arrive in v4.
- Mobile navigation is a bottom bar + sheet, not a native app shell.
- Fonts still load from Google Fonts; the system-font fallback keeps the app usable offline.
- No service worker yet; the app is static and opens directly from `index.html`.
- No LMS/xAPI export yet; that is a v5 task.

---

## Next: v4 — Learn & Teach

- Six modules with objectives, labs and auto-graded checkpoints.
- Guided frame-assignment wizard.
- Analytic 6R IK with branch listing.
- Progress tracking and instructor assignment links.
- Router/state refactor, Playwright and axe in CI.

See [`docs/ROADMAP.md`](./ROADMAP.md) for the complete task plan.

---

## Still to do after deployment

- Run Lighthouse on the live site (target mobile performance ≥ 90, accessibility 100).
- Two-user pilot: one student and one instructor.
- Real-browser (Playwright/axe) pass, scheduled with CI in v3.1/v4.
