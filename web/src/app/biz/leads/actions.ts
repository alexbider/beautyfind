'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  FIELD_NAMES, LIMITS, MANUAL_SOURCE_KEYS, STAGE_KEYS, parseDay, sourceName, stageOf, todayIL, validateLead,
  type LeadField, type LeadFields,
} from '@/components/dashboard/leads/shared';
import { toE164 } from '@/lib/format';
import { requireArea } from '@/lib/server/biz';
import { db } from '@/lib/server/db';

export type LeadResult = { ok: true } | { ok: false; error: string; field?: LeadField };

const FORBIDDEN = 'אין לכם הרשאת עריכה במסך הזה.';
const NOT_FOUND = 'הכרטיס לא נמצא. ייתכן שנמחק בינתיים.';
const INVALID = 'חלק מהפרטים אינם תקינים. בדקו את הטופס ונסו שוב.';

const Id = z.uuid();
const str = (max: number) => z.string().max(max);
const Fields = z.object({
  name: str(LIMITS.name + 20), phone: str(LIMITS.phone + 10), email: str(LIMITS.email + 10), city: str(LIMITS.city + 10),
  treatment: str(LIMITS.treatment + 10), value: str(12), nextAction: str(LIMITS.nextAction + 10), nextDate: str(20),
});

/** Re-checks the session and the leads:edit level. Never trust the client. */
async function editCtx() {
  try {
    return await requireArea('leads', 'edit');
  } catch (e) {
    // Only the permission failure becomes a message; a login redirect must keep propagating.
    if (e instanceof Error && e.message.startsWith('forbidden')) return null;
    throw e;
  }
}

/** The lead, only when it belongs to this business. */
async function ownLead(businessId: string, id: unknown) {
  const p = Id.safeParse(id);
  if (!p.success) return null;
  return db.lead.findFirst({ where: { id: p.data, businessId } });
}

function done() {
  // The layout's nav badge counts `new` leads, so refresh the whole /biz tree.
  revalidatePath('/biz', 'layout');
  return { ok: true } as const;
}

function normalize(f: LeadFields) {
  const day = parseDay(f.nextDate);
  return {
    name: f.name.trim(),
    phone: f.phone.trim() ? toE164(f.phone) : null,
    email: f.email.trim() ? f.email.trim().toLowerCase() : null,
    city: f.city.trim() || null,
    treatment: f.treatment.trim() || null,
    valueAgorot: f.value ? Number(f.value) * 100 : null,
    nextAction: f.nextAction.trim() || null,
    nextDate: day ? new Date(Date.UTC(day.y, day.m - 1, day.d)) : null,
  };
}

const AddInput = z.object({ fields: Fields, source: z.enum(MANUAL_SOURCE_KEYS) });

/** Manual add (phone, WhatsApp, walk-in, referral). `form` leads only come from the public profile form. */
export async function addLead(input: z.input<typeof AddInput>): Promise<LeadResult> {
  const ctx = await editCtx();
  if (!ctx) return { ok: false, error: FORBIDDEN };
  const p = AddInput.safeParse(input);
  if (!p.success) return { ok: false, error: INVALID };
  const f = { ...p.data.fields, nextAction: '', nextDate: '' };
  const v = validateLead(f, { withNext: false });
  if (v.first) return { ok: false, error: v.first, field: Object.keys(v.fields)[0] as LeadField };

  const n = normalize(f);
  await db.lead.create({
    data: {
      businessId: ctx.business.id,
      branchId: ctx.branch?.id ?? null,
      name: n.name, phone: n.phone, email: n.email, city: n.city, treatment: n.treatment, valueAgorot: n.valueAgorot,
      source: p.data.source,
      stage: 'new',
      nextAction: 'לחזור אליו/ה',
      nextDate: todayIL(),
      events: { create: { kind: 'contact', text: `נוסף/ה ידנית ללוח, מקור: ${sourceName(p.data.source)}`, actorId: ctx.user.id } },
    },
  });
  return done();
}

const EditInput = z.object({ id: z.string(), fields: Fields });

/** Details edit. Writes one `edit` event naming the fields that changed; no event when nothing changed. */
export async function saveLeadDetails(input: z.input<typeof EditInput>): Promise<LeadResult> {
  const ctx = await editCtx();
  if (!ctx) return { ok: false, error: FORBIDDEN };
  const p = EditInput.safeParse(input);
  if (!p.success) return { ok: false, error: INVALID };
  const lead = await ownLead(ctx.business.id, p.data.id);
  if (!lead) return { ok: false, error: NOT_FOUND };
  const v = validateLead(p.data.fields, { withNext: true });
  if (v.first) return { ok: false, error: v.first, field: Object.keys(v.fields)[0] as LeadField };

  const n = normalize(p.data.fields);
  const sameDate = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
  const changed: LeadField[] = [];
  if (n.name !== lead.name) changed.push('name');
  if (n.phone !== lead.phone) changed.push('phone');
  if (n.email !== lead.email) changed.push('email');
  if (n.city !== lead.city) changed.push('city');
  if (n.treatment !== lead.treatment) changed.push('treatment');
  if (n.valueAgorot !== lead.valueAgorot) changed.push('value');
  if (n.nextAction !== lead.nextAction) changed.push('nextAction');
  if (!sameDate(n.nextDate, lead.nextDate)) changed.push('nextDate');
  if (changed.length === 0) return { ok: true };

  await db.$transaction([
    db.lead.update({ where: { id: lead.id }, data: n }),
    db.leadEvent.create({
      data: { leadId: lead.id, kind: 'edit', text: `פרטי הלקוח עודכנו: ${changed.map(k => FIELD_NAMES[k]).join(', ')}`, actorId: ctx.user.id },
    }),
  ]);
  return done();
}

const UpdateInput = z.object({ id: z.string(), stage: z.enum(STAGE_KEYS).nullable(), note: z.string().max(LIMITS.note + 50) });

/** "רישום עדכון": a stage change writes a `stage` event, a note writes a `note` event. */
export async function logLeadUpdate(input: z.input<typeof UpdateInput>): Promise<LeadResult> {
  const ctx = await editCtx();
  if (!ctx) return { ok: false, error: FORBIDDEN };
  const p = UpdateInput.safeParse(input);
  if (!p.success) return { ok: false, error: INVALID };
  const lead = await ownLead(ctx.business.id, p.data.id);
  if (!lead) return { ok: false, error: NOT_FOUND };
  const note = p.data.note.trim();
  if (note.length > LIMITS.note) return { ok: false, error: 'העדכון ארוך מדי.' };
  const next = p.data.stage && p.data.stage !== lead.stage ? p.data.stage : null;
  if (!next && !note) return { ok: false, error: 'בחרו סטטוס חדש או כתבו מה קרה.' };

  await db.$transaction(async tx => {
    if (next) {
      await tx.lead.update({ where: { id: lead.id }, data: { stage: next } });
      await tx.leadEvent.create({
        data: { leadId: lead.id, kind: 'stage', text: `סטטוס שונה: ${stageOf(lead.stage).name} ← ${stageOf(next).name}`, actorId: ctx.user.id },
      });
    }
    if (note) {
      // A millisecond later so the note sorts after the stage change it explains.
      await tx.leadEvent.create({
        data: { leadId: lead.id, kind: 'note', text: note, actorId: ctx.user.id, createdAt: next ? new Date(Date.now() + 1) : undefined },
      });
    }
  });
  return done();
}

const NotesInput = z.object({ id: z.string(), notes: z.string().max(LIMITS.notes + 50) });

/** "סיכום קבוע על הלקוח": saved on blur; logged as an `edit` event. */
export async function saveLeadNotes(input: z.input<typeof NotesInput>): Promise<LeadResult> {
  const ctx = await editCtx();
  if (!ctx) return { ok: false, error: FORBIDDEN };
  const p = NotesInput.safeParse(input);
  if (!p.success) return { ok: false, error: INVALID };
  const lead = await ownLead(ctx.business.id, p.data.id);
  if (!lead) return { ok: false, error: NOT_FOUND };
  const notes = p.data.notes.trim();
  if (notes.length > LIMITS.notes) return { ok: false, error: 'הסיכום ארוך מדי.' };
  if (notes === (lead.notes ?? '')) return { ok: true };

  await db.$transaction([
    db.lead.update({ where: { id: lead.id }, data: { notes: notes || null } }),
    db.leadEvent.create({ data: { leadId: lead.id, kind: 'edit', text: 'הסיכום הקבוע עודכן', actorId: ctx.user.id } }),
  ]);
  return done();
}

/** Removes the lead and, by cascade, its whole history. The UI asks for confirmation first. */
export async function deleteLead(id: string): Promise<LeadResult> {
  const ctx = await editCtx();
  if (!ctx) return { ok: false, error: FORBIDDEN };
  const lead = await ownLead(ctx.business.id, id);
  if (!lead) return { ok: false, error: NOT_FOUND };
  await db.lead.deleteMany({ where: { id: lead.id, businessId: ctx.business.id } });
  return done();
}
