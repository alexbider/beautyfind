'use server';

import type { BusinessStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { areaUserOrNull } from '@/components/ops/guard';
import { db } from '@/lib/server/db';
import { ensureImportRecords, estimateCompletion, startCompletion, type EnhanceResult } from '@/lib/server/enhanceRuns';

// Staff actions on a business: its status (live, hidden, past due, pending) with a reason. Every
// change is an append-only decision plus an audit row, and the public pages are refreshed so a hidden
// business leaves the directory at once.

const Input = z.object({ id: z.string().uuid(), status: z.enum(['pending', 'live', 'past_due', 'hidden']), reason: z.string().trim().max(300).optional() });

export type BizActionResult = { ok: true } | { ok: false; error: 'forbidden' | 'invalid' | 'not_found' };

export async function setBusinessStatusAction(input: z.input<typeof Input>): Promise<BizActionResult> {
  const user = await areaUserOrNull('businesses', 'edit');
  if (!user) return { ok: false, error: 'forbidden' };
  const p = Input.safeParse(input);
  if (!p.success) return { ok: false, error: 'invalid' };
  const b = await db.business.findUnique({ where: { id: p.data.id }, select: { id: true, status: true, branches: { select: { regionSlug: true, slug: true } } } });
  if (!b) return { ok: false, error: 'not_found' };
  if (b.status === p.data.status) return { ok: true };
  await db.$transaction([
    db.business.update({ where: { id: b.id }, data: { status: p.data.status as BusinessStatus } }),
    db.decision.create({ data: { actorId: user.id, actorRole: user.opsRole ?? 'ops', subjectType: 'business', subjectId: b.id, action: `status_${p.data.status}`, reason: p.data.reason || null } }),
    db.auditLog.create({ data: { actorId: user.id, action: 'business_status', subjectType: 'business', subjectId: b.id, businessId: b.id, meta: { from: b.status, to: p.data.status, note: p.data.reason || null } } }),
  ]);
  revalidatePath('/');
  revalidatePath('/search');
  for (const br of b.branches) revalidatePath(`/${br.regionSlug}`);
  revalidatePath(`/ops/businesses/${b.id}`);
  revalidatePath('/ops/businesses');
  return { ok: true };
}

// ---------- AI completion ----------


export type EnhanceMode = 'auto' | 'rewrite' | 'site' | 'images';
export type EnhanceBranchesResult = (EnhanceResult & { seeded: number; skipped: Array<{ id: string; reason: string }> }) | { ok: false; count: 0; error: string; seeded: 0; skipped: [] };

const SKIP_TEXT: Record<string, string> = { claimed: 'בבעלות מאומתת (הנתונים של הבעלים)', not_live: 'לא מפורסם', no_coordinates: 'חסרות קואורדינטות', missing: 'לא נמצא' };

/**
 * Runs the AI completion on listings: a listing without an import record gets one seeded from its own
 * data first, then one enhance run starts for everything that qualifies. mode: auto (the gap plan),
 * rewrite (description and FAQs written again), site (the website read again plus the plan), images.
 */
export async function enhanceBranchesAction(branchIds: string[], mode: EnhanceMode = 'auto', label?: string): Promise<EnhanceBranchesResult> {
  const user = await areaUserOrNull('businesses', 'edit');
  const list = z.array(z.string().uuid()).min(1).max(2000).safeParse(branchIds);
  if (!user || !list.success) return { ok: false, count: 0, error: 'אין הרשאה או קלט לא תקין', seeded: 0, skipped: [] };
  const seeded = await ensureImportRecords(list.data, user.id);
  const ids = [...seeded.existing, ...seeded.created];
  const skipped = seeded.skipped.map(x => ({ id: x.id, reason: SKIP_TEXT[x.reason] ?? x.reason }));
  if (!ids.length) return { ok: true, count: 0, runId: null, budgetUsd: 0, plan: {}, seeded: seeded.created.length, skipped };
  const opts =
    mode === 'rewrite' ? { auto: false, steps: ['site', 'editorial', 'regenerate'], label: label ?? `כתיבה מחדש: ${ids.length} עסקים` }
    : mode === 'site' ? { auto: true, rereadSite: true, label: label ?? `השלמה עם קריאת האתר: ${ids.length} עסקים` }
    : mode === 'images' ? { auto: false, steps: ['images'], label: label ?? `תמונות: ${ids.length} עסקים` }
    : { auto: true, label: label ?? `השלמה ב־AI: ${ids.length} עסקים` };
  const r = await startCompletion(user, ids, opts);
  for (const id of list.data) revalidatePath(`/ops/businesses/${id}`);
  revalidatePath('/ops/businesses');
  return r.ok ? { ...r, seeded: seeded.created.length, skipped } : { ok: false, count: 0, error: r.error, seeded: 0, skipped: [] };
}

// ---------- business details ----------

const BusinessInput = z.object({
  id: z.string().uuid(), legalName: z.string().trim().max(200), companyNo: z.string().trim().max(12), type: z.enum(['clinic', 'medspa', 'cosmetics', 'salon']),
  invoiceEmail: z.string().trim().max(160), accountantEmail: z.string().trim().max(160), chainKey: z.string().trim().max(120),
});

export async function saveBusinessDetailsAction(input: z.input<typeof BusinessInput>): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await areaUserOrNull('businesses', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = BusinessInput.safeParse(input);
  if (!p.success) return { ok: false, error: 'קלט לא תקין' };
  const f = p.data;
  const digits = f.companyNo.replace(/\D/g, '');
  if (f.companyNo && digits.length !== 9) return { ok: false, error: 'ח.פ. או ע.מ. הם 9 ספרות' };
  for (const k of ['invoiceEmail', 'accountantEmail'] as const) if (f[k] && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f[k])) return { ok: false, error: 'דוא״ל לא תקין' };
  const b = await db.business.findUnique({ where: { id: f.id }, select: { id: true, legalName: true, companyNo: true, type: true, invoiceEmail: true, accountantEmail: true, chainKey: true } });
  if (!b) return { ok: false, error: 'העסק לא נמצא' };
  const data = { legalName: f.legalName || null, companyNo: digits || null, type: f.type, invoiceEmail: f.invoiceEmail.toLowerCase() || null, accountantEmail: f.accountantEmail.toLowerCase() || null, chainKey: f.chainKey || null };
  const changed = (Object.keys(data) as Array<keyof typeof data>).filter(k => (b[k] ?? null) !== (data[k] ?? null));
  await db.business.update({ where: { id: b.id }, data });
  await db.auditLog.create({ data: { actorId: user.id, action: 'business_edit', subjectType: 'business', subjectId: b.id, businessId: b.id, meta: { changed } } });
  revalidatePath(`/ops/businesses/${b.id}`);
  revalidatePath('/ops/businesses');
  return { ok: true };
}

/** The automatic plan and its estimate for listings (what the bulk screen shows before starting). Listings without an import record are counted apart. */
export async function estimateCompletionAction(branchIds: string[]): Promise<{ ok: true; listings: number; unseeded: number; plan: Record<string, number>; usd: number } | { ok: false; error: string }> {
  const user = await areaUserOrNull('businesses', 'view');
  const list = z.array(z.string().uuid()).min(1).max(2000).safeParse(branchIds);
  if (!user || !list.success) return { ok: false, error: 'קלט לא תקין' };
  const places = await db.importPlace.count({ where: { branchId: { in: list.data }, status: { in: ['approved', 'merged'] } } });
  const est = await estimateCompletion(list.data);
  return { ok: true, listings: est.listings, unseeded: list.data.length - places, plan: est.plan, usd: est.usd };
}
