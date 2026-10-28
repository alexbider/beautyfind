# Email monitoring (/ops/emails)

Every email the platform sends goes through Resend and is logged in `message_sends` (address masked, body never
stored). The admin area "מעקב מיילים" shows, per email, template, business and audience: delivered, opened, clicked,
replied, bounced or failed, with rates over 7, 30 or 90 days, a per-email event timeline, and the replies inbox.

## How each signal is collected

| Signal | Source | Stored |
|---|---|---|
| Delivery, bounce, complaint, failure, suppression | Resend webhook events | `delivery_status`, `email_events` |
| Opens | `email.opened` (open tracking on the sending domain, tracking subdomain `links.`) | `open_count`, `opened_at`, `last_opened_at` |
| Clicks | `email.clicked` (click tracking rewrites links through `links.`) | `click_count`, `clicked_at`, `last_click_url` (origin and path only, never the query) |
| Replies | `email.received` on the receive-only domain `reply.beautyfind.co.il` | `email_replies`, `reply_count`, `replied_at` |

Opens are an estimate: Apple Mail privacy protection and some security scanners load the pixel automatically. A click
also marks the email as opened.

Each webhook event is stored once in `email_events`, keyed by its Svix id, so retries are never counted twice.

## Recipients

`src/lib/server/emailRecipients.ts` resolves the address at send time: a user who owns or works at a business, a
branch's public email, a business billing email or a linked marketing order contact is `business` (with
`business_id`); other users are `client` or `staff`; the rest is `other`.

## Replies

When `email.replyDomain` is set, each email gets `Reply-To: BeautyFind <r-<token>@reply.beautyfind.co.il>`. The
token (16 random characters, unique per email) finds the email a reply answers; the In-Reply-To header against the
stored Message-ID is the fallback. The reply is fetched from Resend's Received emails API, kept as plain text (no
HTML), and forwarded to `email.forwardTo` (default hello@beautyfind.co.il) from "<sender name> דרך BeautyFind" with the
sender as Reply-To, so answering the forwarded copy reaches the business. Attachments are forwarded by URL; only their
names and sizes are stored. Replies are marked handled on /ops/emails (support role: edit).

The reply domain is a separate subdomain, so the Google Workspace mailbox on the root domain is untouched.

## Setup

/ops/emails, tab "הגדרה", or the MCP tool `email_tracking_setup` (full level). Idempotent. It needs a Resend API key
with Full access and:

1. turns on open and click tracking on the sending domain with tracking subdomain `links`;
2. creates `reply.<domain>` in Resend as receive-only;
3. subscribes the webhook at `/api/resend/webhook` to every event (creates it and stores the secret if missing);
4. once the reply domain verifies, sets `email.replyDomain` so new emails carry tracked reply addresses.

It returns the DNS records still needed (CNAME for `links.`, MX and DKIM for `reply.`). DNS is on Vercel.

MCP: `email_stats`, `list_email_replies`, `set_email_reply_status`, `email_tracking_setup`.
