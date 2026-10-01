import 'server-only';
import { chainTotal } from '@/lib/pricing';
import { actorKind, describeAudit, describeDecision, type ActorKind } from '@/components/ops/activity';
import { db } from './db';
import { platformSettings } from './platformSettings';

// Numbers for the overview and the accounting screens, all from the database. Money in agorot unless
// the name says NIS. "This month" is the calendar month in Asia/Jerusalem.

const TZ = 'Asia/Jerusalem';

/** Start of the calendar month (Asia/Jerusalem) that contains `d`, shifted by `offset` months, as a Date. */
export function monthStart(d = new Date(), offset = 0): Date {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit' }).formatToParts(d).map(p => [p.type, p.value]));
  const y = Number(parts.year);
  const m = Number(parts.month) - 1 + offset;
  // Israel is UTC+2 or +3; the month starts at local midnight. Build in UTC then subtract the offset at that instant.
  const guess = new Date(Date.UTC(y + Math.floor(m / 12), ((m % 12) + 12) % 12, 1, 0, 0, 0));
  const local = new Date(guess.toLocaleString('en-US', { timeZone: TZ }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() - (local.getTime() - utc.getTime()));
}

export const monthLabel = (d: Date) => `${String(new Date(d.getTime() + 86_400_000 * 2).getUTCMonth() + 1).padStart(2, '0')}/${String(new Date(d.getTime() + 86_400_000 * 2).getUTCFullYear()).slice(2)}`;

export interface Mrr {
  totalNis: number;
  businesses: number;
  branches: number;
  basicBranches: number;
  advancedBranches: number;
  basicNis: number;
  advancedNis: number;
}

/** Monthly recurring revenue from live subscriptions (active or past due), per live branch, with the chain discount. */
export async function mrr(): Promise<Mrr> {
  const s = await platformSettings();
  const subs = await db.subscription.findMany({
    where: { status: { in: ['active', 'past_due'] } },
    select: { plan: true, business: { select: { branches: { where: { status: 'live' }, select: { id: true } } } } },
  });
  const out: Mrr = { totalNis: 0, businesses: 0, branches: 0, basicBranches: 0, advancedBranches: 0, basicNis: 0, advancedNis: 0 };
  for (const sub of subs) {
    const n = sub.business.branches.length;
    if (!n) continue;
    const unit = sub.plan === 'advanced' ? s.advancedMonthlyNis : s.basicMonthlyNis;
    const t = chainTotal(n, unit).total;
    out.businesses++;
    out.branches += n;
    out.totalNis += t;
    if (sub.plan === 'advanced') { out.advancedBranches += n; out.advancedNis += t; } else { out.basicBranches += n; out.basicNis += t; }
  }
  out.totalNis = Math.round(out.totalNis);
  return out;
}

/** Platform income (payee platform, succeeded) per month for the last `months` months, gross agorot. */
export async function monthlyPlatformIncome(months = 12): Promise<Array<{ start: Date; label: string; agorot: number; subscriptions: number; sponsored: number }>> {
  const from = monthStart(new Date(), -(months - 1));
  const rows = await db.payment.findMany({ where: { payee: 'platform', status: { in: ['succeeded', 'partially_refunded'] }, paidAt: { gte: from } }, select: { paidAt: true, grossAgorot: true, purpose: true } });
  const out = Array.from({ length: months }, (_, i) => {
    const start = monthStart(new Date(), -(months - 1) + i);
    return { start, label: monthLabel(start), agorot: 0, subscriptions: 0, sponsored: 0 };
  });
  for (const r of rows) {
    const at = r.paidAt ?? new Date(0);
    let idx = -1;
    for (let i = 0; i < out.length; i++) if (at >= out[i].start) idx = i;
    if (idx < 0) continue;
    out[idx].agorot += r.grossAgorot;
    if (r.purpose === 'subscription') out[idx].subscriptions += r.grossAgorot;
    if (r.purpose === 'sponsored') out[idx].sponsored += r.grossAgorot;
  }
  return out;
}

/** Credit notes the platform issued this month (negative income). */
export async function creditsThisMonth(): Promise<number> {
  const r = await db.document.aggregate({ where: { issuer: 'platform', type: 'credit_note', issuedAt: { gte: monthStart() } }, _sum: { grossAgorot: true } });
  return r._sum.grossAgorot ?? 0;
}

export async function bookingStats() {
  const now = new Date();
  const thisStart = monthStart(now);
  const lastStart = monthStart(now, -1);
  const real = { notIn: ['pending_payment', 'abandoned'] as Array<'pending_payment' | 'abandoned'> };
  const [thisMonth, lastMonth, cancelled, noShow, consults, total90] = await Promise.all([
    db.booking.count({ where: { startsAt: { gte: thisStart }, status: real } }),
    db.booking.count({ where: { startsAt: { gte: lastStart, lt: thisStart }, status: real } }),
    db.booking.count({ where: { startsAt: { gte: lastStart }, status: { in: ['cancelled_client', 'cancelled_clinic'] } } }),
    db.booking.count({ where: { startsAt: { gte: lastStart, lt: now }, status: 'no_show' } }),
    db.booking.count({ where: { startsAt: { gte: thisStart }, kind: 'consult', status: real } }),
    db.booking.count({ where: { startsAt: { gte: lastStart }, status: real } }),
  ]);
  const pctOf = (n: number) => (total90 ? (n / total90) * 100 : 0);
  return { thisMonth, lastMonth, cancelRate: pctOf(cancelled), noShowRate: pctOf(noShow), consults, deltaPct: lastMonth ? ((thisMonth - lastMonth) / lastMonth) * 100 : null };
}

export async function churn30() {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [cancelled, active] = await Promise.all([
    db.subscription.count({ where: { status: 'cancelled', updatedAt: { gte: since } } }),
    db.subscription.count({ where: { status: { in: ['active', 'past_due'] } } }),
  ]);
  return { cancelled, active, pct: active + cancelled ? (cancelled / (active + cancelled)) * 100 : 0 };
}

export async function businessStats() {
  const monthAgo = monthStart();
  const [live, newThisMonth, pending, suspended, medical] = await Promise.all([
    db.business.count({ where: { status: 'live' } }),
    db.business.count({ where: { status: 'live', createdAt: { gte: monthAgo } } }),
    db.business.count({ where: { status: 'pending' } }),
    db.business.count({ where: { status: 'hidden' } }),
    db.branch.count({ where: { status: 'live', medicalResponsibleId: { not: null } } }),
  ]);
  return { live, newThisMonth, pending, hidden: suspended, medical };
}

/** Model spend this month by provider, from the import's spend ledger (the only metered AI use). */
export async function aiCostThisMonth(): Promise<Array<{ provider: string; calls: number; usd: number }>> {
  const rows = await db.spendEntry.groupBy({
    by: ['provider'], where: { provider: { in: ['openai', 'anthropic'] }, status: { in: ['committed', 'needs_reconciliation'] }, createdAt: { gte: monthStart() } },
    _count: true, _sum: { actualMicros: true, estimatedMicros: true },
  });
  return rows.map(r => ({ provider: r.provider, calls: r._count, usd: Number(r._sum.actualMicros ?? r._sum.estimatedMicros ?? 0n) / 1_000_000 }));
}

export interface AttentionItem { key: string; title: string; sub: string; href: string; action: string; tone: 'bad' | 'warn' | 'info' }

/** What needs a person now, from the real queues. Empty when nothing waits. */
export async function attention(): Promise<AttentionItem[]> {
  const safe = (p: Promise<number>) => p.catch(() => 0);
  const monthAgo = monthStart();
  const [pastDue, aiProposed, disputes, sponsored, deletions, deletionsDone, privacyMsgs, expensesNoReceipt, importReview, verification, reviews, pendingBiz, integrationErrors, maintenance] = await Promise.all([
    safe(db.subscription.count({ where: { status: 'past_due' } })),
    safe(db.aiAction.count({ where: { status: 'proposed' } })),
    safe(db.dispute.count({ where: { status: 'open' } })),
    safe(db.campaign.count({ where: { status: 'pending_review' } })),
    safe(db.decision.count({ where: { subjectType: 'user', action: 'delete_request' } })),
    safe(db.decision.count({ where: { subjectType: 'user', action: { in: ['delete_done', 'delete_rejected'] } } })),
    safe(db.contactMessage.count({ where: { reason: { in: ['access', 'correction'] }, status: { not: 'closed' } } })),
    safe(db.expense.count({ where: { receiptUrl: null, date: { gte: monthAgo } } })),
    safe(db.importPlace.count({ where: { status: { in: ['ready', 'needs_review'] } } })),
    safe(db.verificationRequest.count({ where: { status: { in: ['open', 'awaiting_document'] } } })),
    safe(db.review.count({ where: { status: 'submitted' } })),
    safe(db.business.count({ where: { status: 'pending' } })),
    safe(db.providerConnection.count({ where: { status: 'error' } })),
    platformSettings().then(s => (s.maintenanceMode ? 1 : 0)),
  ]);
  const privacy = Math.max(0, deletions - deletionsDone) + privacyMsgs;
  const out: AttentionItem[] = [];
  const n = (v: number) => v.toLocaleString('he-IL');
  if (maintenance) out.push({ key: 'maintenance', title: 'מצב תחזוקה פעיל', sub: 'האתר הציבורי מציג הודעת תחזוקה', href: '/ops/settings', action: 'להגדרות', tone: 'bad' });
  if (pastDue) out.push({ key: 'past_due', title: `${n(pastDue)} ${pastDue === 1 ? 'חיוב נכשל' : 'חיובים נכשלו'}`, sub: 'מנויים בחוב פתוח', href: '/ops/accounting?tab=subscriptions&filter=past_due', action: 'לחיובים', tone: 'bad' });
  if (aiProposed) out.push({ key: 'ai', title: `${n(aiProposed)} ${aiProposed === 1 ? 'בקשת AI ממתינה' : 'בקשות AI ממתינות'} לאישור`, sub: 'פעולות כתיבה מהעוזר', href: '/ops/ai?tab=queue', action: 'לתור', tone: 'warn' });
  if (disputes) out.push({ key: 'disputes', title: `${n(disputes)} ${disputes === 1 ? 'מחלוקת פתוחה' : 'מחלוקות פתוחות'}`, sub: 'מקדמות ושוברים', href: '/ops/disputes', action: 'למחלוקות', tone: 'bad' });
  if (sponsored) out.push({ key: 'sponsored', title: `${n(sponsored)} ${sponsored === 1 ? 'מקום ממומן לבדיקה' : 'מקומות ממומנים לבדיקה'}`, sub: 'אישור לפני עלייה וחיוב', href: '/ops/sponsored', action: 'לבדיקה', tone: 'warn' });
  if (privacy) out.push({ key: 'privacy', title: `${n(privacy)} ${privacy === 1 ? 'בקשת פרטיות' : 'בקשות פרטיות'}`, sub: 'מענה תוך 30 יום', href: '/ops/clients?tab=privacy', action: 'לבקשות', tone: 'warn' });
  if (verification) out.push({ key: 'verification', title: `${n(verification)} ${verification === 1 ? 'בקשת אימות' : 'בקשות אימות'} בתור`, sub: 'רישיונות, תעודות ובעלות', href: '/ops/verification', action: 'לאימות', tone: 'warn' });
  if (reviews) out.push({ key: 'reviews', title: `${n(reviews)} ${reviews === 1 ? 'ביקורת ממתינה' : 'ביקורות ממתינות'} לפרסום`, sub: 'בדיקה לפני פרסום בפרופיל', href: '/ops/moderation', action: 'לביקורות', tone: 'warn' });
  if (pendingBiz) out.push({ key: 'biz', title: `${n(pendingBiz)} ${pendingBiz === 1 ? 'עסק ממתין' : 'עסקים ממתינים'} לאישור`, sub: 'הרשמה חדשה או תביעת בעלות', href: '/ops/businesses?status=pending', action: 'לעסקים', tone: 'warn' });
  if (importReview) out.push({ key: 'import', title: `${n(importReview)} ${importReview === 1 ? 'רשומת ייבוא' : 'רשומות ייבוא'} לבדיקה`, sub: 'עסקים שנסרקו ומחכים לאישור', href: '/ops/import/review', action: 'לתור הבדיקה', tone: 'info' });
  if (expensesNoReceipt) out.push({ key: 'expenses', title: `${n(expensesNoReceipt)} ${expensesNoReceipt === 1 ? 'הוצאה ללא קבלה' : 'הוצאות ללא קבלה'}`, sub: 'נדרש לפני סגירת החודש', href: '/ops/accounting?tab=expenses', action: 'להוצאות', tone: 'warn' });
  if (integrationErrors) out.push({ key: 'integrations', title: `${n(integrationErrors)} ${integrationErrors === 1 ? 'חיבור ספק בשגיאה' : 'חיבורי ספקים בשגיאה'}`, sub: 'סליקה, חשבוניות או יומן של עסק', href: '/ops/integrations', action: 'לאינטגרציות', tone: 'bad' });
  return out;
}

export interface ActivityRow { at: Date; kind: ActorKind; who: string; text: string; detail: string }

/** The latest audit rows and decisions, newest first, with the actor's name. */
export async function recentActivity(take = 10, filter?: ActorKind): Promise<ActivityRow[]> {
  const [audit, decisions] = await Promise.all([
    db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: take * 2 }),
    db.decision.findMany({ orderBy: { createdAt: 'desc' }, take: take * 2 }),
  ]);
  const ids = [...new Set([...audit.map(a => a.actorId), ...decisions.map(d => d.actorId)].filter((x): x is string => !!x))];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, email: true, opsRole: true } }) : [];
  const name = (id: string | null, fallback: string) => {
    const u = id ? users.find(x => x.id === id) : null;
    return u?.fullName ?? u?.email ?? fallback;
  };
  const rows: ActivityRow[] = [
    ...audit.map(a => {
      const meta = (a.meta ?? null) as Record<string, unknown> | null;
      const kind = actorKind(a.actorId, meta);
      const d = describeAudit(a.action, a.subjectType, meta);
      return { at: a.createdAt, kind, who: kind === 'system' ? 'מערכת' : kind === 'ai' ? String(meta?.source ?? 'AI') : name(a.actorId, 'צוות'), text: d.text, detail: d.detail };
    }),
    ...decisions.map(x => {
      const kind = actorKind(x.actorId, null, x.actorRole);
      const d = describeDecision(x.action, x.subjectType, x.reason);
      const who = kind === 'system' ? 'מערכת' : x.actorRole === 'client' ? 'לקוחה' : name(x.actorId, x.actorRole);
      return { at: x.createdAt, kind, who, text: d.text, detail: d.detail };
    }),
  ];
  return rows.filter(r => !filter || r.kind === filter).sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, take);
}
