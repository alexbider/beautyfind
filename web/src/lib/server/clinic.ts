import 'server-only';
import type { Profession } from '@prisma/client';
import { notFound } from 'next/navigation';
import { PRESET_NAMES, isPreset, type Preset } from '../permissions';
import { bizContext } from './biz';
import { db } from './db';

// Clinic system areas (04-permissions.md). Advanced plan only: on the basic plan every one of these
// is hidden and the page shows an upgrade card instead. Profession gates medical actions separately.

export type ClinicArea = 'bookings' | 'consults' | 'waitlist' | 'giftcards';
export type ClinicLevel = 'none' | 'own' | 'view' | 'manage';

const DEFAULTS: Record<Preset, Record<ClinicArea, ClinicLevel>> = {
  owner: { bookings: 'manage', consults: 'manage', waitlist: 'manage', giftcards: 'manage' },
  manager: { bookings: 'manage', consults: 'manage', waitlist: 'manage', giftcards: 'manage' },
  front: { bookings: 'manage', consults: 'manage', waitlist: 'manage', giftcards: 'manage' },
  book: { bookings: 'none', consults: 'none', waitlist: 'none', giftcards: 'view' },
  practitioner: { bookings: 'own', consults: 'view', waitlist: 'view', giftcards: 'none' },
};

export async function isAdvanced(businessId: string) {
  const sub = await db.subscription.findUnique({ where: { businessId }, select: { plan: true, status: true } });
  return sub?.plan === 'advanced' && sub.status !== 'cancelled';
}

/**
 * Context for /clinic pages. 404 when the area is `none` for this role.
 * `advanced: false` means render the upgrade card (the area exists but isn't in the plan).
 */
export async function clinicContext(area: ClinicArea) {
  const ctx = await bizContext();
  const preset: Preset = ctx.preview ?? (ctx.member.isOwner ? 'owner' : isPreset(ctx.member.preset) ? ctx.member.preset : 'practitioner');
  const stored = (ctx.member.permissions ?? {}) as Record<string, unknown>;
  const raw = !ctx.preview && !ctx.member.isOwner ? stored[area] : undefined;
  const level: ClinicLevel = raw === 'none' || raw === 'own' || raw === 'view' || raw === 'manage' ? raw : DEFAULTS[preset][area];
  if (level === 'none') notFound();
  const profession: Profession = ctx.member.profession;
  return {
    ...ctx,
    level,
    canManage: level === 'manage',
    profession,
    isDoctor: profession === 'doctor',
    roleName: PRESET_NAMES[preset].name,
    advanced: await isAdvanced(ctx.business.id),
  };
}

export async function requireClinic(area: ClinicArea, need: 'view' | 'manage') {
  const c = await clinicContext(area);
  if (!c.advanced) throw new Error('forbidden: plan');
  if (need === 'manage' && !c.canManage) throw new Error(`forbidden: ${area}:manage`);
  return c;
}

/** Health declaration answers: only the treating practitioner of that booking, or the branch's responsible doctor. */
export function canReadDeclaration(c: { member: { id: string } }, booking: { practitionerId: string | null; branch: { medicalResponsibleId: string | null } }) {
  return booking.practitionerId === c.member.id || booking.branch.medicalResponsibleId === c.member.id;
}
