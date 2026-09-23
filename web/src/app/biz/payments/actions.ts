'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { verifyErrorText } from '@/components/dashboard/payments/shared';
import { requireArea } from '@/lib/server/biz';
import { isAdvanced } from '@/lib/server/clinic';
import { db } from '@/lib/server/db';
import { sealCredentials } from '@/lib/server/money';
import { INVOICE_PROVIDERS, invoiceAdapter } from '@/lib/vendors/invoicing/registry';
import { PAYMENT_PROVIDERS, paymentAdapter } from '@/lib/vendors/payments/registry';

// Payments & invoicing tab. Owner and billing-edit roles only, advanced plan only; every action re-checks.
// Each business connects its OWN providers (docs/decisions.md 2026-09-23). Credentials are sealed
// (AES-256-GCM) before they touch the database and are never sent back to the browser.

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

const FORBIDDEN = 'אין לך הרשאה לשנות את הגדרות התשלומים. שינויים אפשריים לבעלים ולהנהלת החשבונות.';

async function guard() {
  try {
    const ctx = await requireArea('billing', 'edit');
    if (!(await isAdvanced(ctx.business.id))) return { ctx: null, error: 'תשלומים וחשבוניות זמינים במסלול המתקדם.' };
    return { ctx, error: null };
  } catch {
    return { ctx: null, error: FORBIDDEN };
  }
}

const Kind = z.enum(['payments', 'invoicing']);

export async function connectProvider(kindRaw: string, providerKey: string, values: Record<string, string>): Promise<ActionResult> {
  const { ctx, error } = await guard();
  if (!ctx) return { ok: false, error: error! };
  const kind = Kind.safeParse(kindRaw);
  if (!kind.success) return { ok: false, error: 'סוג חיבור לא מוכר.' };
  const info = (kind.data === 'payments' ? PAYMENT_PROVIDERS : INVOICE_PROVIDERS).find(p => p.key === providerKey);
  if (!info) return { ok: false, error: 'ספק לא מוכר.' };
  if (!info.available) return { ok: false, error: `החיבור ל־${info.name} יהיה זמין בקרוב.` };

  // Only the provider's declared fields are kept; anything else in the payload is ignored.
  const creds: Record<string, string> = {};
  for (const f of info.fields) {
    const v = typeof values?.[f.key] === 'string' ? values[f.key].trim() : '';
    if (!v) return { ok: false, error: `חסר: ${f.label}.` };
    if (v.length > 500) return { ok: false, error: `${f.label}: ארוך מדי.` };
    creds[f.key] = v;
  }

  let verified: { ok: true } | { ok: false; error: string };
  try {
    verified = await (kind.data === 'payments' ? paymentAdapter(info.key) : invoiceAdapter(info.key)).verify(creds);
  } catch (e) {
    const msg = e instanceof Error && /adapter/i.test(e.message) ? 'no_adapter' : 'unreachable';
    verified = { ok: false, error: msg };
  }

  const businessId = ctx.business.id;
  const existing = await db.providerConnection.findUnique({ where: { businessId_kind_provider: { businessId, kind: kind.data, provider: info.key } } });
  const settings = { ...((existing?.settings as Record<string, unknown> | null) ?? {}), testMode: info.key === 'sandbox' };
  const now = new Date();
  const data = {
    credentialsEnc: sealCredentials(creds),
    settings,
    status: verified.ok ? ('connected' as const) : ('error' as const),
    lastError: verified.ok ? null : verified.error.slice(0, 200),
    lastCheckedAt: now,
    label: info.name,
  };
  const conn = await db.$transaction(async tx => {
    const c = await tx.providerConnection.upsert({
      where: { businessId_kind_provider: { businessId, kind: kind.data, provider: info.key } },
      create: { businessId, kind: kind.data, provider: info.key, ...data },
      update: data,
    });
    // One active provider per kind: connecting a new one switches the previous one off.
    if (verified.ok) {
      await tx.providerConnection.updateMany({ where: { businessId, kind: kind.data, status: 'connected', id: { not: c.id } }, data: { status: 'disabled' } });
    }
    return c;
  });
  if (!ctx.preview) {
    await db.auditLog.create({
      data: { actorId: ctx.user.id, action: verified.ok ? 'provider_connect' : 'provider_connect_failed', subjectType: 'provider_connection', subjectId: conn.id, businessId, meta: { kind: kind.data, provider: info.key } },
    });
  }
  revalidatePath('/biz/payments');
  return verified.ok ? { ok: true, message: 'החיבור נבדק ונשמר' } : { ok: false, error: verifyErrorText(verified.error) };
}

export async function disconnectProvider(kindRaw: string, providerKey: string): Promise<ActionResult> {
  const { ctx, error } = await guard();
  if (!ctx) return { ok: false, error: error! };
  const kind = Kind.safeParse(kindRaw);
  if (!kind.success) return { ok: false, error: 'סוג חיבור לא מוכר.' };
  const businessId = ctx.business.id;
  const conn = await db.providerConnection.findUnique({ where: { businessId_kind_provider: { businessId, kind: kind.data, provider: String(providerKey) } } });
  if (!conn) return { ok: false, error: 'החיבור לא נמצא.' };
  // Credentials stay sealed so refunds of payments already taken through this connection keep working.
  await db.providerConnection.update({ where: { id: conn.id }, data: { status: 'disabled', lastError: null } });
  if (!ctx.preview) {
    await db.auditLog.create({ data: { actorId: ctx.user.id, action: 'provider_disconnect', subjectType: 'provider_connection', subjectId: conn.id, businessId, meta: { kind: kind.data, provider: conn.provider } } });
  }
  revalidatePath('/biz/payments');
  revalidatePath('/clinic', 'layout');
  return { ok: true, message: 'החיבור נותק' };
}

const Policy = z.object({
  enabled: z.boolean(),
  mode: z.enum(['fixed', 'percent']),
  value: z.number().finite(),
  scope: z.enum(['all', 'medical_only', 'per_treatment']),
  refundWindowHours: z.number().int(),
  waitlistHoldMinutes: z.number().int(),
  consultFeeShekels: z.number().int(),
  overrides: z.array(z.object({ id: z.string().uuid(), shekels: z.number().int().nullable() })).max(500),
});

export async function savePolicy(raw: unknown): Promise<ActionResult> {
  const { ctx, error } = await guard();
  if (!ctx) return { ok: false, error: error! };
  const p = Policy.safeParse(raw);
  if (!p.success) return { ok: false, error: 'חלק מהערכים אינם תקינים.' };
  const v = p.data;

  if (v.enabled && v.scope !== 'per_treatment') {
    if (v.mode === 'fixed' && (!Number.isInteger(v.value) || v.value < 1 || v.value > 5000)) return { ok: false, error: 'מקדמה קבועה: בין ₪1 ל־₪5,000.' };
    if (v.mode === 'percent' && (!Number.isInteger(v.value) || v.value < 1 || v.value > 100)) return { ok: false, error: 'מקדמה באחוזים: בין 1% ל־100%.' };
  }
  if (v.refundWindowHours < 0 || v.refundWindowHours > 336) return { ok: false, error: 'חלון הביטול: בין 0 ל־336 שעות.' };
  if (v.waitlistHoldMinutes < 5 || v.waitlistHoldMinutes > 240) return { ok: false, error: 'זמן ההחזקה ברשימת ההמתנה: בין 5 ל־240 דקות.' };
  if (v.consultFeeShekels < 0 || v.consultFeeShekels > 5000) return { ok: false, error: 'דמי הייעוץ: בין ₪0 ל־₪5,000.' };
  if (v.overrides.some(o => o.shekels != null && (o.shekels < 0 || o.shekels > 5000))) return { ok: false, error: 'מקדמה לטיפול: בין ₪0 ל־₪5,000.' };

  const businessId = ctx.business.id;
  const value = v.mode === 'fixed' ? Math.round(v.value) * 100 : Math.round(v.value);
  const fresh = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { settings: true } });
  const settings = { ...((fresh.settings as Record<string, unknown> | null) ?? {}), waitlist_hold_minutes: v.waitlistHoldMinutes, consult_fee: v.consultFeeShekels };

  // Overrides only for treatments of this business's branches.
  const own = v.overrides.length
    ? new Set((await db.treatment.findMany({ where: { id: { in: v.overrides.map(o => o.id) }, branch: { businessId } }, select: { id: true } })).map(t => t.id))
    : new Set<string>();

  await db.$transaction([
    db.depositPolicy.upsert({
      where: { businessId },
      create: { businessId, enabled: v.enabled, mode: v.mode, value, scope: v.scope, refundWindowHours: v.refundWindowHours },
      update: { enabled: v.enabled, mode: v.mode, value, scope: v.scope, refundWindowHours: v.refundWindowHours },
    }),
    db.business.update({ where: { id: businessId }, data: { settings } }),
    ...v.overrides.filter(o => own.has(o.id)).map(o => db.treatment.update({ where: { id: o.id }, data: { depositOverrideAgorot: o.shekels == null ? null : o.shekels * 100 } })),
  ]);
  revalidatePath('/biz/payments');
  return { ok: true, message: 'ההגדרות נשמרו' };
}
