'use server';

import { fromE164, toE164 } from '@/lib/format';
import { db } from '@/lib/server/db';
import { PUBLIC_WHERE, profileHref } from '@/lib/server/public';
import { siteUrl } from '@/lib/server/site';
import { messaging } from '@/lib/vendors/messaging';
import { LEAD_EVENT_TEXT, LEAD_EVENT_TEXT_NO_EMAIL, LEAD_RATE_LIMIT, LeadSchema, leadErrors, type LeadInput, type LeadResult } from './lead-shared';

const DAY_MS = 24 * 60 * 60_000;

/**
 * Profile contact form ("פנייה לעסק"). Registers a CRM lead (source `form`, stage `new`) with a
 * `form` timeline event, then emails the branch (or the business owner when the branch has no email).
 * Only claimed, public branches accept leads. Rate limit: 3 per phone or email per branch per 24h.
 */
export async function submitProfileLead(input: LeadInput): Promise<LeadResult> {
  const raw = {
    branchId: String(input?.branchId ?? ''),
    name: String(input?.name ?? ''),
    phone: String(input?.phone ?? ''),
    email: String(input?.email ?? ''),
    treatment: String(input?.treatment ?? ''),
    message: String(input?.message ?? ''),
    website: String(input?.website ?? ''),
    ...(input?.serviceId ? { serviceId: String(input.serviceId) } : {}),
  };
  const parsed = LeadSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = leadErrors(raw);
    if (Object.keys(fields).length === 0) return { ok: false, error: 'not_found' }; // bad branch id
    return { ok: false, error: 'invalid', fields };
  }
  const d = parsed.data;
  // Honeypot filled: answer like a success so the bot learns nothing, store nothing.
  if (d.website.trim()) return { ok: true };

  try {
    const branch = await db.branch.findFirst({
      where: { AND: [PUBLIC_WHERE, { id: d.branchId, isClaimed: true }] },
      select: {
        id: true, name: true, slug: true, regionSlug: true, email: true, businessId: true,
        business: { select: { owner: { select: { email: true } } } },
      },
    });
    if (!branch) return { ok: false, error: 'not_found' };

    const phone = d.phone ? toE164(d.phone) : null;
    const email = d.email ? d.email.toLowerCase() : null;

    const recent = await db.lead.count({
      where: {
        branchId: branch.id,
        source: 'form',
        createdAt: { gte: new Date(Date.now() - DAY_MS) },
        OR: [...(phone ? [{ phone }] : []), ...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : [])],
      },
    });
    if (recent >= LEAD_RATE_LIMIT) return { ok: false, error: 'rate_limited' };

    const to = branch.email?.trim() || branch.business.owner?.email?.trim() || null;
    // A quote request names the service (business, branch and service context travel with the lead).
    const service = d.serviceId ? await db.treatment.findFirst({ where: { id: d.serviceId, branchId: branch.id }, select: { id: true, name: true, priceAgorot: true } }) : null;
    const treatmentName = service?.name ?? (d.treatment || null);
    const notes = [service ? `בקשת מחיר ופרטים לשירות: ${service.name}${service.priceAgorot == null ? ' (המחיר לא פורסם)' : ''} [${service.id}]` : null, d.message || null].filter(Boolean).join('\n') || null;
    const lead = await db.lead.create({
      data: {
        businessId: branch.businessId,
        branchId: branch.id,
        name: d.name,
        phone,
        email,
        treatment: treatmentName,
        notes,
        source: 'form',
        stage: 'new',
        events: { create: { kind: 'form', text: to ? LEAD_EVENT_TEXT : LEAD_EVENT_TEXT_NO_EMAIL } },
      },
      select: { id: true },
    });

    if (to) {
      try {
        await messaging().send({
          channel: 'email',
          to,
          template: 'M_profile_lead',
          vars: {
            business: branch.name,
            name: d.name,
            phone: phone ? fromE164(phone) : '',
            email: email ?? '',
            treatment: treatmentName ?? '',
            message: notes ?? '',
            leads_link: `${siteUrl()}/biz/leads`,
            profile_link: `${siteUrl()}${profileHref(branch)}`,
          },
          kind: 'service',
        });
      } catch (e) {
        // The lead is saved and visible in the CRM; record the failed email on its timeline.
        console.error('[profile-lead] email failed', e);
        await db.leadEvent.create({ data: { leadId: lead.id, kind: 'note', text: 'שליחת הדוא״ל לעסק נכשלה. הפנייה שמורה כאן.' } }).catch(() => {});
      }
    } else {
      console.warn('[profile-lead] no email for branch', branch.id);
    }
    return { ok: true };
  } catch (e) {
    console.error('[profile-lead] failed', e);
    return { ok: false, error: 'failed' };
  }
}
