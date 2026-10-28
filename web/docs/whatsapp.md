# WhatsApp through Twilio

Service notices (booking confirmations, reminders, review requests, gift cards, business notices) go by WhatsApp
from the Twilio account that already sends SMS, and fall back to SMS. Code: `src/lib/server/whatsapp.ts`, routing in
`src/lib/server/deliver.ts`, admin card on /ops/messages ("Twilio · WhatsApp להודעות שירות").

## How a message becomes a template

Meta only allows business-initiated messages from approved templates. Each message the site sends is turned into one
Twilio Content template (`twilio/text`, Hebrew, category Utility, or Marketing for marketing messages): its SMS text
rendered with the sample vars (`src/lib/messages/samples.ts`), where every var that is plain interpolation becomes
`{{1}}`, `{{2}}`, … and the body closes with "צוות BeautyFind" (Meta refuses a body ending in a variable). Codes
(M16) and bodies that are mostly variables are not templated. The button "יצירה ושליחה לאישור, ועדכון סטטוס" creates
missing templates, submits them, refreshes statuses, and makes a new version when the text changed or Meta rejected it.

A send goes by WhatsApp only when the template is approved and the message renders to exactly that template (same
lines and fixed wording); otherwise by SMS. With "WhatsApp קודם גם להודעות SMS" on (default), notices asked as SMS go
by WhatsApp first too. Verification codes keep their own route (Twilio SMS, Messaggio WhatsApp).

## Fallback

- WhatsApp refuses the send (no sender, invalid number): SMS right away, logged with `fallback_from = whatsapp`.
- WhatsApp accepts but cannot deliver (no WhatsApp on the number, blocked): Twilio's status callback reports
  `failed` or `undelivered`, and the SMS is sent once. The SMS text waits on the send row sealed with DATA_KEY
  (`fallback_enc`) and is wiped on the first final status (delivered, read, failed, undelivered).

Delivery reports come on the existing `/api/twilio/status`; WhatsApp adds `read`.

## Setup

1. Twilio Console, Messaging, Senders, WhatsApp senders, Create new sender: pick a Twilio number (or own number),
   Continue with Facebook, create or pick the Meta Business Portfolio (Israfind Group), create a new WABA, verify the
   number by SMS or voice call, confirm. Display name "BeautyFind".
2. /ops/messages: "מספרי WhatsApp בחשבון", pick the number.
3. "יצירה ושליחה לאישור", wait for Meta (minutes to a day), run it again to refresh.
4. Send a test, then turn on "הודעות שירות ב־WhatsApp".

Costs in Israel (Oct 2026): utility template about $0.0053 (Meta) plus $0.005 (Twilio), against $0.2575 per SMS
segment.
