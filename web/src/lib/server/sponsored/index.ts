import 'server-only';
import type Stripe from 'stripe';
import type { Campaign, CampaignPlacement, Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { cache } from 'react';
import { CATEGORIES, categoryBySlug, CITIES, regionBySlug } from '@/lib/catalog';
import {
  addMonth, FULL_REFUND_HOURS, HOLD_HOURS, monthlyNisFor, pageKeyOf, parsePageKey, pathOfPageKey, PLACEMENT_NAME, type PageTarget, type SponsoredCardData,
} from '@/lib/sponsored';
import { contentChecks, SPONSORED_LINE_MAX, type CheckResult } from '@/lib/sponsoredChecks';
import { customerIdOf, invoiceSubscriptionId, periodEndOf, SITE, stripe, stripeConfigured } from '../billing/stripe';
import { db } from '../db';
import { platformSettings } from '../platformSettings';
import { cardsByIds } from '../public';
import { nextRef } from '../refs';

// Sponsored placements by the month (docs/sponsored.md). One card in the sponsored slider of one page.
// - An owner (or staff, by phone) asks for a page; the slot is held for 24 hours while the content is checked.
// - On approval billing starts: a monthly Stripe subscription (metadata purpose=sponsored) on the business's
//   card. The first month is free for the first N businesses (platform settings). With no card on file the
//   owner gets a Checkout link that only saves the card; the subscription starts when it is saved.
// - The card shows while activeUntil (the paid or free month) has not passed. Every paid invoice extends it.
// - Cancelling before the start refunds in full; after the start the placement runs to the end of the paid month.
// - A month with fewer profile visits from the card than the make-good threshold gets 50% off the next month.
// Every Stripe object carries { site: 'beautyfind', purpose: 'sponsored', campaignId }, and handleSponsoredEvent
// claims those events before the platform-plan handlers see them.

export const PURPOSE = 'sponsored';
const DAY = 86_400_000;

export interface SponsoredConfig {
  listMonthlyNis: number;
  homeMonthlyNis: number;
  slots: number;
  freeMonthQuota: number;
  makeGoodVisits: number;
}

export async function sponsoredConfig(): Promise<SponsoredConfig> {
  const s = await platformSettings();
  return {
    listMonthlyNis: s.sponsoredListMonthlyNis,
    homeMonthlyNis: s.sponsoredHomeMonthlyNis,
    slots: s.sponsoredSlotsPerPage,
    freeMonthQuota: s.sponsoredFreeMonthQuota,
    makeGoodVisits: s.sponsoredMakeGoodVisits,
  };
}

/** Refreshes the cached public page of a placement (its slider changed). Outside a request it does nothing. */
function refreshPage(pageKey: string) {
  try {
    revalidatePath(pathOfPageKey(pageKey));
  } catch {}
}

// ---------- What is live, and where ----------

/** Campaigns whose card is showing right now. */
export const liveWhere = (now = new Date()): Prisma.CampaignWhereInput => ({ status: 'approved', startsAt: { lte: now }, endedAt: null, activeUntil: { gt: now } });

/** Campaigns that take a slot: live or about to be, approved and waiting for a card, or held for review. */
const reservedWhere = (now: Date): Prisma.CampaignWhereInput => ({
  OR: [
    { status: 'approved', endedAt: null, OR: [{ activeUntil: null }, { activeUntil: { gt: now } }] },
    { status: 'pending_review', holdUntil: { gt: now } },
  ],
});

/** Slots taken per page key. */
export async function slotsTaken(pageKeys: string[], exceptId?: string): Promise<Map<string, number>> {
  const out = new Map<string, number>(pageKeys.map(k => [k, 0]));
  if (!pageKeys.length) return out;
  const rows = await db.campaign.groupBy({ by: ['pageKey'], where: { AND: [reservedWhere(new Date()), { pageKey: { in: pageKeys } }, ...(exceptId ? [{ id: { not: exceptId } }] : [])] }, _count: { _all: true } });
  for (const r of rows) out.set(r.pageKey, r._count._all);
  return out;
}

/**
 * The cards of a page's sponsored slider, in a stable order (the client shuffles them on each page load).
 * Only live campaigns of public listings; never more than the slots per page. Cached per request.
 */
export const sponsoredCardsFor = cache(async (pageKey: string): Promise<SponsoredCardData[]> => {
  try {
    const cfg = await sponsoredConfig();
    if (cfg.slots <= 0) return [];
    const rows = await db.campaign.findMany({ where: { AND: [liveWhere(), { pageKey }] }, orderBy: { createdAt: 'asc' }, take: cfg.slots, select: { id: true, branchId: true, line: true, featuredTreatment: true, categorySlug: true } });
    if (!rows.length) return [];
    const cards = await cardsByIds([...new Set(rows.map(r => r.branchId))]);
    const byId = new Map(cards.map(c => [c.id, c]));
    const out: SponsoredCardData[] = [];
    for (const r of rows) {
      const c = byId.get(r.branchId);
      if (!c) continue; // a listing that went offline
      const cat = (r.categorySlug && c.categories.find(x => x.slug === r.categorySlug)) || c.categories[0];
      out.push({
        campaignId: r.id, branchId: c.id, href: c.href, name: c.name, line: r.line, featured: r.featuredTreatment,
        categoryName: cat?.name ?? null, cityName: c.cityName, coverUrl: c.coverUrl, coverAlt: c.coverAlt,
        google: c.google, beautyfind: c.beautyfind, verified: c.verified, priceFromShekels: c.priceFromShekels,
      });
    }
    return out;
  } catch (e) {
    // A sponsored slider must never take a public page down.
    console.error('[sponsored] cards failed', pageKey, e);
    return [];
  }
});

// ---------- What a business can buy ----------

export interface PageOption {
  pageKey: string;
  placement: CampaignPlacement;
  branchId: string;
  branchName: string;
  categorySlug: string | null;
  title: string; // "ציפורניים · תל אביב-יפו"
  path: string;
  monthlyNis: number;
  free: number; // free slots now
  slots: number;
}

/** Every page the business's live branches can be sponsored on, with the price and the free slots. */
export async function pageOptionsFor(businessId: string): Promise<PageOption[]> {
  const cfg = await sponsoredConfig();
  const branches = await db.branch.findMany({
    where: { businessId, status: 'live' },
    select: { id: true, name: true, regionSlug: true, city: { select: { slug: true } }, cityName: true, categories: { select: { categorySlug: true, isPrimary: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const opts: Omit<PageOption, 'free' | 'slots'>[] = [];
  const seen = new Set<string>();
  const push = (o: Omit<PageOption, 'free' | 'slots'>) => {
    if (seen.has(o.pageKey)) return;
    seen.add(o.pageKey);
    opts.push(o);
  };
  for (const b of branches) {
    const cats = b.categories.slice().sort((a, z) => Number(z.isPrimary) - Number(a.isPrimary)).map(c => c.categorySlug).filter(slug => categoryBySlug(slug));
    const city = b.city?.slug ? CITIES.find(c => c.slug === b.city!.slug && c.region === b.regionSlug) : undefined;
    for (const cat of cats) {
      if (!city) continue;
      const t: PageTarget = { placement: 'city_list', region: b.regionSlug, city: city.slug, category: cat };
      push({ pageKey: pageKeyOf(t), placement: 'city_list', branchId: b.id, branchName: b.name, categorySlug: cat, title: `${categoryBySlug(cat)!.name} · ${city.name}`, path: pathOfPageKey(pageKeyOf(t)), monthlyNis: cfg.listMonthlyNis });
    }
    for (const cat of cats) {
      const t: PageTarget = { placement: 'treatment_page', category: cat };
      push({ pageKey: pageKeyOf(t), placement: 'treatment_page', branchId: b.id, branchName: b.name, categorySlug: cat, title: `${categoryBySlug(cat)!.name} · כל הארץ`, path: pathOfPageKey(pageKeyOf(t)), monthlyNis: cfg.listMonthlyNis });
    }
  }
  if (branches[0]) push({ pageKey: 'home', placement: 'homepage', branchId: branches[0].id, branchName: branches[0].name, categorySlug: null, title: 'עמוד הבית', path: '/', monthlyNis: cfg.homeMonthlyNis });
  const taken = await slotsTaken(opts.map(o => o.pageKey));
  return opts.map(o => ({ ...o, slots: cfg.slots, free: Math.max(0, cfg.slots - (taken.get(o.pageKey) ?? 0)) }));
}

/** Human name of a campaign's page: "ציפורניים · תל אביב-יפו", "ציפורניים · כל הארץ", "עמוד הבית". */
export function pageTitle(c: Pick<Campaign, 'pageKey' | 'placement' | 'categorySlug' | 'citySlug' | 'regionSlug'>): string {
  const t = parsePageKey(c.pageKey);
  if (!t || t.placement === 'homepage') return PLACEMENT_NAME.homepage;
  const cat = categoryBySlug(t.category)?.name ?? t.category;
  if (t.placement === 'treatment_page') return `${cat} · כל הארץ`;
  const city = CITIES.find(x => x.slug === t.city && x.region === t.region)?.name ?? regionBySlug(t.region)?.name ?? t.city;
  return `${cat} · ${city}`;
}

// ---------- Ordering ----------

/** A medical category (the catalog's own flag): a placement there needs a verified doctor on the branch. */
export const isMedicalCategory = (slug: string | null | undefined) => !!(slug && categoryBySlug(slug)?.isMedical);

/** Whether this business would get the free first month: under the quota and no earlier free month. */
export async function freeMonthAvailable(businessId: string): Promise<boolean> {
  const cfg = await sponsoredConfig();
  if (cfg.freeMonthQuota <= 0) return false;
  const [mine, used] = await Promise.all([
    db.campaign.count({ where: { businessId, freeMonths: { gt: 0 }, status: { in: ['pending_review', 'approved'] } } }),
    db.campaign.groupBy({ by: ['businessId'], where: { freeMonths: { gt: 0 }, status: { in: ['pending_review', 'approved'] } } }),
  ]);
  if (mine > 0) return false;
  const alreadyPaidBefore = await db.campaign.count({ where: { businessId, status: { in: ['approved', 'cancelled'] }, reviewedAt: { not: null } } });
  return alreadyPaidBefore === 0 && used.length < cfg.freeMonthQuota;
}

export interface CampaignRequest {
  businessId: string;
  branchId: string;
  pageKey: string;
  line: string;
  featuredTreatment?: string | null;
  startsAt?: Date | null;
}

export type RequestResult = { ok: true; id: string; ref: string; free: boolean } | { ok: false; error: string };

/** A new placement waiting for review. The slot is held for 24 hours. */
export async function requestCampaign(input: CampaignRequest, actor: { userId: string | null; via: 'owner' | 'ops' }): Promise<RequestResult> {
  const line = input.line.trim();
  if (line.length < 3) return { ok: false, error: 'כתבו שורת הדגשה' };
  if ([...line].length > SPONSORED_LINE_MAX) return { ok: false, error: `שורת ההדגשה ארוכה מ־${SPONSORED_LINE_MAX} תווים` };
  const target = parsePageKey(input.pageKey);
  if (!target) return { ok: false, error: 'עמוד לא מוכר' };
  const branch = await db.branch.findUnique({ where: { id: input.branchId }, select: { id: true, businessId: true, status: true, regionSlug: true, city: { select: { slug: true } }, categories: { select: { categorySlug: true } } } });
  if (!branch || branch.businessId !== input.businessId) return { ok: false, error: 'הסניף לא נמצא' };
  if (branch.status !== 'live') return { ok: false, error: 'אפשר לפרסם רק סניף שמופיע באתר' };
  const cats = new Set(branch.categories.map(c => c.categorySlug));
  // A business can only be sponsored where it is really listed: its own city and categories.
  if (target.placement === 'city_list' && (target.region !== branch.regionSlug || target.city !== branch.city?.slug || !cats.has(target.category))) return { ok: false, error: 'אפשר לפרסם רק ברשימה של העיר והתחום שבהם העסק רשום' };
  if (target.placement === 'treatment_page' && !cats.has(target.category)) return { ok: false, error: 'אפשר לפרסם רק בתחום שבו העסק רשום' };

  const cfg = await sponsoredConfig();
  const taken = (await slotsTaken([input.pageKey])).get(input.pageKey) ?? 0;
  if (taken >= cfg.slots) return { ok: false, error: 'כל המקומות בעמוד הזה תפוסים כרגע. אפשר לבחור עמוד אחר או לנסות שוב בהמשך.' };
  const dup = await db.campaign.findFirst({ where: { AND: [reservedWhere(new Date()), { branchId: branch.id, pageKey: input.pageKey }] }, select: { ref: true } });
  if (dup) return { ok: false, error: `לסניף כבר יש מקום בעמוד הזה (${dup.ref})` };

  const free = await freeMonthAvailable(input.businessId);
  const ref = await nextRef('AD', 2);
  const checks = contentChecks(line, input.featuredTreatment);
  const c = await db.campaign.create({
    data: {
      ref, businessId: branch.businessId, branchId: branch.id,
      placement: target.placement, pageKey: input.pageKey,
      regionSlug: target.placement === 'city_list' ? branch.regionSlug : null,
      citySlug: target.placement === 'city_list' ? target.city : null,
      categorySlug: target.placement === 'homepage' ? null : target.category,
      startsAt: input.startsAt && input.startsAt.getTime() > Date.now() ? input.startsAt : new Date(),
      line, featuredTreatment: input.featuredTreatment?.trim() || null,
      monthlyPriceAgorot: monthlyNisFor(target.placement, cfg) * 100,
      freeMonths: free ? 1 : 0,
      holdUntil: new Date(Date.now() + HOLD_HOURS * 3_600_000),
      checks: checks as unknown as Prisma.InputJsonValue,
    },
  });
  await db.auditLog.create({ data: { actorId: actor.userId, action: 'campaign_order', subjectType: 'campaign', subjectId: c.id, businessId: c.businessId, meta: { ref, pageKey: c.pageKey, via: actor.via, monthly: c.monthlyPriceAgorot / 100, free } } });
  const { alertOps } = await import('../alerts');
  await alertOps(`campaign-new:${c.id}`, `מקום ממומן חדש לבדיקה ${ref}: ${pageTitle(c)}, ${(c.monthlyPriceAgorot / 100).toLocaleString('en-US')} ₪ לחודש${free ? ' (חודש ראשון חינם)' : ''}.`).catch(() => undefined);
  return { ok: true, id: c.id, ref, free };
}

/** The automatic checks a reviewer sees: content, the medical responsible, the branch, capacity, debt. */
export async function reviewChecks(c: Campaign): Promise<{ checks: CheckResult[]; taken: number; slots: number }> {
  const cfg = await sponsoredConfig();
  const checks = contentChecks(c.line, c.featuredTreatment);
  const [branch, business, taken] = await Promise.all([
    db.branch.findUnique({ where: { id: c.branchId }, select: { status: true, categories: { select: { categorySlug: true } }, medicalResponsible: { select: { profession: true, license: { select: { status: true } } } } } }),
    db.business.findUnique({ where: { id: c.businessId }, select: { status: true, subscription: { select: { status: true } } } }),
    slotsTaken([c.pageKey], c.id).then(m => m.get(c.pageKey) ?? 0),
  ]);
  // A medical page: the category itself, or the homepage for a branch with medical categories.
  const medical = c.categorySlug ? isMedicalCategory(c.categorySlug) : !!branch?.categories.some(x => isMedicalCategory(x.categorySlug));
  if (medical) {
    const doc = branch?.medicalResponsible;
    if (doc?.profession === 'doctor' && doc.license?.status === 'verified') checks.push({ result: 'ok', text: 'הרופא/ה האחראי/ת מאומת/ת' });
    else checks.push({ result: 'bad', text: 'תחום רפואי ללא רופא/ה אחראי/ת מאומת/ת בסניף' });
  }
  if (!branch || branch.status !== 'live') checks.push({ result: 'bad', text: 'הסניף אינו מפורסם' });
  if (taken < cfg.slots) checks.push({ result: 'ok', text: `יש מקום פנוי בעמוד: ${taken + 1} מתוך ${cfg.slots}` });
  else checks.push({ result: 'bad', text: `העמוד מלא: ${taken} מתוך ${cfg.slots} מקומות תפוסים` });
  if (business?.status === 'past_due' || business?.subscription?.status === 'past_due') checks.push({ result: 'warn', text: 'לעסק חוב פתוח על המנוי' });
  return { checks, taken, slots: cfg.slots };
}

// ---------- Billing ----------

export type ActivateResult = { ok: true; state: 'billing' | 'free_month' | 'needs_card' | 'manual' } | { ok: false; error: string };

/** The Stripe customer for sponsored charges: the plan's customer when the business has one, otherwise its own. */
async function sponsoredCustomer(businessId: string): Promise<string> {
  const sub = await db.subscription.findUnique({ where: { businessId }, select: { stripeCustomerId: true } });
  if (sub?.stripeCustomerId) return sub.stripeCustomerId;
  const prev = await db.campaign.findFirst({ where: { businessId, stripeCustomerId: { not: null } }, select: { stripeCustomerId: true }, orderBy: { createdAt: 'desc' } });
  if (prev?.stripeCustomerId) return prev.stripeCustomerId;
  const b = await db.business.findUnique({ where: { id: businessId }, select: { legalName: true, invoiceEmail: true, owner: { select: { email: true, phone: true } }, branches: { select: { name: true }, orderBy: { createdAt: 'asc' }, take: 1 } } });
  const name = b?.branches[0]?.name ?? b?.legalName ?? 'BeautyFind';
  // A separate customer, never written to the plan subscription row: saving a card for a placement must not start a plan.
  const c = await stripe().customers.create(
    { name: b?.legalName ? `${name} (${b.legalName})` : name, email: b?.invoiceEmail ?? b?.owner?.email ?? undefined, phone: b?.owner?.phone ?? undefined, preferred_locales: ['en'], metadata: { site: SITE, businessId, purpose: PURPOSE } },
    { idempotencyKey: `bf-sp-customer-${businessId}` },
  );
  return c.id;
}

async function defaultCard(customerId: string): Promise<string | null> {
  const c = await stripe().customers.retrieve(customerId);
  if ('deleted' in c && c.deleted) return null;
  const pm = (c as Stripe.Customer).invoice_settings?.default_payment_method;
  return typeof pm === 'string' ? pm : pm?.id ?? null;
}

/** The monthly Stripe price for a placement kind and amount, created once (lookup key per amount). */
async function sponsoredPrice(placement: CampaignPlacement, agorot: number): Promise<string> {
  const kind = placement === 'homepage' ? 'home' : 'list';
  const product = `beautyfind_sponsored_${kind}`;
  const name = placement === 'homepage' ? 'BeautyFind · מקום ממומן בעמוד הבית' : 'BeautyFind · מקום ממומן ברשימה';
  const meta = { site: SITE, purpose: PURPOSE, kind };
  try {
    await stripe().products.retrieve(product);
  } catch (e) {
    if ((e as Stripe.errors.StripeError)?.statusCode !== 404) throw e;
    await stripe().products.create({ id: product, name, type: 'service', statement_descriptor: 'BEAUTYFIND', metadata: meta }, { idempotencyKey: `bf-sp-product-${product}` });
  }
  const lookup = `beautyfind_sponsored_${kind}_monthly_${agorot}`;
  const list = await stripe().prices.list({ lookup_keys: [lookup], active: true, limit: 1 });
  if (list.data[0]) return list.data[0].id;
  const price = await stripe().prices.create(
    { product, currency: 'ils', unit_amount: agorot, recurring: { interval: 'month' }, lookup_key: lookup, nickname: `${name} · ${agorot / 100} ₪ לחודש`, tax_behavior: 'exclusive', metadata: meta },
    { idempotencyKey: `bf-sp-price-${lookup}` },
  );
  return price.id;
}

const metaOf = (c: Pick<Campaign, 'id' | 'ref' | 'businessId'>) => ({ site: SITE, purpose: PURPOSE, campaignId: c.id, ref: c.ref, businessId: c.businessId });

/**
 * Starts an approved placement: the monthly subscription on the saved card (a free first month is a trial),
 * or, with no card, waits for the owner to save one. Without Stripe the placement runs one month (staff bill it).
 */
export async function activateCampaign(id: string): Promise<ActivateResult> {
  const c = await db.campaign.findUnique({ where: { id } });
  if (!c) return { ok: false, error: 'not found' };
  if (c.status !== 'approved' || c.endedAt) return { ok: false, error: 'not approved' };
  if (c.stripeSubscriptionId) return { ok: true, state: 'billing' };
  const now = new Date();
  const start = c.startsAt.getTime() > now.getTime() ? c.startsAt : now;

  if (!stripeConfigured()) {
    await db.campaign.update({ where: { id }, data: { startsAt: start, activeUntil: addMonth(start, 1 + c.freeMonths) } });
    refreshPage(c.pageKey);
    return { ok: true, state: 'manual' };
  }
  const customer = c.stripeCustomerId ?? (await sponsoredCustomer(c.businessId));
  if (!c.stripeCustomerId) await db.campaign.update({ where: { id }, data: { stripeCustomerId: customer } });
  const pm = await defaultCard(customer);
  if (!pm) {
    await db.campaign.update({ where: { id }, data: { startsAt: start } });
    return { ok: true, state: 'needs_card' };
  }
  // A free month is a trial; a start in the future waits as a trial too (no charge before it runs).
  const trialEnd = c.freeMonths > 0 ? addMonth(start, c.freeMonths) : start.getTime() > now.getTime() + 3_600_000 ? start : null;
  const sub = await stripe().subscriptions.create(
    {
      customer,
      items: [{ price: await sponsoredPrice(c.placement, c.monthlyPriceAgorot) }],
      default_payment_method: pm,
      collection_method: 'charge_automatically',
      payment_behavior: 'allow_incomplete',
      proration_behavior: 'none',
      description: `מקום ממומן ${c.ref} · ${pageTitle(c)}`,
      metadata: metaOf(c),
      ...(trialEnd ? { trial_end: Math.floor(trialEnd.getTime() / 1000) } : {}),
    },
    { idempotencyKey: `bf-sp-sub-${c.id}` },
  );
  const paidThrough = sub.status === 'active' ? periodEndOf(sub) : null;
  await db.campaign.update({
    where: { id },
    data: { stripeSubscriptionId: sub.id, startsAt: start, activeUntil: c.freeMonths > 0 ? trialEnd : paidThrough },
  });
  refreshPage(c.pageKey);
  return { ok: true, state: c.freeMonths > 0 ? 'free_month' : 'billing' };
}

/** activateCampaign that never throws. */
export async function activateCampaignSafe(id: string): Promise<ActivateResult> {
  try {
    return await activateCampaign(id);
  } catch (e) {
    console.error('[sponsored] activation failed', id, e);
    const { alertOps } = await import('../alerts');
    await alertOps(`campaign-activate:${id}`, `הפעלת מקום ממומן נכשלה (${id}): ${(e as Error).message}`).catch(() => undefined);
    return { ok: false, error: 'החיוב לא הופעל; הצוות עודכן' };
  }
}

function siteUrl(): string {
  return (process.env.SITE_URL ?? 'https://beautyfind.co.il').replace(/\/+$/, '');
}

/** Stripe Checkout that only saves a card for this placement (no charge); billing starts when it is approved. */
export async function cardCheckoutUrl(campaignId: string, businessId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!stripeConfigured()) return { ok: false, error: 'החיוב אונליין עדיין לא מחובר. נחזור אליכם לתיאום התשלום.' };
  const c = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!c || c.businessId !== businessId) return { ok: false, error: 'לא נמצא' };
  const customer = c.stripeCustomerId ?? (await sponsoredCustomer(c.businessId));
  if (!c.stripeCustomerId) await db.campaign.update({ where: { id: c.id }, data: { stripeCustomerId: customer } });
  const session = await stripe().checkout.sessions.create({
    mode: 'setup',
    currency: 'ils',
    customer,
    locale: 'auto',
    client_reference_id: c.id,
    metadata: metaOf(c),
    setup_intent_data: { metadata: metaOf(c), description: `מקום ממומן ${c.ref}` },
    success_url: `${siteUrl()}/biz/sponsored?card=saved&c=${c.ref}`,
    cancel_url: `${siteUrl()}/biz/sponsored?card=cancelled&c=${c.ref}`,
  });
  if (!session.url) return { ok: false, error: 'לא הצלחנו לפתוח את דף שמירת הכרטיס' };
  return { ok: true, url: session.url };
}

/** Whether the business already has a card that sponsored charges can use. */
export async function hasSponsoredCard(businessId: string): Promise<boolean> {
  if (!stripeConfigured()) return false;
  try {
    const sub = await db.subscription.findUnique({ where: { businessId }, select: { stripeCustomerId: true, cardLast4: true } });
    if (sub?.stripeCustomerId && sub.cardLast4) return true;
    const prev = await db.campaign.findFirst({ where: { businessId, stripeCustomerId: { not: null } }, select: { stripeCustomerId: true }, orderBy: { createdAt: 'desc' } });
    const customer = sub?.stripeCustomerId ?? prev?.stripeCustomerId;
    return customer ? !!(await defaultCard(customer)) : false;
  } catch {
    return false;
  }
}

export type CancelResult = { ok: true; message: string } | { ok: false; error: string };

/** Cancels a placement. Before it starts (or 48 hours before): ends now with a full refund. After: runs to the end of the paid month. */
export async function cancelCampaign(id: string, actor: { userId: string | null; businessId?: string }): Promise<CancelResult> {
  const c = await db.campaign.findUnique({ where: { id } });
  if (!c || (actor.businessId && c.businessId !== actor.businessId)) return { ok: false, error: 'לא נמצא' };
  if (c.status === 'cancelled' || c.status === 'rejected' || c.endedAt) return { ok: false, error: 'המקום כבר לא פעיל' };
  const now = new Date();
  const audit = (mode: string) => db.auditLog.create({ data: { actorId: actor.userId, action: 'campaign_cancel', subjectType: 'campaign', subjectId: c.id, businessId: c.businessId, meta: { ref: c.ref, mode } } });

  if (c.status === 'pending_review') {
    await db.campaign.update({ where: { id }, data: { status: 'cancelled', holdUntil: null, endedAt: now } });
    await audit('pending');
    return { ok: true, message: 'הבקשה בוטלה. לא בוצע חיוב.' };
  }
  const started = c.activeUntil != null && c.startsAt.getTime() <= now.getTime();
  const earlyEnough = c.startsAt.getTime() - now.getTime() >= FULL_REFUND_HOURS * 3_600_000;
  if (!started || earlyEnough) {
    if (c.stripeSubscriptionId && stripeConfigured()) {
      await stripe().subscriptions.cancel(c.stripeSubscriptionId, { prorate: false, invoice_now: false }).catch(e => console.warn('[sponsored] cancel', e));
      await refundLatest(c.stripeSubscriptionId);
    }
    await db.campaign.update({ where: { id }, data: { status: 'cancelled', endedAt: now, activeUntil: now, cancelAtPeriodEnd: false } });
    refreshPage(c.pageKey);
    await audit('before_start');
    return { ok: true, message: 'המקום בוטל לפני שעלה, וכל סכום שנגבה יוחזר במלואו.' };
  }
  if (c.stripeSubscriptionId && stripeConfigured()) await stripe().subscriptions.update(c.stripeSubscriptionId, { cancel_at_period_end: true });
  await db.campaign.update({ where: { id }, data: { cancelAtPeriodEnd: true } });
  await audit('period_end');
  const until = c.activeUntil ? c.activeUntil.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' }) : '';
  return { ok: true, message: until ? `החידוש בוטל. הכרטיס ימשיך להופיע עד ${until}, ולא יהיו חיובים נוספים.` : 'החידוש בוטל ולא יהיו חיובים נוספים.' };
}

/** Undo a cancellation that has not taken effect yet. */
export async function resumeCampaign(id: string, businessId: string): Promise<CancelResult> {
  const c = await db.campaign.findUnique({ where: { id } });
  if (!c || c.businessId !== businessId) return { ok: false, error: 'לא נמצא' };
  if (!c.cancelAtPeriodEnd || c.endedAt) return { ok: false, error: 'אין ביטול לבטל' };
  if (c.stripeSubscriptionId && stripeConfigured()) await stripe().subscriptions.update(c.stripeSubscriptionId, { cancel_at_period_end: false });
  await db.campaign.update({ where: { id }, data: { cancelAtPeriodEnd: false } });
  return { ok: true, message: 'החידוש החודשי חזר לפעול.' };
}

/** Refunds the last paid invoice of a sponsored subscription, if there is one. */
async function refundLatest(subscriptionId: string): Promise<void> {
  try {
    const invs = await stripe().invoices.list({ subscription: subscriptionId, status: 'paid', limit: 1 });
    const inv = invs.data[0] as unknown as { id: string; amount_paid: number; payment_intent?: string | { id: string } | null; charge?: string | { id: string } | null } | undefined;
    if (!inv || !inv.amount_paid) return;
    const pi = typeof inv.payment_intent === 'string' ? inv.payment_intent : inv.payment_intent?.id;
    const ch = typeof inv.charge === 'string' ? inv.charge : inv.charge?.id;
    if (pi) await stripe().refunds.create({ payment_intent: pi, metadata: { site: SITE, purpose: PURPOSE } });
    else if (ch) await stripe().refunds.create({ charge: ch, metadata: { site: SITE, purpose: PURPOSE } });
    else {
      const { alertOps } = await import('../alerts');
      await alertOps(`campaign-refund:${inv.id}`, `יש להחזיר ידנית ב־Stripe את החשבונית ${inv.id} (מקום ממומן שבוטל לפני שעלה).`);
    }
  } catch (e) {
    console.error('[sponsored] refund failed', subscriptionId, e);
  }
}

// ---------- Stripe events ----------

const isSponsored = (m: Stripe.Metadata | null | undefined) => m?.site === SITE && m?.purpose === PURPOSE;

async function campaignOfSubscription(sub: Stripe.Subscription): Promise<Campaign | null> {
  if (isSponsored(sub.metadata) && sub.metadata.campaignId) return db.campaign.findUnique({ where: { id: sub.metadata.campaignId } });
  return db.campaign.findUnique({ where: { stripeSubscriptionId: sub.id } });
}

async function campaignOfInvoice(inv: Stripe.Invoice): Promise<Campaign | null> {
  const parentMeta = (inv as unknown as { parent?: { subscription_details?: { metadata?: Stripe.Metadata | null } | null } | null }).parent?.subscription_details?.metadata;
  const meta = isSponsored(inv.metadata) ? inv.metadata : isSponsored(parentMeta) ? parentMeta : inv.lines?.data?.map(l => l.metadata).find(m => isSponsored(m));
  if (meta?.campaignId) return db.campaign.findUnique({ where: { id: meta.campaignId } });
  const subId = invoiceSubscriptionId(inv);
  return subId ? db.campaign.findUnique({ where: { stripeSubscriptionId: subId } }) : null;
}

/** Writes a sponsored subscription's state back to its campaign. */
export async function applySponsoredSubscription(sub: Stripe.Subscription): Promise<void> {
  const c = await campaignOfSubscription(sub);
  if (!c) return;
  const now = new Date();
  if (sub.status === 'canceled' || sub.status === 'incomplete_expired') {
    if (!c.endedAt) await db.campaign.update({ where: { id: c.id }, data: { status: c.status === 'approved' ? 'cancelled' : c.status, endedAt: now, cancelAtPeriodEnd: false, ...(c.activeUntil && c.activeUntil > now ? { activeUntil: now } : {}) } });
    refreshPage(c.pageKey);
    return;
  }
  const data: Prisma.CampaignUpdateInput = { cancelAtPeriodEnd: !!sub.cancel_at_period_end, stripeSubscriptionId: sub.id };
  if (sub.status === 'trialing' && c.freeMonths > 0 && sub.trial_end) data.activeUntil = new Date(sub.trial_end * 1000);
  if (sub.status === 'active') {
    const end = periodEndOf(sub);
    if (end && (!c.activeUntil || end > c.activeUntil)) data.activeUntil = end;
  }
  await db.campaign.update({ where: { id: c.id }, data });
  if (data.activeUntil !== undefined && !c.activeUntil) refreshPage(c.pageKey);
}

async function recordSponsoredPayment(c: Campaign, inv: Stripe.Invoice): Promise<void> {
  if (!inv.id || !inv.amount_paid) return;
  const exists = await db.payment.findFirst({ where: { provider: 'stripe', providerRef: inv.id }, select: { id: true } });
  if (exists) return;
  const paidAt = inv.status_transitions?.paid_at ? new Date(inv.status_transitions.paid_at * 1000) : new Date();
  const amount = inv.amount_paid;
  const branch = await db.branch.findUnique({ where: { id: c.branchId }, select: { name: true } });
  const number = inv.number ?? inv.id;
  const lines = (inv.lines?.data ?? []).map(l => ({ description: l.description ?? `מקום ממומן ${c.ref}`, qty: l.quantity ?? 1, unitAgorot: l.quantity ? Math.round(l.amount / l.quantity) : l.amount }));
  await db.$transaction(async tx => {
    const p = await tx.payment.create({
      data: {
        payee: 'platform', businessId: c.businessId, payerName: inv.customer_name ?? branch?.name ?? 'BeautyFind', payerEmail: inv.customer_email ?? null,
        purpose: 'sponsored', netAgorot: amount, vatAgorot: 0, grossAgorot: amount, provider: 'stripe', providerRef: inv.id, status: 'succeeded', paidAt,
      },
    });
    await tx.document.create({
      data: {
        issuer: 'platform', businessId: c.businessId, type: 'platform_invoice', number, paymentId: p.id,
        lines: lines as unknown as Prisma.InputJsonValue, netAgorot: amount, vatAgorot: 0, grossAgorot: amount,
        provider: 'stripe', providerRef: inv.id, pdfUrl: inv.invoice_pdf ?? inv.hosted_invoice_url ?? null, sentTo: inv.customer_email ?? null, issuedAt: paidAt,
      },
    });
    await tx.campaign.update({ where: { id: c.id }, data: { paymentId: p.id } });
    await tx.auditLog.create({ data: { action: 'platform_payment', subjectType: 'payment', subjectId: p.id, businessId: c.businessId, meta: { ref: number, purpose: 'sponsored', campaign: c.ref, gross: amount / 100, provider: 'stripe' } } });
  });
}

/**
 * Claims the Stripe events of sponsored placements. Returns null for anything else, so the plan and
 * marketing handlers run as before.
 */
export async function handleSponsoredEvent(ev: Stripe.Event): Promise<'handled' | 'ignored' | null> {
  switch (ev.type) {
    case 'checkout.session.completed': {
      const s = ev.data.object as Stripe.Checkout.Session;
      if (!isSponsored(s.metadata)) return null;
      const customer = customerIdOf(s.customer);
      const id = s.metadata?.campaignId ?? s.client_reference_id;
      if (customer && s.mode === 'setup' && s.setup_intent) {
        const si = await stripe().setupIntents.retrieve(typeof s.setup_intent === 'string' ? s.setup_intent : s.setup_intent.id);
        const pm = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id;
        if (pm) await stripe().customers.update(customer, { invoice_settings: { default_payment_method: pm } });
      }
      if (id) {
        if (customer) await db.campaign.updateMany({ where: { id, stripeCustomerId: null }, data: { stripeCustomerId: customer } });
        const c = await db.campaign.findUnique({ where: { id }, select: { status: true, stripeSubscriptionId: true } });
        // Approved while waiting for a card: billing starts now.
        if (c?.status === 'approved' && !c.stripeSubscriptionId) await activateCampaignSafe(id);
      }
      return 'handled';
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = ev.data.object as Stripe.Subscription;
      if (!isSponsored(sub.metadata)) return null;
      await applySponsoredSubscription(ev.type === 'customer.subscription.deleted' ? sub : await stripe().subscriptions.retrieve(sub.id));
      return 'handled';
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const inv = ev.data.object as Stripe.Invoice;
      const c = await campaignOfInvoice(inv).catch(() => null);
      if (!c) return null;
      if (ev.type === 'invoice.paid') {
        await recordSponsoredPayment(c, inv);
        const subId = invoiceSubscriptionId(inv);
        if (subId) await applySponsoredSubscription(await stripe().subscriptions.retrieve(subId));
      } else {
        const { alertOps } = await import('../alerts');
        await alertOps(`campaign-charge-failed:${inv.id}`, `חיוב מקום ממומן ${c.ref} נכשל: ${(inv.amount_due / 100).toFixed(2)} ₪. Stripe ינסה שוב; הכרטיס ייעלם מהאתר בסוף החודש ששולם אם החיוב לא יעבור.`).catch(() => undefined);
      }
      return 'handled';
    }
    default:
      return null;
  }
}

// ---------- Stats ----------

/** Today in Israel, as a UTC midnight Date (the @db.Date key). */
export function israelDay(d = new Date()): Date {
  const [y, m, day] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export type StatKind = 'impression' | 'click' | 'contact';

/** Adds to today's counters of live campaigns. Unknown or ended campaigns are ignored. */
export async function recordSponsoredStats(ids: string[], kind: StatKind): Promise<number> {
  const unique = [...new Set(ids)].slice(0, 20);
  if (!unique.length) return 0;
  const live = await db.campaign.findMany({ where: { AND: [liveWhere(), { id: { in: unique } }] }, select: { id: true } });
  const day = israelDay();
  const field = kind === 'impression' ? 'impressions' : kind === 'click' ? 'clicks' : 'contacts';
  for (const { id } of live) {
    await db.sponsoredStat.upsert({ where: { campaignId_day: { campaignId: id, day } }, create: { campaignId: id, day, [field]: 1 }, update: { [field]: { increment: 1 } } });
  }
  return live.length;
}

export interface StatTotals { impressions: number; clicks: number; contacts: number }

/** Totals per campaign since a date (all time when omitted). */
export async function statTotals(ids: string[], since?: Date): Promise<Map<string, StatTotals>> {
  const out = new Map<string, StatTotals>();
  if (!ids.length) return out;
  const rows = await db.sponsoredStat.groupBy({ by: ['campaignId'], where: { campaignId: { in: ids }, ...(since ? { day: { gte: israelDay(since) } } : {}) }, _sum: { impressions: true, clicks: true, contacts: true } });
  for (const r of rows) out.set(r.campaignId, { impressions: r._sum.impressions ?? 0, clicks: r._sum.clicks ?? 0, contacts: r._sum.contacts ?? 0 });
  return out;
}

/** Daily series for one campaign (last N days), for the dashboard chart. */
export async function statSeries(id: string, days = 30): Promise<Array<{ day: string } & StatTotals>> {
  const since = israelDay(new Date(Date.now() - (days - 1) * DAY));
  const rows = await db.sponsoredStat.findMany({ where: { campaignId: id, day: { gte: since } }, orderBy: { day: 'asc' } });
  const byDay = new Map(rows.map(r => [r.day.toISOString().slice(0, 10), r]));
  const out: Array<{ day: string } & StatTotals> = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * DAY).toISOString().slice(0, 10);
    const r = byDay.get(d);
    out.push({ day: d, impressions: r?.impressions ?? 0, clicks: r?.clicks ?? 0, contacts: r?.contacts ?? 0 });
  }
  return out;
}

// ---------- Daily run ----------

const MAKE_GOOD_COUPON = 'beautyfind_sponsored_makegood';

async function ensureMakeGoodCoupon(): Promise<string> {
  try {
    await stripe().coupons.retrieve(MAKE_GOOD_COUPON);
  } catch (e) {
    if ((e as Stripe.errors.StripeError)?.statusCode !== 404) throw e;
    await stripe().coupons.create({ id: MAKE_GOOD_COUPON, percent_off: 50, duration: 'once', name: 'BeautyFind · 50% על החודש הבא', metadata: { site: SITE, purpose: PURPOSE } });
  }
  return MAKE_GOOD_COUPON;
}

/**
 * Daily (billing cron): ends placements whose last paid month is over, starts billing for approved ones whose
 * card arrived, and gives the make-good discount to a month that brought too few profile visits.
 */
export async function runSponsoredCron(): Promise<{ ended: number; started: number; madeGood: number; errors: number }> {
  const out = { ended: 0, started: 0, madeGood: 0, errors: 0 };
  const now = new Date();
  // Ended: the paid month passed and nothing renews it (cancelled, or a charge that never went through). Three days of grace for retries.
  const over = await db.campaign.findMany({ where: { status: 'approved', endedAt: null, activeUntil: { lt: new Date(now.getTime() - 3 * DAY) } }, select: { id: true, pageKey: true } });
  for (const c of over) {
    await db.campaign.update({ where: { id: c.id }, data: { status: 'cancelled', endedAt: now } });
    refreshPage(c.pageKey);
    out.ended++;
  }
  if (!stripeConfigured()) return out;
  const waiting = await db.campaign.findMany({ where: { status: 'approved', endedAt: null, stripeSubscriptionId: null, activeUntil: null }, select: { id: true } });
  for (const c of waiting) {
    const r = await activateCampaignSafe(c.id);
    if (r.ok && r.state !== 'needs_card') out.started++;
    if (!r.ok) out.errors++;
  }
  const cfg = await sponsoredConfig();
  if (cfg.makeGoodVisits <= 0) return out;
  const renewing = await db.campaign.findMany({
    where: { AND: [liveWhere(now), { stripeSubscriptionId: { not: null }, cancelAtPeriodEnd: false, activeUntil: { lte: new Date(now.getTime() + 3 * DAY) } }] },
    select: { id: true, ref: true, activeUntil: true, stats: true, stripeSubscriptionId: true, freeMonths: true, startsAt: true },
  });
  for (const c of renewing) {
    const mark = c.activeUntil!.toISOString();
    const st = (c.stats ?? {}) as { makeGoodFor?: string };
    if (st.makeGoodFor === mark) continue;
    const from = addMonth(c.activeUntil!, -1);
    const totals = (await statTotals([c.id], from > c.startsAt ? from : c.startsAt)).get(c.id) ?? { impressions: 0, clicks: 0, contacts: 0 };
    if (totals.clicks >= cfg.makeGoodVisits) continue;
    try {
      await stripe().subscriptions.update(c.stripeSubscriptionId!, { discounts: [{ coupon: await ensureMakeGoodCoupon() }] });
      await db.campaign.update({ where: { id: c.id }, data: { stats: { ...st, makeGoodFor: mark, makeGoodClicks: totals.clicks } as Prisma.InputJsonValue } });
      out.madeGood++;
    } catch (e) {
      console.error('[sponsored] make-good failed', c.ref, e);
      out.errors++;
    }
  }
  return out;
}

/** Category name for a campaign (null for the homepage). */
export const campaignCategoryName = (c: Pick<Campaign, 'categorySlug'>) => (c.categorySlug ? CATEGORIES.find(x => x.slug === c.categorySlug)?.name ?? c.categorySlug : null);

