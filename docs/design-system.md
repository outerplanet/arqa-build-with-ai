# Design System

Modern, minimal, and comfortable to read for eight hours at a stretch. Not decorative, not stripped of function.

This document is the **visual foundation**: tokens, palette, type, space, motion, accessibility.
How a screen is assembled from it — which control a task gets, how a form is laid out, what a
table row does, what every input field must declare — is `docs/ui-patterns.md`.

The rule that follows from "minimal but complete": **reduce visual noise, never reduce capability.** Density comes from restraint in colour and border weight, not from hiding features behind menus.

## 1. Token architecture

Three layers. Components use only layer 3.

```text
1. Palette      raw scales      --brand-600, --neutral-200
2. Semantic     roles           --color-canvas, --color-fg-muted, --color-accent
3. Component    local           built from layer 2 in the component
```

**1.1.** Components never reference a palette value directly. `bg-accent`, never `bg-brand-600`.

**1.2.** The dark theme redefines **only layer 2**, in one place in `src/app/globals.css`. No component contains a dark-mode colour.

**1.3.** Every colour has its light definition on bare `:root`. Nothing is defined only inside a media query or a `[data-theme]` block.

**1.4.** Theme resolution has three states: explicit light, explicit dark, and system. An inline script in the root layout applies the stored choice before first paint, so there is no flash.

```css
:root                                            { /* light */ }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"])                { /* dark */ }
}
:root[data-theme="dark"]                         { /* dark */ }
```

## 2. Palette

The palette is called **«Астана»**. It takes its two brand colours from the flag of Kazakhstan:
the sky teal of the field and the gold of the sun. **Light is the default theme** — the product is
used outdoors, on a phone, next to a map — and dark is a full equal, chosen in the toggle or by
the system.

### 2.1. Brand — sky teal

The flag teal is `#00AFCA` (`--brand-500`). It carries the product; it is not sprinkled around.

```text
--brand-50   #E6F8FB
--brand-100  #C6EEF5
--brand-200  #94DFEC
--brand-300  #5CCDE0
--brand-400  #22BCD5
--brand-500  #00AFCA   the flag teal
--brand-600  #008FA6
--brand-700  #007A8F   the light-theme accent fill
--brand-800  #005F70
--brand-900  #034A57
--brand-950  #022E36
```

**2.1.1.** The flag teal is bright, and white text on it measures **2.63:1** — a fail. So in the
light theme the accent fill is the deep teal `--brand-700`, `#007A8F`, which measures **5.02:1**
against white text and still reads as the same hue. The flag teal itself is kept for what is not
text: `--color-accent-bright`, for route lines, markers and decorative rules on the map.

**2.1.2.** In the dark theme the accent is the flag teal itself, with dark text on it
(`#04262D` on `#00AFCA`, **6.05:1**). There the brightness is an asset, not a problem.

**2.1.3.** The light focus ring is `--brand-600`, not the flag teal. A focus ring is a boundary and
needs 3:1; `#00AFCA` on white is 2.63:1, `#008FA6` is 3.83:1. In the dark theme the ring is the
flag teal (6.19:1 on the surface).

**2.1.4.** The accent must not be confusable with the semantic hues of §2.3, because status and action appear side by side — most visibly in the agent activity panel, where success green and danger red sit beside accent-coloured controls. Teal sits in the free zone between success green and info blue.

### 2.1a. Highlight — gold

```text
--gold-400   #FEC50C   the gold of the flag
```

Gold is a **highlight**, not a second accent: the recommended place, the chosen stop, a badge that
must catch the eye. It is always a fill with `--color-fg-on-highlight` text on it — near-black in
both themes — and never text on a light ground, where it measures 1.59:1.

### 2.2. Neutral — cool grey with a trace of teal

Pure grey next to teal reads dirty. A trace of the brand hue in the neutrals makes the whole surface feel intentional.

```text
--neutral-0     #FFFFFF
--neutral-25    #F7FAFB   light canvas
--neutral-50    #F0F5F7
--neutral-100   #E8EFF2
--neutral-150   #DDE6EA
--neutral-200   #D0DBE0
--neutral-300   #B5C3C9
--neutral-400   #93A3AA
--neutral-450   #7E8F97
--neutral-500   #66777F
--neutral-600   #4D5D65   light fg-muted
--neutral-700   #3A4950
--neutral-800   #26343A
--neutral-900   #18262C
--neutral-950   #0F1E24   light fg
--neutral-1000  #081115
```

**2.2.1.** The light canvas is `--neutral-25`, `#F7FAFB`, not white. Cards sit on it in white.

**2.2.2.** The dark canvas is `#0B1418`, not black — pure black plus bright text causes halation. Dark surfaces are `#13222A`, dark text is `#E6F2F5`.

**2.2.3.** `--neutral-450` exists for one token, `--color-fg-subtle`: it measures 3.35:1 on a white surface, the 3:1 that §9 requires of UI text. Anything a person must actually read takes `fg-muted`, not `fg-subtle`.

### 2.2a. Measured contrast

Measured with the WCAG 2.x formula, and enforced by `src/app/globals.spec.ts`.

| Pair | Light | Dark |
|---|---|---|
| `fg` on `canvas` | `#0F1E24` on `#F7FAFB` — 16.26:1 | `#E6F2F5` on `#0B1418` — 16.31:1 |
| `fg` on `surface` | `#0F1E24` on `#FFFFFF` — 17.05:1 | `#E6F2F5` on `#13222A` — 14.25:1 |
| `fg-muted` on `surface` | `#4D5D65` on `#FFFFFF` — 6.84:1 | `#9DB1B9` on `#13222A` — 7.31:1 |
| `fg-subtle` on `surface` (3:1) | `#7E8F97` on `#FFFFFF` — 3.35:1 | `#6F848C` on `#13222A` — 4.15:1 |
| `fg-on-accent` on `accent` | `#FFFFFF` on `#007A8F` — 5.02:1 | `#04262D` on `#00AFCA` — 6.05:1 |
| `accent-fg` on `surface` | `#007A8F` on `#FFFFFF` — 5.02:1 | `#5CCDE0` on `#13222A` — 8.73:1 |
| `accent-fg` on `accent-subtle` | `#007A8F` on `#E6F8FB` — 4.59:1 | `#5CCDE0` on `#0A3640` — 6.98:1 |
| `fg-on-highlight` on `highlight` | `#0F1E24` on `#FEC50C` — 10.72:1 | `#0B1418` on `#FEC50C` — 11.71:1 |

### 2.3. Semantic hues

| Role | Light | Dark |
|---|---|---|
| Success | `#15803D` on `#ECFDF3` | `#5BD68C` on `#0E2A1B` |
| Warning | `#A15C07` on `#FEF6E7` | `#F5B942` on `#2E2109` |
| Danger | `#B42318` on `#FEF3F2` | `#F98080` on `#2E1311` |
| Info | `#175CD3` on `#EFF4FF` | `#84ADFF` on `#111C33` |

Four hues, and adding a fifth needs a reason: each one costs a light value, a dark value, a
tinted ground in both, and a contrast check against all four.

## 3. Semantic tokens

```text
--color-canvas            page background
--color-surface           cards, panels, table rows
--color-surface-raised    popovers, dialogs, dropdowns
--color-surface-sunken    inset areas, code, empty states
--color-overlay           the scrim behind a modal dialog

--color-border            default hairline
--color-border-strong     inputs, dividers that must be seen
--color-border-hover      the edge of a control under the pointer
--color-border-focus      focus ring

--color-fg                primary text
--color-fg-muted          secondary text, labels
--color-fg-subtle         placeholder, disabled
--color-fg-on-accent      text on an accent fill

--color-accent            primary actions
--color-accent-hover
--color-accent-active
--color-accent-subtle     tinted background
--color-accent-fg         accent-coloured text and icons
--color-accent-bright     the flag teal: routes, markers; never under text in light

--color-highlight         gold fill: the recommended or chosen item
--color-fg-on-highlight   text on a highlight fill
```

## 4. Status tokens

Status needs its own vocabulary, and its states must be distinguishable **without relying on
colour alone** — every state also differs in border, fill, or label.

| Token | Meaning | Treatment |
|---|---|---|
| `--status-free` | Available, nothing here yet | Surface, dashed border, accent tint on hover |
| `--status-booked` | Claimed, active | Surface-raised, 3px accent left border |
| `--status-suspended` | Held, but not in effect | Warning tint, dashed border, explicit label |
| `--status-cancelled` | Cancelled | Muted fill, struck-through title |
| `--status-unavailable` | Out of scope | Sunken surface, diagonal hatch |
| `--status-conflict` | Conflict | Danger border and icon |

Rename these to the domain's own words when it has them. What must survive the rename: two
states that mean different things never differ by hue alone. Roughly one man in twelve cannot
tell the danger tone from the warning tone, and a monochrome print cannot tell any of them apart.

**4.1.** "Suspended" must be visually distinct from "booked". That distinction is the whole point
of the status: the slot is taken, but nothing is happening in it.

## 5. Typography

**5.1.** Inter Variable, **served from our own origin**, via `next/font/google` with a system fallback stack.

**A runtime request to a font CDN is prohibited.** It carries the visitor's IP to foreign infrastructure, which contradicts `docs/14-data-protection-and-compliance-kz.md`. `next/font/google` does not make one: it fetches the files at build time, copies them into the application's static output and emits a `@font-face` pointing at our domain. Nothing in the rendered page names Google.

An earlier revision of this line said `next/font/local` and called Google Fonts prohibited outright. The rule it was protecting is about the visitor's request, not about where the file came from months earlier — so the build-time form satisfies it. What it costs instead: the build needs to reach Google once, and the font files are not in the repository. If an air-gapped or bit-reproducible build is ever needed, commit the files and switch to `next/font/local`; the rendered result is identical.

**5.2.** Add a subset for every script the interface actually uses — `cyrillic`, `greek`, `vietnamese`. Without it, those letters fall back to whatever the system has, in the middle of a word.

**5.3.** Scale, in a 14px base:

```text
xs    12px / 16   labels, table meta, badges
sm    13px / 18   secondary text
base  14px / 20   body, tables, forms
md    16px / 24   card titles
lg    18px / 26   section headings
xl    20px / 28   page titles
2xl   24px / 32   dashboard figures
3xl   30px / 38   rare, empty states
```

**5.4.** Weights 400, 500, 600. No 700 in the interface; if something needs more emphasis than 600, the layout is wrong.

**5.5.** Tabular figures (`font-variant-numeric: tabular-nums`) everywhere numbers align: money, counts, times, anything in a column.

## 6. Space, radius, elevation

**6.1.** A 4px grid. Spacing steps: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.

**6.2.** Radius: `sm` 6px (badges, inputs), `md` 8px (buttons, cards), `lg` 12px (dialogs, panels), `full` (avatars, pills).

**6.3.** In light theme, **prefer a border to a shadow**. Shadows are for things that genuinely float: dropdowns, dialogs, drag previews. A page of drop-shadowed cards is the look we are avoiding.

**6.4.** In dark theme, elevation is surface lightness, not shadow. Shadows barely read on a dark ground.

## 7. Density

Administrators work in tables all day.

- Default table row: 40px. Compact toggle: 32px. The choice is remembered per user.
- Form field height: 36px.
- Buttons: 32px small, 36px default, 40px large.
- Page gutter: 24px desktop, 16px tablet, 12px phone.
- Content max width: 1600px; a wide data grid is exempt and scrolls.

## 8. Motion

120–180ms, `ease-out`. Dialogs and popovers fade with a 4px translate; nothing bounces or slides across the screen.

`prefers-reduced-motion: reduce` disables transforms and keeps opacity changes only.

## 9. Accessibility

- Body text meets WCAG AA, 4.5:1. Large text and UI boundaries meet 3:1.
- Focus is always visible: a 2px `--color-border-focus` ring with a 2px offset. Never `outline: none` without a replacement.
- Status is never colour alone. Every state carries a shape, border, or label difference.
- Interactive targets are at least 40×40px on touch.
- Dialogs, menus, and tooltips come from Radix, so keyboard and screen-reader behaviour is correct by construction.

## 10. Components

Built on Radix primitives, styled with Tailwind, living in `src/shared/ui/`.

```text
Button, IconButton, Input, Textarea, Select, Combobox, DatePicker,
TimePicker, Checkbox, Radio, Switch, Badge, Avatar, Tooltip, Popover,
Dropdown, Dialog, Drawer, Tabs, Table, Pagination, Toast, Skeleton,
EmptyState, ErrorState, Callout, Card, Kbd, ThemeToggle
```

**10.0.** `Card` was not in this list and should have been. A bare `<section>` is not a landmark
— it becomes one only when it has an accessible name — so every card on every screen was an
unnamed region until a component owned the heading and the `aria-labelledby` together.

**10.0a.** `Avatar` has no photograph and will not get one: most products have no portraits of the
people in their rows, and a repeated placeholder silhouette is worse than nothing. It is initials
on one of eight grounds, chosen by a hash of the row's id — never of the name, because a person
who changes their name must not change colour in the list. §14's "one accent hue" still holds: the identity
palette carries no meaning and marks nothing, it only lets two adjacent rows differ.

**10.1.** No component kit that copies source into the repository. We own these files.

**10.2.** Every list surface ships its three states: loading (skeleton, not a spinner), empty (with the action that fills it), and error (with a retry). A screen without all three is not finished.

## 11. Page structure

Navigation is flat and each item is one job. Nothing important hides behind a menu.

```text
Dashboard    what needs doing today
<Section>    a list, and the records reached from it
<Section>    ...
Settings     account, branding, rules, users
```

Keep it flat, and keep each item one job. A second level of navigation is a sign that two
products are sharing a shell.


## 12. Branding

**12.1.** If the product is multi-tenant, a tenant uploads its own logo rather than choosing its
own colours.

```text
branding
  owner_id
  logo_asset_id           light backgrounds
  logo_dark_asset_id      optional, for the dark theme
  updated_by_id, updated_at
```

**12.2.** Constraints: SVG or PNG, at most 1 MB, at least 128px on the long edge. Rendered at a
fixed height (28px in the sidebar) with preserved aspect ratio. Without a logo, the name is set in
the brand wordmark.

**12.3.** A per-tenant accent colour is deliberately deferred. It requires contrast validation
against both themes before it can be allowed, and one logo is enough to make a tenant feel at home.

## 13. Theme switching

**13.1.** Three choices: light, dark, system. Stored per user, applied before first paint. With nothing stored, the theme is light (`DEFAULT_THEME` in `src/shared/lib/theme.ts`); "system" follows the operating system.

**13.2.** The toggle sits in the profile menu, not on the main toolbar. It is set once.

**13.3.** Both themes are first-class. Dark is not an afterthought: every screen is reviewed in both, and dense surfaces in particular are checked for status legibility in dark.

## 14. What we are not doing

- No gradients, glassmorphism, or decorative illustration.
- No coloured page backgrounds; colour marks meaning.
- No icon-only navigation. Icons accompany labels.
- No animated dashboard charts.
- No more than one accent hue. Gold is a highlight fill (§2.1a), not a second accent.
