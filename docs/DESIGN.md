---
name: Crayon Robotics Lab
colors:
  surface: '#faf8ff'
  surface-dim: '#d9d9e7'
  surface-bright: '#faf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f2ff'
  surface-container: '#ededfb'
  surface-container-high: '#e7e7f6'
  surface-container-highest: '#e1e1f0'
  on-surface: '#191b25'
  on-surface-variant: '#40474f'
  inverse-surface: '#2e303b'
  inverse-on-surface: '#efeffe'
  outline: '#717880'
  outline-variant: '#c0c7d0'
  surface-tint: '#076397'
  primary: '#076397'
  on-primary: '#ffffff'
  primary-container: '#76b9f2'
  on-primary-container: '#004971'
  inverse-primary: '#94ccff'
  secondary: '#9c4238'
  on-secondary: '#ffffff'
  secondary-container: '#ff8e80'
  on-secondary-container: '#77261e'
  tertiary: '#715c12'
  on-tertiary: '#ffffff'
  tertiary-container: '#ccb15f'
  on-tertiary-container: '#554300'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#cde5ff'
  primary-fixed-dim: '#94ccff'
  on-primary-fixed: '#001d32'
  on-primary-fixed-variant: '#004b74'
  secondary-fixed: '#ffdad5'
  secondary-fixed-dim: '#ffb4aa'
  on-secondary-fixed: '#410001'
  on-secondary-fixed-variant: '#7e2b23'
  tertiary-fixed: '#fee089'
  tertiary-fixed-dim: '#e1c470'
  on-tertiary-fixed: '#231b00'
  on-tertiary-fixed-variant: '#574500'
  background: '#faf8ff'
  on-background: '#191b25'
  surface-variant: '#e1e1f0'
typography:
  display-lg:
    fontFamily: Outfit
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Outfit
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Outfit
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Outfit
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  title-md:
    fontFamily: Outfit
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Outfit
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Outfit
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Outfit
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  math-matrix:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 22px
    letterSpacing: -0.02em
  math-subscript:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
  code-badge:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
  label-caps:
    fontFamily: Outfit
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.06em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.25rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-desktop: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system serves advanced undergraduate and graduate robotics engineers navigating forward and inverse kinematics using Craig-style Modified Denavit-Hartenberg (MDH) parameters. Robotics software is historically rigid, sterile, and intimidating; this design system dismantles mathematical fatigue by blending rigorous academic precision with the warm, approachable tactility of an engineer's graph-paper sketchbook.

The visual ethos balances two opposing forces:
1. **Mathematical Exactitude:** Uncompromised clarity for $4 \times 4$ homogeneous transformation matrices, joint variable limits, and canonical Cartesian coordinate frames ($X$-Red, $Y$-Green, $Z$-Blue).
2. **Pedagogical Warmth:** A textured, hand-annotated aesthetic featuring warm parchment surfaces, waxy crayon-tinted states, subtle irregular border rhythms, and pencil-graphite ink lines.

The resulting interface feels like a collaborative workshop bench: professional, mathematically uncompromising, yet visually forgiving and inviting.

## Colors

The palette simulates colored wax crayons marking on heavyweight, archival drafting paper. 

### Core Surfaces & Neutral Inks
- **Paper Canvas (`#FFFDF7`):** Base canvas background evoking heavy vellum sketchbook stock.
- **Card Surface (`#F5F1E8`):** Elevated structural background for panels, inspectors, and matrix cards.
- **Surface Highlight (`#EFE9DC`):** Pressed or active state container color.
- **Border / Drafting Rule (`#E2DDD3`):** Neutral divider and contour tone representing soft pencil guidelines.
- **Deep Charcoal Text (`#30323D`):** Primary drafting ink; soft on the eyes yet stark enough for sub-pixel matrix readability.
- **Graphite Muted (`#6C6F7D`):** Secondary metadata, joint indexing, and coordinate dimension labels.

### Crayon Pigments
- **Sky Crayon (`#76B9F2`):** Primary interactive actions, active joint selections, and selected parameter focus rings.
- **Crayon Coral (`#FF8E80`):** Secondary actions, joint limits/warnings, prismatic offset accents ($d_i$).
- **Sunny Ochre (`#FFE18A`):** Warnings, active matrix cell highlight, rotational twist ($\alpha_{i-1}$) indicators.
- **Fresh Mint (`#A8E6CF`):** Success states, convergent kinematic solvers, link length ($a_{i-1}$) indicators.
- **Playful Violet (`#C8B6F6`):** Joint angle ($\theta_i$) variables, end-effector pose indicators, and auxiliary tooltips.

### Kinematic Standard Coordinate Frames (ISO/Academic Standard)
- **Frame X-Axis (`#EF4444`):** Red normal vector along common normal $x_{i-1}$.
- **Frame Y-Axis (`#10B981`):** Green orthogonal vector completing the right-hand rule frame.
- **Frame Z-Axis (`#3B82F6`):** Blue principal joint axis of motion $z_i$.

## Typography

Typography relies on a stark contrast between approachable geometric sans-serif headings (`Outfit`) and ultra-precise mathematical tabular monospace figures (`JetBrains Mono`).

### Application Rules
- **Structural Text:** `Outfit` drives all interactive prose, modal headings, parameter tooltips, and educational sidebars. Its circular counters mirror the friendly crayon sketch motif while remaining legible at dense UI scales.
- **Mathematical Formulations:** All MDH parameters ($\alpha_{i-1}, a_{i-1}, \theta_i, d_i$), transformation indices (${}^{i-1}T_i$), numeric inputs, and 3D coordinate displays must use `JetBrains Mono`. Monospace alignment ensures matrix rows and columns remain vertically aligned across recalculation cycles.
- **TeX Notation Rendering:** Where KaTeX or LaTeX formulas appear inline, match baseline sizing directly to `body-md` with `JetBrains Mono` variable numerals.

## Layout & Spacing

The system uses an asymmetric three-pane fluid engineering layout designed for continuous spatial manipulation and tabular calculations:
1. **Left Panel (Kinematic Tree & MDH Table):** 360px–420px fixed-width column providing quick entry for link twist $\alpha_{i-1}$, link length $a_{i-1}$, joint angle $\theta_i$, and joint distance $d_i$.
2. **Central Viewport (3D Workcell):** Fluid canvas providing real-time 3D webGL rendering of frame axes, kinematic links, and end-effector trajectories.
3. **Right Drawer (Matrix Inspector & Solvers):** Collapsible 340px inspector displaying compiled ${}^0T_n$ homogeneous transforms, Jacobian matrices, and trajectory logs.

### Responsive Behaviors
- **Desktop ($\ge 1280\text{px}$):** Simultaneous 3-pane layout with 24px outer margins and 20px panel gaps.
- **Tablet ($768\text{px} - 1279\text{px}$):** Central 3D viewport remains dominant; MDH parameter tables and transformation matrices convert into collapsible bottom sheets.
- **Mobile ($< 768\text{px}$):** Tabbed viewport switching between 3D model, MDH table, and matrix outputs. Outer margin snaps to 16px.

## Elevation & Depth

To sustain the paper-and-crayon drafting metaphor, this system abandons digital drop shadows and blurred glassmorphism in favor of **tactile sketch elevation**:

- **Drafting Base (Level 0):** Pure `#FFFDF7` with an optional micro-fine CSS background grid (dot-grid patterned at 16px intervals using `#E2DDD3` at 40% opacity).
- **Physical Cutouts (Level 1):** Panels and cards use `#F5F1E8`, enclosed by a crisp `1.5px solid #E2DDD3` pencil rule. No blurry box shadows.
- **Tactile Paper Lift (Level 2 - Hover/Active):** Dynamic components push a hard, unblurred crayon offset shadow: `box-shadow: 3px 3px 0px 0px #30323D`. This mimics a thick wooden block or thick paper cut-out pressed onto the desk.
- **Floating Overlays & Modals (Level 3):** Grounded by a heavy opaque border `2px solid #30323D` and an offset crayon shadow `5px 5px 0px 0px #76B9F2`.

## Shapes

The geometry mimics organic, rounded hand-cut cards without sacrificing the clean boundaries required for data grids.

- **Standard Cards & Containers:** Configured to `roundedness: 2` (`1rem` / `16px`), softening the corners of complex matrix layouts.
- **Hand-Drawn Crayon Underline Accents:** Section headers and dynamic totals feature an SVG squiggly stroke border or an organic underline (`border-radius: 255px 15px 225px 15px/15px 225px 15px 255px` at 2px height) colored with Sky Blue, Coral, or Sunny Ochre.
- **Matrix Brackets:** Square brackets on $4 \times 4$ matrices feature thick vertical stems (`2.5px solid #30323D`) with inward-facing rounded caps (`4px`), providing instant mathematical legibility.
- **Pills and Badges:** Extreme pill radiuses (`9999px`) for unit toggles, frame tags, and joint state indicators.

## Components

### Buttons
- **Primary Crayon Button:** Background `#76B9F2`, text `#30323D`, border `1.5px solid #30323D`. Hover effect shifts translation `translate(-2px, -2px)` with shadow `2px 2px 0px 0px #30323D`. Active state snaps back to `translate(0, 0)` with shadow collapsed.
- **Secondary Sketch Button:** Background `#FFFDF7`, border `1.5px solid #E2DDD3`, text `#30323D`. Hover applies background `#F5F1E8` and border `#30323D`.
- **Destructive/Reset Action:** Background `#FFFDF7`, border `1.5px solid #FF8E80`, text `#FF8E80`. Hover applies background `#FF8E80` with text `#FFFDF7`.

### MDH Parameter Inputs & Unit Pills
- **Numeric Cells:** Compact numerical fields set in `JetBrains Mono` on `#FFFDF7` with `1.5px solid #E2DDD3`. 
- **Inline Unit Toggle:** Affixed internal unit pill badge (`rad`/`deg` or `mm`/`m`) sitting at the trailing edge of the field. Clicking toggles state with an animated bounce and subtle pastel wash (`#FFE18A` for angular, `#A8E6CF` for linear).
- **Active Editing State:** Border swaps from `#E2DDD3` to `1.5px solid #76B9F2` with an ambient glow replaced by a 2px offset solid wax highlight `#C8B6F6`.

### 4x4 Homogeneous Transformation Matrices
- **Container:** Wrapped inside custom tactile brackets with a soft `#F5F1E8` interior background.
- **Cell Structure:** Grid of 16 monospaced cells formatted to 3 decimal places. 
- **Sub-Matrix Color Coding:**
  - Cells $(0..2, 0..2)$ (Rotational sub-matrix $R$): Highlighted with an ultra-faint wash of `#76B9F2` (10% tint).
  - Cells $(0..2, 3)$ (Position vector $P$): Highlighted with an ultra-faint wash of `#FF8E80` (10% tint).
  - Row $3$ (Perspective & Scale $[0, 0, 0, 1]$): Muted text `#6C6F7D`.

### Chips & Doodle Badges
- **Joint Variable Badges:** Fully rounded pills (`padding: 4px 10px`) indicating joint type: Revolute ($R$) rendered with Lavender outline (`#C8B6F6`), Prismatic ($P$) rendered with Coral outline (`#FF8E80`).
- **Frame Axis Badges:** Micro-pills pinned to 3D gizmo indicators: `$X_i$` badge `#EF4444`, `$Y_i$` badge `#10B981`, `$Z_i$` badge `#3B82F6` with bold white lettering.

### Checkboxes & Segmented Controls
- **Toggle Segments:** Pill-shaped grouped controls on `#F5F1E8`. The active item slides a `#FFFDF7` pebble container into place with `1.5px solid #30323D` and subtle 1px offset drop shadow.
- **Hand-Drawn Checkboxes:** Checkbox inputs are 18px rounded rectangles (`rounded-md`, `4px`) featuring an animated SVG wax-pencil checkstroke upon selection.

## Recent integration pass
- Increased 3D link contrast using saturated, alternating materials and a pale cool viewport background.
- Expanded the built-in robot library with 4R, 5-axis, 6R and Cartesian PPP educational models.
- Added damped least-squares 3D position IK, cubic/quintic trajectory selection with q/qd/qdd plots, and translational Jacobian singularity indicators.
- These additions run in the same Crayon page and use its Modified-DH transform convention; no RoboLab page, iframe, or copied standalone interface is embedded.
