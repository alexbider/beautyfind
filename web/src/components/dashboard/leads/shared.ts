// CRM constants, validation and formatting shared by the leads page, its client board and its server actions.
// Design: project/BeautyFind Dashboard.dc.html (isLeads · STAGES, SOURCES, KINDS).

import { EMAIL_RE, toE164 } from '@/lib/format';

export type StageKey = 'new' | 'contacted' | 'booked' | 'done' | 'lost';
export type SourceKey = 'form' | 'whatsapp' | 'phone' | 'walkin' | 'referral';
export type EventKind = 'form' | 'contact' | 'stage' | 'note' | 'edit' | 'visit';

export const STAGES: Array<{ key: StageKey; name: string; color: string; bg: string; border: string }> = [
  { key: 'new', name: 'חדש', color: '#A8432C', bg: '#FFF4F2', border: '#F0C9BF' },
  { key: 'contacted', name: 'יצרנו קשר', color: '#0C243E', bg: '#EDEFF2', border: '#D4D4D4' },
  { key: 'booked', name: 'נקבע תור', color: '#0B7A87', bg: '#F0FAFB', border: '#CDEFF3' },
  { key: 'done', name: 'הגיע/ה לטיפול', color: '#ffffff', bg: '#0B7A87', border: '#0B7A87' },
  { key: 'lost', name: 'לא רלוונטי', color: '#8A96A3', bg: '#F6F8F9', border: '#E6E6E6' },
];
export const STAGE_KEYS = STAGES.map(s => s.key) as [StageKey, ...StageKey[]];
export const stageOf = (k: string) => STAGES.find(s => s.key === k) ?? STAGES[0];

export const SOURCES: Array<{ key: SourceKey; name: string }> = [
  { key: 'form', name: 'טופס באתר' },
  { key: 'whatsapp', name: 'WhatsApp' },
  { key: 'phone', name: 'טלפון' },
  { key: 'walkin', name: 'הגיע/ה למקום' },
  { key: 'referral', name: 'המלצה' },
];
/** `form` leads only come from the public profile form, never from the manual add form. */
export const MANUAL_SOURCES = SOURCES.filter(s => s.key !== 'form');
export const MANUAL_SOURCE_KEYS = MANUAL_SOURCES.map(s => s.key) as [SourceKey, ...SourceKey[]];
export const sourceName = (k: string) => (SOURCES.find(s => s.key === k) ?? SOURCES[0]).name;

export const KINDS: Record<EventKind, { name: string; dot: string }> = {
  form: { name: 'פנייה מהטופס', dot: '#14B3C6' },
  contact: { name: 'יצירת קשר', dot: '#0B7A87' },
  stage: { name: 'שינוי סטטוס', dot: '#0C243E' },
  note: { name: 'הערה', dot: '#8A96A3' },
  edit: { name: 'עדכון פרטים', dot: '#C3CBD3' },
  visit: { name: 'טיפול', dot: '#0B7A87' },
};

/** Stages that still count toward the pipeline value (design: "לא כולל טיפולים שהסתיימו"). */
export const OPEN_STAGES: StageKey[] = ['new', 'contacted', 'booked'];

export const LIMITS = { name: 80, city: 60, treatment: 120, nextAction: 160, email: 160, phone: 20, note: 2000, notes: 2000, valueDigits: 7 };

// ---------- Serialized lead for the client ----------

export interface LeadEventDTO {
  id: string;
  kind: EventKind;
  text: string;
  when: string; // D.M.YYYY · HH:MM, Asia/Jerusalem
}

export interface LeadDTO {
  id: string;
  name: string;
  phone: string | null; // E.164
  email: string | null;
  city: string | null;
  treatment: string | null;
  source: SourceKey;
  stage: StageKey;
  value: number | null; // whole shekels
  nextAction: string | null;
  nextDate: string | null; // D.M.YYYY
  notes: string;
  lastWhen: string; // latest history entry
  events: LeadEventDTO[]; // oldest first
}

// ---------- Validation ----------

export type LeadField = 'name' | 'phone' | 'email' | 'city' | 'treatment' | 'value' | 'nextAction' | 'nextDate';

export interface LeadFields {
  name: string;
  phone: string;
  email: string;
  city: string;
  treatment: string;
  value: string; // digits only
  nextAction: string;
  nextDate: string; // D.M.YYYY or empty
}

export const EMPTY_LEAD: LeadFields = { name: '', phone: '', email: '', city: '', treatment: '', value: '', nextAction: '', nextDate: '' };

export const FIELD_NAMES: Record<LeadField, string> = {
  name: 'שם', phone: 'טלפון', email: 'דוא״ל', city: 'יישוב', treatment: 'טיפול', value: 'שווי', nextAction: 'הפעולה הבאה', nextDate: 'תאריך יעד',
};

/** Parses 24.9.2026 / 24.09.2026 / 24/9/2026 into a calendar date. Null when invalid. */
export function parseDay(v: string): { y: number; m: number; d: number } | null {
  const t = v.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!t) return null;
  const d = Number(t[1]), m = Number(t[2]), y = Number(t[3]);
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return { y, m, d };
}

export interface LeadErrors {
  fields: Partial<Record<LeadField, string>>;
  /** Shown in the form's alert line: the first problem, in field order. */
  first: string | null;
}

export function validateLead(f: LeadFields, opts: { withNext: boolean }): LeadErrors {
  const e: Partial<Record<LeadField, string>> = {};
  if (!f.name.trim()) e.name = 'נדרש שם, כדי לדעת למי חוזרים.';
  else if (f.name.trim().length > LIMITS.name) e.name = 'השם ארוך מדי.';
  const phone = f.phone.trim();
  const email = f.email.trim();
  if (phone && !toE164(phone)) e.phone = 'מספר הטלפון אינו תקין. לדוגמה 050-123-4567.';
  if (email && (!EMAIL_RE.test(email) || email.length > LIMITS.email)) e.email = 'כתובת הדוא״ל אינה תקינה.';
  if (!phone && !email) e.phone = 'נדרש טלפון או דוא״ל. בלי אחד מהם אי אפשר לחזור ללקוח.';
  if (f.city.trim().length > LIMITS.city) e.city = 'שם היישוב ארוך מדי.';
  if (f.treatment.trim().length > LIMITS.treatment) e.treatment = 'תיאור הטיפול ארוך מדי.';
  if (f.value && (!/^\d+$/.test(f.value) || f.value.length > LIMITS.valueDigits)) e.value = 'השווי צריך להיות מספר שלם בשקלים.';
  if (opts.withNext) {
    if (f.nextAction.trim().length > LIMITS.nextAction) e.nextAction = 'הפעולה הבאה ארוכה מדי.';
    if (f.nextDate.trim() && !parseDay(f.nextDate)) e.nextDate = 'התאריך אינו תקין. לדוגמה 24.9.2026.';
  }
  const order: LeadField[] = ['name', 'phone', 'email', 'city', 'treatment', 'value', 'nextAction', 'nextDate'];
  const firstKey = order.find(k => e[k]);
  return { fields: e, first: firstKey ? e[firstKey]! : null };
}

// ---------- Formatting (Asia/Jerusalem) ----------

const TZ = 'Asia/Jerusalem';
const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function parts(d: Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map(x => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hh: p.hour, mm: p.minute };
}

/** 18.9.2026 in Israel time. */
export const fmtDay = (d: Date) => { const p = parts(d); return `${p.d}.${p.m}.${p.y}`; };
/** 08:40 in Israel time. */
export const fmtTime = (d: Date) => { const p = parts(d); return `${p.hh}:${p.mm}`; };
/** 18.9.2026 · 08:40 in Israel time (design format for history entries). */
export const fmtStamp = (d: Date) => `${fmtDay(d)} · ${fmtTime(d)}`;
/** A @db.Date column (UTC midnight) as 24.9.2026. */
export const fmtDateOnly = (d: Date) => `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`;
/** Today's calendar date in Israel as a UTC-midnight Date for @db.Date columns. */
export function todayIL(now = new Date()): Date {
  const p = parts(now);
  return new Date(Date.UTC(p.y, p.m - 1, p.d));
}

// ---------- Hebrew counts ----------

/** לקוח אחד · שני לקוחות · 5 לקוחות */
export function clientsCount(n: number) {
  return n === 1 ? 'לקוח אחד' : n === 2 ? 'שני לקוחות' : `${n} לקוחות`;
}
/** רישום אחד · שני רישומים · 5 רישומים */
export function entriesCount(n: number) {
  return n === 1 ? 'רישום אחד' : n === 2 ? 'שני רישומים' : `${n} רישומים`;
}
