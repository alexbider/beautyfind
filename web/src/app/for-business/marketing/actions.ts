'use server';

import { z } from 'zod';
import { isServiceSlug } from '@/content/marketing/types';
import { db } from '@/lib/server/db';
import { getService } from '@/content/marketing';
import { COMMON_ONBOARDING } from '@/content/marketing/common';
import { canOnboard, canQuote, createQuoteRequest, orderByToken, resolvedService, saveOnboarding, startCheckout, type OrderContact } from '@/lib/server/marketing';
import { LIMITS as RATE, clientIp, hit } from '@/lib/server/rateLimit';
import { userWriteBlock } from '@/lib/server/access';
import { currentUser } from '@/lib/server/session';
import { LIMITS, validateContact, type ActionResult, type ContactInput } from './shared';

const Contact = z.object({
  name: z.string().max(LIMITS.name + 20),
  email: z.string().max(LIMITS.email + 20),
  phone: z.string().max(LIMITS.phone + 10),
  business: z.string().max(LIMITS.business + 20),
  businessType: z.string().max(80),
  city: z.string().max(LIMITS.city + 20),
  website: z.string().max(LIMITS.website + 20),
  message: z.string().max(LIMITS.message + 200),
  consent: z.boolean(),
  company_url: z.string().max(500),
});

const Utm = z.record(z.string().max(40), z.string().max(200)).optional();

const DAY_MS = 86_400_000;
const PER_EMAIL_PER_DAY = 6;

function toContact(c: ContactInput, utm?: Record<string, string>): OrderContact {
  return {
    contactName: c.name.slice(0, LIMITS.name),
    contactEmail: c.email.slice(0, LIMITS.email),
    contactPhone: c.phone.slice(0, LIMITS.phone),
    businessName: c.business.slice(0, LIMITS.business),
    businessType: c.businessType || null,
    city: c.city.slice(0, LIMITS.city) || null,
    website: c.website.slice(0, LIMITS.website) || null,
    message: c.message.slice(0, LIMITS.message) || null,
    utm: utm ?? null,
  };
}

async function guard(c: ContactInput): Promise<ActionResult | null> {
  const email = c.email.trim().toLowerCase();
  if (!(await hit(`form:ip:${await clientIp()}`, RATE.formIp)).ok) return { ok: false, message: 'נשלחו יותר מדי בקשות מהרשת הזו בשעה האחרונה. נסו שוב מאוחר יותר.' };
  const recent = await db.marketingOrder.count({ where: { contactEmail: email, createdAt: { gte: new Date(Date.now() - DAY_MS) } } });
  if (recent >= PER_EMAIL_PER_DAY) return { ok: false, message: 'נשלחו כבר כמה בקשות מהכתובת הזו היום. נחזור אליכם בהקדם.' };
  return null;
}

/** A quote request from a service page (or the hub, with service "general"). */
export async function requestQuote(input: { service: string; packageKey?: string | null; contact: ContactInput; utm?: Record<string, string> }): Promise<ActionResult> {
  const parsed = Contact.safeParse(input.contact);
  if (!parsed.success || !isServiceSlug(input.service)) return { ok: false, message: 'חלק מהפרטים אינם תקינים. בדקו את הטופס ונסו שוב.' };
  const c = parsed.data;
  if (c.company_url.trim()) return { ok: true, ref: null }; // honeypot: look successful, store nothing
  const errors = validateContact(c);
  if (Object.keys(errors).length) return { ok: false, message: 'יש כמה שדות לתקן.', errors };
  const service = await resolvedService(input.service);
  if (!service || !canQuote(service)) return { ok: false, message: 'השירות הזה זמין להזמנה ישירה בלבד. בחרו חבילה כדי להמשיך.' };
  const blocked = await guard(c);
  if (blocked) return blocked;
  const user = await currentUser();
  // A signed-in owner whose subscription is not paid cannot order; visitors with no business can.
  const unpaid = user ? await userWriteBlock(user.id) : null;
  if (unpaid) return { ok: false, message: unpaid };
  try {
    const order = await createQuoteRequest(service.slug, toContact(c, Utm.safeParse(input.utm).data), user?.id ?? null, input.packageKey ?? null);
    return { ok: true, ref: order.ref };
  } catch (e) {
    console.error('[marketing] quote failed', e);
    return { ok: false, message: 'משהו השתבש בשליחה. נסו שוב בעוד רגע.' };
  }
}

/** Starts a purchase: creates the order and returns the Stripe Checkout URL. */
export async function beginCheckout(input: { service: string; packageKey: string; contact: ContactInput; utm?: Record<string, string> }): Promise<ActionResult> {
  const parsed = Contact.safeParse(input.contact);
  if (!parsed.success || !isServiceSlug(input.service) || typeof input.packageKey !== 'string') return { ok: false, message: 'חלק מהפרטים אינם תקינים. בדקו את הטופס ונסו שוב.' };
  const c = parsed.data;
  if (c.company_url.trim()) return { ok: false, message: 'לא הצלחנו לפתוח את דף התשלום.' };
  const errors = validateContact(c);
  if (Object.keys(errors).length) return { ok: false, message: 'יש כמה שדות לתקן.', errors };
  const blocked = await guard(c);
  if (blocked) return blocked;
  const user = await currentUser();
  // A signed-in owner whose subscription is not paid cannot order; visitors with no business can.
  const unpaid = user ? await userWriteBlock(user.id) : null;
  if (unpaid) return { ok: false, message: unpaid };
  const r = await startCheckout(input.service, input.packageKey, toContact(c, Utm.safeParse(input.utm).data), user?.id ?? null);
  if (!r.ok) return { ok: false, message: r.message };
  return { ok: true, ref: r.ref, url: r.url };
}

const Answers = z.record(z.string().max(60), z.union([z.string().max(4000), z.array(z.string().max(200)).max(30)]));

/** Saves the intake questionnaire for an order (by its secret link). */
export async function submitOnboarding(input: { token: string; answers: Record<string, string | string[]> }): Promise<ActionResult> {
  const parsed = Answers.safeParse(input.answers);
  if (!parsed.success || typeof input.token !== 'string') return { ok: false, message: 'חלק מהתשובות אינן תקינות.' };
  const order = await orderByToken(input.token);
  if (!order) return { ok: false, message: 'ההזמנה לא נמצאה.' };
  if (!canOnboard(order) || !isServiceSlug(order.serviceSlug)) return { ok: false, message: 'השאלון נפתח אחרי שהתשלום מתקבל.' };
  if (!(await hit(`form:ip:${await clientIp()}`, RATE.formIp)).ok) return { ok: false, message: 'יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.' };
  // Only the questions this order's form actually asks.
  const allowed = new Set([...COMMON_ONBOARDING, ...getService(order.serviceSlug).onboarding.fields].map(f => f.key));
  const answers = Object.fromEntries(Object.entries(parsed.data).filter(([k]) => allowed.has(k)));
  await saveOnboarding(order, answers);
  return { ok: true, ref: order.ref };
}
