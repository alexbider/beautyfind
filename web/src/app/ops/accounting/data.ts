import 'server-only';
import type { Prisma } from '@prisma/client';
import { chainTotal } from '@/lib/pricing';
import { db } from '@/lib/server/db';
import { monthLabel, monthStart } from '@/lib/server/opsStats';
import { platformSettings } from '@/lib/server/platformSettings';

// Accounting for the platform's own money (Israfind Group): documents it issued, what its
// subscriptions should bring in, its expenses, the monthly profit and loss, and the accountant's
// export. Clinic money (deposits, treatments, gift cards) never appears here: it flows through each
// clinic's own providers.

export type LedgerFilter = 'all' | 'subscription' | 'sponsored' | 'manual' | 'credit';
export const LEDGER_FILTERS: Array<{ key: LedgerFilter; name: string }> = [
  { key: 'all', name: 'הכול' }, { key: 'subscription', name: 'מנויים' }, { key: 'sponsored', name: 'ממומן' }, { key: 'manual', name: 'ידני' }, { key: 'credit', name: 'זיכויים' },
];

export interface LedgerRow {
  id: string;
  number: string;
  issuedAt: Date;
  customer: string;
  description: string;
  kind: 'subscription' | 'sponsored' | 'manual' | 'credit';
  netAgorot: number;
  vatAgorot: number;
  grossAgorot: number;
  status: 'paid' | 'open' | 'credit';
  pdfUrl: string | null;
  sentTo: string | null;
}

const kindOf = (d: { type: string; payment: { purpose: string } | null; provider: string }): LedgerRow['kind'] =>
  d.type === 'credit_note' ? 'credit' : d.payment?.purpose === 'subscription' ? 'subscription' : d.payment?.purpose === 'sponsored' ? 'sponsored' : 'manual';

export async function ledger(opts: { filter: LedgerFilter; q: string; from?: Date; to?: Date; take?: number }): Promise<LedgerRow[]> {
  const where: Prisma.DocumentWhereInput = {
    issuer: 'platform',
    ...(opts.filter === 'credit' ? { type: 'credit_note' } : opts.filter === 'subscription' || opts.filter === 'sponsored' ? { payment: { purpose: opts.filter } } : opts.filter === 'manual' ? { type: { not: 'credit_note' }, paymentId: null } : {}),
    ...(opts.q ? { OR: [{ number: { contains: opts.q } }, { sentTo: { contains: opts.q, mode: 'insensitive' } }] } : {}),
    ...(opts.from || opts.to ? { issuedAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lt: opts.to } : {}) } } : {}),
  };
  const docs = await db.document.findMany({ where, orderBy: { issuedAt: 'desc' }, take: opts.take ?? 200, include: { payment: { select: { purpose: true, status: true, payerName: true } } } });
  const bizIds = [...new Set(docs.map(d => d.businessId).filter((x): x is string => !!x))];
  const branches = bizIds.length ? await db.branch.findMany({ where: { businessId: { in: bizIds } }, select: { businessId: true, name: true }, orderBy: { createdAt: 'asc' } }) : [];
  return docs.map(d => {
    const lines = (Array.isArray(d.lines) ? d.lines : []) as Array<{ description?: string }>;
    const kind = kindOf(d);
    return {
      id: d.id, number: d.number, issuedAt: d.issuedAt,
      customer: branches.find(b => b.businessId === d.businessId)?.name ?? d.payment?.payerName ?? d.sentTo ?? '—',
      description: lines.map(l => l.description).filter(Boolean).join(' · ') || d.type,
      kind, netAgorot: d.netAgorot, vatAgorot: d.vatAgorot, grossAgorot: d.grossAgorot,
      status: kind === 'credit' ? 'credit' : d.payment ? (d.payment.status === 'succeeded' ? 'paid' : 'open') : 'open',
      pdfUrl: d.pdfUrl, sentTo: d.sentTo,
    };
  });
}

export async function ledgerCounts(): Promise<Record<LedgerFilter, number>> {
  const [all, credit, subscription, sponsored, manual] = await Promise.all([
    db.document.count({ where: { issuer: 'platform' } }),
    db.document.count({ where: { issuer: 'platform', type: 'credit_note' } }),
    db.document.count({ where: { issuer: 'platform', payment: { purpose: 'subscription' } } }),
    db.document.count({ where: { issuer: 'platform', payment: { purpose: 'sponsored' } } }),
    db.document.count({ where: { issuer: 'platform', type: { not: 'credit_note' }, paymentId: null } }),
  ]);
  return { all, credit, subscription, sponsored, manual };
}

export interface SubscriptionRow {
  id: string;
  businessId: string;
  businessName: string;
  plan: 'basic' | 'advanced';
  cycle: 'monthly' | 'yearly';
  liveBranches: number;
  monthlyNis: number;
  status: string;
  currentPeriodEnd: Date | null;
  retry: { attempts?: number; next_at?: string } | null;
  businessStatus: string;
}

export async function subscriptions(filter: 'all' | 'active' | 'past_due' | 'hidden' | 'cancelled'): Promise<SubscriptionRow[]> {
  const s = await platformSettings();
  const subs = await db.subscription.findMany({
    where: filter === 'all' ? {} : { status: filter }, orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }], take: 300,
    include: { business: { select: { id: true, status: true, branches: { select: { name: true, status: true }, orderBy: { createdAt: 'asc' } } } } },
  });
  return subs.map(x => {
    const live = x.business.branches.filter(b => b.status === 'live').length;
    const unit = x.plan === 'advanced' ? s.advancedMonthlyNis : s.basicMonthlyNis;
    return {
      id: x.id, businessId: x.business.id, businessName: x.business.branches[0]?.name ?? 'עסק', plan: x.plan, cycle: x.cycle, liveBranches: live,
      monthlyNis: live ? chainTotal(live, unit).total : 0, status: x.status, currentPeriodEnd: x.currentPeriodEnd, retry: (x.retry ?? null) as SubscriptionRow['retry'], businessStatus: x.business.status,
    };
  });
}

export const EXPENSE_CATEGORIES: Record<string, string> = { hosting: 'אחסון ותשתית', providers: 'ספקי נתונים ו־AI', marketing: 'שיווק', legal: 'משפטי ורו״ח', salaries: 'שכר וקבלנים', office: 'משרד', other: 'אחר' };

export async function expenses(from?: Date) {
  return db.expense.findMany({ where: from ? { date: { gte: from } } : {}, orderBy: { date: 'desc' }, take: 300 });
}

export interface PnlMonth { start: Date; label: string; incomeAgorot: number; creditsAgorot: number; expensesAgorot: number; resultAgorot: number }

/** Income (platform payments succeeded), credits issued and expenses per month for the last `months` months. */
export async function profitAndLoss(months = 12): Promise<PnlMonth[]> {
  const from = monthStart(new Date(), -(months - 1));
  const [payments, credits, exp] = await Promise.all([
    db.payment.findMany({ where: { payee: 'platform', status: { in: ['succeeded', 'partially_refunded'] }, paidAt: { gte: from } }, select: { paidAt: true, grossAgorot: true } }),
    db.document.findMany({ where: { issuer: 'platform', type: 'credit_note', issuedAt: { gte: from } }, select: { issuedAt: true, grossAgorot: true } }),
    db.expense.findMany({ where: { date: { gte: from } }, select: { date: true, netAgorot: true, vatAgorot: true } }),
  ]);
  const out: PnlMonth[] = Array.from({ length: months }, (_, i) => { const start = monthStart(new Date(), -(months - 1) + i); return { start, label: monthLabel(start), incomeAgorot: 0, creditsAgorot: 0, expensesAgorot: 0, resultAgorot: 0 }; });
  const slot = (d: Date) => { let idx = -1; for (let i = 0; i < out.length; i++) if (d >= out[i].start) idx = i; return idx; };
  for (const p of payments) { const i = slot(p.paidAt ?? new Date(0)); if (i >= 0) out[i].incomeAgorot += p.grossAgorot; }
  for (const c of credits) { const i = slot(c.issuedAt); if (i >= 0) out[i].creditsAgorot += Math.abs(c.grossAgorot); }
  for (const e of exp) { const i = slot(e.date); if (i >= 0) out[i].expensesAgorot += e.netAgorot + e.vatAgorot; }
  for (const m of out) m.resultAgorot = m.incomeAgorot - m.creditsAgorot - m.expensesAgorot;
  return out;
}

export async function collectionStats() {
  const [open, past] = await Promise.all([
    db.payment.count({ where: { payee: 'platform', status: { in: ['pending', 'failed'] } } }),
    db.subscription.count({ where: { status: 'past_due' } }),
  ]);
  const paid = await db.payment.count({ where: { payee: 'platform', status: 'succeeded', paidAt: { gte: monthStart(new Date(), -2) } } });
  const failed = await db.payment.count({ where: { payee: 'platform', status: 'failed', createdAt: { gte: monthStart(new Date(), -2) } } });
  return { open: open + past, pct: paid + failed ? (paid / (paid + failed)) * 100 : 100 };
}

// ---------- bank reconciliation (stateless: a bank statement CSV matched against platform payments) ----------

export interface BankLine { date: Date; amountAgorot: number; text: string }

/** Parses a bank CSV: a date column, an amount column (credit) and a free text column, any order; header optional. */
export function parseBankCsv(csv: string): BankLine[] {
  const out: BankLine[] = [];
  for (const raw of csv.split(/\r?\n/)) {
    const cells = raw.split(/[,;\t]/).map(c => c.trim().replace(/^"|"$/g, ''));
    if (cells.length < 2) continue;
    const date = cells.map(c => { const m = c.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/); return m ? new Date(Date.UTC(Number(m[3].length === 2 ? `20${m[3]}` : m[3]), Number(m[2]) - 1, Number(m[1]))) : /^\d{4}-\d{2}-\d{2}/.test(c) ? new Date(c) : null; }).find((d): d is Date => !!d && !Number.isNaN(d.getTime()));
    const amount = cells.map(c => Number(c.replace(/[₪,\s]/g, ''))).find(n => Number.isFinite(n) && n !== 0 && String(n).length < 12);
    if (!date || amount == null) continue;
    const text = cells.filter(c => !/^[\d.,/₪\s-]+$/.test(c)).join(' ').slice(0, 120);
    out.push({ date, amountAgorot: Math.round(amount * 100), text });
  }
  return out;
}

export async function reconcile(lines: BankLine[]) {
  if (!lines.length) return { matched: [] as Array<{ line: BankLine; paymentRef: string; payer: string }>, unmatchedLines: [] as BankLine[], unmatchedPayments: [] as Array<{ ref: string; payer: string; at: Date | null; amountAgorot: number }> };
  const min = new Date(Math.min(...lines.map(l => l.date.getTime())) - 5 * 86_400_000);
  const max = new Date(Math.max(...lines.map(l => l.date.getTime())) + 5 * 86_400_000);
  const payments = await db.payment.findMany({ where: { payee: 'platform', status: 'succeeded', paidAt: { gte: min, lte: max } }, select: { id: true, providerRef: true, payerName: true, paidAt: true, grossAgorot: true } });
  const used = new Set<string>();
  const matched: Array<{ line: BankLine; paymentRef: string; payer: string }> = [];
  const unmatchedLines: BankLine[] = [];
  for (const l of lines) {
    const p = payments.find(x => !used.has(x.id) && x.grossAgorot === l.amountAgorot && x.paidAt && Math.abs(x.paidAt.getTime() - l.date.getTime()) <= 4 * 86_400_000);
    if (p) { used.add(p.id); matched.push({ line: l, paymentRef: p.providerRef ?? p.id.slice(0, 8), payer: p.payerName }); } else unmatchedLines.push(l);
  }
  const unmatchedPayments = payments.filter(p => !used.has(p.id)).map(p => ({ ref: p.providerRef ?? p.id.slice(0, 8), payer: p.payerName, at: p.paidAt, amountAgorot: p.grossAgorot }));
  return { matched, unmatchedLines, unmatchedPayments };
}

export const csvEscape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
