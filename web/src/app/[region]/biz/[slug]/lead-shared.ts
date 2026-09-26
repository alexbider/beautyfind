// Contact-form validation shared by the profile popup (client) and its server action.

import { z } from 'zod';
import { EMAIL_RE, IL_PHONE_RE, toE164 } from '@/lib/format';

export const LEAD_LIMITS = { name: 80, phone: 20, email: 160, treatment: 120, message: 1000 } as const;

/** Leads per phone or email per branch in a rolling 24 hours. */
export const LEAD_RATE_LIMIT = 3;

/** Timeline text written to LeadEvent (kind `form`) when the business was emailed. */
export const LEAD_EVENT_TEXT = 'פנייה מהטופס בפרופיל, נשלח דוא״ל לעסק';
export const LEAD_EVENT_TEXT_NO_EMAIL = 'פנייה מהטופס בפרופיל, לעסק אין כתובת דוא״ל לשליחה';

export interface LeadInput {
  branchId: string;
  name: string;
  phone: string;
  email: string;
  treatment: string;
  message: string;
  /** Honeypot. Humans never see it; bots fill it. */
  website: string;
  /** Treatment id the request is about (quote requests from the services accordion). */
  serviceId?: string;
}

export type LeadField = 'name' | 'phone' | 'email' | 'contact' | 'treatment' | 'message';

const validPhone = (v: string) => IL_PHONE_RE.test(v.trim()) || (v.trim().startsWith('+972') && toE164(v) !== null);

/** Field errors in the order they appear in the form. Empty object = valid. */
export function leadErrors(v: Omit<LeadInput, 'branchId' | 'website'>): Partial<Record<LeadField, string>> {
  const e: Partial<Record<LeadField, string>> = {};
  const name = v.name.trim();
  const phone = v.phone.trim();
  const email = v.email.trim();
  if (name.length < 2) e.name = 'נא למלא שם';
  else if (name.length > LEAD_LIMITS.name) e.name = 'השם ארוך מדי';
  if (!phone && !email) e.contact = 'נא להשאיר טלפון או דוא״ל, כדי שהעסק יוכל לחזור אליכם';
  if (phone && (phone.length > LEAD_LIMITS.phone || !validPhone(phone))) e.phone = 'מספר הטלפון לא תקין';
  if (email && (email.length > LEAD_LIMITS.email || !EMAIL_RE.test(email))) e.email = 'כתובת הדוא״ל לא תקינה';
  if (v.treatment.trim().length > LEAD_LIMITS.treatment) e.treatment = 'שם הטיפול ארוך מדי';
  if (v.message.trim().length > LEAD_LIMITS.message) e.message = `ההודעה ארוכה מדי (עד ${LEAD_LIMITS.message} תווים)`;
  return e;
}

export const LeadSchema = z
  .object({
    branchId: z.uuid(),
    name: z.string().trim().min(2).max(LEAD_LIMITS.name),
    phone: z.string().trim().max(LEAD_LIMITS.phone),
    email: z.string().trim().max(LEAD_LIMITS.email),
    treatment: z.string().trim().max(LEAD_LIMITS.treatment),
    message: z.string().trim().max(LEAD_LIMITS.message),
    website: z.string().max(200),
    serviceId: z.uuid().optional(),
  })
  .superRefine((v, ctx) => {
    const errs = leadErrors(v);
    for (const [field, message] of Object.entries(errs)) ctx.addIssue({ code: 'custom', path: [field], message });
  });

export type LeadResult =
  | { ok: true }
  | { ok: false; error: 'invalid'; fields: Partial<Record<LeadField, string>> }
  | { ok: false; error: 'rate_limited' | 'not_found' | 'failed' };
