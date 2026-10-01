import 'server-only';
import type { Campaign, CampaignStatus } from '@prisma/client';
import { categoryBySlug, regionBySlug } from '@/lib/catalog';
import { db } from '@/lib/server/db';
import { platformSettings } from '@/lib/server/platformSettings';
import { contentChecks, weekEnd, type CheckResult } from '@/lib/sponsoredChecks';

// Sponsored placements waiting for review, with the automatic checks a reviewer needs in front of
// them: the content rules, the medical responsibility of the branch (a medical category needs a
// verified doctor), the capacity of the list (max N approved per region, category and week) and
// whether the business has an open debt (no charge until it is settled).

export const STATUS_NAME: Record<CampaignStatus, string> = { pending_review: 'לבדיקה', approved: 'אושר', rejected: 'נדחה', cancelled: 'בוטל' };
export const STATUS_TONE: Record<CampaignStatus, 'warn' | 'ok' | 'bad' | 'neutral'> = { pending_review: 'warn', approved: 'ok', rejected: 'bad', cancelled: 'neutral' };
const MEDICAL_GROUP = /רפואי|רפואית|הזרקות|לייזר/u;

export interface CampaignView extends Campaign {
  businessName: string;
  branchName: string;
  regionName: string;
  categoryName: string;
  checks: CheckResult[];
  blocking: boolean;
  capacityUsed: number;
  capacityMax: number;
  totalAgorot: number;
}

export async function reviewChecks(c: Campaign): Promise<{ checks: CheckResult[]; capacityUsed: number; capacityMax: number }> {
  const s = await platformSettings();
  const checks = contentChecks(c.line, c.featuredTreatment);
  const [branch, business, overlapping] = await Promise.all([
    db.branch.findUnique({ where: { id: c.branchId }, select: { status: true, medicalResponsible: { select: { profession: true, license: { select: { status: true } } } } } }),
    db.business.findUnique({ where: { id: c.businessId }, select: { status: true, subscription: { select: { status: true } } } }),
    db.campaign.count({ where: { id: { not: c.id }, status: 'approved', regionSlug: c.regionSlug, categorySlug: c.categorySlug, weekStart: { lt: weekEnd(c.weekStart, c.weeks) }, AND: [{ weekStart: { gte: new Date(c.weekStart.getTime() - 26 * 7 * 86_400_000) } }] } }),
  ]);
  const cat = categoryBySlug(c.categorySlug);
  const medical = !!cat && (MEDICAL_GROUP.test(cat.group) || MEDICAL_GROUP.test(cat.name));
  if (medical) {
    const doc = branch?.medicalResponsible;
    if (doc?.profession === 'doctor' && doc.license?.status === 'verified') checks.push({ result: 'ok', text: 'הרופא/ה האחראי/ת מאומת/ת' });
    else checks.push({ result: 'bad', text: 'תחום רפואי ללא רופא/ה אחראי/ת מאומת/ת בסניף' });
  }
  if (!branch || branch.status !== 'live') checks.push({ result: 'bad', text: 'הסניף אינו מפורסם' });
  const max = s.sponsoredMaxPerList;
  if (overlapping < max) checks.push({ result: 'ok', text: `יש מקום פנוי: ${overlapping + 1} מתוך ${max}` });
  else checks.push({ result: 'bad', text: `הרשימה מלאה: ${overlapping} מתוך ${max} ממומנים בשבועות האלה` });
  if (business?.status === 'past_due' || business?.subscription?.status === 'past_due') checks.push({ result: 'warn', text: 'לעסק חוב פתוח: לא ניתן לחייב עד הסדרה' });
  return { checks, capacityUsed: overlapping, capacityMax: max };
}

export async function listCampaigns(filter: 'pending' | 'all'): Promise<CampaignView[]> {
  const rows = await db.campaign.findMany({ where: filter === 'pending' ? { status: 'pending_review' } : {}, orderBy: [{ status: 'asc' }, { weekStart: 'asc' }], take: 100 });
  const branchIds = [...new Set(rows.map(r => r.branchId))];
  const branches = branchIds.length ? await db.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true, businessId: true } }) : [];
  const out: CampaignView[] = [];
  for (const c of rows) {
    const r = c.status === 'pending_review' ? await reviewChecks(c) : { checks: (Array.isArray(c.checks) ? c.checks : []) as CheckResult[], capacityUsed: 0, capacityMax: 0 };
    const br = branches.find(b => b.id === c.branchId);
    const gross = c.weeklyPriceAgorot * c.weeks;
    out.push({
      ...c, businessName: br?.name ?? 'עסק', branchName: br?.name ?? '—', regionName: regionBySlug(c.regionSlug)?.name ?? c.regionSlug, categoryName: categoryBySlug(c.categorySlug)?.name ?? c.categorySlug,
      checks: r.checks, blocking: r.checks.some(x => x.result === 'bad'), capacityUsed: r.capacityUsed, capacityMax: r.capacityMax, totalAgorot: Math.round(gross * (1 - c.discountPct / 100)),
    });
  }
  return out;
}

/** Businesses with live branches, for the manual order form. */
export async function orderableBranches() {
  return db.branch.findMany({ where: { status: 'live', business: { status: { in: ['live', 'past_due'] } } }, select: { id: true, name: true, cityName: true, regionSlug: true, businessId: true, categories: { select: { categorySlug: true, isPrimary: true } } }, orderBy: { name: 'asc' }, take: 500 });
}
