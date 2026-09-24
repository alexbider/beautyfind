// Clinic roles × areas (04-permissions.md). Presets only seed levels; the owner can change any cell.

export type Area = 'overview' | 'analytics' | 'profile' | 'menu' | 'reviews' | 'leads' | 'billing';
export type Level = 'none' | 'view' | 'edit';
export type Preset = 'owner' | 'manager' | 'front' | 'book' | 'practitioner';
export type Perms = Record<Area, Level>;

export const AREAS: Area[] = ['overview', 'analytics', 'profile', 'menu', 'reviews', 'leads', 'billing'];

export const PRESET_NAMES: Record<Preset, { name: string; sub: string }> = {
  owner: { name: 'בעלים', sub: 'מנהל ראשי · רואה ומנהל הכול' },
  manager: { name: 'מנהל/ת קליניקה', sub: 'תוכן, פניות וביקורות' },
  front: { name: 'מזכירות', sub: 'פניות ולקוחות' },
  book: { name: 'הנהלת חשבונות', sub: 'מנוי וחשבוניות' },
  practitioner: { name: 'מטפל/ת', sub: 'היומן שלי ורישום קליני' },
};

const ALL_EDIT: Perms = { overview: 'edit', analytics: 'edit', profile: 'edit', menu: 'edit', reviews: 'edit', leads: 'edit', billing: 'edit' };

export const DEFAULT_PERMS: Record<Preset, Perms> = {
  owner: ALL_EDIT,
  manager: { overview: 'edit', analytics: 'view', profile: 'edit', menu: 'edit', reviews: 'edit', leads: 'edit', billing: 'none' },
  front: { overview: 'view', analytics: 'none', profile: 'view', menu: 'view', reviews: 'view', leads: 'edit', billing: 'none' },
  book: { overview: 'none', analytics: 'none', profile: 'none', menu: 'view', reviews: 'none', leads: 'none', billing: 'edit' },
  practitioner: { overview: 'view', analytics: 'none', profile: 'view', menu: 'view', reviews: 'view', leads: 'view', billing: 'none' },
};

export const isPreset = (v: unknown): v is Preset => typeof v === 'string' && v in PRESET_NAMES;

/** Effective levels for a staff member: stored cells over the preset defaults. Owners always edit everything. */
export function effectivePerms(opts: { isOwner: boolean; preset: string | null; stored: unknown }): Perms {
  if (opts.isOwner) return ALL_EDIT;
  const base = DEFAULT_PERMS[isPreset(opts.preset) ? opts.preset : 'practitioner'];
  const stored = (opts.stored && typeof opts.stored === 'object' ? opts.stored : {}) as Partial<Record<string, unknown>>;
  const out = { ...base };
  for (const a of AREAS) {
    const v = stored[a];
    if (v === 'none' || v === 'view' || v === 'edit') out[a] = v;
  }
  return out;
}

export const canView = (p: Perms, a: Area) => p[a] !== 'none';
export const canEdit = (p: Perms, a: Area) => p[a] === 'edit';
