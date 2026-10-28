# Marketing services (BeautyFind for Business)

Digital marketing services sold to beauty businesses from `/for-business/marketing`. Nine services, each
orderable online (Stripe Checkout) or by quote request, with post-purchase onboarding, a dashboard view for the
business and an admin queue.

## Pages

| Route | What | Indexed |
|---|---|---|
| `/for-business/marketing` | Hub: all services, price overview, guide, FAQ, general quote form | yes |
| `/for-business/marketing/[service]` | Service page (9 slugs, `src/content/marketing/types.ts`) | yes |
| `/for-business/marketing/[service]/order?package=` | Contact details, then Stripe Checkout | no |
| `/for-business/marketing/order/[token]` | Order page: status, onboarding questionnaire, access steps, timeline | no (private area) |
| `/biz/marketing` | Business dashboard: ordered services and the catalog (follows the billing area) | no |
| `/ops/marketing`, `/ops/marketing/[id]` | Admin: orders queue, order detail, services and prices tab | no |

Service pages are rendered by one template from typed content modules in `src/content/marketing/services/*.ts`
(copy, packages, market price table, onboarding questions, FAQ). The hub groups are in `src/content/marketing/index.ts`.
Common onboarding questions: `src/content/marketing/common.ts`. Local pages (`/for-business/marketing/seo/tel-aviv`)
are the planned next level; `sectionOfPath` in `src/lib/indexing.ts` currently indexes only one level below the hub.

Media: `public/assets/marketing/<slug>.webp` (hero image) and `<slug>.mp4` (5 second silent loop, attached in
`src/content/marketing/index.ts`). Both made with Higgsfield. The video only loads on wide screens without reduced
motion or data saver, and has a pause control.

## Prices and order mode

The prices in the content modules are defaults. `/ops/marketing?tab=services` (full level in the marketing area)
overrides price, setup fee and visibility per package, the order mode per service (`buy`, `quote`, `both`) and
whether the service is on sale. Stored in `marketing_service_configs`; pages revalidate on save (and every 10
minutes). Prices are shown without Israeli VAT, like the platform plans (`PLATFORM_PRICE_NOTE`).

## Orders

`marketing_orders` holds both purchases and quote requests (`kind`). Statuses: quote_requested, quoted,
awaiting_payment, paid, onboarding, in_progress, active, completed, past_due, cancelled. Each order has a secret
`access_token` for its order page, a `timeline` JSON and intake answers in `onboarding`. Guests can order; the
business is linked automatically only when a signed-in owner or staff member orders (and only then is the
business's Stripe customer reused). Guest orders are linked by the admin from the order page in /ops/marketing,
never by the email typed into the form. The onboarding form opens only for paid purchases, and stores only the
questions that order's form asks.

Server code: `src/lib/server/marketing/index.ts` (catalog with overrides, quote requests, checkout, Stripe events,
onboarding, admin status changes, notifications). Public actions: `src/app/for-business/marketing/actions.ts`
(zod, honeypot `company_url`, IP rate limit, 6 per email per day).

## Stripe

Checkout Sessions with inline `price_data` in ILS: `payment` mode for one-off packages (with `invoice_creation` so
a Stripe invoice and PDF exist) and `subscription` mode for monthly packages, with the setup fee as a one-time line
on the first invoice. Everything carries metadata `{ site: 'beautyfind', purpose: 'marketing', orderId }`, on the
session, the subscription and the invoice. `handleMarketingEvent` runs first in `handleStripeEvent`
(`src/lib/server/billing/webhook.ts`) and claims these events before the platform plan handlers, so a marketing
subscription never touches the listing `Subscription` row of the same Stripe customer.

Events used: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`
(cancels the abandoned order),
`customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`. Make sure the webhook
endpoint in the Stripe dashboard sends `checkout.session.async_payment_succeeded` and `checkout.session.expired` too.
Invoices on the shared account are matched to orders by metadata first; the Stripe API is read only for customers
that already have marketing orders, and a failure there never blocks the platform handlers.

Each paid invoice creates a platform `Payment` (purpose `marketing`) and a `Document` (`platform_invoice`). Monthly
plan changes and cancellations are handled by the team (the dashboard links to contact); a customer portal for
marketing subscriptions can come later.

## Messages

Templates in `src/lib/messages/render.ts`: `M_mk_order_paid`, `M_mk_quote_received`, `M_mk_onboarding_received`,
`M_mk_status` (sent from the admin when "notify" is checked). Ops get an SMS alert (`alertOps`) for every quote,
payment, intake and failed charge.

## MCP

Tools in `src/lib/server/mcpTools.ts`: `list_marketing_orders`, `update_marketing_order`, `set_marketing_service`.

## Research

Keyword, competitor and price research (DataForSEO, Israel/Hebrew, October 2026) behind the copy and the default
prices is summarized in the Project doc "BeautyFind for Business: marketing services strategy".
