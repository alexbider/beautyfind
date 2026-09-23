import type { Profession } from '@prisma/client';
import { AREAS, PRESET_NAMES, effectivePerms, isPreset, type Area, type Preset } from '@/lib/permissions';
import { toE164 } from '@/lib/format';

// Pure helpers shared by the invite page, its client screen and its server actions.
// No 'server-only' marker: nothing here touches the database or secrets.

/** Raw invite tokens are base64url (randomToken). Checked before any DB lookup. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;
export const isTokenShape = (t: unknown): t is string => typeof t === 'string' && TOKEN_RE.test(t);

export const invitePath = (token: string) => `/invite/${token}`;

/* ---------- Professions (design order) ---------- */

export type Prof = Extract<Profession, 'doctor' | 'nurse' | 'cosmetician' | 'technician' | 'front' | 'management'>;

export const PROFS: { key: Prof; name: string }[] = [
  { key: 'doctor', name: 'רופא/ה' },
  { key: 'nurse', name: 'אח/ות מוסמך/ת' },
  { key: 'cosmetician', name: 'קוסמטיקאית' },
  { key: 'technician', name: 'מטפל/ת' },
  { key: 'front', name: 'קבלה ומזכירות' },
  { key: 'management', name: 'ניהול' },
];

export const isProf = (v: unknown): v is Prof => PROFS.some(p => p.key === v);

/** Doctors and nurses need a Ministry of Health license. */
export const LICENSE_LABEL: Partial<Record<Prof, string>> = {
  doctor: 'מספר רישיון משרד הבריאות',
  nurse: 'מספר רישיון אחות מוסמכת',
};
export const needsLicense = (p: Prof | '') => p === 'doctor' || p === 'nurse';
export const takesCert = (p: Prof | '') => p === 'cosmetician';

/* ---------- Form ---------- */

export type InviteForm = {
  name: string;
  phone: string;
  password: string;
  profession: Prof | '';
  license: string;
  specialty: string;
  cert: string;
};

/** Which details this invitee still has to give (known ones are skipped). */
export type Need = { name: boolean; phone: boolean; password: boolean };

export type FormField = 'name' | 'phone' | 'password' | 'profession' | 'license' | 'cert';

const LIC_RE = /^[0-9][0-9-]{2,18}[0-9]$/;
const digits = (v: string) => v.replace(/\D/g, '');

export const nameOk = (v: string) => {
  const parts = v.trim().split(/\s+/).filter(Boolean);
  return parts.length >= 2 && v.trim().length <= 120;
};
export const phoneOk = (v: string) => toE164(v) !== null;
export const passwordOk = (v: string) => v.length >= 8 && v.length <= 200;
export const licenseOk = (v: string) => LIC_RE.test(v.trim()) && digits(v).length >= 4;

/** Same order as the design: the first failing field wins. */
export function checkForm(f: InviteForm, need: Need): { field: FormField; error: string } | null {
  if (need.name && !nameOk(f.name)) return { field: 'name', error: 'כתבו שם פרטי ושם משפחה' };
  if (need.phone && !phoneOk(f.phone)) return { field: 'phone', error: 'מספר הטלפון לא מלא' };
  if (need.password && !passwordOk(f.password)) return { field: 'password', error: 'הסיסמה חייבת להכיל לפחות 8 תווים' };
  if (!isProf(f.profession)) return { field: 'profession', error: 'בחרו תפקיד בקליניקה' };
  if (needsLicense(f.profession) && !licenseOk(f.license)) return { field: 'license', error: 'חסר מספר רישיון' };
  if (takesCert(f.profession) && f.cert.trim() && !licenseOk(f.cert)) return { field: 'cert', error: 'מספר התעודה לא תקין' };
  if (f.specialty.length > 120) return { field: 'license', error: 'ההתמחות ארוכה מדי' };
  return null;
}

/** 050-•••-4567 for the code step. */
export function maskPhone(v: string): string {
  const e = toE164(v);
  const d = e ? '0' + e.slice(4) : digits(v);
  return d.length >= 9 ? `${d.slice(0, 3)}-•••-${d.slice(-4)}` : v;
}

/* ---------- Role summary ---------- */

const AREA_LABEL: Record<Area, string> = {
  overview: 'סקירה כללית',
  analytics: 'נתונים וסטטיסטיקות',
  profile: 'פרופיל וגלריה',
  menu: 'טיפולים ומחירים',
  reviews: 'ביקורות ומענה לביקורות',
  leads: 'פניות ולקוחות',
  billing: 'מנוי וחשבוניות',
};

export type RoleSummary = { preset: Preset; name: string; can: string[]; cannot: string[] };

/**
 * What this invite grants, from the invite's stored permissions over the preset defaults.
 * Team management is owner-only and never granted by a preset.
 */
export function roleSummary(presetRaw: string, stored: unknown): RoleSummary {
  const preset: Preset = isPreset(presetRaw) && presetRaw !== 'owner' ? presetRaw : 'practitioner';
  const perms = effectivePerms({ isOwner: false, preset, stored });
  const can: string[] = [];
  const cannot: string[] = [];
  for (const a of AREAS) {
    if (perms[a] === 'edit') can.push(`${AREA_LABEL[a]}: צפייה ועריכה`);
    else if (perms[a] === 'view') can.push(`${AREA_LABEL[a]}: צפייה בלבד`);
    else cannot.push(AREA_LABEL[a]);
  }
  const bookings = stored && typeof stored === 'object' ? (stored as Record<string, unknown>).bookings : undefined;
  if (bookings === 'manage') can.push('יומן ותורים: קביעה, הזזה וביטול');
  else if (bookings === 'view') can.push('יומן ותורים: צפייה בלבד');
  else if (bookings === 'own') can.push('יומן ותורים: התורים שלך בלבד');
  else if (bookings === 'none') cannot.push('יומן ותורים');
  cannot.push('ניהול צוות והרשאות');
  return { preset, name: PRESET_NAMES[preset].name, can, cannot };
}

/* ---------- Copy helpers ---------- */

/** dd/mm/yyyy in Israel time. */
export const ilDate = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);

/** Hebrew plural: חבר צוות אחד · 2 חברי צוות · N חברי צוות. */
export const staffCountText = (n: number) => (n === 1 ? 'חבר צוות אחד' : `${n} חברי צוות`);

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';
