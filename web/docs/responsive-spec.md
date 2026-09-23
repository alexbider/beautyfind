# Responsive layout and app feel: whole site

**Goal:** on phones BeautyFind should feel like an installed native app: a fixed top bar, a bottom tab bar, bottom sheets instead of dropdowns, full-screen step flows with a sticky action bar, instant feedback, and no "desktop page squeezed small" moments. On desktop it stays a spacious website. Everything here is RTL.

**Status:** the designs are responsive (they reflow at the breakpoints below) and already use some app patterns (the mobile CTA bar on Business Profile, the step flows in Booking and Onboarding, toasts, segmented tabs). But the **app shell** (bottom tab bar, bottom sheets, sticky step footers everywhere, PWA install, gestures) is **not yet built** in the prototypes. This document is the spec for it; it overrides per-screen desktop layouts on small viewports.

---

## 1. Breakpoints (one set for the whole product)

The prototypes use slightly different breakpoints per page (620 / 760 / 900 / 960 / 1000 / 1040 / 1080 / 1100). In production, unify them:

| Token | Min width | Layout |
|---|---|---|
| `xs` | 0 | phone (portrait): single column, app shell |
| `sm` | 480px | large phone: 2-up small cards allowed |
| `md` | 768px | tablet / small laptop: 2 columns, side rail optional, still bottom tabs on touch devices |
| `lg` | 1024px | desktop: top nav, content + sidebar (320–380px), no bottom tab bar |
| `xl` | 1280px | wide desktop: max content width 1280px, centred |

Also gate by **height** and **input**:
- `(min-height: 700px)` before making any tall sidebar sticky.
- `(hover: hover) and (pointer: fine)` for hover effects; touch devices get pressed states instead.
- `prefers-reduced-motion: reduce` turns off slide/scale transitions (keep fades ≤120ms).

Detect breakpoints with CSS media queries or `matchMedia`, never by measuring widths.

## 2. The app shell (< 1024px)

```
┌──────────────────────────────┐  ← safe-area-inset-top
│  Top bar (56px, sticky)      │
├──────────────────────────────┤
│                              │
│  Scrolling content           │
│  (padding 16px, bottom pad = │
│   tab bar + action bar)      │
│                              │
├──────────────────────────────┤
│  Sticky action bar (opt.)    │  ← per screen, sits above tabs
├──────────────────────────────┤
│  Bottom tab bar (64px)       │  ← + safe-area-inset-bottom
└──────────────────────────────┘
```

### 2.1 Top bar
- Height 56px, white, 1px bottom border `#E6E6E6` that appears only after scrolling 4px (use a scroll sentinel, not a scroll listener).
- **Root screens:** wordmark (Jost, `dir="ltr"`) on the right, then one or two icon actions (search, notifications) on the left.
- **Pushed screens:** back button on the **right** (arrow pointing right, i.e. mirrored), title centred (Assistant 700, 16px, one line, ellipsis), max one action on the left.
- Large-title variant for root screens: a 28px Frank Ruhl Libre title under the bar that collapses into the bar on scroll.
- Never show the desktop mega-menu or footer navigation inside the shell; the footer becomes a compact "more" page (see tab 5).

### 2.2 Bottom tab bar

| Side | Tabs (RTL order, right → left) |
|---|---|
| Client (guest or logged in) | בית · חיפוש · שמורות · התורים שלי · עוד |
| Business (Dashboard, basic plan) | סקירה · פניות · ביקורות · פרופיל · עוד |
| Clinic (Noa Clinic, advanced plan) | היום · יומן · לקוחות · הודעות · עוד |
| BeautyFind staff (Admin) | not a phone product, show a "best on desktop" notice, but keep it usable |

- Height 64px + `env(safe-area-inset-bottom)`. White, top border `#E6E6E6`, `backdrop-filter: blur(12px)` on a 92% white background.
- Each tab: 24px outline icon + 11.5px label (700), min target 48×48. Active = teal `#0B7A87` with a filled icon; inactive = `#5B6B7B`.
- Badges: red `#A33A31` dot or count (max "9+") for unread messages, new consult requests and waitlist offers.
- Tapping the active tab again scrolls to top; a second tap resets that tab's stack.
- Each tab keeps its own navigation stack and scroll position.
- **Hide** the tab bar during focused flows: Booking, Consult Request, Health Declaration, Checkout (gift card, sponsored), Onboarding, Claim, Staff Invite, Auth. Those flows own the screen and show a close (×) button in the top bar.
- "עוד" opens a page listing Account, Gift Cards, Help, Get Listed / Switch to business, Legal (privacy, terms, accessibility statement), Contact, language, logout.

### 2.3 Sticky action bar
- Sits above the tab bar (or at the very bottom when the tab bar is hidden). 1px top border, white, 12px padding, safe-area aware.
- **Business Profile:** [WhatsApp icon] [Call icon] [קביעת תור, primary, flex 1]. Medical-only clinics: primary = "קביעת ייעוץ".
- **Step flows (Booking, Consult, Declaration, Onboarding, Claim, gift card, Sponsored):** primary button full width (min-height 52px) with the step hint above it in 12.5px muted text; "back" lives in the top bar, not next to the primary.
- **Search results:** "מפה / רשימה" toggle floating pill centred above the tab bar.
- **Saved:** the compare tray replaces the action bar when ≥1 clinic is selected.
- The action bar moves up with the on-screen keyboard (use `visualViewport` / `interactive-widget=resizes-content`), so the primary button is never hidden while typing.

## 3. App-like components (mobile replacements)

| Desktop pattern | Mobile (< 768px) replacement |
|---|---|
| Dropdown / popover menu (filters, sort, branch switcher, role menu) | **Bottom sheet**: 20px top radius, drag handle, snaps to 50% and 90%, swipe down or tap scrim to close, focus trapped |
| Modal dialog (cookie preferences, confirmations) | Bottom sheet (short) or full-screen sheet (forms) |
| Sidebar (booking summary, clinic info, policy) | Collapsible summary card at the top of the step, or a "פרטים" sheet from the action bar |
| Horizontal tabs that overflow | Scrollable segmented control with fade edges; active tab scrolled into view |
| Data tables (Admin, Gift Cards ledger, compare) | Stacked cards (one row = one card), key value first; compare = horizontal swipe between 3 columns with a sticky first column |
| Hover-revealed actions | Always-visible icon buttons or swipe actions on list rows |
| Mega-menu | Search tab + category grid screen |
| Multi-column footer | "עוד" tab page |
| Toast at bottom-centre | Toast above the action bar / tab bar |

### 3.1 Lists and rows
- Full-bleed list rows (no side card borders), 64–72px tall, 16px side padding, 1px dividers inset 16px from the right.
- Swipe actions (RTL: swipe **left-to-right** reveals trailing actions on the left side): Saved → remove; clinic inbox → archive; calendar item → check in.
- Pull to refresh on: התורים שלי, clinic "היום", inbox, consult requests, waitlist queue.
- Infinite scroll with a skeleton row on search and lists; keep "טען עוד" only on desktop.

### 3.2 Cards
- Clinic card on phone: image 16:9 full width, radius 16, save heart top-left, name + rating on one line, category · city, from-price, then WhatsApp/call icon buttons and the primary CTA.
- Horizontal carousels (categories, featured clinics, articles): scroll-snap, card width 78% of the viewport so the next card peeks; the direction follows RTL.

### 3.3 Forms
- One column, labels above fields, inputs 48px tall, 16px font (prevents iOS zoom).
- Correct keyboards: `inputmode="tel"` for phones, `numeric` + `autocomplete="one-time-code"` for OTP, `email`, `decimal` for prices.
- Chips instead of selects; date/time = our own slot grid (never the native picker for booking slots).
- Validation summary above the sticky button + field-level borders, scroll the first error into view (use `element.scrollTo` on the scroll container, not `scrollIntoView`).
- Signature pad (Health Declaration): full width, 180px tall on phones, a "סיבוב המסך לחתימה" hint in landscape.

### 3.4 Step flows
- One step = one screen, with a thin progress bar under the top bar (teal on `#EDEFF2`) and "שלב 2 מתוך 4" in 12.5px.
- Forward slides in from the left (RTL), back slides out to the right; 240ms `cubic-bezier(.2,.7,.2,1)`.
- The draft is saved on every step (resume from the WhatsApp link).
- Success screens are full-screen, with a large check animation (scale .8→1, 220ms), the key facts and two actions stacked.

## 4. Motion, feedback and touch

- **Tap feedback:** every tappable element gets a pressed state (scale .97 or background tint) within 50ms; no 300ms delay (`touch-action: manipulation`).
- **Navigation transitions:** push = slide 24px + fade 200ms; tab switch = cross-fade 120ms; sheet = slide up 260ms with spring-like easing.
- **Optimistic UI:** save heart, check-in, mark as read, and toggle switches update instantly and roll back with a toast on error.
- **Skeletons** instead of spinners for anything over 300ms; keep the layout fixed (no content jumps; reserve image space with `aspect-ratio`).
- **Haptics** (where supported via the PWA wrapper or native shell): light on save / toggle, success on booking confirmed, warning on validation errors.
- **Gestures:** back is an edge swipe from the right edge (RTL); sheets close with a swipe down; image galleries swipe with pinch-zoom.
- `overscroll-behavior: contain` on sheets and inner scroll areas; the body never rubber-bands behind an open sheet.
- Minimum hit target 44×44 (48 preferred on the tab bar and primary actions); 8px minimum spacing between adjacent targets.

## 5. PWA / installability

- Web app manifest: `name` "BeautyFind", `short_name` "BeautyFind", `dir: "rtl"`, `lang: "he"`, `display: "standalone"`, `theme_color: "#0C243E"` (top bar in standalone) or `#FFFFFF` for the light top bar, `background_color: "#F6F8F9"`, maskable icons 192/512.
- Splash: navy background with the wordmark.
- Service worker: cache the app shell, fonts and last-viewed clinic profiles; offline fallback page (reuse States → error) with "the booking will be sent when you're back online" for drafts only (never queue a payment).
- Install prompt: show a custom bottom sheet only after a completed booking or a second visit, never on the first page load.
- Web push (opt-in, after the first booking): reminders, waitlist offers, consult replies. WhatsApp stays the primary channel; push is extra.
- Deep links: `/b/:token`, `/w/:token`, `/review/:token`, `/invite/:token` open in the installed app when present.
- iOS: `apple-mobile-web-app-capable`, status bar style `default`, and handle the notch with `viewport-fit=cover` + safe-area padding.

## 6. Screen-by-screen mobile behaviour

### Client
| Screen | Phone layout |
|---|---|
| Homepage | Large title + search field (opens a full-screen search with recent searches and categories); region chips carousel; category grid 3×n; featured carousel; magazine carousel. No hero image taller than 40vh. |
| Search | Search field in the top bar; filter chips row (scrollable) + "סינון" button → bottom sheet with all filters and a "הצגת N תוצאות" sticky button; list ↔ map pill; map = full screen with a card carousel at the bottom. |
| Region / Directory / Treatments / Treatment Category | Large title, stat chips row, list of clinic cards; long guide text collapsed to 5 lines + "המשך קריאה"; FAQ as accordion. |
| Business Profile | Full-bleed gallery (swipe, counter pill), sticky mini-header with the clinic name after scrolling past the title, section tabs (טיפולים · צוות · ביקורות · פרטים) sticky under the top bar, sticky action bar (WhatsApp · call · book). Hours and address in a "פרטים" sheet. |
| Practitioner | Portrait 1:1 top, license card right under the name, treatment list, sticky action bar (book / consult). |
| Booking | Tab bar hidden; 4 step screens; the treatment list as full-width selectable rows; practitioner as horizontal cards; slots = day strip (scroll-snap) + time grid 3 columns; summary as a collapsible card at the top of step 4. Medical treatment → hands off to Consult Request. |
| Consult Request | Step flow: areas → goal → prior injections → format + slot → phone + consent. |
| Health Declaration | One question per row with כן/לא segmented buttons; "yes" expands the detail field inline; signature step last. |
| Manage Booking | Status pill + big date/time; action bar: העברת מועד (primary) · ביטול (text, danger); contact row as icon buttons. |
| Waitlist offer | Full-screen card with a large countdown; two stacked buttons. |
| Aftercare | Phase segmented control sticky under the top bar; red-flag block always visible with the emergency call button. |
| Receipt | Document card full width; share / download in the top bar action. |
| Review | Step flow: stars → aspects → text → photos → publish settings. |
| Saved | List with swipe to remove; compare tray; compare = swipeable columns. |
| Gift Cards | Buy = step flow with a live card preview pinned at the top (shrinks on scroll); redeem = single field + result card. |
| Account ("התורים שלי" tab) | Upcoming / past segmented control; appointment cards with quick actions; settings under "עוד". |
| Auth | Full screen, phone field → OTP (auto-advance, paste support) → done. |
| Help | Search field in the top bar, topics as a 2-column grid, answers as accordion. |
| Cookie Consent | Bottom sheet above the tab bar on the first visit; preferences = full-height sheet. |
| Legal / About / Standards / Blog / Article | Reading layout: 16px side padding, 17px body, sticky "תוכן העניינים" button that opens a sheet. |

### Business & clinic
| Screen | Phone layout |
|---|---|
| Get Listed | Marketing page; plan cards stacked, the recommended plan (advanced) first on mobile; sticky "רישום העסק" bar after the hero. |
| Onboarding / Claim / Staff Invite | Step flows, tab bar hidden, draft autosave. |
| Dashboard | Tab bar (סקירה · פניות · ביקורות · פרופיל · עוד); KPI cards 2×2; charts full width with a range segmented control; the menu editor as a list → edit sheet. Branch switcher = top bar title tap → bottom sheet. |
| Branches | Branch cards list; "הוספת סניף" = full-screen sheet. |
| Sponsored | Step flow: where → weeks → content → review & pay. |
| Noa Clinic | "היום" tab = today's timeline (next appointment highlighted, one-tap check-in); "יומן" = day view with a swipeable day strip, week view only ≥768px; customers = searchable list → profile screen; settings under "עוד". |
| Clinic Booking | Status stepper as a horizontal progress bar; declaration card first; the primary action (צ׳ק־אין / התחלת טיפול / סיום) in the sticky action bar; clinical form in a full-screen sheet. |
| Consult inbox / Waitlist queue / Gift card desk | List → detail screen (not side by side); actions in the sticky action bar. |

### BeautyFind staff
| Screen | Phone layout |
|---|---|
| Admin / Verification / Moderation | Desktop-first. On phones: list → detail, tables as cards, and every decision behind a confirmation sheet. |

## 7. Performance budgets (mobile, 4G, mid-range Android)
- LCP ≤ 2.5s on the Homepage, Search and Business Profile; INP ≤ 200ms; CLS ≤ 0.05.
- Public pages server-rendered (SEO) and hydrated; app-only screens can be client-rendered behind the shell.
- Images: AVIF/WebP, `srcset`, lazy below the fold, explicit `width`/`height` or `aspect-ratio`.
- Fonts: subset Hebrew + Latin, `font-display: swap`, preload Assistant 400/700 only.
- Route-level code splitting; prefetch the next step of every flow.

## 8. Acceptance checklist (per screen)
- [ ] Works at 360×640, 390×844, 768×1024, 1280×800 and 1440×900, in portrait and landscape.
- [ ] No horizontal scroll at any width (root uses `overflow-x: clip`).
- [ ] Primary action reachable with one thumb (bottom 40% of the screen) on phones.
- [ ] Tab bar hidden in focused flows; back and close behave as specified.
- [ ] Every popover is a bottom sheet under 768px.
- [ ] Keyboard never covers the focused field or the primary button.
- [ ] Safe areas respected (notch, home indicator).
- [ ] Touch targets ≥44px; pressed states present; no hover-only information.
- [ ] RTL: arrows, swipes, carousels and slide transitions mirrored correctly; numbers, phones and codes isolated LTR.
- [ ] Skeletons, empty, error and offline states designed (see the States screen).
- [ ] Screen reader: the tab bar is a `nav` with `aria-current`; sheets use `role="dialog"` + `aria-modal`, return focus on close.
- [ ] Reduced motion respected.
