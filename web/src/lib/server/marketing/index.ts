import 'server-only';
import type Stripe from 'stripe';
import type { MarketingOrder, MarketingOrderStatus, Prisma } from '@prisma/client';
import { getService, SERVICES } from '@/content/marketing';
import type { MarketingService, OrderMode, ServicePackage, ServiceSlug } from '@/content/marketing/types';
import { isServiceSlug } from '@/content/marketing/types';
import { nis } from '@/lib/format';
import { messaging } from '@/lib/vendors/messaging';
import { randomToken } from '../crypto';
import { db } from '../db';
import { nextRef } from '../refs';
import { customerIdOf, invoiceSubscriptionId, periodEndOf, SITE, stripe, stripeConfigured } from '../billing/stripe';

// Marketing services (BeautyFind for Business). The catalog and copy are code (src/content/marketing);
// prices, the order mode and on/off are admin overrides (marketing_service_configs). Orders are purchases
// through Stripe Checkout (one-off or monthly, metadata purpose=marketing) or quote requests.
// Every Stripe object made here carries metadata { site: 'beautyfind', purpose: 'marketing', orderId },
// and handleMarketingEvent claims those events before the platform-plan handlers see them, so a marketing
// subscription never touches the listing subscription row of the same customer.

export const PURPOSE = 'marketing';

export const STATUS_LABEL: Record<MarketingOrderStatus, string> = {
  quote_requested: 'בקשה להצעת מחיר',
  quoted: 'נשלחה הצעת מחיר',
  awaiting_payment: 'ממתין לתשלום',
  paid: 'שולם, ממתין לשאלון',
  onboarding: 'השאלון התקבל',
  in_progress: 'בעבודה',
  active: 'פעיל',
  completed: 'הושלם',
  past_due: 'חיוב נכשל',
  cancelled: 'בוטל',
};

/** What the client sees on the order page and in the dashboard, per status. */
export const STATUS_HINT: Record<MarketingOrderStatus, string> = {
  quote_requested: 'נחזור אליכם עם הצעת מחיר תוך יום עסקים אחד.',
  quoted: 'שלחנו הצעת מחיר למייל. אפשר להשיב עליה ישירות.',
  awaiting_payment: 'התשלום עדיין לא הושלם.',
  paid: 'התשלום התקבל. נשאר למלא את שאלון הפתיחה כדי שנתחיל.',
  onboarding: 'קיבלנו את השאלון. אנחנו בודקים את הגישות והחומרים ונחזור עם תוכנית עבודה.',
  in_progress: 'הצוות עובד על השירות. עדכונים יגיעו במייל ויופיעו כאן.',
  active: 'השירות פעיל ומתחדש כל חודש.',
  completed: 'השירות הושלם. תודה!',
  past_due: 'החיוב החודשי נכשל. עדכנו אמצעי תשלום כדי שהשירות ימשיך.',
  cancelled: 'ההזמנה בוטלה.',
};

const OPEN: MarketingOrderStatus[] = ['quote_requested', 'quoted', 'awaiting_payment', 'paid', 'onboarding', 'in_progress', 'active', 'past_due'];

// ---------- Catalog with admin overrides ----------

export type ResolvedPackage = ServicePackage & { hidden: boolean };
export type ResolvedService = MarketingService & { enabled: boolean; mode: OrderMode; resolvedPackages: ResolvedPackage[] };

type PackageOverride = { priceNis?: number; setupNis?: number; hidden?: boolean };

function applyOverrides(s: MarketingService, cfg: { enabled: boolean; mode: string; packages: unknown } | null): ResolvedService {
  const o = (cfg?.packages ?? {}) as Record<string, PackageOverride>;
  const mode: OrderMode = cfg?.mode === 'buy' || cfg?.mode === 'quote' || cfg?.mode === 'both' ? cfg.mode : s.defaultMode;
  const resolvedPackages = s.packages.map(p => {
    const ov = o[p.key] ?? {};
    return {
      ...p,
      priceNis: typeof ov.priceNis === 'number' && ov.priceNis > 0 ? ov.priceNis : p.priceNis,
      setupNis: typeof ov.setupNis === 'number' && ov.setupNis >= 0 ? ov.setupNis : p.setupNis,
      hidden: !!ov.hidden,
    };
  });
  return { ...s, enabled: cfg?.enabled ?? true, mode, resolvedPackages };
}

/** One service with prices and mode as the admin set them. Null for an unknown slug. */
export async function resolvedService(slug: string): Promise<ResolvedService | null> {
  if (!isServiceSlug(slug)) return null;
  const cfg = await db.marketingServiceConfig.findUnique({ where: { slug } }).catch(() => null);
  return applyOverrides(getService(slug), cfg);
}

/** All services, in catalog order, with admin overrides. */
export async function resolvedServices(): Promise<ResolvedService[]> {
  const rows = await db.marketingServiceConfig.findMany().catch(() => []);
  const bySlug = new Map(rows.map(r => [r.slug, r]));
  return SERVICES.map(s => applyOverrides(s, bySlug.get(s.slug) ?? null));
}

export const canBuy = (s: ResolvedService) => s.enabled && s.mode !== 'quote' && s.resolvedPackages.some(p => !p.hidden);
export const canQuote = (s: ResolvedService) => s.enabled && s.mode !== 'buy';

/** "1,900 ₪ לחודש" or "4,500 ₪" with a setup fee line when there is one. */
export function priceLine(p: Pick<ServicePackage, 'priceNis' | 'cycle' | 'setupNis'>): string {
  const base = p.cycle === 'monthly' ? `${nis(p.priceNis)} לחודש` : nis(p.priceNis);
  return p.setupNis ? `${base} + ${nis(p.setupNis)} הקמה` : base;
}

// ---------- Who is ordering ----------

/** The business of a signed-in owner or staff member, else the business whose owner has this email. */
async function linkBusiness(userId: string | null, email: string): Promise<{ businessId: string | null; branchId: string | null }> {
  if (userId) {
    const m = await db.staffMember.findFirst({ where: { userId, status: 'active' }, orderBy: { createdAt: 'asc' }, select: { businessId: true } });
    if (m) {
      const br = await db.branch.findFirst({ where: { businessId: m.businessId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      return { businessId: m.businessId, branchId: br?.id ?? null };
    }
  }
  const owner = await db.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, kind: 'business' }, select: { id: true } });
  if (owner) {
    const b = await db.business.findFirst({ where: { ownerUserId: owner.id }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (b) return { businessId: b.id, branchId: null };
  }
  return { businessId: null, branchId: null };
}

export type OrderContact = {
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  businessName: string;
  businessType?: string | null;
  city?: string | null;
  website?: string | null;
  message?: string | null;
  utm?: Record<string, string> | null;
};

const event = (status: MarketingOrderStatus, note?: string, by?: string) => ({ at: new Date().toISOString(), status, ...(note ? { note } : {}), ...(by ? { by } : {}) });

function siteUrl(): string {
  return (process.env.SITE_URL ?? 'https://beautyfind.co.il').replace(/\/+$/, '');
}

export const orderPagePath = (token: string) => `/for-business/marketing/order/${token}`;

// ---------- Quote requests ----------

export async function createQuoteRequest(slug: ServiceSlug, contact: OrderContact, userId: string | null, packageKey?: string | null): Promise<MarketingOrder> {
  const service = getService(slug);
  const pkg = packageKey ? service.packages.find(p => p.key === packageKey) : undefined;
  const link = await linkBusiness(userId, contact.contactEmail);
  const order = await db.marketingOrder.create({
    data: {
      ref: await nextRef('MK'),
      kind: 'quote',
      status: 'quote_requested',
      serviceSlug: slug,
      packageKey: pkg?.key ?? null,
      packageName: pkg?.name ?? null,
      ...contactData(contact),
      ...link,
      userId,
      accessToken: randomToken(),
      timeline: [event('quote_requested')] as unknown as Prisma.InputJsonValue,
    },
  });
  await audit(order, 'marketing_quote_requested');
  await notifyClient(order, 'M_mk_quote_received');
  await notifyOps(`בקשה להצעת מחיר ${order.ref}: ${service.name}, ${order.businessName} (${order.contactPhone}).`, `mk-quote:${order.id}`);
  return order;
}

function contactData(c: OrderContact) {
  return {
    contactName: c.contactName.trim(),
    contactEmail: c.contactEmail.trim().toLowerCase(),
    contactPhone: c.contactPhone.trim(),
    businessName: c.businessName.trim(),
    businessType: c.businessType?.trim() || null,
    city: c.city?.trim() || null,
    website: c.website?.trim() || null,
    message: c.message?.trim() || null,
    utm: c.utm ? (c.utm as Prisma.InputJsonValue) : undefined,
  };
}

// ---------- Purchases (Stripe Checkout) ----------

export type CheckoutResult = { ok: true; url: string; ref: string } | { ok: false; message: string };

export async function startCheckout(slug: ServiceSlug, packageKey: string, contact: OrderContact, userId: string | null): Promise<CheckoutResult> {
  const service = await resolvedService(slug);
  if (!service || !canBuy(service)) return { ok: false, message: 'השירות הזה זמין כרגע בהצעת מחיר בלבד.' };
  const pkg = service.resolvedPackages.find(p => p.key === packageKey && !p.hidden);
  if (!pkg) return { ok: false, message: 'החבילה שנבחרה אינה זמינה.' };
  if (!stripeConfigured()) return { ok: false, message: 'התשלום אונליין אינו זמין כרגע. אפשר לבקש הצעת מחיר ונחזור אליכם.' };

  const link = await linkBusiness(userId, contact.contactEmail);
  const priceAgorot = Math.round(pkg.priceNis * 100);
  const setupAgorot = Math.round((pkg.setupNis ?? 0) * 100);
  const order = await db.marketingOrder.create({
    data: {
      ref: await nextRef('MK'),
      kind: 'purchase',
      status: 'awaiting_payment',
      serviceSlug: slug,
      packageKey: pkg.key,
      packageName: pkg.name,
      cycle: pkg.cycle,
      priceAgorot,
      setupAgorot,
      ...contactData(contact),
      ...link,
      userId,
      accessToken: randomToken(),
      timeline: [event('awaiting_payment')] as unknown as Prisma.InputJsonValue,
    },
  });

  const meta = { site: SITE, purpose: PURPOSE, orderId: order.id, orderRef: order.ref, service: slug, package: pkg.key };
  let customer: string | undefined;
  if (link.businessId) {
    const sub = await db.subscription.findUnique({ where: { businessId: link.businessId }, select: { stripeCustomerId: true } });
    customer = sub?.stripeCustomerId ?? undefined;
  }
  const name = `${service.name}: ${pkg.name}`;
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      quantity: 1,
      price_data: {
        currency: 'ils',
        unit_amount: priceAgorot,
        product_data: { name, metadata: { site: SITE, purpose: PURPOSE, service: slug, package: pkg.key } },
        ...(pkg.cycle === 'monthly' ? { recurring: { interval: 'month' as const } } : {}),
      },
    },
  ];
  if (setupAgorot > 0) {
    lineItems.push({ quantity: 1, price_data: { currency: 'ils', unit_amount: setupAgorot, product_data: { name: `${name} (הקמה)`, metadata: { site: SITE, purpose: PURPOSE } } } });
  }
  const back = `${siteUrl()}${orderPagePath(order.accessToken)}`;
  try {
    const session = await stripe().checkout.sessions.create(
      {
        mode: pkg.cycle === 'monthly' ? 'subscription' : 'payment',
        line_items: lineItems,
        ...(customer ? { customer } : { customer_email: order.contactEmail }),
        ...(pkg.cycle === 'monthly'
          ? { subscription_data: { metadata: meta, description: name } }
          : { ...(customer ? {} : { customer_creation: 'always' as const }), invoice_creation: { enabled: true, invoice_data: { metadata: meta, description: name } }, payment_intent_data: { metadata: meta, description: name } }),
        client_reference_id: order.id,
        metadata: meta,
        locale: 'auto',
        billing_address_collection: 'auto',
        success_url: `${back}?paid=1`,
        cancel_url: `${siteUrl()}/for-business/marketing/${slug}?cancelled=1#packages`,
      },
      { idempotencyKey: `bf-mk-checkout-${order.id}` },
    );
    await db.marketingOrder.update({ where: { id: order.id }, data: { stripeSessionId: session.id } });
    if (!session.url) return { ok: false, message: 'לא הצלחנו לפתוח את דף התשלום. נסו שוב בעוד רגע.' };
    return { ok: true, url: session.url, ref: order.ref };
  } catch (e) {
    console.error('[marketing] checkout failed', e);
    await db.marketingOrder.update({ where: { id: order.id }, data: { status: 'cancelled', internalNote: 'Stripe checkout failed to open' } });
    return { ok: false, message: 'לא הצלחנו לפתוח את דף התשלום. נסו שוב, או בקשו הצעת מחיר ונחזור אליכם.' };
  }
}

// ---------- Stripe events ----------

const isMarketing = (m: Stripe.Metadata | null | undefined) => m?.site === SITE && m?.purpose === PURPOSE;

/**
 * Claims the Stripe events that belong to marketing orders. Returns null when the event is not a marketing
 * one, so the platform handlers run as before.
 */
export async function handleMarketingEvent(ev: Stripe.Event): Promise<'handled' | 'ignored' | null> {
  switch (ev.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const s = ev.data.object as Stripe.Checkout.Session;
      if (!isMarketing(s.metadata)) return null;
      if (s.payment_status === 'unpaid') return 'handled'; // async methods: wait for async_payment_succeeded
      await markPaid(s);
      return 'handled';
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = ev.data.object as Stripe.Subscription;
      if (!isMarketing(sub.metadata)) return null;
      await applyMarketingSubscription(ev.type === 'customer.subscription.deleted' ? sub : await stripe().subscriptions.retrieve(sub.id));
      return 'handled';
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const inv = ev.data.object as Stripe.Invoice;
      let orderId = isMarketing(inv.metadata) ? inv.metadata?.orderId : undefined;
      const subId = invoiceSubscriptionId(inv);
      if (!orderId && subId) {
        const own = await db.marketingOrder.findUnique({ where: { stripeSubscriptionId: subId }, select: { id: true } });
        if (own) orderId = own.id;
        else {
          const sub = await stripe().subscriptions.retrieve(subId);
          if (isMarketing(sub.metadata)) orderId = sub.metadata.orderId;
        }
      }
      if (!orderId) return null;
      if (ev.type === 'invoice.paid') await recordMarketingPayment(orderId, inv);
      else await recordMarketingFailure(orderId, inv);
      return 'handled';
    }
    default:
      return null;
  }
}

async function markPaid(s: Stripe.Checkout.Session) {
  const orderId = s.metadata?.orderId ?? s.client_reference_id;
  if (!orderId) return;
  const order = await db.marketingOrder.findUnique({ where: { id: orderId } });
  if (!order || order.paidAt) return; // already handled (events can repeat)
  const customerId = customerIdOf(s.customer);
  const subscriptionId = typeof s.subscription === 'string' ? s.subscription : s.subscription?.id ?? null;
  let currentPeriodEnd: Date | null = null;
  if (subscriptionId) {
    const sub = await stripe().subscriptions.retrieve(subscriptionId);
    currentPeriodEnd = periodEndOf(sub);
  }
  // A customer Checkout created for a guest: mark it as ours so other handlers know whose it is.
  if (customerId) {
    try {
      const c = await stripe().customers.retrieve(customerId);
      if (!('deleted' in c && c.deleted) && !(c as Stripe.Customer).metadata?.site) {
        await stripe().customers.update(customerId, { metadata: { site: SITE, marketing: '1', ...(order.businessId ? { businessId: order.businessId } : {}) } });
      }
    } catch (e) {
      console.warn('[marketing] could not tag customer', e);
    }
  }
  const updated = await db.marketingOrder.update({
    where: { id: order.id },
    data: {
      status: 'paid',
      paidAt: new Date(),
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      currentPeriodEnd,
      timeline: pushEvent(order.timeline, event('paid')),
    },
  });
  await audit(updated, 'marketing_order_paid');
  await notifyClient(updated, 'M_mk_order_paid');
  const service = getService(updated.serviceSlug as ServiceSlug);
  await notifyOps(`הזמנה חדשה שולמה ${updated.ref}: ${service?.name ?? updated.serviceSlug} (${updated.packageName ?? ''}), ${updated.businessName}.`, `mk-paid:${updated.id}`);
}

async function applyMarketingSubscription(sub: Stripe.Subscription) {
  const orderId = sub.metadata?.orderId;
  const order = orderId
    ? await db.marketingOrder.findUnique({ where: { id: orderId } })
    : await db.marketingOrder.findUnique({ where: { stripeSubscriptionId: sub.id } });
  if (!order) return;
  const data: Prisma.MarketingOrderUpdateInput = {
    stripeSubscriptionId: sub.id,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end || !!sub.cancel_at,
    currentPeriodEnd: periodEndOf(sub),
  };
  let next: MarketingOrderStatus | null = null;
  if (sub.status === 'canceled' || sub.status === 'incomplete_expired') next = 'cancelled';
  else if ((sub.status === 'past_due' || sub.status === 'unpaid') && order.status !== 'past_due') next = 'past_due';
  else if (sub.status === 'active' && order.status === 'past_due') next = 'active';
  if (next && next !== order.status) {
    data.status = next;
    data.timeline = pushEvent(order.timeline, event(next));
  }
  await db.marketingOrder.update({ where: { id: order.id }, data });
}

async function recordMarketingPayment(orderId: string, inv: Stripe.Invoice) {
  if (!inv.id || !inv.amount_paid) return;
  const order = await db.marketingOrder.findUnique({ where: { id: orderId } });
  if (!order) return;
  const exists = await db.payment.findFirst({ where: { provider: 'stripe', providerRef: inv.id }, select: { id: true } });
  if (exists) return;
  const paidAt = inv.status_transitions?.paid_at ? new Date(inv.status_transitions.paid_at * 1000) : new Date();
  const amount = inv.amount_paid;
  const service = getService(order.serviceSlug as ServiceSlug);
  await db.$transaction(async tx => {
    const p = await tx.payment.create({
      data: {
        payee: 'platform', businessId: order.businessId, payerName: order.businessName, payerEmail: order.contactEmail, payerPhone: order.contactPhone,
        purpose: 'marketing', netAgorot: amount, vatAgorot: 0, grossAgorot: amount, provider: 'stripe', providerRef: inv.id, status: 'succeeded', paidAt,
      },
    });
    await tx.document.create({
      data: {
        issuer: 'platform', businessId: order.businessId, type: 'platform_invoice', number: inv.number ?? inv.id!, paymentId: p.id,
        lines: [{ description: `${service?.name ?? order.serviceSlug}: ${order.packageName ?? ''}`.trim(), qty: 1, unitAgorot: amount }] as unknown as Prisma.InputJsonValue,
        netAgorot: amount, vatAgorot: 0, grossAgorot: amount, provider: 'stripe', providerRef: inv.id,
        pdfUrl: inv.invoice_pdf ?? inv.hosted_invoice_url ?? null, sentTo: order.contactEmail, issuedAt: paidAt,
      },
    });
    await tx.auditLog.create({ data: { action: 'platform_payment', subjectType: 'payment', subjectId: p.id, businessId: order.businessId, meta: { ref: order.ref, purpose: 'marketing', gross: amount / 100, provider: 'stripe' } } });
  });
  if (order.status === 'past_due') {
    await db.marketingOrder.update({ where: { id: order.id }, data: { status: 'active', timeline: pushEvent(order.timeline, event('active', 'החיוב עבר')) } });
  }
}

async function recordMarketingFailure(orderId: string, inv: Stripe.Invoice) {
  const order = await db.marketingOrder.findUnique({ where: { id: orderId } });
  if (!order) return;
  await notifyOps(`חיוב נכשל בהזמנת שיווק ${order.ref}: ${order.businessName}, ${(inv.amount_due / 100).toFixed(2)} ₪.`, `mk-failed:${inv.id}`);
  if (order.stripeSubscriptionId && order.status !== 'past_due' && order.status !== 'cancelled') {
    await db.marketingOrder.update({ where: { id: order.id }, data: { status: 'past_due', timeline: pushEvent(order.timeline, event('past_due')) } });
  }
}

// ---------- Onboarding ----------

export type OnboardingAnswers = Record<string, string | string[]>;

export async function orderByToken(token: string) {
  if (!token || token.length < 16) return null;
  return db.marketingOrder.findUnique({ where: { accessToken: token } });
}

export async function saveOnboarding(order: MarketingOrder, answers: OnboardingAnswers): Promise<MarketingOrder> {
  const next: MarketingOrderStatus = order.status === 'paid' || order.status === 'awaiting_payment' ? 'onboarding' : order.status;
  const updated = await db.marketingOrder.update({
    where: { id: order.id },
    data: {
      onboarding: answers as Prisma.InputJsonValue,
      onboardedAt: new Date(),
      status: next,
      timeline: next !== order.status ? pushEvent(order.timeline, event(next)) : undefined,
    },
  });
  if (!order.onboardedAt) {
    await audit(updated, 'marketing_onboarding_submitted');
    await notifyClient(updated, 'M_mk_onboarding_received');
    await notifyOps(`שאלון פתיחה התקבל ${updated.ref}: ${updated.businessName}.`, `mk-onb:${updated.id}`);
  }
  return updated;
}

// ---------- Admin ----------

export async function setOrderStatus(orderId: string, status: MarketingOrderStatus, opts: { note?: string; statusNote?: string; notify?: boolean; by?: string } = {}) {
  const order = await db.marketingOrder.findUnique({ where: { id: orderId } });
  if (!order) throw new Error('order not found');
  const updated = await db.marketingOrder.update({
    where: { id: orderId },
    data: {
      status,
      statusNote: opts.statusNote ?? order.statusNote,
      timeline: pushEvent(order.timeline, event(status, opts.note, opts.by)),
    },
  });
  if (opts.notify) await notifyClient(updated, 'M_mk_status', { status: STATUS_LABEL[status], note: opts.statusNote ?? opts.note ?? '' });
  return updated;
}

/** Orders a business sees: those linked to it, plus guest orders placed with the owner's email. */
export async function ordersForBusiness(businessId: string, ownerEmail?: string | null) {
  return db.marketingOrder.findMany({
    where: {
      OR: [{ businessId }, ...(ownerEmail ? [{ businessId: null, contactEmail: ownerEmail.toLowerCase() }] : [])],
      NOT: { status: 'awaiting_payment', createdAt: { lt: new Date(Date.now() - 86_400_000) } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export const isOpen = (s: MarketingOrderStatus) => OPEN.includes(s);

// ---------- Helpers ----------

function pushEvent(timeline: Prisma.JsonValue, e: ReturnType<typeof event>): Prisma.InputJsonValue {
  const list = Array.isArray(timeline) ? timeline : [];
  return [...list, e] as unknown as Prisma.InputJsonValue;
}

async function audit(order: MarketingOrder, action: string) {
  await db.auditLog
    .create({ data: { action, subjectType: 'marketing_order', subjectId: order.id, businessId: order.businessId, meta: { ref: order.ref, service: order.serviceSlug, package: order.packageKey } } })
    .catch(e => console.warn('[marketing] audit failed', e));
}

async function notifyClient(order: MarketingOrder, template: string, extra: Record<string, string> = {}) {
  const service = getService(order.serviceSlug as ServiceSlug);
  const amount = order.priceAgorot ? priceLine({ priceNis: order.priceAgorot / 100, cycle: order.cycle === 'monthly' ? 'monthly' : 'one_time', setupNis: order.setupAgorot ? order.setupAgorot / 100 : undefined }) : '';
  try {
    await messaging().send({
      channel: 'email',
      to: order.contactEmail,
      template,
      kind: 'service',
      vars: {
        name: order.contactName.split(' ')[0] ?? '',
        business: order.businessName,
        service: service?.name ?? order.serviceSlug,
        package: order.packageName ?? '',
        amount,
        ref: order.ref,
        link: `${siteUrl()}${orderPagePath(order.accessToken)}`,
        ...extra,
      },
    });
  } catch (e) {
    console.warn('[marketing] client notice failed', e);
  }
}

async function notifyOps(text: string, key: string) {
  try {
    const { alertOps } = await import('../alerts');
    await alertOps(key, text);
  } catch (e) {
    console.warn('[marketing] ops alert failed', e);
  }
}
