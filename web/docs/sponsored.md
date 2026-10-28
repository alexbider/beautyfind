# Sponsored placements

A business pays a fixed monthly price for a card in the "ממומן" slider at the top of one page. Ranking, comparison, guide mentions and reviews are never for sale; the slider is separate from the ranked list and always labelled.

## The product

| Page | Page key | Default price (before VAT) |
| --- | --- | --- |
| City + category list, page 1 (`/{region}/{city}/{category}`) | `list:{region}/{city}/{category}` | 499 ₪ / month |
| National treatment page (`/treatments/{category}`) | `treatment:{category}` | 499 ₪ / month |
| Homepage (desktop and phone) | `home` | 999 ₪ / month |

- Up to 10 slots per page (`sponsoredSlotsPerPage`). Cards are shuffled on every load, so no slot is "first". Search results show no sponsored cards.
- Free first month for the first 50 businesses that order (`sponsoredFreeMonthQuota`, counted per business).
- Make-good: a paid month with fewer than 20 profile visits (`sponsoredMakeGoodVisits`) gets 50% off the next month, applied by the daily cron as the Stripe coupon `beautyfind_sponsored_makegood`.
- Auto-renews monthly. Cancel anytime: before the start, or 48 hours or more before it, cancels and refunds in full; later, the slot stays until the end of the paid month.
- One line of up to 60 characters plus an optional featured treatment. Content is checked automatically (`src/lib/sponsoredChecks.ts`) and reviewed by staff before any charge. A medical category (catalog `isMedical`), or the homepage for a branch with medical categories, needs a verified responsible doctor on the branch.
- Every Sunday the owner gets `M22_sponsored_report` with the last 7 days.

Prices, slots, quota and the make-good threshold live in `/ops/settings` → "מקומות ממומנים". Existing campaigns keep the price they were ordered at (`monthlyPriceAgorot`).

## Flow

1. **Order.** The owner picks a page in `/biz/sponsored` (or staff in `/ops/sponsored`, or the MCP tool `create_campaign`). The page must match the branch's city and categories and have a free slot. The slot is held for 24 hours (`holdUntil`) while it waits for review. If Stripe is on and the business has no card, the owner saves one through a Checkout session in setup mode; nothing is charged.
2. **Review.** `/ops/sponsored` recomputes the checks (content, medical doctor, branch live, capacity, open debt). Approve is blocked while a check is "bad". Reject needs a note, ends the campaign and charges nothing.
3. **Activate** (`activateCampaign`). Without Stripe, the campaign runs in manual mode until `startsAt + 1 + freeMonths` months. With Stripe it creates a subscription on the sponsored price, with a trial for the free month or a future start; no card means the phase is "needs card" until one is saved.
4. **Live.** Status approved, `startsAt <= now`, `endedAt` null and `activeUntil > now`. The webhook keeps `activeUntil` on the subscription's period end.
5. **End.** Cancelled, or not renewed: the cron ends campaigns 3 days after `activeUntil` and revalidates the page.

## Billing (Stripe)

Everything carries metadata `{ site: 'beautyfind', purpose: 'sponsored', campaignId }`. The code creates what it needs on first use, so there is nothing to set up by hand:

- products `beautyfind_sponsored_list` and `beautyfind_sponsored_home`;
- prices with lookup keys `beautyfind_sponsored_{list|home}_monthly_{agorot}` (a price change in settings makes a new price; running subscriptions keep theirs);
- the coupon `beautyfind_sponsored_makegood` (50%, once).

The sponsored subscription uses the plan's Stripe customer when there is one, otherwise its own customer, and is never written to the plan subscription row. `handleSponsoredEvent` in the webhook claims sponsored events before the plan handlers; paid invoices become a `Payment` with purpose `sponsored` and a platform invoice document.

## Measurement

- `/api/sponsored/event` takes impressions (card at least 60% on screen) and clicks, same-origin only, bots filtered, rate limited per IP. They are anonymous daily counters in `sponsored_stats`, so they need no consent.
- A contact (call, WhatsApp, booking, navigation) is credited to a campaign only for visitors who allowed analytics: the click stores the campaign in `sessionStorage` and the first contact within an hour carries it.

## Code

- `src/lib/sponsored.ts`: constants, page keys, card data (client-safe).
- `src/lib/server/sponsored/index.ts`: capacity, ordering, review checks, Stripe, webhook, stats, cron.
- `src/components/sponsored/SponsoredSlider.tsx`: the slider and the card.
- `src/app/biz/sponsored`: the owner's builder and placements. `src/app/ops/sponsored`: review queue and staff orders.
- Public rules: `/listing-standards/sponsorship` (`src/components/content/data/standards.ts`), terms in `legal.ts`, help in `src/app/help/content.ts`, the section on `/for-business`.
