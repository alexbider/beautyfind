// Contact form shape and validation. Imported by the client form and the server action,
// so both apply the same rules.

import type { ContactReason } from '@/components/contact/reasons';
import { EMAIL_RE, toE164 } from '@/lib/format';

export const LIMITS = { name: 120, email: 160, phone: 20, extra: 300, msgMin: 20, msgMax: 4000 } as const;

/** Max messages per sender email in a rolling 24 hours. */
export const RATE_LIMIT_PER_DAY = 5;

export interface ContactInput {
  reason: ContactReason;
  name: string;
  email: string;
  phone: string;
  extra: string;
  msg: string;
  consent: boolean;
  /** Honeypot. Hidden from people; bots fill it. */
  website: string;
}

export type FieldKey = 'name' | 'email' | 'phone' | 'msg' | 'consent';

export function validateContact(i: Pick<ContactInput, 'name' | 'email' | 'phone' | 'msg' | 'consent'>): Record<FieldKey, boolean> {
  const phone = i.phone.trim();
  return {
    name: i.name.trim().length >= 2 && i.name.trim().length <= LIMITS.name,
    email: EMAIL_RE.test(i.email.trim()) && i.email.trim().length <= LIMITS.email,
    phone: phone === '' || toE164(phone) !== null,
    msg: i.msg.trim().length >= LIMITS.msgMin && i.msg.trim().length <= LIMITS.msgMax,
    consent: i.consent,
  };
}

export const FIELD_ERRORS: Record<Exclude<FieldKey, 'consent'>, string> = {
  name: 'נדרש שם כדי שנדע למי לענות',
  email: 'כתובת דואר אלקטרוני לא תקינה',
  phone: 'מספר טלפון לא תקין. למשל: 050-1234567',
  msg: `כתבו לפחות ${LIMITS.msgMin} תווים כדי שנוכל להבין את הפנייה`,
};

/** The single summary line under the submit row (design pattern). */
export function summaryError(v: Record<FieldKey, boolean>): string | null {
  const fieldsOk = v.name && v.email && v.phone && v.msg;
  if (!fieldsOk) return 'יש שדות שצריך להשלים לפני השליחה. הם מסומנים למעלה.';
  if (!v.consent) return 'כדי לשלוח את הפנייה יש לאשר את מדיניות הפרטיות.';
  return null;
}

/** A pasted link to a page (full URL, beautyfind domain or a site path) rather than a business name. */
export const looksLikeUrl = (s: string) => /^(https?:\/\/|www\.|\/[^\s]*$)/i.test(s.trim()) || /beautyfind\.co\.il/i.test(s);

export type ContactResult =
  | { ok: true; ref: string | null; reason: ContactReason; email: string }
  | { ok: false; error: 'invalid' | 'rate' | 'server'; message: string };
