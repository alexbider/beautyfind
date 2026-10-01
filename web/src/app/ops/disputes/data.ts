import 'server-only';
import type { DisputeStatus } from '@prisma/client';
import { db } from '@/lib/server/db';
import { hoursUntil, refundWindowHours } from '@/lib/server/booking';
import { dateTimeIL, nisAgorot } from '@/components/ops/ui';

// Disputes (02-data-model.md): a client's claim about a deposit or a gift card. The clinic decides
// the refund; BeautyFind reads what the system recorded (the booking, its cancellation, the policy
// shown at booking time, the card's terms) and records a recommendation. This module gathers those
// facts from the records so staff never type them by hand.

export const STATUS_NAME: Record<DisputeStatus, string> = { open: 'פתוח', recommended_refund: 'הומלץ להחזיר', closed_policy_upheld: 'המדיניות נאכפה', escalated_legal: 'אצל היועמ״ש' };
export const STATUS_TONE: Record<DisputeStatus, 'warn' | 'ok' | 'neutral' | 'bad'> = { open: 'warn', recommended_refund: 'ok', closed_policy_upheld: 'neutral', escalated_legal: 'bad' };
export const KIND_NAME = { deposit: 'מקדמה', gift_card: 'שובר' } as const;

export type Fact = { label: string; text: string };

/** The facts for a deposit dispute, from the booking and its policy snapshot. */
export async function depositFacts(ref: string): Promise<{ ok: true; bookingId: string; businessId: string; branchId: string; clientName: string; clientPhone: string; amountAgorot: number; facts: Fact[]; policy: unknown; policyLine: string } | { ok: false; error: string }> {
  const b = await db.booking.findUnique({ where: { ref: ref.trim().toUpperCase() }, include: { branch: { select: { id: true, businessId: true, name: true } }, payments: { select: { purpose: true, status: true, grossAgorot: true, refunds: { select: { status: true, amountAgorot: true } } } }, treatment: { select: { name: true } } } });
  if (!b) return { ok: false, error: 'תור לא נמצא' };
  const policy = b.policyShown as { depositRefundHours?: number; cancelWindowHours?: number; deposit?: unknown } | null;
  const window = refundWindowHours(b);
  const cancel = b.cancellation as { by?: string; at?: string; reason?: string; late?: boolean } | null;
  const facts: Fact[] = [
    { label: 'התור', text: `${b.ref} · ${b.branch.name}${b.treatment ? ` · ${b.treatment.name}` : ''} · ${dateTimeIL(b.startsAt)}` },
    { label: 'מקדמה', text: b.depositAgorot ? nisAgorot(b.depositAgorot) : 'לא נגבתה מקדמה' },
  ];
  if (cancel?.at) {
    const hrs = Math.round(hoursUntil(b, new Date(cancel.at)));
    facts.push({ label: 'ביטול', text: `נרשם ${dateTimeIL(cancel.at)}, ${hrs >= 0 ? `${hrs} שעות לפני התור` : `${-hrs} שעות אחרי מועד התור`}, על ידי ${cancel.by === 'client' ? 'הלקוחה' : 'הקליניקה'}${cancel.late ? ' · מחוץ לחלון ההחזר' : ' · בתוך חלון ההחזר'}` });
  } else facts.push({ label: 'ביטול', text: `לא נרשם ביטול; מצב התור: ${b.status}` });
  const refunds = b.payments.flatMap(p => p.refunds);
  facts.push({ label: 'החזרים', text: refunds.length ? refunds.map(r => `${nisAgorot(r.amountAgorot)} · ${r.status}`).join(', ') : 'לא הופק החזר או חשבונית זיכוי' });
  const policyLine = window != null ? `החזר מלא עד ${window} שעות לפני התור` : policy?.cancelWindowHours ? `ביטול עד ${policy.cancelWindowHours} שעות לפני התור` : 'לא נשמרה מדיניות לתור הזה';
  return { ok: true, bookingId: b.id, businessId: b.branch.businessId, branchId: b.branch.id, clientName: b.clientName, clientPhone: b.clientPhone, amountAgorot: b.depositAgorot, facts, policy: b.policyShown, policyLine };
}

/** The facts for a gift card dispute, from the card and its redemptions. */
export async function giftCardFacts(code: string) {
  const g = await db.giftCard.findUnique({ where: { code: code.trim().toUpperCase() }, include: { redemptions: { select: { amountAgorot: true, createdAt: true } }, business: { select: { id: true, branches: { select: { id: true, name: true }, take: 1 } } } } });
  if (!g) return { ok: false as const, error: 'שובר לא נמצא' };
  const treatment = g.treatmentId ? await db.treatment.findUnique({ where: { id: g.treatmentId }, select: { name: true } }) : null;
  const facts: Fact[] = [
    { label: 'השובר', text: `${g.code} · ${g.kind === 'amount' ? 'לפי סכום' : `לטיפול: ${treatment?.name ?? '—'}`} · ערך ${nisAgorot(g.valueAgorot)} · יתרה ${nisAgorot(g.balanceAgorot)}` },
    { label: 'תוקף', text: `עד ${dateTimeIL(g.expiresAt)} · מצב ${g.status}` },
    { label: 'מימושים', text: g.redemptions.length ? g.redemptions.map(r => `${nisAgorot(r.amountAgorot)} · ${dateTimeIL(r.createdAt)}`).join(', ') : 'טרם מומש' },
  ];
  const policyLine = g.kind === 'amount' ? 'שובר לפי סכום: לכל טיפול בקליניקה, בתוקף חמש שנים לפחות' : `שובר לטיפול "${treatment?.name ?? ''}": תקף לטיפול הזה בקליניקה`;
  return { ok: true as const, giftCardId: g.id, businessId: g.business.id, branchId: g.business.branches[0]?.id ?? null, clientName: g.recipientName || g.buyerName, clientPhone: g.buyerPhone, amountAgorot: g.balanceAgorot || g.valueAgorot, facts, policy: { kind: g.kind, expiresAt: g.expiresAt }, policyLine };
}

export async function listDisputes(filter: 'open' | 'all') {
  const rows = await db.dispute.findMany({ where: filter === 'open' ? { status: 'open' } : {}, orderBy: { createdAt: 'desc' }, take: 100 });
  const bizIds = [...new Set(rows.map(r => r.businessId))];
  const branches = bizIds.length ? await db.branch.findMany({ where: { businessId: { in: bizIds } }, select: { businessId: true, name: true }, orderBy: { createdAt: 'asc' } }) : [];
  const decided = rows.filter(r => r.decidedById).map(r => r.decidedById!);
  const users = decided.length ? await db.user.findMany({ where: { id: { in: decided } }, select: { id: true, fullName: true, email: true } }) : [];
  return rows.map(r => ({
    ...r,
    businessName: branches.find(b => b.businessId === r.businessId)?.name ?? 'עסק',
    decidedBy: users.find(u => u.id === r.decidedById)?.fullName ?? users.find(u => u.id === r.decidedById)?.email ?? null,
    facts: (Array.isArray(r.systemFacts) ? r.systemFacts : []) as Fact[],
  }));
}
