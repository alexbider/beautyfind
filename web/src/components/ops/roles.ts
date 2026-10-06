// BeautyFind staff roles (04-permissions.md), the admin's areas and the access level each role has in
// each area. Pure data and functions: shared by the server guards and the admin's own screens.
//
// Levels: none (the menu item is not shown) · view (read only) · edit (actions) · full (settings of the
// area, and in the team area the right to change other people's roles). The defaults below follow the
// handoff; staff with the ops role can change any other role's levels from /ops/team, and the result is
// stored in platform settings (`rolePermissions`). The ops role itself always stays full, so the admin
// can never lock itself out.

export type OpsRoleKey = 'ops' | 'verifier' | 'moderator' | 'support' | 'legal';
export type Level = 'none' | 'view' | 'edit' | 'full';

export const LEVELS: Level[] = ['none', 'view', 'edit', 'full'];
export const LEVEL_NAMES: Record<Level, string> = { none: 'אין', view: 'צפייה', edit: 'עריכה', full: 'מלא' };
export const levelRank = (l: Level) => LEVELS.indexOf(l);
export const atLeast = (l: Level, want: Level) => levelRank(l) >= levelRank(want);

// Display names for BeautyFind staff roles and the system actor.
export const OPS_ROLE_NAMES: Record<string, string> = {
  ops: 'מנהל־על',
  verifier: 'צוות אימות',
  moderator: 'צוות ביקורות',
  support: 'תמיכה',
  legal: 'משפטי',
  system: 'מערכת',
};
export const OPS_ROLES: OpsRoleKey[] = ['ops', 'verifier', 'moderator', 'support', 'legal'];

export type Area =
  | 'overview' | 'businesses' | 'clients' | 'bookings' | 'disputes' | 'sponsored' | 'moderation' | 'verification' | 'import'
  | 'accounting' | 'content' | 'magazine' | 'messages' | 'ai' | 'integrations' | 'team' | 'audit' | 'settings' | 'health';

export const AREAS: Area[] = [
  'overview', 'businesses', 'clients', 'bookings', 'disputes', 'sponsored', 'moderation', 'verification', 'import',
  'accounting', 'content', 'magazine', 'messages', 'ai', 'integrations', 'team', 'audit', 'settings', 'health',
];

export const AREA_NAMES: Record<Area, string> = {
  overview: 'סקירה כללית', businesses: 'עסקים', clients: 'לקוחות ופרטיות', bookings: 'הזמנות', disputes: 'מחלוקות', sponsored: 'מקומות ממומנים',
  moderation: 'ביקורות', verification: 'אימות רישיונות', import: 'ייבוא עסקים', accounting: 'הנהלת חשבונות', content: 'תוכן ו־SEO', magazine: 'מגזין',
  messages: 'הודעות ותבניות', ai: 'AI ו־MCP', integrations: 'אינטגרציות ומקורות', team: 'צוות והרשאות', audit: 'יומן פעולות',
  settings: 'הגדרות פלטפורמה', health: 'בריאות מערכת',
};

/** The columns of the permissions table on /ops/team: one representative area per column group. */
export const MATRIX_GROUPS: Array<{ name: string; areas: Area[] }> = [
  { name: 'עסקים', areas: ['businesses', 'clients', 'bookings', 'import'] },
  { name: 'אמון', areas: ['verification', 'moderation', 'disputes', 'sponsored'] },
  { name: 'כספים', areas: ['accounting'] },
  { name: 'תוכן', areas: ['content', 'magazine', 'messages'] },
  { name: 'AI ו־MCP', areas: ['ai', 'integrations'] },
  { name: 'הגדרות', areas: ['settings', 'team', 'health'] },
  { name: 'יומן', areas: ['audit'] },
];

const full = (): Record<Area, Level> => Object.fromEntries(AREAS.map(a => [a, 'full'])) as Record<Area, Level>;
const none = (over: Partial<Record<Area, Level>>): Record<Area, Level> =>
  ({ ...(Object.fromEntries(AREAS.map(a => [a, 'none'])) as Record<Area, Level>), overview: 'view', ...over });

/** Access per role before any override (04-permissions.md: what each staff role can do). */
export const DEFAULT_PERMISSIONS: Record<OpsRoleKey, Record<Area, Level>> = {
  ops: full(),
  verifier: none({ verification: 'edit', businesses: 'view' }),
  moderator: none({ moderation: 'edit', businesses: 'view', content: 'view' }),
  support: none({ businesses: 'view', clients: 'view', bookings: 'view', messages: 'view' }),
  legal: none({ disputes: 'edit', audit: 'view', businesses: 'view' }),
};

export type PermissionOverrides = Partial<Record<OpsRoleKey, Partial<Record<Area, Level>>>>;

/** The effective level of a role in an area: the override when staff set one, else the default. ops is always full. */
export function levelOf(role: string | null | undefined, area: Area, overrides?: PermissionOverrides | null): Level {
  if (!role || !(role in DEFAULT_PERMISSIONS)) return 'none';
  if (role === 'ops') return 'full';
  const r = role as OpsRoleKey;
  const o = overrides?.[r]?.[area];
  return o && LEVELS.includes(o) ? o : DEFAULT_PERMISSIONS[r][area];
}

/** The full matrix (every role, every area) with overrides applied. */
export function permissionMatrix(overrides?: PermissionOverrides | null): Record<OpsRoleKey, Record<Area, Level>> {
  return Object.fromEntries(OPS_ROLES.map(r => [r, Object.fromEntries(AREAS.map(a => [a, levelOf(r, a, overrides)]))])) as Record<OpsRoleKey, Record<Area, Level>>;
}

/** The first area a role can open, for the landing after sign-in. */
export function firstArea(role: string | null | undefined, overrides?: PermissionOverrides | null): Area | null {
  for (const a of AREAS) if (levelOf(role, a, overrides) !== 'none') return a;
  return null;
}

/** The admin route of an area. */
export const AREA_HREF: Record<Area, string> = {
  overview: '/ops', businesses: '/ops/businesses', clients: '/ops/clients', bookings: '/ops/bookings', disputes: '/ops/disputes',
  sponsored: '/ops/sponsored', moderation: '/ops/moderation', verification: '/ops/verification', import: '/ops/import',
  accounting: '/ops/accounting', content: '/ops/content', magazine: '/ops/magazine', messages: '/ops/messages', ai: '/ops/ai', integrations: '/ops/integrations',
  team: '/ops/team', audit: '/ops/audit', settings: '/ops/settings', health: '/ops/health',
};
