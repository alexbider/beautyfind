'use server';

import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { toE164 } from '@/lib/format';
import { db } from '@/lib/server/db';
import { sendOtp, verifyOtp } from '@/lib/server/otp';
import { nextRef } from '@/lib/server/refs';
import { currentUser } from '@/lib/server/session';
import { clearClaimProof, readClaimProof, setClaimProof } from './claim-token';
import { claimTarget, isClaimedRow, loadLiveBranch, maskEmail, maskPhone, searchLiveBranches } from './data';
import { CATEGORY_SLUGS, CLAIM_METHODS, TIME_RE, detailsErrors, hasMedical, type ClaimDetails, type ListingHit } from './shared';

const SLA_MS = 24 * 60 * 60_000;
const OPEN_STATUSES = ['open', 'awaiting_document'] as const;

async function bizUser() {
  const user = await currentUser();
  return user && user.kind === 'business' ? user : null;
}

// ---------- Find ----------

export type SearchResult = { ok: true; hits: ListingHit[] } | { ok: false; error: 'unauthorized' | 'failed' };

export async function searchListings(q: string): Promise<SearchResult> {
  if (!(await bizUser())) return { ok: false, error: 'unauthorized' };
  const parsed = z.string().max(80).safeParse(q);
  if (!parsed.success) return { ok: true, hits: [] };
  try {
    return { ok: true, hits: await searchLiveBranches(parsed.data) };
  } catch (e) {
    console.error('[claim] search failed', e);
    return { ok: false, error: 'failed' };
  }
}

// ---------- Verify ----------

const codeTargetInput = z.object({ branchId: z.uuid(), method: z.enum(CLAIM_METHODS) });

type TargetError = 'unauthorized' | 'not_found' | 'claimed' | 'no_target' | 'failed';

export type SendCodeResult =
  | { ok: true; cooldownSeconds: number }
  | { ok: false; error: TargetError | 'cooldown'; retryInSeconds?: number };

export async function sendClaimCode(input: { branchId: string; method: string }): Promise<SendCodeResult> {
  const user = await bizUser();
  if (!user) return { ok: false, error: 'unauthorized' };
  const parsed = codeTargetInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'not_found' };
  try {
    const branch = await loadLiveBranch(parsed.data.branchId);
    if (!branch) return { ok: false, error: 'not_found' };
    if (isClaimedRow(branch)) return { ok: false, error: 'claimed' };
    const t = claimTarget(branch, parsed.data.method);
    if (!t) return { ok: false, error: 'no_target' };
    const res = await sendOtp({ target: t.target, channel: t.channel, purpose: 'claim', context: { branchId: branch.id, userId: user.id } });
    if (!res.ok) return { ok: false, error: 'cooldown', retryInSeconds: res.retryInSeconds };
    return { ok: true, cooldownSeconds: res.cooldownSeconds };
  } catch (e) {
    console.error('[claim] send failed', e);
    return { ok: false, error: 'failed' };
  }
}

export type VerifyCodeResult = { ok: true } | { ok: false; error: TargetError | 'invalid' | 'expired' | 'too_many_attempts' };

export async function verifyClaimCode(input: { branchId: string; method: string; code: string }): Promise<VerifyCodeResult> {
  const user = await bizUser();
  if (!user) return { ok: false, error: 'unauthorized' };
  const parsed = codeTargetInput.extend({ code: z.string().regex(/^\d{6}$/) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  try {
    const branch = await loadLiveBranch(parsed.data.branchId);
    if (!branch) return { ok: false, error: 'not_found' };
    if (isClaimedRow(branch)) return { ok: false, error: 'claimed' };
    const t = claimTarget(branch, parsed.data.method);
    if (!t) return { ok: false, error: 'no_target' };
    const res = await verifyOtp({ target: t.target, purpose: 'claim', code: parsed.data.code });
    if (!res.ok) return { ok: false, error: res.error };
    // The code must have been requested by this user for this branch.
    const ctx = (res.context ?? {}) as Record<string, unknown>;
    if (ctx.branchId !== branch.id || ctx.userId !== user.id) return { ok: false, error: 'invalid' };
    await setClaimProof({
      branchId: branch.id,
      userId: user.id,
      method: parsed.data.method,
      target: t.channel === 'email' ? maskEmail(t.target) : maskPhone(t.target),
      verifiedAt: new Date().toISOString(),
    });
    return { ok: true };
  } catch (e) {
    console.error('[claim] verify failed', e);
    return { ok: false, error: 'failed' };
  }
}

// ---------- Submit ----------

const detailsInput = z
  .object({
    branchId: z.uuid(),
    bizName: z.string().trim().max(120),
    address: z.string().trim().max(200),
    phone: z.string().trim().max(20),
    whatsapp: z.string().trim().max(20),
    cats: z.array(z.string().refine(s => CATEGORY_SLUGS.has(s))).max(CATEGORY_SLUGS.size),
    doctor: z.string().trim().max(160),
    days: z.array(z.object({ open: z.boolean(), from: z.string().regex(TIME_RE), to: z.string().regex(TIME_RE) })).length(7),
  })
  .superRefine((d, ctx) => {
    for (const [field, bad] of Object.entries(detailsErrors(d))) {
      if (bad) ctx.addIssue({ code: 'custom', path: [field], message: 'invalid' });
    }
  });

export type SubmitClaimResult =
  | { ok: true; ref: string }
  | { ok: false; error: 'unauthorized' | 'invalid' | 'not_verified' | 'not_found' | 'claimed' | 'failed' }
  | { ok: false; error: 'duplicate'; ref: string };

const CHECK_TEXT = {
  sms: 'קוד אומת ב־SMS למספר הרשום',
  call: 'קוד אומת בשיחה קולית למספר הרשום',
  mail: 'קוד אומת בדואר האלקטרוני הרשום',
} as const;

export async function submitClaim(input: ClaimDetails): Promise<SubmitClaimResult> {
  const user = await bizUser();
  if (!user) return { ok: false, error: 'unauthorized' };
  const parsed = detailsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const d = parsed.data;

  const proof = await readClaimProof();
  if (!proof || proof.userId !== user.id || proof.branchId !== d.branchId) return { ok: false, error: 'not_verified' };

  try {
    const branch = await loadLiveBranch(d.branchId);
    if (!branch) return { ok: false, error: 'not_found' };
    if (isClaimedRow(branch)) return { ok: false, error: 'claimed' };

    const existing = await db.verificationRequest.findFirst({
      where: { kind: 'claim', branchId: branch.id, submittedById: user.id, status: { in: [...OPEN_STATUSES] } },
      select: { ref: true },
    });
    if (existing) return { ok: false, error: 'duplicate', ref: existing.ref };

    const medical = hasMedical(d.cats);
    // Ownership is not granted here: the details wait in the request until BeautyFind approves.
    const submitted: Prisma.InputJsonValue = {
      branch: { id: branch.id, name: branch.name, cityName: branch.cityName },
      details: {
        name: d.bizName,
        address: d.address,
        phone: toE164(d.phone),
        whatsapp: d.whatsapp ? toE164(d.whatsapp) : null,
        categories: d.cats,
        medicalResponsible: medical ? d.doctor : null,
        hours: d.days.map(x => (x.open ? { open: x.from, close: x.to, closed: false } : { open: '', close: '', closed: true })),
      },
      verification: { method: proof.method, target: proof.target, verifiedAt: proof.verifiedAt },
    };
    const checks = [
      { result: 'ok', text: CHECK_TEXT[proof.method] },
      { result: 'todo', text: 'ח״פ מול רשם החברות' },
      ...(medical ? [{ result: 'todo', text: 'רישיון האחראי הרפואי מול משרד הבריאות' }] : []),
    ];

    const ref = await nextRef('CLM');
    await db.verificationRequest.create({
      data: {
        ref,
        kind: 'claim',
        businessId: branch.businessId,
        branchId: branch.id,
        submittedById: user.id,
        submitted,
        checks,
        slaDueAt: new Date(Date.now() + SLA_MS),
      },
    });
    await clearClaimProof();
    return { ok: true, ref };
  } catch (e) {
    console.error('[claim] submit failed', e);
    return { ok: false, error: 'failed' };
  }
}
