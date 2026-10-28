'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { bizContext } from '@/lib/server/biz';
import { cancelCampaign, cardCheckoutUrl, hasSponsoredCard, requestCampaign, resumeCampaign } from '@/lib/server/sponsored';
import { stripeConfigured } from '@/lib/server/billing/stripe';
import { SPONSORED_LINE_MAX } from '@/lib/sponsoredChecks';

// The owner's side of sponsored placements (/biz/sponsored): ask for a page, save a card, cancel or resume.
// Buying and cancelling need billing edit rights; everything is checked again on the server.

type Result = { ok: true; message?: string; url?: string; ref?: string } | { ok: false; error: string };

async function editor() {
  const ctx = await bizContext();
  if (ctx.perms.billing !== 'edit' || ctx.preview) return null;
  return ctx;
}

const RequestInput = z.object({
  branchId: z.string().uuid(),
  pageKey: z.string().min(4).max(120),
  line: z.string().trim().min(3).max(SPONSORED_LINE_MAX),
  featuredTreatment: z.string().trim().max(80).optional(),
});

export async function requestPlacementAction(input: z.input<typeof RequestInput>): Promise<Result> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: 'רק מי שמנהל את החיוב בעסק יכול להזמין מקום ממומן' };
  const p = RequestInput.safeParse(input);
  if (!p.success) return { ok: false, error: `כתבו שורת הדגשה של 3 עד ${SPONSORED_LINE_MAX} תווים` };
  const r = await requestCampaign({ businessId: ctx.business.id, branchId: p.data.branchId, pageKey: p.data.pageKey, line: p.data.line, featuredTreatment: p.data.featuredTreatment }, { userId: ctx.user.id, via: 'owner' });
  if (!r.ok) return r;
  revalidatePath('/biz/sponsored');
  revalidatePath('/ops/sponsored');
  // No card yet: save one now (no charge), so the placement can go live the moment it is approved.
  if (stripeConfigured() && !(await hasSponsoredCard(ctx.business.id))) {
    const c = await cardCheckoutUrl(r.id, ctx.business.id).catch(() => null);
    if (c?.ok) return { ok: true, ref: r.ref, url: c.url };
  }
  return { ok: true, ref: r.ref, message: r.free ? 'free' : undefined };
}

export async function saveCardAction(campaignId: string): Promise<Result> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: 'אין הרשאה' };
  if (!z.string().uuid().safeParse(campaignId).success) return { ok: false, error: 'קלט לא תקין' };
  const r = await cardCheckoutUrl(campaignId, ctx.business.id).catch(e => ({ ok: false as const, error: (e as Error).message }));
  return r.ok ? { ok: true, url: r.url } : { ok: false, error: r.error };
}

export async function cancelPlacementAction(campaignId: string): Promise<Result> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: 'אין הרשאה' };
  if (!z.string().uuid().safeParse(campaignId).success) return { ok: false, error: 'קלט לא תקין' };
  const r = await cancelCampaign(campaignId, { userId: ctx.user.id, businessId: ctx.business.id });
  revalidatePath('/biz/sponsored');
  return r.ok ? { ok: true, message: r.message } : r;
}

export async function resumePlacementAction(campaignId: string): Promise<Result> {
  const ctx = await editor();
  if (!ctx) return { ok: false, error: 'אין הרשאה' };
  if (!z.string().uuid().safeParse(campaignId).success) return { ok: false, error: 'קלט לא תקין' };
  const r = await resumeCampaign(campaignId, ctx.business.id);
  revalidatePath('/biz/sponsored');
  return r.ok ? { ok: true, message: r.message } : r;
}
