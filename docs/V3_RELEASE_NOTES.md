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

### Automated suite

```bash
npm i
npm test            # engine + all seven UI suites
```

Result on 2026-10-26 with **Node 24.22.1** and **jsdom 30.1.3**:

| Suite | Checks |
| --- | --- |
| Engine self-tests | 30/30 |
| Smoke | 24/24 |
| Audit | 14/14 |
| Features | 20/20 |
| Export | 19/19 |
| Collision | 10/10 |
| Snapshot | 13/13 |
| v3 release checks | 12/12 |
| **Total** | **142/142** |

No JavaScript errors were reported by any suite.

### Lighthouse (desktop, local static server)

| Category | Score |
| --- | --- |
| Accessibility | 100 |
| Best Practices | 100 |
| SEO | 100 |

No failures.

### Layout matrix

Tested at 360, 390, 768, 800, 801, 900, 1000, 1001, 1100, 1101, 1280 and 1440 px:

- no horizontal document overflow;
- no app-bar overflow (top tabs hidden at ≤ 1100 px, where the sidebar or its tablet strip carries navigation);
- 44 px bottom-nav targets at 360 px;
- the “All sections” sheet and tour card both fit inside a 360 px viewport;
- all 11 pages render with their outcome banner, and the 3D engine stays live.

### Browser (manual)

- [x] Load with the console open: no uncaught errors.
- [x] Navigate all 11 pages on desktop.
- [x] At 360 px: bottom bar works; More sheet reaches every page; content is not obscured.
- [x] Tour opens with `?`, can be completed, skipped and reopened.
- [x] `Esc` closes the sheet and the tour.
- [x] Renaming a joint with HTML renders as plain text in the tree, table, inspector, dynamics and payload views.
- [x] A crafted `#s=` share link loads without executing markup.
- [x] 3D view shows the boot shimmer then the robot.
- [x] Reduced-motion mode removes transitions.
- [x] Print preview of the report is unchanged and clean.

The suite requires Node 18+ (`npm i` installs jsdom).

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

- Point the live GitHub Pages URL at this repository and re-run Lighthouse there (local desktop already scores 100/100/100).
- Two-user pilot: one student and one instructor.
- Real-browser (Playwright/axe) pass, scheduled with CI in v3.1/v4.
- Add a mobile Lighthouse/performance run once the site is hosted.
