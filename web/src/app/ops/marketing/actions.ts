'use server';

import type { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { areaUserOrNull } from '@/components/ops/access';
import { getService } from '@/content/marketing';
import { isServiceSlug } from '@/content/marketing/types';
import { db } from '@/lib/server/db';
import { setOrderStatus } from '@/lib/server/marketing';

// Marketing services admin: move an order through its statuses (optionally emailing the client the new
// status and a note), keep internal notes, link a guest order to a business, and set each service's
// prices, order mode and availability. Every change is audited.

type Result = { ok: true } | { ok: false; error: string };
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

async function syncServiceToStripe(slug: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { stripeConfigured } = await import('@/lib/server/billing/stripe');
  if (!stripeConfigured()) return { ok: true };
  const { resolvedService } = await import('@/lib/server/marketing');
  const { syncMarketingCatalog } = await import('@/lib/server/marketing/stripeCatalog');
  const s = await resolvedService(slug);
  if (!s) return { ok: true };
  const r = await syncMarketingCatalog([s]);
  return r.ok ? { ok: true } : { ok: false, error: r.errors[0] ?? 'unknown' };
}

/** Creates or updates every service and package in Stripe (products and prices by lookup key). */
export async function syncStripeCatalogAction(): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const user = await areaUserOrNull('marketing', 'full');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const { stripeConfigured } = await import('@/lib/server/billing/stripe');
  if (!stripeConfigured()) return { ok: false, error: 'STRIPE_SECRET_KEY לא מוגדר' };
  const { resolvedServices } = await import('@/lib/server/marketing');
  const { syncMarketingCatalog } = await import('@/lib/server/marketing/stripeCatalog');
  const r = await syncMarketingCatalog(await resolvedServices());
  console.info(`[marketing-stripe] ${JSON.stringify(r)}`);
  await db.auditLog.create({ data: { actorId: user.id, action: 'marketing_stripe_sync', subjectType: 'marketing_service', subjectId: NIL_UUID, meta: { products: r.products, prices: r.prices, created: r.created, errors: r.errors.length } } }).catch(() => undefined);
  revalidatePath('/ops/marketing');
  const text = `${r.products} שירותים, ${r.prices} מחירים ב־Stripe. נוצרו או עודכנו ${r.created}.`;
  return r.ok ? { ok: true, text } : { ok: false, error: `${text} שגיאות: ${r.errors.slice(0, 3).join(' · ')}` };
}

const STATUSES = ['quote_requested', 'quoted', 'awaiting_payment', 'paid', 'onboarding', 'in_progress', 'active', 'completed', 'past_due', 'cancelled'] as const;

const OrderInput = z.object({
  id: z.string().uuid(),
  status: z.enum(STATUSES),
  statusNote: z.string().trim().max(600).optional(),
  internalNote: z.string().trim().max(4000).optional(),
  notify: z.boolean().optional(),
  businessId: z.string().uuid().or(z.literal('')).optional(),
});

export async function updateMarketingOrderAction(input: z.input<typeof OrderInput>): Promise<Result> {
  const user = await areaUserOrNull('marketing', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = OrderInput.safeParse(input);
  if (!p.success) return { ok: false, error: 'קלט לא תקין' };
  const order = await db.marketingOrder.findUnique({ where: { id: p.data.id } });
  if (!order) return { ok: false, error: 'לא נמצא' };

  if (p.data.businessId !== undefined) {
    if (p.data.businessId) {
      const b = await db.business.findUnique({ where: { id: p.data.businessId }, select: { id: true } });
      if (!b) return { ok: false, error: 'העסק לא נמצא' };
    }
    await db.marketingOrder.update({ where: { id: order.id }, data: { businessId: p.data.businessId || null } });
  }
  if (p.data.internalNote !== undefined) {
    await db.marketingOrder.update({ where: { id: order.id }, data: { internalNote: p.data.internalNote || null } });
  }
  const statusChanged = p.data.status !== order.status;
  const noteChanged = (p.data.statusNote ?? '') !== (order.statusNote ?? '');
  if (statusChanged || noteChanged) {
    await setOrderStatus(order.id, p.data.status, { statusNote: p.data.statusNote, notify: !!p.data.notify, by: user.fullName ?? user.email ?? undefined, note: noteChanged ? p.data.statusNote : undefined });
  }
  await db.auditLog.create({
    data: { actorId: user.id, action: 'marketing_order_update', subjectType: 'marketing_order', subjectId: order.id, businessId: p.data.businessId || order.businessId, meta: { ref: order.ref, from: order.status, to: p.data.status, notify: !!p.data.notify } },
  });
  revalidatePath('/ops/marketing');
  revalidatePath(`/ops/marketing/${order.id}`);
  return { ok: true };
}

const ConfigInput = z.object({
  slug: z.string(),
  enabled: z.boolean(),
  mode: z.enum(['buy', 'quote', 'both']),
  packages: z.record(z.string().max(40), z.object({ priceNis: z.number().int().min(0).max(1_000_000).optional(), setupNis: z.number().int().min(0).max(1_000_000).optional(), hidden: z.boolean().optional() })),
});

export async function saveServiceConfigAction(input: z.input<typeof ConfigInput>): Promise<Result> {
  const user = await areaUserOrNull('marketing', 'full');
  if (!user) return { ok: false, error: 'רק בעלי הרשאה מלאה יכולים לשנות מחירים' };
  const p = ConfigInput.safeParse(input);
  if (!p.success || !isServiceSlug(p.data.slug)) return { ok: false, error: 'קלט לא תקין' };
  const keys = new Set(getService(p.data.slug).packages.map(x => x.key));
  const packages = Object.fromEntries(Object.entries(p.data.packages).filter(([k]) => keys.has(k)));
  const data = { enabled: p.data.enabled, mode: p.data.mode, packages: packages as Prisma.InputJsonValue, updatedById: user.id };
  await db.marketingServiceConfig.upsert({ where: { slug: p.data.slug }, create: { slug: p.data.slug, ...data }, update: data });
  // audit_logs.subject_id is a uuid: the service slug goes in meta.
  await db.auditLog.create({ data: { actorId: user.id, action: 'marketing_service_config', subjectType: 'marketing_service', subjectId: NIL_UUID, meta: { ref: p.data.slug, enabled: p.data.enabled, mode: p.data.mode, packages } as Prisma.InputJsonValue } }).catch(e => console.error('[marketing] audit', e));
  revalidatePath('/ops/marketing');
  revalidatePath('/for-business/marketing');
  revalidatePath(`/for-business/marketing/${p.data.slug}`);
  // Keep the Stripe catalog in step with the new prices (checkout would also fix it on the next order).
  const sync = await syncServiceToStripe(p.data.slug);
  return sync.ok ? { ok: true } : { ok: false, error: `נשמר באתר, אבל העדכון ב־Stripe נכשל: ${sync.error}. הוא יתוקן בהזמנה הבאה או בכפתור הסנכרון.` };
}
