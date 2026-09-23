# App shell foundation (how to use it)

The spec is `docs/responsive-spec.md`. This file lists what already exists so screens reuse it.

## Rules
- Breakpoints (CSS only): `480` sm · `768` md · `1024` lg · `1280` xl. Every stylesheet already uses only these.
- **Shell media query** (top bar, tab bar, action bar, sheets-as-default), written out in CSS:
  `@media (max-width: 767px), (max-width: 1023px) and (hover: none)`
  In TS: `SHELL_MQ` / `SHEET_MQ` from `src/lib/ui/shell.ts` (for `matchMedia` only when behaviour, not layout, must differ).
- Hover styles only under `@media (hover: hover) and (pointer: fine)`. Touch gets pressed states (globals.css already does scale .97 on buttons and links inside the shell).
- Tall sticky sidebars: `@media (min-width: 1024px) and (min-height: 700px)`.
- Toasts, floating pills and FABs: `bottom: calc(var(--bf-float-bottom) + 12px)` so they sit above the tab bar and any action bar.
- Safe areas: `var(--safe-t)`, `var(--safe-b)`. The tab bar and action bar already pad for the home indicator.
- Inputs are 16px below 1024px (globals). Keep them ≥48px tall on phones.
- Wrappers: `.bf-desk-only` (hidden in the shell), `.bf-shell-only` (hidden outside it).
- No em dashes in copy. RTL: numbers, phones and codes in `.ltr`.

## Components (`src/components/shell/`)
| Component | Use |
|---|---|
| `TopBar` | Mobile top bar. `mode="root"` (wordmark + ≤2 icon actions, optional `largeTitle`), `mode="pushed"` (back → + centred `title` + ≤1 action; `backHref` for deep links), `mode="flow"` (back from step 2, × close, `progress={{step,total}}` bar + "שלב 2 מתוך 4"). Renders nothing outside the shell. Render it next to the page's desktop header and add `bf-desk-only` to that header. `SearchIcon` is exported for the common action. |
| `SiteHeader` | Already renders `TopBar` in the shell. Pass `title` (pushed screens), `largeTitle` (root screens), `backHref`. |
| `ActionBar` | Sticky action bar. `hint`, `error`, children = buttons (last child flexes). Fixed above the tab bar in the shell, inline elsewhere (`mobileOnly` hides it on desktop). Rises with the keyboard. Marks `data-bottom-bar`, which pads the page. |
| `BottomSheet` | `open`, `onClose`, `title`, `footer`, `size="auto"|"half"|"full"`. Sheet below 768, centred dialog above. Focus trap, Esc, swipe down, scrim, scroll lock, focus return. Use it for every popover, menu, filter panel and confirmation on phones. |
| `Segmented` | Scrollable segmented control with fade edges; items are links (URL state) or buttons. `sticky` pins it under the top bar. |
| `SwipeRow` | Row with trailing actions (swipe left-to-right in RTL). Buttons stay reachable by keyboard and are always visible with a mouse. |
| `PullToRefresh` | Wrap a list; defaults to `router.refresh()`. |
| `Skeleton`, `SkeletonRow` | Placeholders for anything that loads over 300ms. |
| `haptic('light'|'success'|'warning')` | From `shell/haptics`. Save/toggle → light, booking confirmed → success, validation error → warning. |

## Shell behaviour already wired (root layout)
- Tab bar per area (client / business / clinic) from `TABS` in `src/lib/ui/shell.ts`, hidden in focused flows (`isFocused`). Badges from `/api/shell/badges`. Each tab remembers its last screen and scroll position; tapping the active tab scrolls to top, again resets.
- Page transition: root `template.tsx` (push slide 24px + fade 200ms; fade only on desktop; off with reduced motion).
- Right-edge swipe back on pushed screens (not in flows, not on tab roots).
- "עוד" pages: `/more`, `/biz/more`, `/clinic/more` (`components/more/MoreMenu`).
- PWA: `app/manifest.ts`, icons at `/icons/*`, `public/sw.js` (production only), `/offline`, install prompt sheet (after a paid booking or a second-day visit).
