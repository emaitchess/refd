---
version: 1.5.3
name: refd
description: >-
  Premium, minimal interface for refd (refd.ai), open-source AI search
  monitoring. Warm near-black and ivory themes, line-built layouts, square
  geometry, restrained scarlet brand moments, an Inter-led display hierarchy,
  Departure Mono machine details, and dither-kit data graphics form one system
  across the public landing page, onboarding, and the analytical dashboard.
  Theme defaults to the operating system and is driven by one shared external
  store.
colors:
  bg: "#080809"                         # light #f7f4f0
  bg-subtle: "#0d0d0f"                  # light #f0ebe6
  bg-elevated: "#0a0a0c"                # light #fffdfa
  bg-card: "rgba(255,255,255,0.025)"    # light rgba(39,28,30,0.025)
  bg-card-hover: "rgba(255,255,255,0.05)" # light rgba(39,28,30,0.05)
  primary: "#f5f3ef"                    # light #181416
  secondary: "#b7b3b0"                  # light #50494c
  muted: "#82808a"                      # light #71676b
  border: "rgba(255,255,255,0.09)"      # light rgba(39,28,30,0.14)
  border-strong: "rgba(255,255,255,0.18)" # light rgba(39,28,30,0.24)
  accent-soft: "rgba(255,255,255,0.06)"  # light rgba(39,28,30,0.06)
  brand-scarlet: "#f02b3a"              # light #c8232f
  brand-scarlet-strong: "#d6202f"       # solid dark-theme CTA face
  brand-soft: "rgba(240,43,58,0.12)"    # light rgba(200,35,47,0.09)
  on-brand: "#ffffff"
  dither-button-text: "#ffffff"         # light #3d0c12
  scrim: "rgba(0,0,0,0.8)"
  shadow: "rgba(0,0,0,0.5)"            # light rgba(71,45,48,0.16)
  success: "#4ade80"                    # light #16a34a
  warning: "#fbbf24"                    # light #d97706
  error: "#f87171"                      # light #dc2626
  info: "#38bdf8"                       # light #0369a1
typography:
  marketing-display:
    fontFamily: Inter
    fontSize: 78px
    fontWeight: 520
    letterSpacing: -0.045em
    lineHeight: 0.98
  secondary-display:
    fontFamily: Inter
    fontSize: 64px
    fontWeight: 400
    letterSpacing: -0.035em
    lineHeight: 1.05
  marketing-section:
    fontFamily: Inter
    fontSize: 52px
    fontWeight: 400
    letterSpacing: -0.04em
    lineHeight: 1.08
  page-title:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: 550
    letterSpacing: -0.025em
    lineHeight: 1.2
  card-title:
    fontFamily: Inter
    fontSize: 17px
    fontWeight: 500
    letterSpacing: -0.015em
  body:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.65
  body-large:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.7
  table:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.4
  stat-value:
    fontFamily: Departure Mono
    fontSize: 28px
    fontWeight: 400
  section-label:
    fontFamily: Departure Mono
    fontSize: 11px
    fontWeight: 400
    letterSpacing: 0.16em
    textTransform: uppercase
  axis-label:
    fontFamily: Departure Mono
    fontSize: 11px
    fontWeight: 400
  button:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 500
rounded:
  none: 0px                             # the only radius; every corner is square
spacing:
  marketing-rail: 1120px
  dashboard-max: 1400px
  sidebar: 240px
  mobile-header: 56px
  desktop-header: 68px
  mobile-gutter: 20px
  desktop-gutter: 32px
  section-y-mobile: 64px
  section-y-desktop: 96px
  card-padding: 20px
components:
  rail:
    width: 1120px
  sidebar:
    backgroundColor: "{colors.bg-card}"
    width: 240px
  card:
    backgroundColor: "{colors.bg-card}"
    padding: 20px
  card-hover:
    backgroundColor: "{colors.bg-card-hover}"
  elevated-illustration:
    backgroundColor: "{colors.bg-elevated}"
    padding: 20px
  stat-value:
    typography: "{typography.stat-value}"
    textColor: "{colors.primary}"
  btn-primary:
    typography: "{typography.button}"
    backgroundColor: "{colors.primary}"
    textColor: "{colors.bg}"
    height: 32px
  btn-brand:
    typography: "{typography.button}"
    backgroundColor: "{colors.brand-scarlet-strong}"
    textColor: "{colors.on-brand}"
    height: 40px                        # 32px compact variant in the fixed header
  btn-secondary:
    typography: "{typography.button}"
    textColor: "{colors.primary}"
    height: 32px                        # accent-soft fill + border-strong hairline
  btn-dither:
    typography: "{typography.button}"
    textColor: "{colors.dither-button-text}"
    height: 40px
  onboarding-progress:
    typography: "{typography.section-label}"
    textColor: "{colors.brand-scarlet}"  # brand-soft fill behind completed steps
  input:
    typography: "{typography.body}"
    backgroundColor: "{colors.bg}"
    textColor: "{colors.primary}"
    height: 40px                        # onboarding minimum; dense dashboard fields may be 36px
  section-label:
    typography: "{typography.section-label}"
    textColor: "{colors.brand-scarlet}"
  table-header:
    typography: "{typography.section-label}"
    backgroundColor: "{colors.bg-elevated}"
    textColor: "{colors.muted}"
  modal:
    backgroundColor: "{colors.bg-elevated}"
  scrim:
    backgroundColor: "{colors.scrim}"
---

# refd Design System

## Purpose

This document is the source of truth for the next refd onboarding and dashboard
UI. The signed-out landing page establishes the visual language. Product
surfaces inherit its warm palette, line-built structure, square geometry,
typographic contrast, and dither texture, then become denser where analytical
work requires it.

refd should feel like **premium instrumentation**: a quiet frame, precise
alignment, direct language, and expressive data. It is technical without
looking like a developer toy, minimal without feeling empty, and distinctive
without relying on ornamental effects.

## Principles

1. **Build with lines.** Shared vertical rails and continuous horizontal
   dividers establish the page. A line begins at an edge and ends at another
   edge or border. It never starts or stops in open space.
2. **Warm monochrome is the foundation.** Near-black and ivory replace generic
   zinc. The frame remains quiet so type and data lead.
3. **Dither is the visual signature.** Charts, selected illustrations,
   contained gradient washes, and a small number of brand CTAs use the same
   ordered-dither texture.
4. **Scarlet is controlled.** Scarlet marks branded moments, marketing section
   labels, and onboarding progress. Analytical dashboard chrome remains
   monochrome because hue already carries data and status meaning.
5. **Typography creates hierarchy.** Inter handles every headline, statement,
   control, and body passage. Departure Mono labels machine-readable details.
   Scale, weight, and spacing create display contrast without italics or a
   third font.
6. **Density follows the task.** Landing and onboarding breathe. Dashboard
   tables and controls are compact, but never reduce essential copy below a
   legible size.
7. **Both themes are first-class.** With no stored choice, follow the operating
   system. A stored user choice wins. Dark and light must preserve hierarchy,
   not merely invert colors.

## Theme Architecture

Theme state lives in the single `useSyncExternalStore` implementation in
`src/app/lib/theme.ts`. Do not introduce component-local theme state. The
pre-paint script and React store must agree so the page never flashes the wrong
theme.

- Default: operating-system preference.
- Stored key: `refd-theme`.
- Toggle placement: landing footer, authenticated sidebar or mobile account
  menu, and any standalone auth surface where the footer is absent.
- Public landing theme changes use visible controls only. Do not register
  global letter-key shortcuts on the landing page.
- The favicon follows the active application theme.
- Landing overscroll uses the active page background so native boundary
  stretch never reveals a contrasting color.

The landing and authentication pages scope the target warm palette through
the shared `BRANDED_THEME_TOKENS`. During the onboarding and dashboard
redesign, promote the shared warm neutral roles into global `@theme` tokens.
Keep brand scarlet contextual rather than making every authenticated `accent`
chromatic.

Scarlet rides the existing semantic roles rather than a parallel token set.
Markup always reads `--color-accent`, `--color-accent-soft`, and
`--color-on-accent`; branded scopes (the landing shell, later the branded
onboarding rail) override those three roles to the scarlet values, and
authenticated surfaces keep the neutral accent. The front-matter
`brand-scarlet`, `brand-soft`, and `on-brand` entries catalog the scarlet
values for those scoped overrides. Do not introduce `--color-brand-*` custom
properties in markup; two competing accent systems is the failure mode this
rule exists to prevent. The one purpose-specific addition is `--color-cta`,
the deeper dark-theme solid CTA face consumed by `.landing-shell .btn-primary`.

## Color

### Warm neutral foundation

| Role | Token | Dark | Light |
|------|-------|------|-------|
| Page base | `bg` | `#080809` | `#f7f4f0` |
| Subtle layer | `bg-subtle` | `#0d0d0f` | `#f0ebe6` |
| Elevated surface | `bg-elevated` | `#0a0a0c` | `#fffdfa` |
| Quiet card | `bg-card` | `white/2.5%` | warm black/2.5% |
| Hover surface | `bg-card-hover` | `white/5%` | warm black/5% |
| Primary text | `primary` | `#f5f3ef` | `#181416` |
| Secondary text | `secondary` | `#b7b3b0` | `#50494c` |
| Muted/meta text | `muted` | `#82808a` | `#71676b` |
| Hairline | `border` | `white/9%` | warm black/14% |
| Strong hairline | `border-strong` | `white/18%` | warm black/24% |
| Shadow | `shadow` | black/50% | warm brown/16% |

Light mode deliberately uses stronger borders and darker supporting text than
a mechanical inversion. The warm page is brighter, so faint gray lines and
labels otherwise disappear.

### Brand scarlet

- `brand-scarlet`: `#f02b3a` dark, `#c8232f` light.
- `brand-scarlet-strong`: `#d6202f`, used for a solid dark-theme CTA face when
  white text requires more contrast.
- `brand-soft`: scarlet/12% dark, scarlet/9% light.
- `on-brand`: white.
- Dither-gradient CTA text: white in dark mode, `#3d0c12` in light mode. The
  light gradient dissolves into the ivory page, so white is not legible there.

Scarlet is allowed for:

- Landing section labels and the primary conversion path.
- Onboarding step progress, selected brand moments, and the final action that
  begins monitoring.
- Contained dither washes in the landing open-source section and footer.
- Landing product illustrations, where red is clearly illustrative rather
  than a live entity mapping.

Scarlet is not allowed for:

- Generic dashboard buttons, active navigation, table selection, or filters.
- Error states. Use the semantic `error` token and pair it with text or an
  icon, even when its hue looks similar.
- Live dashboard brand data. Entity series retain the fixed CVD-safe mapping.

### Data and status colors

Dashboard entity series use the fixed order in
`src/app/lib/chart-colors.ts`:

1. green, workspace brand
2. purple
3. red
4. blue
5. orange
6. pink
7. and later, grey

Never cycle or reorder the mapping within a workspace. Show no more than four
series in a trend chart without an explicit comparison flow. Text stays on
text tokens; series color appears in swatches, marks, and dither fills.

Status colors are `success`, `warning`, `error`, and `info`. Always pair color
with a label, symbol, or icon. Mentioned and cited are independent signals and
must not collapse into one shared status treatment.

## Typography

### Families

The entire product uses exactly two font families:

- **Inter Variable**: navigation, headings, body copy, controls, tables, and
  every display statement. Load the normal variable face from
  `@fontsource-variable/inter`.
- **Departure Mono**: section labels, values, timestamps, deltas, axes, compact
  metadata, and machine identifiers. It is the supporting machine layer, not a
  body or marketing display face.

Do not add a serif, a second sans, or another monospace family. Typographic
contrast comes from size, weight, family, tracking, line height, and careful
line breaks. Display headlines remain upright.

### Scale

| Context | Size | Notes |
|---------|------|-------|
| Marketing hero primary | 78px desktop, 42px mobile | Inter 520, `0.98` line height |
| Marketing hero emphasis | 64px desktop, 34px mobile | Inter 400, `1.05` line height |
| Marketing section | 52px desktop, 34px mobile | 400 weight, tight tracking |
| Onboarding title | 36–44px desktop, 30–34px mobile | one clear task per step |
| Dashboard page title | 22px | 550 weight |
| Card title | 17px | 500 weight |
| Body large | 15px / 1.7 | marketing and onboarding support copy |
| Body | 14px / 1.65 | default product copy |
| Table cell | 13px / 1.4 | figures mono or tabular |
| Section label | 11px mono | uppercase, tracked |
| Compact metadata | 10–11px mono | never essential information below 10px |
| Button | 13px / 500 | labels remain short |

Use sentence case for headings. Navigation and short marketing actions may be
lowercase in copy, but do not apply a blanket CSS text transform. Do not use
700-weight headings. Use `text-balance` for large display headings and control
line breaks intentionally when the composition depends on them.

## Geometry and Borders

### Square corners

All first-party UI has zero radius: cards, buttons, fields, badges, menus,
modals, tooltips, tabs, illustrations, and tables. Do not add `rounded-*`
utilities. Vendored components must be overridden to square geometry at the
call site when necessary.

### Continuous line system

Borders are structural, not decorative.

- Public landing and spacious onboarding surfaces use a centered `1120px`
  maximum rail with `border-x`.
- Every top-level section supplies its own full-width horizontal boundary.
- Internal grid dividers run from one panel edge to the opposite edge.
- A vertical divider terminates at a horizontal divider, not in open space.
- Adjacent panels share one border. Avoid doubled semi-transparent borders.
- Header rails align exactly with section rails.
- Do not use corner brackets, crop marks, detached ticks, or short ornamental
  line fragments.

In analytical views, the content region may expand to `1400px` for tables and
multi-chart layouts. It still follows the same edge-to-edge divider rules.

## Layout

### Landing and branded onboarding rail

- Maximum width: `1120px`.
- Horizontal inset: `20px` mobile, `32px` from `sm` upward.
- Standard section padding: `64px` mobile, `96px` desktop.
- Heading-to-visual gap: `40px` mobile, `48px` desktop.
- Use a two-column split for explanation plus illustration. On mobile, text
  comes first unless the illustration is required to understand it.
- Product illustrations can touch the rail edges so their borders join the
  page grid.
- Avoid repeated full-viewport empty bands. Each section should add new proof,
  a new capability, or a clear next action.

### Dashboard shell

- Fixed `240px` sidebar at desktop widths, collapsible to a `56px` icon rail
  with `⌘+/`. The collapse must survive the migration.
- Dashboard keyboard shortcuts (`g` chords, `shift+?`, `⌘+/`, `t`) are product
  features and remain. The letter-key ban applies to the public landing page
  only.
- Main content maximum: `1400px`, with `24px` gutters.
- Use a 12-column grid with `16px` gaps for page composition.
- Keep page header controls on the same axis as the content below.
- Stat tiles may form a continuous bordered row rather than floating cards.
- Tables and major charts use the full available width when readability
  benefits.
- Below `1024px`, replace the sidebar with the established top bar and drawer.

### Header and mobile navigation

Landing header behavior is canonical:

- Fixed at the top, `56px` mobile and `68px` desktop.
- `border-x` is visible at rest and aligned to the page rail.
- The outer header draws no top border. Its only horizontal rule is the bottom
  border that appears with the scrolled state.
- At the top, the background is transparent and the bottom border is hidden.
- After scrolling begins, add `bg/90`, backdrop blur, and the bottom border in
  a `200ms` transition.
- Mobile wordmark starts at the left. A dither menu icon sits at the right.
- The mobile menu fills the viewport below the header, uses full-width row
  dividers, and behaves as a modal dialog.
- Opening the menu focuses its first menu item. Tab and Shift+Tab loop through
  the menu toggle and menu controls, Escape closes it, and closing restores
  focus to the toggle. The page behind the dialog must not remain reachable by
  keyboard.
- Menu animation combines a short opacity fade with an 8px vertical settle.
  The header stays above the menu in the stacking order.
- Do not show keyboard shortcut badges in public or small-screen navigation.

## Surfaces and Elevation

The system is flat by default. Depth comes from contrast, border, and rare
shadows.

- **Quiet card**: `bg-card` plus `border`. Use for grouped controls and dense
  dashboard content.
- **Elevated illustration**: `bg-elevated`, `border`, and a restrained shadow.
  Use for the primary product preview, selected signal panels, and onboarding
  illustrations that need separation in light mode.
- **Overlay**: opaque `bg-elevated`, `border-strong`, soft shadow, and the
  theme-static scrim with backdrop blur.
- **Sticky header**: translucent background and blur only after scroll.
- Do not lift cards on hover. Interactive rows change fill and border contrast.
- Do not add ambient glows to normal dashboard panels.

## Dither Language

### Dither-kit rules

Dither-kit is the only chart and graph system. Components are vendored under
`src/app/components/dither-kit/` and added by hand. Never run the dither-kit
CLI because registry items co-ship `palette.ts` and `lib.ts`, which would
overwrite the repository's arrow-function codemod. Add only the new file,
convert function declarations to arrow definitions, and add the vendor
`@ts-nocheck` header.

The kit also supplies non-chart identity elements:

- `gradient`: contained background washes.
- `button`: selected ordered-dither brand actions.
- Pixel and palette primitives shared by those components.

### Charts

- Use `gradient` area for the primary brand series and lines for competitors.
- Use `bloom="low"` for normal charts and `off` for repeated sparklines.
- Reserve stronger bloom for at most one focal overview chart.
- Axis labels use 11px Departure Mono and `muted`.
- Grid lines use `border`.
- Every chart states its metric, unit, and time range.
- Fewer than two points shows a collecting-data state, not a degenerate line.
- Landing demo charts may use red consistently as an illustration. Live
  dashboard charts must use the fixed entity mapping.
- In landing comparison graphics, scarlet identifies the illustrative brand
  and grey identifies competitors. Supporting deltas and yes/no values remain
  on normal text tokens instead of turning every positive value scarlet.

### Dither gradient washes

- Keep washes inside the centered rail or the specific box they belong to.
- They never bleed across the entire viewport behind adjacent content.
- Open-source section: red to transparent, upward, `cell={3}`, bloom off,
  approximately `0.21` dark and `0.12` light opacity.
- Footer: the same wash at approximately `0.12` dark and `0.06` light.
- A wash supports content. It must not become the section's dominant color.

### Dither gradient buttons

Use the registry `DitherButton` gradient selectively:

- Hero and final landing `start monitoring` actions.
- The account-creation `start monitoring` submit action.
- Optionally the final onboarding commit action, where no analytical series is
  present.
- `color="red"`, `variant="gradient"`, `bloom="off"`.
- `40px` height, square corners, 13px Inter medium text.
- Text uses `--color-dither-button-text`: white dark, dark red-black light.
- Small header and mobile CTAs stay solid for clarity.
- Dashboard actions stay monochrome.
- Do not use dotted or hatched variants for primary actions. They reduce label
  contrast and add unnecessary noise.

### Shader backgrounds

The public hero may use `@paper-design/shaders-react` dithering:

- Warp shape, 2px cells, slow speed, and no cursor response.
- Current target opacity is approximately `0.75` dark and `0.65` light. Light
  mode uses a softer pink foreground and a stronger neutral radial veil so the
  shader remains visible without reducing text contrast.
- The text region stays calm and high contrast.
- Reduced motion renders a still frame.
- Pause the shader by setting its speed to zero when an `IntersectionObserver`
  reports the hero offscreen. Hidden GPU work is not an acceptable ambient
  cost.
- Shader backgrounds do not appear behind dashboard data or forms.

Do not add ASCII character fields, cursor parallax, film grain, floating beams,
or random background particles. Dither texture already provides identity.

## Components

### Buttons

- **Dashboard primary**: monochrome filled foreground, 32px high, 13px/500.
- **Brand solid**: scarlet face with `on-brand` text, 40px high, with a 32px
  compact variant inside the fixed header rows. Use for small public and
  onboarding conversion actions.
- **Brand dither gradient**: only at the focal conversion points described
  above.
- **Secondary**: `brand-soft` only in branded contexts; otherwise a neutral
  subtle fill plus `border-strong`.
- **Ghost**: text only, secondary to primary on hover.
- **Destructive**: bordered neutral face with `error` text. Never a filled red
  button.
- All buttons compress to `scale(0.98)` on press and retain a visible keyboard
  focus ring.
- The canonical acquisition label is `start monitoring` everywhere. Do not
  alternate with `create account`, `get started`, or `join now` for the same
  action.

### Cards and illustrations

- Cards join the line system where possible. Prefer bordered rows or grids to
  isolated floating rectangles.
- Use `20px` inset for dense dashboard cards and `24–28px` for spacious
  marketing feature content.
- Illustration and copy columns should feel equal in visual weight.
- Dither charts used inside an illustration have equal allocated heights.
- Product previews may use a restrained shadow, but their outer borders must
  still align to the rail.

### Navigation

- Desktop navigation uses 13px Inter and quiet secondary text.
- Active dashboard navigation uses neutral `accent-soft`, not scarlet.
- Icons are `DitherIcon` SVG pixel glyphs in `currentColor`.
- The refd mark is the lowercase `r` dither glyph paired with the lowercase
  wordmark.
- Add new concepts to the bitmap map. Do not import an icon font or general
  stock icon library.
- Keep workspace configuration and personal account management separate.
  Settings owns workspaces and tracked AI surfaces. Account owns profile,
  password, session security, and account deletion.

### Forms

- Onboarding fields: 40px minimum height, 14px Inter, warm page or elevated
  fill, hairline border to `border-strong` on focus.
- Dense dashboard fields may be 36px high.
- Labels use 10px Departure Mono, uppercase, with clear spacing from fields.
- Validation stays inline below the relevant field. Refused transient actions
  use `useToast()`.
- Group related fields with continuous dividers rather than stacking many
  floating cards.
- Do not use placeholder text as the only label.

### Onboarding

Onboarding should feel like the landing page becoming interactive:

- Use the warm palette, `1120px` rail, scarlet step progress, and one dominant
  task per screen.
- Pair explanatory text with a restrained product-native illustration when it
  materially clarifies the step.
- Welcome and completion statements use upright Inter. Departure Mono remains
  limited to the eyebrow, step metadata, and progress details.
- Manual entry remains clear when an AI draft fails.
- Generated content is a draft, never visually presented as immutable truth.
- Enter advances only under the established focus rules. Shift+Enter creates a
  newline. Escape yields to open popovers and draft forms before navigating
  back.
- The final action may use the gradient `start monitoring` button. Intermediate
  actions remain solid or secondary so the finish retains emphasis.

### Dashboard data components

- **Stat tile**: mono metric label, 28px mono value, labeled delta, optional
  dither sparkline.
- **Chart card**: full-width header strip, metric/unit/range, padded plot body,
  explicit legend for multi-series views.
- **Table**: 13px cells, 36px rows, sticky elevated header, full-width
  separators, mono right-aligned numeric columns, accessible sorting,
  pagination, and column resizing through shared table utilities.
- **Side pane**: square elevated right panel over scrim, full width on small
  screens and half width from `sm`; preserve the established enter and exit
  motion.
- **Command overlay**: elevated line-built panel over one scrim, grouped by
  destination or action. Search uses the shared fuzzy-search hook while group
  order remains stable. Arrow keys move, Enter runs, and Escape clears before
  closing. Hide key hints on small screens.
- **Shortcut overlay**: continuous grouped rows with explicit keycaps and one
  visible close control. Keep navigation chords sourced from the shared nav
  table so the sidebar, palette, and shortcut reference cannot drift.
- **Badges**: square mono chips with text. Never use a bare colored dot as the
  only state indicator.
- **Prompt category tag**: square mono label with a restrained static dither
  wash. Canonical buyer-journey categories keep their fixed color everywhere;
  custom categories derive a stable hue from their name. The label stays on a
  text token so color is never the only identifier.
- **Metric help**: unfamiliar analytical terms use the shared dither info icon
  with a short plain-language definition on hover, focus, and tap. Apply it to
  terms such as mention rate, share of voice, average position, first named,
  source gap, and attribution. Obvious labels do not need an icon.
- **Empty state**: state what is happening (`waiting for answers`, `no data`,
  `needs setup`) and offer one relevant next action.

### Untrusted answer content

AI answer content stays escaped or passes through the safe react-markdown path
without raw HTML. Citation URLs must pass the existing http(s) scheme check.
Entity highlighting must use the AST-level scorer-aligned implementation, not
regex replacement on markdown strings.

## Motion

House easing is `cubic-bezier(0.22, 1, 0.36, 1)`. Every motion path supports
`prefers-reduced-motion`.

- Control hover and border transitions: `150–200ms`.
- Header background and border transition: `200ms`.
- Mobile menu: `240ms` opacity plus `320ms` short vertical settle.
- Dashboard content enter: one `300ms` fade-up, no long cascade.
- Landing hero: restrained `700ms` fade-up sequence with small delays and a
  maximum 9px translation.
- Side pane: `250ms` in, `200ms` out.
- Button press: `scale(0.98)`.
- Dither button hover animates only while easing to its new density.
- No cursor-following motion.
- Smooth anchor scrolling is allowed on landing and disabled under reduced
  motion.

## Accessibility

- Essential text never drops below 10px. Body content is 14px or larger.
- Verify contrast in both themes. Translucent dither fills require separate
  label colors when the page beneath changes.
- Focus states are visible and not removed without replacement.
- All focusable elements use a 2px neutral primary outline with a -2px inset
  offset. The shared treatment stays visible without clipping inside rails,
  panes, or tables.
- Buttons perform actions; links navigate. If a vendored native button handles
  client navigation, it must remain keyboard accessible and use an explicit
  click handler.
- Mobile menus and overlays use dialog semantics, contain keyboard focus while
  open, and restore it when closed. Closed menus are inert and hidden from
  assistive technology.
- Escape closes menus, dialogs, and panes as expected.
- Do not communicate state with color alone.
- Reduced-motion users receive stable, complete content rather than missing
  effects.

## Content Style

- Write `refd` in lowercase.
- Describe the product as AI search monitoring. Public copy never pairs `refd`
  with `aeo`.
- Lead with outcomes, then explain the mechanism or proof.
- Keep CTA labels direct and consistent. The primary acquisition phrase is
  `start monitoring`.
- Avoid inflated AI language such as revolutionary, magical, or game-changing.
- Do not use em dashes in UI prose. Use a period, comma, colon, or parentheses.
  The standalone `—` remains valid as a no-data placeholder.

## Do and Don't

### Do

- Use the shared warm neutral tokens and test both themes.
- Align headers, sections, product illustrations, and footer content to the
  same rail.
- Let dividers run edge to edge inside their owning panel.
- Use scarlet sparingly in branded contexts and stable series colors for data.
- Use dither-kit for every graph and chart.
- Keep visual effects inside the box they belong to.
- Use Departure Mono for labels, values, and machine metadata, not marketing
  display copy.
- Preserve square geometry and the lowercase pixel mark.
- Provide clear empty, loading, error, and reduced-motion states.

### Don't

- Do not turn the dashboard chrome scarlet.
- Do not use the landing demo's red chart treatment for live entity data.
- Do not add floating partial lines, corner brackets, or ornamental crop marks.
- Do not allow section widths to fluctuate.
- Do not let gradient washes bleed outside the central rail.
- Do not use rounded corners, stock icon libraries, or generic glass cards.
- Do not use dotted or hatched dither buttons for primary actions.
- Do not use cursor parallax, ASCII fields, film grain, or ambient dashboard
  glows.
- Do not hide important information in 9px low-contrast copy.
- Do not hardcode theme colors in normal markup. Scope exceptional branded
  values through semantic tokens.

## Migration Order

When redoing onboarding and the main dashboard, work in this order:

1. Promote the warm neutral foundation into global theme tokens, update the
   `theme-color` metas and pre-paint script in `index.html` to the warm values,
   and verify the shared theme store in both themes.
2. Build shared `Rail`, section-divider, surface, button, field, and typography
   primitives. Do not reproduce long utility strings per page.
3. Redesign onboarding on the `1120px` branded rail, preserving its resumable
   behavior, manual fallbacks, and keyboard rules.
4. Update the dashboard shell and navigation using monochrome analytical
   chrome.
5. Migrate stat tiles, chart cards, tables, side panes, empty states, and
   settings forms without changing metric semantics or data color mapping.
6. Verify desktop, mobile, dark, light, reduced motion, focus order, overflow,
   and empty/loading/error states before removing the previous styles.

---

> **Tooling.** This file follows the
> [DESIGN.md](https://github.com/google-labs-code/design.md) format. Use Bun for
> repository tooling, for example `bunx @google/design.md lint DESIGN.md`.
> Front-matter values list the dark target first and annotate the light target.
> The prose is authoritative for contextual scarlet use and dashboard series
> mapping.
