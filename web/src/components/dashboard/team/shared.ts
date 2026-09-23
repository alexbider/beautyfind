// Team & permissions: constants and serialized shapes shared by the page, the client panel and the actions.
// Design: project/BeautyFind Dashboard.dc.html (isTeam · ROLES, LEVELS).

import type { Area, Level, Perms, Preset } from '@/lib/permissions';

export const LEVELS: Array<{ key: Level; name: string; bg: string; color: string; border: string }> = [
  { key: 'none', name: 'אין גישה', bg: '#F6F8F9', color: '#8A96A3', border: '#E6E6E6' },
  { key: 'view', name: 'צפייה', bg: '#EDEFF2', color: '#0C243E', border: '#D4D4D4' },
  { key: 'edit', name: 'צפייה ועריכה', bg: '#F0FAFB', color: '#0B7A87', border: '#CDEFF3' },
];
export const levelOf = (k: Level) => LEVELS.find(l => l.key === k) ?? LEVELS[0];
export const nextLevel = (k: Level): Level => LEVELS[(LEVELS.findIndex(l => l.key === k) + 1) % LEVELS.length].key;

/** Presets an invite or a member can take. The owner preset is never assignable. */
export const STAFF_PRESETS = ['manager', 'front', 'book', 'practitioner'] as const satisfies readonly Preset[];
export type StaffPreset = (typeof STAFF_PRESETS)[number];

export const INVITE_DAYS = 7;

export interface MemberDTO {
  id: string;
  name: string;
  email: string | null;
  isOwner: boolean;
  preset: StaffPreset | null; // null for the owner
  perms: Perms;
  last: string | null; // last activity, already phrased
}

export interface InviteDTO {
  id: string;
  email: string;
  name: string | null;
  preset: StaffPreset;
  expires: string; // D.M.YYYY
  expired: boolean;
}

export type AreaRow = { key: Area; name: string };
