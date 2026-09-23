# Rules, RTL conventions and design tokens

## Business rules
- **Currency** ₪, integer agorot. Display `₪1,200` (he-IL grouping). Prices on the site are **before VAT**; state "לא כולל מע״מ" next to prices and totals. VAT = 18% (keep configurable).
- **Documents:** every charge → חשבונית מס/קבלה; every refund → חשבונית זיכוי referencing the original. Clinic payments are issued by the clinic; subscriptions and sponsored by BeautyFind.
- **Instalments (תשלומים)** offered where the clinic enables them; show per-instalment amount.
- **Health basket:** aesthetic treatments are not in the סל; mention in pricing FAQs.
- **Deposit:** from `DepositPolicy`; offset against the treatment; refund window default 24h.
- **Consult fee** (default ₪200) offsets the treatment if performed.
- **Gift cards:** validity ≥5 years; 14-day cancellation if unused; not exchangeable for cash; transferable; open balance is a liability.
- **Subscription:** basic ₪149 / advanced + CRM ₪249 per live branch / month; yearly = 10× monthly; no commissions on bookings, deposits or gift cards. Advanced-only features are gated by plan.
- **Booking** is native on BeautyFind with two-way calendar sync (Google, Microsoft, iCal, or the clinic's booking system).
- **Reviews:** Google rating and BeautyFind verified reviews are shown side by side, never merged.
- **Sponsored:** weekly price by region × category (prototype: region base × category factor, rounded to ₪10); 10% off ≥4 weeks; max 2 per list; always tagged "ממומן"; excluded from compare and ranking.
- **Time:** Asia/Jerusalem. Week = Sunday (0) → Saturday. Default hours ראשון–חמישי + short Friday, שבת סגור. Dates `DD/MM/YYYY`, times 24h `HH:MM`.
- **Geography:** 7 regions (צפון, חיפה, שרון, גוש דן, ירושלים, שפלה, דרום), 60+ cities, 14 service categories.
- **Medical:** injectables = medical act (doctor, or nurse under doctor). Cosmeticians may not inject. Responsibility labels: "אחריות רפואית" (doctor) vs "איש מקצוע אחראי" (non-medical).
- **Reviews:** verified visit only; explicit photo consent; no removal for negativity.
- **Accessibility statement** is legally required (Legal → הצהרת נגישות).

## Hebrew & RTL
- Root `dir="rtl" lang="he"`; `text-align:right`; use logical properties in code (`margin-inline-start`, `inset-inline-end`).
- Arrows point **left** for "forward" (`M12 7H2M6 3 2 7l4 4`); back arrows are mirrored.
- Wrap numbers, prices with digits, phones, emails, URLs, codes (`BF-5102`, `NOA-7K4M-29QX`), time ranges and star rows in `<span dir="ltr" style="unicode-bidi:isolate">`. Time ranges must render `08:30–13:00`, not reversed.
- Loop output that mixes Hebrew with latin/number spans must not inject whitespace nodes (keeps the ־ maqaf and punctuation attached).
- Plurals: singular / dual / plural — שעה · שעתיים · N שעות; יום · יומיים · N ימים; פנויה אחת · שתיים פנויות · N פנויות; שבוע אחד · שבועיים · N שבועות.
- Gendered copy: client-facing copy addresses the reader in feminine singular in many flows (the majority audience) and plural in general pages — keep per screen as designed.
- No `text-transform: uppercase`, no wide letter-spacing. Headings: letter-spacing −0.012em to −0.015em.
- Never render a `<select>` whose options come from async data — use chip rows or input + datalist.

## Layout rules
- Breakpoints via `matchMedia` / CSS media queries, never measured widths.
- Root `overflow-x: clip` (not hidden — it breaks `position: sticky`).
- Sticky sidebars only when `min-height` allows (`@media (min-width:1000px) and (min-height:700px)`).
- Explicit grid track counts when item count is known.
- Common widths: public content 1160–1280px; forms 1000–1100px; single-column flows 560–760px. Page padding 16px (<560px) → 22px.
- Main + sidebar: `minmax(0,1fr) 320–380px` at ≥1000px; stacks below.
- Min hit target 44px (chips 38–42px allowed in dense filters).

## Design tokens
### Color
| Token | Hex |
|---|---|
| navy (text, dark surfaces) | `#0C243E` |
| teal (brand accent, focus) | `#14B3C6` |
| deep teal (primary buttons, links) | `#0B7A87` |
| light teal (on-dark accent, selected border) | `#7ED7E1` |
| teal border | `#CDEFF3` |
| tint teal (selected bg) | `#F0FAFB` |
| page bg | `#F6F8F9` / `#FAFBFB` |
| border | `#E6E6E6` · strong `#D4D4D4` · divider `#EDEFF2` · control off `#C9CFD6` |
| body text | `#3E4F62` |
| muted | `#5B6B7B` · subtle `#8A96A3` |
| success | text `#3B6B3F` · bg `#EAF3EA` · border `#CFE3CF` |
| warning | text `#9A5B15` · bg `#FFF8EC` · border `#F1DDB5` |
| danger | text `#A33A31` · bg `#FDEDEC` · border `#F0C9C4` · invalid input `#D98A80` |
| WhatsApp button | bg `#EAF7EF` · border `#BFE6CC` · text `#0E6B3A` · glyph `#1DA851` · hover `#DDF2E5` / `#9ED9B3` |
| disabled primary | `#AFC4C8` |

### Typography
- Display: **Frank Ruhl Libre** 500 — H1 `clamp(25px,3.4vw,38px)` (hero up to 56px), line-height 1.1–1.2.
- UI/body: **Assistant** 400–800 — body 15–16.5px / 1.55–1.75; labels 13px 700; meta 12.5px; buttons 14–16px 700. Hebrew weights run heavier (700 where English used 600).
- Wordmark: **Jost** 300, `beauty` navy + `find` teal + teal `.`, always `dir="ltr"`.
- Numbers: `font-variant-numeric: tabular-nums`.

### Radius · shadow · motion
- Radius: chips/inputs 10–11px · buttons 11–12px · cards 15–18px · hero/cards with media 18–20px · pills 999px.
- Shadows: card hover `0 18px 44px rgba(12,36,62,.10)` · dropdown `0 16px 40px rgba(12,36,62,.16)` · modal `0 24px 60px rgba(12,36,62,.28)` · toast `0 12px 30px rgba(12,36,62,.28)`.
- Motion: enter `opacity 0→1, translateY(7px→0)` 200–250ms ease; pop `scale(.97→1)` 160–200ms; toggles 160ms. Respect `prefers-reduced-motion`.

## Component specs (recurring)
- **Primary button:** bg `#0B7A87`, white 700, radius 12, min-height 46–52; hover bg `#0C243E`; disabled `#AFC4C8`.
- **Secondary:** white bg, 1px `#E6E6E6`, text `#3E4F62` 600. **Destructive:** 1px `#F0C9C4`, text `#A33A31`; confirm = solid `#A33A31`.
- **WhatsApp / phone buttons:** see colors; phone = white, `#D4D4D4` border, navy text, teal handset; icon-only variants 40–44px square-round. Emergency call (Aftercare) solid `#A33A31`.
- **Chip (toggle):** off = white / `#E6E6E6` / `#3E4F62`; on = `#0B7A87` bg, white text; `aria-pressed`.
- **Selectable card (radio):** off white / `#E6E6E6`; on `#F0FAFB` / `#7ED7E1`; `role="radio"`.
- **Checkbox:** 23px, radius 7, 1.5px border; checked teal fill with white check.
- **Switch:** 48–50×28–30, knob 22–24; on `#0B7A87`, off `#C9CFD6`; `role="switch"`.
- **Status pill:** 24–28px high, radius 7–8, 12–12.5px 700, colors from success/warning/danger/neutral (`#F0F3F5` / `#5B6B7B`).
- **Toast:** navy, white 14px 600, bottom-center, 3.2s.
- **Save heart:** 44px circle, `rgba(255,255,255,.92)` + blur, outline navy when off, teal filled + `#CDEFF3` ring when on; stops click propagation.
- **Sponsored tag:** "ממומן" navy pill on image, or bordered neutral tag inline.
- **Tab switcher:** segmented, track `#F0F3F5`, active white with `0 1px 3px rgba(12,36,62,.12)`.
- **Form errors:** one summary line above the submit button (danger colors) + invalid borders `#D98A80`; validation runs on submit, then live.
