import 'server-only';
import { CATEGORIES, REGIONS } from '../catalog';
import { nisFromAgorot } from '../format';
import { ilDate } from '../time';
import { unsubscribeUrl } from '@/components/unsubscribe/token';
import { bookingToken } from './bookingLink';
import { db } from './db';
import { platformSettings } from './platformSettings';
import { enqueue, registerGuard, type Automation, type SendChannel } from './scheduler';
import { siteUrl } from './site';

// The automations: scanners that queue messages (run by /api/cron/messages before the queue is sent), and the
// check each one runs right before a message goes out. Every message has a stable key, so a scanner can run
// any number of times and still queue each message once.
//
//   review_request  M6   3 days after a completed booking, unless the client already reviewed. Stale after 14 days.
//   gift_delivery   M14  a gift card the buyer scheduled, on the send date. Never stale.
//   gift_expiry     M15  90 and 30 days before a gift card with a balance expires.
//   payment_failed  M23  days 0, 3, 7 and 14 of a failed subscription charge, while it is still unpaid.
//   sponsored       M22  placement approved, rejected, started and ended.
//   onboarding           welcome (first 2 days), finish the profile (day 3), add a card (day 5).
//   claim_invite         one invite per unclaimed business, queued by staff in batches (queueClaimInvites).

const DAY = 86_400_000;
const at = (ms: number) => new Date(ms);
const isMobile = (p: string | null | undefined): p is string => !!p && /^\+9725\d{8}$/.test(p);
const isEmail = (e: string | null | undefined): e is string => !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const catName = (slug: string) => CATEGORIES.find(c => c.slug === slug)?.name ?? slug;
const regionName = (slug: string) => REGIONS.find(r => r.slug === slug)?.name ?? slug;

/** How to reach a person: email first (SMS meanwhile if email is not connected), else the phone. */
function route(email: string | null | undefined, phone: string | null | undefined): { channel: SendChannel; to: string; fallbackPhone: string | null } | null {
  if (isEmail(email)) return { channel: 'email', to: email.trim(), fallbackPhone: phone || null };
  if (phone) return { channel: 'whatsapp', to: phone, fallbackPhone: null };
  return null;
}

async function ownerOf(businessId: string) {
  const b = await db.business.findUnique({
    where: { id: businessId },
    select: { invoiceEmail: true, owner: { select: { email: true, phone: true, fullName: true } }, branches: { select: { name: true, status: true }, orderBy: { createdAt: 'asc' }, take: 1 } },
  });
  if (!b?.owner) return null;
  return { name: b.owner.fullName ?? '', business: b.branches[0]?.name ?? '', route: route(b.owner.email ?? b.invoiceEmail, b.owner.phone) };
}

export interface PlanRun { queued: Partial<Record<Automation, number>> }

export async function planAutomations(now = new Date()): Promise<PlanRun> {
  const s = (await platformSettings()).automations;
  const out: PlanRun = { queued: {} };
  const add = (a: Automation, ok: boolean) => { if (ok) out.queued[a] = (out.queued[a] ?? 0) + 1; };
  const site = siteUrl();
  const steps: Array<Promise<void>> = [];
  const step = (name: string, fn: () => Promise<void>) => steps.push(fn().catch(e => console.error(`[automations] ${name} failed`, e instanceof Error ? e.message : e)));

  if (s.reviewRequest) step('review_request', async () => {
    const rows = await db.booking.findMany({
      where: { status: 'completed', startsAt: { gte: at(now.getTime() - 12 * DAY), lte: now }, review: { is: null } },
      select: { id: true, startsAt: true, finishedAt: true, clientName: true, clientPhone: true, clientEmail: true, branch: { select: { name: true, businessId: true } } },
      take: 1000,
    });
    for (const b of rows) {
      const done = (b.finishedAt ?? b.startsAt).getTime();
      const r = route(b.clientEmail, b.clientPhone);
      if (!r) continue;
      add('review_request', await enqueue({
        key: `M6:${b.id}`, automation: 'review_request', template: 'M6_review_request', ...r,
        vars: { name: b.clientName.split(' ')[0] ?? '', business: b.branch.name, link: `${site}/review/${bookingToken(b.id)}` },
        businessId: b.branch.businessId, refId: b.id, dueAt: at(done + 3 * DAY), staleAt: at(done + 14 * DAY),
      }));
    }
  });

  if (s.giftDelivery) step('gift_delivery', async () => {
    const rows = await db.giftCard.findMany({
      where: { status: 'scheduled', sendAt: { lte: at(now.getTime() + 2 * DAY) } },
      include: { business: { select: { branches: { select: { name: true }, orderBy: { createdAt: 'asc' }, take: 1 } } } },
      take: 500,
    });
    for (const g of rows) {
      const r = g.recipientChannel === 'self' ? route(g.buyerEmail, g.buyerPhone)
        : g.recipientChannel === 'email' ? (isEmail(g.recipientContact) ? { channel: 'email' as const, to: g.recipientContact, fallbackPhone: null } : null)
        : g.recipientContact ? { channel: 'whatsapp' as const, to: g.recipientContact, fallbackPhone: null } : null;
      if (!r) continue;
      add('gift_delivery', await enqueue({
        key: `M14:${g.id}`, automation: 'gift_delivery', template: 'M14_gift_card', ...r,
        vars: {
          recipient: g.recipientName, buyer: g.buyerName, business: g.business.branches[0]?.name ?? '', amount: nisFromAgorot(g.valueAgorot),
          code: g.code, message: g.message ?? '', link: `${site}/gift/check?code=${encodeURIComponent(g.code)}`,
        },
        businessId: g.businessId, refId: g.id, dueAt: g.sendAt,
      }));
    }
  });

  if (s.giftExpiry) step('gift_expiry', async () => {
    const rows = await db.giftCard.findMany({
      where: { status: { in: ['active', 'partially_redeemed'] }, balanceAgorot: { gt: 0 }, expiresAt: { gt: now, lte: at(now.getTime() + 91 * DAY) } },
      include: { business: { select: { branches: { select: { name: true }, orderBy: { createdAt: 'asc' }, take: 1 } } } },
      take: 1000,
    });
    for (const g of rows) {
      const left = g.expiresAt.getTime() - now.getTime();
      const days = left <= 31 * DAY ? 30 : 90;
      if (days === 90 && left <= 31 * DAY) continue;
      const holder = g.recipientChannel === 'self' ? route(g.buyerEmail, g.buyerPhone)
        : g.recipientChannel === 'email' && isEmail(g.recipientContact) ? { channel: 'email' as const, to: g.recipientContact, fallbackPhone: null }
        : g.recipientContact ? { channel: 'whatsapp' as const, to: g.recipientContact, fallbackPhone: null } : route(g.buyerEmail, g.buyerPhone);
      if (!holder) continue;
      add('gift_expiry', await enqueue({
        key: `M15:${g.id}:${days}`, automation: 'gift_expiry', template: 'M15_gift_expiry', ...holder,
        vars: {
          name: g.recipientChannel === 'self' ? g.buyerName : g.recipientName, business: g.business.branches[0]?.name ?? '', amount: nisFromAgorot(g.balanceAgorot),
          expires: ilDate(g.expiresAt), days: String(days), link: `${site}/gift/check?code=${encodeURIComponent(g.code)}`,
        },
        businessId: g.businessId, refId: g.id, dueAt: now, staleAt: g.expiresAt,
      }));
    }
  });

  if (s.paymentFailed) step('payment_failed', async () => {
    const settings = await platformSettings();
    const subs = await db.subscription.findMany({ where: { status: { in: ['past_due', 'hidden'] }, pastDueSince: { not: null } }, select: { id: true, businessId: true, pastDueSince: true } });
    for (const sub of subs) {
      const since = sub.pastDueSince!.getTime();
      const o = await ownerOf(sub.businessId);
      if (!o?.route) continue;
      const hide = since + settings.hideInDebtDays * DAY;
      for (const d of [0, 3, 7, 14]) {
        const due = since + d * DAY;
        if (due > now.getTime() + DAY || due < now.getTime() - 3 * DAY) continue; // only steps around now (no backlog burst)
        add('payment_failed', await enqueue({
          key: `M23:${sub.id}:${Math.floor(since / DAY)}:${d}`, automation: 'payment_failed', template: 'M23_payment_failed', ...o.route,
          vars: { name: o.name, business: o.business, step: String(d), hide_date: hide > due ? ilDate(at(hide)) : '', link: `${site}/biz/billing`, since: String(since) },
          businessId: sub.businessId, refId: sub.id, dueAt: at(due), staleAt: at(due + 3 * DAY),
        }));
      }
    }
  });

  if (s.sponsored) step('sponsored', async () => {
    const rows = await db.campaign.findMany({
      where: { OR: [{ reviewedAt: { gte: at(now.getTime() - 3 * DAY) } }, { status: 'approved', weekStart: { gte: at(now.getTime() - 13 * 7 * DAY) } }] },
      select: { id: true, ref: true, businessId: true, status: true, reviewNote: true, reviewedAt: true, weekStart: true, weeks: true, regionSlug: true, categorySlug: true },
      take: 1000,
    });
    for (const c of rows) {
      const o = await ownerOf(c.businessId);
      if (!o?.route) continue;
      const end = c.weekStart.getTime() + c.weeks * 7 * DAY;
      const base = { name: o.name, business: o.business, ref: c.ref, where: `${catName(c.categorySlug)}, ${regionName(c.regionSlug)}`, start: ilDate(c.weekStart), end: ilDate(at(end - DAY)), weeks: String(c.weeks), link: `${site}/biz/billing` };
      const q = (suffix: string, template: string, dueAt: Date, staleAt: Date, extra: Record<string, string> = {}) =>
        enqueue({ key: `M22:${c.id}:${suffix}`, automation: 'sponsored', template, ...o.route!, vars: { ...base, ...extra }, businessId: c.businessId, refId: c.id, dueAt, staleAt });
      const recent = c.reviewedAt && c.reviewedAt.getTime() >= now.getTime() - 3 * DAY;
      if (recent && c.status === 'approved') add('sponsored', await q('approved', 'M22_sponsored_approved', now, at(c.weekStart.getTime())));
      if (recent && c.status === 'rejected') add('sponsored', await q('rejected', 'M22_sponsored_rejected', now, at(now.getTime() + 3 * DAY), { reason: c.reviewNote ?? '' }));
      if (c.status === 'approved' && c.weekStart <= at(now.getTime() + DAY) && end > now.getTime()) add('sponsored', await q('started', 'M22_sponsored_started', at(c.weekStart.getTime() + 9 * 3600_000), at(c.weekStart.getTime() + 2 * DAY)));
      if (c.status === 'approved' && end <= now.getTime() && end > now.getTime() - 3 * DAY) add('sponsored', await q('ended', 'M22_sponsored_ended', at(end), at(end + 4 * DAY)));
    }
  });

  if (s.onboarding) step('onboarding', async () => {
    const subs = await db.subscription.findMany({ where: { createdAt: { gte: at(now.getTime() - 14 * DAY) }, business: { ownerUserId: { not: null } } }, select: { businessId: true, createdAt: true } });
    for (const sub of subs) {
      const o = await ownerOf(sub.businessId);
      if (!o?.route) continue;
      const t0 = sub.createdAt.getTime();
      const vars = { name: o.name, business: o.business, link: `${site}/biz` };
      const q = (step: string, template: string, after: number, staleAfter: number, link = `${site}/biz`) =>
        enqueue({ key: `ONB:${sub.businessId}:${step}`, automation: 'onboarding', template, ...o.route!, vars: { ...vars, link }, businessId: sub.businessId, refId: sub.businessId, dueAt: at(t0 + after), staleAt: at(t0 + staleAfter) });
      add('onboarding', await q('welcome', 'M_onboard_welcome', 10 * 60_000, 2 * DAY));
      add('onboarding', await q('profile', 'M_onboard_profile', 3 * DAY, 10 * DAY, `${site}/biz/profile`));
      add('onboarding', await q('card', 'M_onboard_card', 5 * DAY, 14 * DAY, `${site}/biz/billing`));
    }
  });

  await Promise.all(steps);
  return out;
}

// ---------- Claim invites (staff batches) ----------

export interface ClaimCandidate { businessId: string; branchId: string; name: string; email: string | null; mobile: string | null }

/** Unclaimed businesses with a live listing and a way to reach them, never invited before. */
export async function claimCandidates(limit: number): Promise<{ rows: ClaimCandidate[]; total: number }> {
  const invited = db.scheduledMessage.findMany({ where: { automation: 'claim_invite' }, select: { businessId: true } });
  const where = { ownerUserId: null, branches: { some: { status: 'live' as const, OR: [{ email: { not: null } }, { phone: { startsWith: '+9725' } }, { whatsapp: { startsWith: '+9725' } }] } } };
  const [done, total, list] = await Promise.all([
    invited,
    db.business.count({ where }),
    db.business.findMany({ where, select: { id: true, branches: { where: { status: 'live' }, select: { id: true, name: true, email: true, phone: true, whatsapp: true }, orderBy: { createdAt: 'asc' }, take: 1 } }, orderBy: { createdAt: 'asc' }, take: 5000 }),
  ]);
  const skip = new Set(done.map(d => d.businessId));
  const rows: ClaimCandidate[] = [];
  for (const b of list) {
    if (skip.has(b.id)) continue;
    const br = b.branches[0];
    if (!br) continue;
    const mobile = isMobile(br.whatsapp) ? br.whatsapp : isMobile(br.phone) ? br.phone : null;
    const email = isEmail(br.email) ? br.email.trim().toLowerCase() : null;
    if (!email && !mobile) continue;
    rows.push({ businessId: b.id, branchId: br.id, name: br.name, email, mobile });
  }
  return { rows: rows.slice(0, limit), total: Math.max(0, total - skip.size) };
}

export async function queueClaimInvites(count: number, actorId: string): Promise<number> {
  const { rows } = await claimCandidates(count);
  const site = siteUrl();
  let n = 0;
  for (const c of rows) {
    const r = c.email ? { channel: 'email' as const, to: c.email, fallbackPhone: c.mobile } : { channel: 'sms' as const, to: c.mobile!, fallbackPhone: null };
    const ok = await enqueue({
      key: `CLAIM:${c.businessId}`, automation: 'claim_invite', template: 'M_claim_invite', ...r, kind: 'marketing', scope: 'all',
      vars: {
        business: c.name, link: `${site}/for-business/claim?branch=${c.branchId}`,
        ...(c.email ? { unsub_email: unsubscribeUrl({ contact: c.email, scope: 'all', channel: 'email' }) } : {}),
        ...(c.mobile ? { unsub_sms: unsubscribeUrl({ contact: c.mobile, scope: 'all', channel: 'sms' }) } : {}),
      },
      businessId: c.businessId, refId: c.branchId, dueAt: new Date(), staleAt: new Date(Date.now() + 30 * DAY), createdById: actorId,
    });
    if (ok) n++;
  }
  if (n) await db.auditLog.create({ data: { actorId, action: 'claim_invites_queued', subjectType: 'automation', subjectId: actorId, meta: { count: n } } });
  return n;
}

// ---------- Checks right before sending ----------

registerGuard('review_request', async row => {
  const b = await db.booking.findUnique({ where: { id: row.refId! }, select: { status: true, review: { select: { id: true } } } });
  if (!b || b.status !== 'completed') return { send: false, reason: 'התור כבר לא במצב הושלם' };
  if (b.review) return { send: false, reason: 'הלקוח/ה כבר כתב/ה ביקורת' };
  return { send: true };
});

registerGuard('gift_delivery', async row => {
  const g = await db.giftCard.findUnique({ where: { id: row.refId! }, select: { status: true } });
  return g?.status === 'scheduled' ? { send: true } : { send: false, reason: 'הכרטיס כבר נשלח, בוטל או הוחזר' };
}, async row => {
  await db.giftCard.updateMany({ where: { id: row.refId!, status: 'scheduled' }, data: { status: 'active' } });
});

registerGuard('gift_expiry', async row => {
  const g = await db.giftCard.findUnique({ where: { id: row.refId! }, select: { status: true, balanceAgorot: true } });
  if (!g || !['active', 'partially_redeemed'].includes(g.status) || g.balanceAgorot <= 0) return { send: false, reason: 'אין יתרה בכרטיס' };
  return { send: true };
});

registerGuard('payment_failed', async (row, vars) => {
  const s = await db.subscription.findUnique({ where: { id: row.refId! }, select: { status: true, pastDueSince: true } });
  if (!s || !['past_due', 'hidden'].includes(s.status)) return { send: false, reason: 'החיוב הוסדר' };
  if (!s.pastDueSince || String(s.pastDueSince.getTime()) !== vars.since) return { send: false, reason: 'החוב הזה כבר הוסדר' };
  return { send: true };
});

registerGuard('sponsored', async row => {
  const c = await db.campaign.findUnique({ where: { id: row.refId! }, select: { status: true } });
  if (!c) return { send: false, reason: 'המקום נמחק' };
  const wantsApproved = !row.template.endsWith('_rejected');
  if (wantsApproved && c.status !== 'approved') return { send: false, reason: 'המקום כבר לא מאושר' };
  return { send: true };
});

registerGuard('onboarding', async (row, vars) => {
  const b = await db.business.findUnique({
    where: { id: row.businessId! },
    select: { ownerUserId: true, status: true, subscription: { select: { status: true, stripeSubscriptionId: true } }, branches: { select: { status: true, coverUrl: true, treatments: { select: { id: true }, take: 1 } } } },
  }).catch(() => null);
  if (!b?.ownerUserId) return { send: false, reason: 'אין בעלים לעסק' };
  const live = b.branches.some(x => x.status === 'live');
  if (row.template === 'M_onboard_profile') {
    if (live) return { send: false, reason: 'הפרופיל כבר באוויר' };
    const missing = [!b.branches.some(x => x.coverUrl) && 'תמונות', !b.branches.some(x => x.treatments.length) && 'טיפולים ומחירים'].filter(Boolean).join(' ו');
    return { send: true, vars: { ...vars, missing } };
  }
  if (row.template === 'M_onboard_card') {
    if (!live) return { send: false, reason: 'הפרופיל עוד לא באוויר' };
    if (b.subscription?.stripeSubscriptionId || b.subscription?.status === 'cancelled') return { send: false, reason: 'כבר יש אמצעי תשלום' };
  }
  return { send: true };
});

registerGuard('claim_invite', async row => {
  const b = await db.business.findUnique({ where: { id: row.businessId! }, select: { ownerUserId: true } });
  if (!b) return { send: false, reason: 'העסק נמחק' };
  if (b.ownerUserId) return { send: false, reason: 'העסק כבר נתבע' };
  return { send: true };
});

