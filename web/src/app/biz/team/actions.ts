'use server';

import { revalidatePath } from 'next/cache';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { fmtDay } from '@/components/dashboard/leads/shared';
import { INVITE_DAYS, STAFF_PRESETS } from '@/components/dashboard/team/shared';
import { EMAIL_RE } from '@/lib/format';
import { AREAS, DEFAULT_PERMS, PRESET_NAMES, type Area, type Level } from '@/lib/permissions';
import { requireOwner } from '@/lib/server/biz';
import { randomToken, sha256 } from '@/lib/server/crypto';
import { db } from '@/lib/server/db';
import { siteUrl } from '@/lib/server/site';
import { messaging } from '@/lib/vendors/messaging';

export type TeamResult = { ok: true } | { ok: false; error: string };

const FORBIDDEN = 'רק המנהל הראשי יכול לנהל את הצוות.';
const NOT_FOUND = 'המשתמש לא נמצא בעסק.';
const INVALID = 'הבקשה אינה תקינה. רעננו את הדף ונסו שוב.';
const Id = z.uuid();
const LevelZ = z.enum(['none', 'view', 'edit']);

async function ownerCtx() {
  try {
    return await requireOwner();
  } catch (e) {
    // Only the permission failure becomes a message; a login redirect must keep propagating.
    if (e instanceof Error && e.message.startsWith('forbidden')) return null;
    throw e;
  }
}

function done(): TeamResult {
  revalidatePath('/biz/team');
  return { ok: true };
}

/** An active, non-owner member of this business. */
async function editableMember(businessId: string, id: unknown) {
  const p = Id.safeParse(id);
  if (!p.success) return null;
  return db.staffMember.findFirst({ where: { id: p.data, businessId, status: 'active', isOwner: false } });
}

/** Keeps keys outside the dashboard areas (e.g. `bookings`) and replaces the area cells. */
function withAreaCells(stored: unknown, cells: Record<Area, Level>): Prisma.InputJsonObject {
  const base = stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...(stored as Prisma.JsonObject) } : {};
  for (const a of AREAS) delete base[a];
  return { ...base, ...cells };
}

// ---------- Members ----------

/** Switching preset re-seeds the member's levels from that preset (custom cells are cleared). */
export async function setMemberPreset(memberId: string, preset: string): Promise<TeamResult> {
  const ctx = await ownerCtx();
  if (!ctx) return { ok: false, error: FORBIDDEN };
  const p = z.enum(STAFF_PRESETS).safeParse(preset);
  if (!p.success) return { ok: false, error: INVALID };
  const m = await editableMember(ctx.business.id, memberId);
  if (!m) return { ok: false, error: NOT_FOUND };
  await db.staffMember.update({
    where: { id: m.id },
    data: { preset: p.data, permissions: withAreaCells(m.permissions, { ...DEFAULT_PERMS[p.data] }) },
  });
  return done();
}

const PermsZ = z.object(Object.fromEntries(AREAS.map(a => [a, LevelZ])) as Record<Area, typeof LevelZ>);

/** Saves one member's full matrix row. Only the area cells are stored. */
export async function saveMemberPerms(memberId: string, perms: Record<string, string>): Promise<TeamResult> {
  const ctx = await ownerCtx();
  if (!ctx) return { ok: false, error: FORBIDDEN };
  const p = PermsZ.safeParse(perms);
  if (!p.success) return { ok: false, error: INVALID };
  const m = await editableMember(ctx.business.id, memberId);
  if (!m) return { ok: false, error: NOT_FOUND };
  await db.staffMember.update({ where: { id: m.id }, data: { permissions: withAreaCells(m.permissions, p.data) } });
  return done();
}

export async function removeMember(memberId: string): Promise<TeamResult> {
  const ctx = await ownerCtx();
  if (!ctx) return { ok: false, error: FORBIDDEN };
  const m = await editableMember(ctx.business.id, memberId);
  if (!m) return { ok: false, error: NOT_FOUND };
  // A branch's declared medical responsible cannot silently disappear.
  const responsible = await db.branch.count({ where: { businessId: ctx.business.id, medicalResponsibleId: m.id } });
  if (responsible > 0) {
    return { ok: false, error: `${m.displayName} מוגדר/ת כאחראי/ת רפואי/ת בסניף. יש להגדיר אחראי/ת רפואי/ת אחר/ת לפני ההסרה.` };
  }
  await db.staffMember.update({ where: { id: m.id }, data: { status: 'removed' } });
  return done();
}

// ---------- Invites ----------

const InviteInput = z.object({ email: z.string().max(200), name: z.string().max(200), preset: z.enum(STAFF_PRESETS) });
export type InviteField = 'email' | 'name';
export type InviteResult = TeamResult | { ok: false; error: string; field: InviteField };

const expiry = () => new Date(Date.now() + INVITE_DAYS * 86_400_000);

async function sendInvite(opts: { to: string; token: string; name: string | null; preset: string; expiresAt: Date; ctx: NonNullable<Awaited<ReturnType<typeof ownerCtx>>> }) {
  const { ctx } = opts;
  await messaging().send({
    channel: 'email',
    to: opts.to,
    template: 'M18_staff_invite',
    vars: {
      name: opts.name ?? '',
      business: ctx.branch?.name ?? ctx.business.legalName ?? '',
      inviter: ctx.user.fullName ?? ctx.member.displayName,
      role: PRESET_NAMES[opts.preset as keyof typeof PRESET_NAMES]?.name ?? '',
      link: `${siteUrl()}/invite/${opts.token}`,
      expires: fmtDay(opts.expiresAt),
      days: String(INVITE_DAYS),
    },
    kind: 'service',
  });
}

export async function inviteStaff(input: z.input<typeof InviteInput>): Promise<InviteResult> {
  const ctx = await ownerCtx();
  if (!ctx) return { ok: false, error: FORBIDDEN };
  const p = InviteInput.safeParse(input);
  if (!p.success) return { ok: false, error: INVALID };
  const email = p.data.email.trim().toLowerCase();
  const name = p.data.name.trim().replace(/\s+/g, ' ') || null;
  if (!email || !EMAIL_RE.test(email) || email.length > 160) {
    return { ok: false, field: 'email', error: 'נדרשת כתובת דוא״ל תקינה, כי ההזמנה נשלחת אליה.' };
  }
  if (name && name.length > 80) return { ok: false, field: 'name', error: 'השם ארוך מדי.' };

  const member = await db.staffMember.findFirst({
    where: { businessId: ctx.business.id, status: 'active', user: { email: { equals: email, mode: 'insensitive' } } },
    select: { id: true },
  });
  if (member) return { ok: false, field: 'email', error: 'הכתובת הזאת כבר משויכת למשתמש בעסק.' };

  const now = new Date();
  const pending = await db.staffInvite.findFirst({
    where: { businessId: ctx.business.id, status: 'sent', expiresAt: { gt: now }, email: { equals: email, mode: 'insensitive' } },
    select: { id: true },
  });
  if (pending) {
    return { ok: false, field: 'email', error: 'כבר נשלחה הזמנה לכתובת הזאת והיא ממתינה לאישור. אפשר לשלוח אותה שוב מהרשימה.' };
  }
  const token = randomToken();
  const expiresAt = expiry();
  const data = {
    name,
    preset: p.data.preset,
    permissions: { ...DEFAULT_PERMS[p.data.preset] },
    tokenHash: sha256(token),
    invitedById: ctx.user.id,
    status: 'sent' as const,
    expiresAt,
  };
  // An earlier invite to the same address that ran out is reused, so the list keeps one row per address.
  const stale = await db.staffInvite.findFirst({
    where: {
      businessId: ctx.business.id, email: { equals: email, mode: 'insensitive' },
      OR: [{ status: 'expired' }, { status: 'sent', expiresAt: { lte: now } }],
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (stale) await db.staffInvite.update({ where: { id: stale.id }, data });
  else await db.staffInvite.create({ data: { ...data, businessId: ctx.business.id, email } });

  try {
    await sendInvite({ to: email, token, name, preset: p.data.preset, expiresAt, ctx });
  } catch {
    revalidatePath('/biz/team');
    return { ok: false, field: 'email', error: 'ההזמנה נשמרה אבל השליחה נכשלה. נסו שליחה חוזרת מרשימת ההזמנות.' };
  }
  return done();
}

/** A still-open invite of this business (sent, whether or not its 7 days ran out). */
async function openInvite(businessId: string, id: unknown) {
  const p = Id.safeParse(id);
  if (!p.success) return null;
  return db.staffInvite.findFirst({ where: { id: p.data, businessId, status: { in: ['sent', 'expired'] } } });
}

/** New token on the same row and a fresh 7 days. The old link stops working. */
export async function resendInvite(inviteId: string): Promise<TeamResult> {
  const ctx = await ownerCtx();
  if (!ctx) return { ok: false, error: FORBIDDEN };
  const inv = await openInvite(ctx.business.id, inviteId);
  if (!inv) return { ok: false, error: 'ההזמנה לא נמצאה או שכבר טופלה.' };
  const token = randomToken();
  const expiresAt = expiry();
  await db.staffInvite.update({ where: { id: inv.id }, data: { tokenHash: sha256(token), expiresAt, status: 'sent' } });
  try {
    await sendInvite({ to: inv.email, token, name: inv.name, preset: inv.preset, expiresAt, ctx });
  } catch {
    revalidatePath('/biz/team');
    return { ok: false, error: 'השליחה נכשלה. נסו שוב בעוד רגע.' };
  }
  return done();
}

export async function revokeInvite(inviteId: string): Promise<TeamResult> {
  const ctx = await ownerCtx();
  if (!ctx) return { ok: false, error: FORBIDDEN };
  const inv = await openInvite(ctx.business.id, inviteId);
  if (!inv) return { ok: false, error: 'ההזמנה לא נמצאה או שכבר טופלה.' };
  await db.staffInvite.update({ where: { id: inv.id }, data: { status: 'revoked' } });
  return done();
}
