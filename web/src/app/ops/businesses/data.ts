import 'server-only';
import type { BusinessStatus, Prisma, RegionSlug } from '@prisma/client';
import { categoryBySlug, regionBySlug } from '@/lib/catalog';
import { chainTotal } from '@/lib/pricing';
import { db } from '@/lib/server/db';
import { platformSettings } from '@/lib/server/platformSettings';

// The businesses screen: every business with its live branches, plan, monthly charge and who carries
// the professional responsibility. One query, then plain rows for the table and the CSV export.

export type BizFilter = 'all' | 'live' | 'past_due' | 'pending' | 'hidden' | 'no_subscription';
export const BIZ_FILTERS: Array<{ key: BizFilter; name: string }> = [
  { key: 'all', name: 'הכל' }, { key: 'live', name: 'פעילים' }, { key: 'past_due', name: 'בחוב' }, { key: 'pending', name: 'ממתינים' }, { key: 'hidden', name: 'מוסתרים' }, { key: 'no_subscription', name: 'ללא מנוי' },
];

export const STATUS_NAME: Record<BusinessStatus, string> = { pending: 'ממתין לאימות', live: 'פעיל', past_due: 'חוב פתוח', hidden: 'מוסתר' };
export const STATUS_TONE: Record<BusinessStatus, 'ok' | 'warn' | 'bad' | 'neutral'> = { pending: 'warn', live: 'ok', past_due: 'bad', hidden: 'neutral' };
export const PLAN_NAME = { basic: 'בסיסי', advanced: 'מתקדם + CRM' } as const;

export interface BizRow {
  id: string;
  name: string;
  legalName: string | null;
  companyNo: string | null;
  city: string;
  region: string;
  category: string;
  branches: number;
  liveBranches: number;
  plan: 'basic' | 'advanced' | null;
  subscriptionStatus: string | null;
  monthlyNis: number | null;
  responsible: string | null;
  responsibility: 'medical' | 'professional';
  status: BusinessStatus;
  claimed: boolean;
  createdAt: Date;
}

export interface BizListOptions { filter: BizFilter; q: string; take?: number; region?: string; category?: string; claimed?: 'all' | 'claimed' | 'unclaimed'; plan?: 'all' | 'basic' | 'advanced' | 'none' }

export async function listBusinesses(opts: BizListOptions): Promise<{ rows: BizRow[]; total: number }> {
  const s = await platformSettings();
  const q = opts.q.trim();
  const digits = q.replace(/\D/g, '');
  const branchFilter: Prisma.BranchWhereInput = {
    ...(opts.region ? { regionSlug: opts.region as RegionSlug } : {}),
    ...(opts.category ? { categories: { some: { categorySlug: opts.category } } } : {}),
    ...(opts.claimed === 'claimed' ? { isClaimed: true } : {}),
  };
  const where: Prisma.BusinessWhereInput = {
    ...(opts.filter === 'all' || opts.filter === 'no_subscription' ? {} : { status: opts.filter }),
    ...(opts.filter === 'no_subscription' ? { subscription: null } : {}),
    ...(Object.keys(branchFilter).length ? { branches: { some: branchFilter } } : {}),
    ...(opts.claimed === 'unclaimed' ? { branches: { none: { isClaimed: true } } } : {}),
    ...(opts.plan === 'none' ? { subscription: null } : opts.plan === 'basic' || opts.plan === 'advanced' ? { subscription: { plan: opts.plan } } : {}),
    ...(q
      ? {
          OR: [
            { legalName: { contains: q, mode: 'insensitive' } },
            { branches: { some: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { cityName: { contains: q, mode: 'insensitive' } }] } } },
            ...(digits.length >= 4 ? [{ companyNo: { contains: digits } }] : []),
          ],
        }
      : {}),
  };
  const [total, list] = await Promise.all([
    db.business.count({ where }),
    db.business.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: opts.take ?? 200,
      select: {
        id: true, legalName: true, companyNo: true, status: true, createdAt: true, type: true,
        subscription: { select: { plan: true, status: true } },
        branches: {
          select: {
            name: true, cityName: true, regionSlug: true, status: true, isClaimed: true,
            categories: { select: { categorySlug: true, isPrimary: true }, take: 3 },
            medicalResponsible: { select: { displayName: true, profession: true, license: { select: { status: true } } } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    }),
  ]);
  const rows: BizRow[] = list.map(b => {
    const first = b.branches[0];
    const live = b.branches.filter(x => x.status === 'live').length;
    const unit = b.subscription ? (b.subscription.plan === 'advanced' ? s.advancedMonthlyNis : s.basicMonthlyNis) : null;
    const primary = first?.categories.find(c => c.isPrimary) ?? first?.categories[0];
    const med = b.branches.map(x => x.medicalResponsible).find(x => x && x.profession === 'doctor');
    const responsibility: BizRow['responsibility'] = med || b.type === 'clinic' || b.type === 'medspa' ? 'medical' : 'professional';
    return {
      id: b.id,
      name: first?.name ?? b.legalName ?? 'עסק ללא שם',
      legalName: b.legalName,
      companyNo: b.companyNo,
      city: first?.cityName ?? '—',
      region: first ? regionBySlug(first.regionSlug)?.name ?? first.regionSlug : '—',
      category: primary ? categoryBySlug(primary.categorySlug)?.name ?? primary.categorySlug : '—',
      branches: b.branches.length,
      liveBranches: live,
      plan: b.subscription?.plan ?? null,
      subscriptionStatus: b.subscription?.status ?? null,
      monthlyNis: unit != null && live ? chainTotal(live, unit).total : null,
      responsible: med?.displayName ?? b.branches.map(x => x.medicalResponsible?.displayName).find(Boolean) ?? null,
      responsibility,
      status: b.status,
      claimed: b.branches.some(x => x.isClaimed),
      createdAt: b.createdAt,
    };
  });
  return { rows, total };
}

export async function businessCounts() {
  const [all, live, past_due, pending, hidden, no_subscription] = await Promise.all([
    db.business.count(), db.business.count({ where: { status: 'live' } }), db.business.count({ where: { status: 'past_due' } }),
    db.business.count({ where: { status: 'pending' } }), db.business.count({ where: { status: 'hidden' } }), db.business.count({ where: { subscription: null } }),
  ]);
  return { all, live, past_due, pending, hidden, no_subscription } as Record<BizFilter, number>;
}

/** One business with everything the card shows. */
export async function loadBusiness(id: string) {
  const b = await db.business.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, fullName: true, email: true, phone: true } },
      subscription: true,
      branches: { include: { categories: true, medicalResponsible: { select: { displayName: true, profession: true } } }, orderBy: { createdAt: 'asc' } },
      staff: { where: { status: { not: 'removed' } }, select: { id: true, displayName: true, profession: true, isOwner: true, status: true, license: { select: { status: true, kind: true } } } },
      verificationRequests: { orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, ref: true, kind: true, status: true, createdAt: true } },
      providerConnections: { select: { kind: true, provider: true, status: true, lastCheckedAt: true, lastError: true } },
    },
  });
  if (!b) return null;
  const [decisions, payments, campaigns, disputes] = await Promise.all([
    db.decision.findMany({ where: { subjectType: 'business', subjectId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    db.payment.findMany({ where: { payee: 'platform', businessId: id }, orderBy: { createdAt: 'desc' }, take: 10 }),
    db.campaign.findMany({ where: { businessId: id }, orderBy: { createdAt: 'desc' }, take: 10 }),
    db.dispute.findMany({ where: { businessId: id }, orderBy: { createdAt: 'desc' }, take: 10 }),
  ]);
  return { ...b, decisions, payments, campaigns, disputes };
}

export const csvOf = (rows: BizRow[]) => {
  const head = ['name', 'legal_name', 'company_no', 'city', 'region', 'category', 'branches', 'live_branches', 'plan', 'subscription_status', 'monthly_nis', 'responsible', 'responsibility', 'status', 'claimed', 'created_at'];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [head.join(','), ...rows.map(r => [r.name, r.legalName, r.companyNo, r.city, r.region, r.category, r.branches, r.liveBranches, r.plan, r.subscriptionStatus, r.monthlyNis, r.responsible, r.responsibility, r.status, r.claimed, r.createdAt.toISOString()].map(esc).join(','))].join('\n');
};
