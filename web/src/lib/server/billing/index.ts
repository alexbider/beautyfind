import 'server-only';
import type { Prisma, SubscriptionStatus } from '@prisma/client';
import type Stripe from 'stripe';
import { planPrice, type PlanKey } from '@/lib/pricing';
import { db } from '../db';
import { platformSettings } from '../platformSettings';
import { siteUrl } from '../site';
import { customerIdOf, periodEndOf, planOfPrice, planPriceId, portalConfigurationId, priceId, SITE, stripe, stripeConfigured, type Cycle } from './stripe';

// Platform billing: BeautyFind's own subscriptions and sponsored weeks, charged through Stripe.
// - A business saves a card through Stripe Checkout. If it already has live branches the subscription
//   starts right there; if not, the card is only saved (setup mode) and the subscription starts when the
//   first branch goes live (syncBilling, called on approval and by the daily billing cron).
// - One subscription item: the plan's price for the cycle, quantity = live branches. The price is
//   graduated, so the chain discount from the fourth branch is Stripe's own arithmetic.
// - Upgrades and monthly → yearly apply now (prorated). Downgrades and yearly → monthly wait for the end
//   of the period through a subscription schedule, so the paid period is never cut short.
// - Stripe is the source of truth for status, plan and period; the webhook writes it back here.

export type BillingResult = { ok: true; url?: string; message?: string } | { ok: false; error: string };

const NOT_CONFIGURED = 'החיוב עדיין לא מחובר. נסו שוב מאוחר יותר או פנו אלינו.';

type SubRow = Prisma.SubscriptionGetPayload<object>;

async function businessFacts(businessId: string) {
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: {
      id: true, legalName: true, invoiceEmail: true, status: true,
      owner: { select: { email: true, fullName: true, phone: true } },
      branches: { select: { id: true, name: true, status: true }, orderBy: { createdAt: 'asc' } },
      subscription: true,
    },
  });
  if (!b) return null;
  const liveBranches = b.branches.filter(x => x.status === 'live').length;
  const name = b.branches[0]?.name ?? b.legalName ?? 'BeautyFind';
  return { ...b, liveBranches, name };
}

/** The Stripe customer for a business, created on first use. */
export async function ensureCustomer(businessId: string): Promise<string> {
  const b = await businessFacts(businessId);
  if (!b) throw new Error('business not found');
  if (!b.subscription) throw new Error('no subscription');
  if (b.subscription.stripeCustomerId) return b.subscription.stripeCustomerId;
  const email = b.invoiceEmail ?? b.owner?.email ?? undefined;
  const c = await stripe().customers.create(
    {
      name: b.legalName ? `${b.name} (${b.legalName})` : b.name,
      email,
      phone: b.owner?.phone ?? undefined,
      preferred_locales: ['en'], // Stripe emails and invoices have no Hebrew
      metadata: { site: SITE, businessId },
    },
    { idempotencyKey: `bf-customer-${businessId}` },
  );
  // Another request may have raced us; keep whichever id landed first.
  const r = await db.subscription.updateMany({ where: { businessId, stripeCustomerId: null }, data: { stripeCustomerId: c.id } });
  if (!r.count) {
    const again = await db.subscription.findUnique({ where: { businessId }, select: { stripeCustomerId: true } });
    return again?.stripeCustomerId ?? c.id;
  }
  return c.id;
}

/** Saves the default card's brand, last four digits and expiry on the subscription row. */
export async function refreshCard(customerId: string): Promise<void> {
  const c = await stripe().customers.retrieve(customerId, { expand: ['invoice_settings.default_payment_method'] });
  if ('deleted' in c && c.deleted) return;
  const pm = (c as Stripe.Customer).invoice_settings?.default_payment_method;
  const card = pm && typeof pm !== 'string' ? pm.card : null;
  await db.subscription.updateMany({
    where: { stripeCustomerId: customerId },
    data: card
      ? { cardBrand: card.brand, cardLast4: card.last4, cardExp: `${String(card.exp_month).padStart(2, '0')}/${String(card.exp_year).slice(-2)}` }
      : { cardBrand: null, cardLast4: null, cardExp: null },
  });
}

async function hasDefaultCard(customerId: string): Promise<boolean> {
  const c = await stripe().customers.retrieve(customerId);
  if ('deleted' in c && c.deleted) return false;
  return !!(c as Stripe.Customer).invoice_settings?.default_payment_method;
}

/**
 * The Stripe price for a business: its plan and cycle, unless BILLING_PRICE_OVERRIDES (JSON
 * {"<businessId>": "<price lookup key>"}) names a special price for it, e.g. a 1 ₪ demo account used to
 * test billing end to end, or a negotiated price.
 */
async function priceForBusiness(businessId: string, plan: PlanKey, cycle: Cycle): Promise<string> {
  try {
    const map = JSON.parse(process.env.BILLING_PRICE_OVERRIDES || '{}') as Record<string, string>;
    if (typeof map[businessId] === 'string' && map[businessId]) return priceId(map[businessId]);
  } catch {
    console.warn('[billing] BILLING_PRICE_OVERRIDES is not valid JSON');
  }
  return planPriceId(plan, cycle);
}

const effectivePlan = (s: SubRow): { plan: PlanKey; cycle: Cycle } => ({ plan: s.plan, cycle: s.cycle });

/**
 * Stripe Checkout for this business: subscription mode when it has live branches (first charge now),
 * setup mode otherwise (the card is saved, the charge starts at go-live).
 */
export async function checkoutUrl(businessId: string): Promise<BillingResult> {
  if (!stripeConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const b = await businessFacts(businessId);
  if (!b?.subscription) return { ok: false, error: 'בחרו מסלול לפני הוספת אמצעי תשלום.' };
  const sub = b.subscription;
  if (sub.stripeSubscriptionId && sub.status !== 'cancelled') return portalUrl(businessId);
  const customer = await ensureCustomer(businessId);
  const base = siteUrl();
  const common = {
    customer,
    locale: 'auto' as const, // Checkout has no Hebrew; auto follows the browser
    success_url: `${base}/biz/billing?checkout=done`,
    cancel_url: `${base}/biz/billing?checkout=cancelled`,
    client_reference_id: businessId,
    metadata: { site: SITE, businessId },
  };
  const { plan, cycle } = effectivePlan(sub);
  const session =
    b.liveBranches > 0
      ? await stripe().checkout.sessions.create({
          ...common,
          mode: 'subscription',
          line_items: [{ price: await priceForBusiness(businessId, plan, cycle), quantity: b.liveBranches }],
          subscription_data: { metadata: { site: SITE, businessId }, description: `BeautyFind · ${b.name}` },
          payment_method_collection: 'always',
        })
      : await stripe().checkout.sessions.create({
          ...common,
          mode: 'setup',
          currency: 'ils',
          setup_intent_data: { metadata: { site: SITE, businessId }, description: `BeautyFind · ${b.name}` },
        });
  if (!session.url) return { ok: false, error: 'לא הצלחנו לפתוח את עמוד התשלום. נסו שוב.' };
  return { ok: true, url: session.url };
}

/** Stripe's customer portal: update the card, see and download invoices, cancel at period end. */
export async function portalUrl(businessId: string): Promise<BillingResult> {
  if (!stripeConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const sub = await db.subscription.findUnique({ where: { businessId } });
  if (!sub?.stripeCustomerId) return { ok: false, error: 'עדיין לא נשמר אמצעי תשלום.' };
  const s = await stripe().billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${siteUrl()}/biz/billing`,
    configuration: await portalConfigurationId(),
    locale: 'auto',
  });
  return { ok: true, url: s.url };
}

function mapStatus(s: Stripe.Subscription.Status): SubscriptionStatus {
  switch (s) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'cancelled';
    default:
      return 'incomplete'; // incomplete, paused
  }
}

/**
 * Writes a Stripe subscription back to our row: status, plan and cycle (from the price), period end and
 * scheduled cancellation. A pending downgrade or cycle switch clears once Stripe is on that price.
 * The business follows its subscription the way the accounting screen already does it.
 */
export async function applyStripeSubscription(s: Stripe.Subscription): Promise<void> {
  const customerId = customerIdOf(s.customer);
  const row = await db.subscription.findFirst({
    where: { OR: [{ stripeSubscriptionId: s.id }, ...(customerId ? [{ stripeCustomerId: customerId }] : [])] },
  });
  if (!row) return; // not a BeautyFind customer (the Stripe account bills other sites too)
  // An older subscription that was replaced must not overwrite the current one.
  if (row.stripeSubscriptionId && row.stripeSubscriptionId !== s.id && mapStatus(s.status) === 'cancelled') return;

  let status = mapStatus(s.status);
  // A listing hidden for debt stays hidden until the debt is paid (Stripe still says past_due meanwhile).
  if (status === 'past_due' && row.status === 'hidden') status = 'hidden';
  const fromPrice = planOfPrice(s.items.data[0]?.price);
  const data: Prisma.SubscriptionUpdateInput = {
    stripeSubscriptionId: s.id,
    stripeCustomerId: customerId ?? row.stripeCustomerId,
    status,
    currentPeriodEnd: periodEndOf(s),
    cancelAtPeriodEnd: !!s.cancel_at_period_end || !!s.cancel_at,
  };
  if (fromPrice) {
    data.plan = fromPrice.plan;
    data.cycle = fromPrice.cycle;
    data.pricePerBranchAgorot = planPrice(fromPrice.plan, fromPrice.cycle) * 100;
    if (row.pendingPlan && row.pendingPlan === fromPrice.plan) data.pendingPlan = null;
    if (row.pendingCycle && row.pendingCycle === fromPrice.cycle) data.pendingCycle = null;
  }
  if (status === 'past_due' || status === 'hidden') data.pastDueSince = row.pastDueSince ?? new Date();
  else data.pastDueSince = null;
  if (status === 'cancelled') {
    data.stripeSubscriptionId = null;
    data.pendingPlan = null;
    data.pendingCycle = null;
    data.cancelAtPeriodEnd = false;
  }

  const ops: Prisma.PrismaPromise<unknown>[] = [db.subscription.update({ where: { id: row.id }, data })];
  if (status === 'past_due' && row.status !== 'past_due') {
    ops.push(db.business.updateMany({ where: { id: row.businessId, status: 'live' }, data: { status: 'past_due' } }));
  }
  if (status === 'active' && (row.status === 'past_due' || row.status === 'hidden')) {
    ops.push(db.business.updateMany({ where: { id: row.businessId, status: { in: ['past_due', 'hidden'] } }, data: { status: 'live' } }));
  }
  if (row.status !== status) {
    ops.push(db.auditLog.create({ data: { action: 'subscription_stripe', subjectType: 'subscription', subjectId: row.id, businessId: row.businessId, meta: { from: row.status, to: status, stripe: s.status, sub: s.id } } }));
  }
  await db.$transaction(ops);
}

/** Releases a subscription schedule if one is attached, so the subscription can be changed directly. */
async function releaseSchedule(s: Stripe.Subscription) {
  const sched = s.schedule;
  if (!sched) return;
  const id = typeof sched === 'string' ? sched : sched.id;
  await stripe().subscriptionSchedules.release(id, { preserve_cancel_date: true });
}

/** From the end of the current period, the subscription moves to `nextPrice` (a downgrade or yearly → monthly). */
async function scheduleAtPeriodEnd(s: Stripe.Subscription, nextPrice: string, quantity: number, nextCycle: Cycle) {
  await releaseSchedule(s);
  const sched = await stripe().subscriptionSchedules.create({ from_subscription: s.id });
  const cur = sched.phases[0];
  const curItems = cur.items.map(i => ({ price: typeof i.price === 'string' ? i.price : i.price.id, quantity: i.quantity ?? quantity }));
  await stripe().subscriptionSchedules.update(sched.id, {
    end_behavior: 'release',
    phases: [
      { items: curItems, start_date: cur.start_date, end_date: cur.end_date, proration_behavior: 'none' },
      { items: [{ price: nextPrice, quantity }], duration: { interval: nextCycle === 'yearly' ? 'year' : 'month', interval_count: 1 }, proration_behavior: 'none' },
    ],
    metadata: { site: SITE },
  });
}

/**
 * Brings Stripe in line with the business: starts the subscription once there is a live branch and a
 * saved card, and keeps the quantity equal to the live branches. Safe to call any time; does nothing
 * when Stripe is not configured or the business has no Stripe customer.
 */
export async function syncBilling(businessId: string): Promise<{ action: string }> {
  if (!stripeConfigured()) return { action: 'not_configured' };
  const b = await businessFacts(businessId);
  const sub = b?.subscription;
  if (!b || !sub?.stripeCustomerId) return { action: 'no_customer' };
  const n = b.liveBranches;

  if (sub.stripeSubscriptionId) {
    const s = await stripe().subscriptions.retrieve(sub.stripeSubscriptionId);
    if (s.status === 'canceled' || s.status === 'incomplete_expired') {
      await applyStripeSubscription(s);
      return { action: 'cancelled' };
    }
    const item = s.items.data[0];
    if (!item || n === 0 || item.quantity === n) return { action: 'in_sync' };
    // A branch went live or left mid-period: prorate onto the next invoice. A schedule (pending downgrade)
    // keeps its own quantities, so it is released first and rebuilt with the new count.
    const pending = sub.pendingPlan || sub.pendingCycle;
    await releaseSchedule(s);
    await stripe().subscriptions.update(s.id, { items: [{ id: item.id, quantity: n }], proration_behavior: 'create_prorations' });
    if (pending) {
      const next = { plan: sub.pendingPlan ?? sub.plan, cycle: (sub.pendingCycle ?? sub.cycle) as Cycle };
      await scheduleAtPeriodEnd(await stripe().subscriptions.retrieve(s.id), await priceForBusiness(businessId, next.plan, next.cycle), n, next.cycle);
    }
    return { action: 'quantity' };
  }

  if (n === 0) return { action: 'waiting_for_live_branch' };
  // A business that cancelled is not restarted behind its back; it comes back through Checkout.
  if (sub.status === 'cancelled') return { action: 'cancelled' };
  if (!(await hasDefaultCard(sub.stripeCustomerId))) return { action: 'no_card' };
  const { plan, cycle } = effectivePlan(sub);
  const s = await stripe().subscriptions.create(
    {
      customer: sub.stripeCustomerId,
      items: [{ price: await priceForBusiness(businessId, plan, cycle), quantity: n }],
      collection_method: 'charge_automatically',
      payment_behavior: 'allow_incomplete',
      metadata: { site: SITE, businessId },
      description: `BeautyFind · ${b.name}`,
    },
    { idempotencyKey: `bf-sub-${businessId}-${sub.updatedAt.getTime()}` },
  );
  await db.subscription.update({ where: { id: sub.id }, data: { stripeSubscriptionId: s.id } });
  await applyStripeSubscription(s);
  return { action: 'started' };
}

/** syncBilling that never throws: for hooks after an approval or a status change. */
export async function syncBillingSafe(businessId: string): Promise<void> {
  try {
    await syncBilling(businessId);
  } catch (e) {
    console.error('[billing] sync failed', businessId, e);
  }
}

/**
 * Applies a plan or cycle change that is already saved on our row. `when` says how the change was saved:
 * now (upgrade, monthly → yearly), period_end (downgrade, yearly → monthly) or undo (a pending change
 * was cancelled by picking the current plan or cycle again).
 */
export async function applyPlanChange(businessId: string, when: 'now' | 'period_end' | 'undo'): Promise<void> {
  if (!stripeConfigured()) return;
  const sub = await db.subscription.findUnique({ where: { businessId } });
  if (!sub?.stripeSubscriptionId) return;
  const s = await stripe().subscriptions.retrieve(sub.stripeSubscriptionId);
  const item = s.items.data[0];
  if (!item || s.status === 'canceled') return;
  const qty = item.quantity ?? 1;
  if (when === 'undo') {
    await releaseSchedule(s);
    return;
  }
  if (when === 'now') {
    await releaseSchedule(s);
    const updated = await stripe().subscriptions.update(s.id, {
      items: [{ id: item.id, price: await priceForBusiness(businessId, sub.plan, sub.cycle), quantity: qty }],
      // Upgrades show the prorated difference on the next invoice; a switch to yearly is charged at once
      // (Stripe restarts the cycle and credits the unused part of the month).
      proration_behavior: item.price.recurring?.interval === (sub.cycle === 'yearly' ? 'year' : 'month') ? 'create_prorations' : 'always_invoice',
    });
    await applyStripeSubscription(updated);
    return;
  }
  const next = { plan: sub.pendingPlan ?? sub.plan, cycle: (sub.pendingCycle ?? sub.cycle) as Cycle };
  await scheduleAtPeriodEnd(s, await priceForBusiness(businessId, next.plan, next.cycle), qty, next.cycle);
}

/**
 * Bills an approved sponsored placement: one invoice for the weeks, after the multi-week discount.
 * With a saved card it is charged at once; without one Stripe emails a payment link due in three days.
 */
export async function billCampaign(campaignId: string): Promise<BillingResult> {
  if (!stripeConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const c = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!c) return { ok: false, error: 'not found' };
  if (c.paymentId) return { ok: true, message: 'already billed' };
  const sub = await db.subscription.findUnique({ where: { businessId: c.businessId }, select: { id: true } });
  // A business with no plan has no billing account yet; the placement stays an open charge for the accounting screen.
  if (!sub) return { ok: false, error: 'no_subscription' };
  const customer = await ensureCustomer(c.businessId);
  const weeksTotal = c.weeklyPriceAgorot * c.weeks;
  const amount = Math.round(weeksTotal * (1 - c.discountPct / 100));
  const card = await hasDefaultCard(customer);
  const meta = { site: SITE, purpose: 'sponsored', campaignId: c.id, businessId: c.businessId, ref: c.ref };
  const weekStart = c.weekStart.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' });

  const inv = await stripe().invoices.create(
    {
      customer,
      currency: 'ils',
      collection_method: card ? 'charge_automatically' : 'send_invoice',
      ...(card ? {} : { days_until_due: 3 }),
      pending_invoice_items_behavior: 'exclude',
      auto_advance: true,
      description: `מקום ממומן ${c.ref}`,
      metadata: meta,
    },
    { idempotencyKey: `bf-campaign-invoice-${c.id}` },
  );
  await stripe().invoiceItems.create(
    {
      customer,
      invoice: inv.id,
      currency: 'ils',
      amount,
      description: `מקום ממומן ${c.ref} · ${c.weeks === 1 ? 'שבוע אחד' : `${c.weeks} שבועות`} מ־${weekStart}${c.discountPct ? ` · הנחה ${c.discountPct}%` : ''}`,
      metadata: meta,
    },
    { idempotencyKey: `bf-campaign-item-${c.id}` },
  );
  const fin = await stripe().invoices.finalizeInvoice(inv.id!, { auto_advance: true });
  if (card) {
    try {
      await stripe().invoices.pay(fin.id!);
    } catch (e) {
      // A declined card: Stripe retries on its own schedule and emails the customer; the webhook records the outcome.
      console.warn('[billing] sponsored charge declined', c.ref, (e as Error).message);
    }
  } else {
    await stripe().invoices.sendInvoice(fin.id!);
  }
  return { ok: true, message: card ? 'charged' : 'invoice_sent' };
}

/** billCampaign that never throws. */
export async function billCampaignSafe(campaignId: string): Promise<void> {
  try {
    await billCampaign(campaignId);
  } catch (e) {
    console.error('[billing] sponsored invoice failed', campaignId, e);
  }
}

/** Plain-text lines of a Stripe invoice for our document record. */
function invoiceLines(inv: Stripe.Invoice) {
  return (inv.lines?.data ?? []).map(l => ({ description: l.description ?? 'BeautyFind', qty: l.quantity ?? 1, unitAgorot: l.quantity ? Math.round(l.amount / l.quantity) : l.amount }));
}

/**
 * Records a paid Stripe invoice: a platform Payment (income reports read these) and a platform invoice
 * Document with Stripe's number and PDF. Idempotent on the invoice id.
 */
export async function recordPaidInvoice(inv: Stripe.Invoice): Promise<void> {
  const customerId = customerIdOf(inv.customer);
  if (!customerId || !inv.id) return;
  const sub = await db.subscription.findUnique({ where: { stripeCustomerId: customerId } });
  if (!sub) return;
  if (!inv.amount_paid) return; // nothing was charged (a zero invoice)
  const exists = await db.payment.findFirst({ where: { provider: 'stripe', providerRef: inv.id }, select: { id: true } });
  if (exists) return;

  const purpose = inv.metadata?.purpose === 'sponsored' ? 'sponsored' : 'subscription';
  const paidAt = inv.status_transitions?.paid_at ? new Date(inv.status_transitions.paid_at * 1000) : new Date();
  const amount = inv.amount_paid;
  const b = await businessFacts(sub.businessId);
  const number = inv.number ?? inv.id;

  await db.$transaction(async tx => {
    const p = await tx.payment.create({
      data: {
        payee: 'platform', businessId: sub.businessId, payerName: inv.customer_name ?? b?.name ?? 'BeautyFind',
        payerEmail: inv.customer_email ?? null, purpose, netAgorot: amount, vatAgorot: 0, grossAgorot: amount,
        provider: 'stripe', providerRef: inv.id, cardBrand: sub.cardBrand, cardLast4: sub.cardLast4, status: 'succeeded', paidAt,
      },
    });
    await tx.document.create({
      data: {
        issuer: 'platform', businessId: sub.businessId, type: 'platform_invoice', number, paymentId: p.id,
        lines: invoiceLines(inv) as unknown as Prisma.InputJsonValue, netAgorot: amount, vatAgorot: 0, grossAgorot: amount,
        provider: 'stripe', providerRef: inv.id, pdfUrl: inv.invoice_pdf ?? inv.hosted_invoice_url ?? null, sentTo: inv.customer_email ?? null, issuedAt: paidAt,
      },
    });
    if (purpose === 'sponsored' && inv.metadata?.campaignId) {
      await tx.campaign.updateMany({ where: { id: inv.metadata.campaignId, paymentId: null }, data: { paymentId: p.id } });
    }
    await tx.auditLog.create({ data: { action: 'platform_payment', subjectType: 'payment', subjectId: p.id, businessId: sub.businessId, meta: { ref: number, purpose, gross: amount / 100, provider: 'stripe' } } });
  });
}

/** A failed subscription charge: past due from now, and the business shows as past due. */
export async function recordFailedInvoice(inv: Stripe.Invoice, subscriptionId: string | null): Promise<void> {
  if (!subscriptionId) return; // a sponsored invoice: Stripe retries and emails; nothing changes on the listing
  const s = await stripe().subscriptions.retrieve(subscriptionId);
  await applyStripeSubscription(s);
}

/**
 * Daily billing run (vercel.json cron): hides listings whose charge has failed for longer than the
 * admin's "hide in debt" days, and re-syncs every Stripe customer (starts subscriptions for businesses
 * that went live with a saved card, and fixes branch counts that changed).
 */
export async function runBillingCron(): Promise<{ synced: number; hidden: number; errors: number }> {
  const out = { synced: 0, hidden: 0, errors: 0 };
  if (!stripeConfigured()) return out;
  const s = await platformSettings();
  const cutoff = new Date(Date.now() - s.hideInDebtDays * 86_400_000);
  const overdue = await db.subscription.findMany({ where: { status: 'past_due', pastDueSince: { lte: cutoff }, stripeSubscriptionId: { not: null } }, select: { id: true, businessId: true } });
  for (const o of overdue) {
    await db.$transaction([
      db.subscription.update({ where: { id: o.id }, data: { status: 'hidden' } }),
      db.business.updateMany({ where: { id: o.businessId, status: { in: ['live', 'past_due'] } }, data: { status: 'hidden' } }),
      db.auditLog.create({ data: { action: 'subscription_hidden_debt', subjectType: 'subscription', subjectId: o.id, businessId: o.businessId, meta: { days: s.hideInDebtDays } } }),
    ]);
    out.hidden++;
  }
  const rows = await db.subscription.findMany({ where: { stripeCustomerId: { not: null }, status: { not: 'cancelled' } }, select: { businessId: true }, take: 2000 });
  for (const r of rows) {
    try {
      await syncBilling(r.businessId);
      out.synced++;
    } catch (e) {
      out.errors++;
      console.error('[billing] cron sync failed', r.businessId, e);
    }
  }
  return out;
}

export { priceId, stripeConfigured };
