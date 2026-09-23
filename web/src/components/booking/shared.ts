// Pure helpers and types for Booking (/book/[branch]) and Manage Booking (/b/[token]).
// Safe on server and client. Time is Asia/Jerusalem; the week starts Sunday (index 0).

import { addDays, dowOf, hhmm, ilDateKey } from '@/lib/time';
import type { DayHours, PriceType } from '@/components/profile/format';

// ---------- Hebrew words ----------

export const DOW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'] as const;
export const DOW_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'] as const;
export const DOW_LONG = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת'] as const;
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'] as const;

// Singular / dual / plural (07-rules: never "1 פנויות").
export const freeTxt = (n: number, none = 'תפוס') => (n === 0 ? none : n === 1 ? 'פנויה אחת' : n === 2 ? 'שתיים פנויות' : `${n} פנויות`);
export const plHours = (n: number) => (n === 1 ? 'שעה' : n === 2 ? 'שעתיים' : `${n} שעות`);
export const plDays = (n: number) => (n === 1 ? 'יום' : n === 2 ? 'יומיים' : `${n} ימים`);
export const weekTxt = (n: number) => (n === 0 ? 'אין מועדים בשבוע הקרוב' : n === 1 ? 'מועד אחד פנוי בשבוע הקרוב' : `${n} מועדים פנויים בשבוע הקרוב`);

// ---------- Dates ----------

const parts = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d, dow: dowOf(key) };
};
const pad = (n: number) => String(n).padStart(2, '0');

/** 22/09/2026 */
export const dateText = (key: string) => {
  const p = parts(key);
  return `${pad(p.d)}/${pad(p.m)}/${p.y}`;
};
/** 22/09 */
export const dayMonth = (key: string) => {
  const p = parts(key);
  return `${pad(p.d)}/${pad(p.m)}`;
};
export const dom = (key: string) => pad(parts(key).d);
export const monthName = (key: string) => MONTHS[parts(key).m - 1];
/** "יום שני, 28 בספטמבר" */
export const longDay = (key: string) => {
  const p = parts(key);
  return `${DOW_LONG[p.dow]}, ${p.d} ב${MONTHS[p.m - 1]}`;
};

/** "22–28 ספטמבר" or "29 ספטמבר – 05 אוקטובר". */
export function weekLabel(fromKey: string) {
  const toKey = addDays(fromKey, 6);
  return monthName(fromKey) === monthName(toKey)
    ? `${dom(fromKey)}–${dom(toKey)} ${monthName(fromKey)}`
    : `${dom(fromKey)} ${monthName(fromKey)} – ${dom(toKey)} ${monthName(toKey)}`;
}

export const keyOf = (iso: string) => ilDateKey(new Date(iso));
export const timeOfIso = (iso: string) => hhmm(new Date(iso));

/** "בעוד 5 ימים", "בעוד 3 שעות", "בעוד פחות משעה". */
export function relUntil(hours: number) {
  if (hours < 1) return 'בעוד פחות משעה';
  if (hours < 24) return `בעוד ${plHours(Math.floor(hours))}`;
  return `בעוד ${plDays(Math.round(hours / 24))}`;
}

// ---------- Hours table ----------

export interface HoursRow {
  day: string; // "ראשון–חמישי"
  h: string; // "09:00–19:00" or "סגור"
  closed: boolean;
  days: number[];
}

/** Consecutive days with identical hours collapse into one row (as in the designs). */
export function hoursRows(hours: DayHours[] | null): HoursRow[] {
  if (!hours) return [];
  const rows: HoursRow[] = [];
  hours.forEach((h, i) => {
    const text = h.closed ? 'סגור' : `${h.open}–${h.close}`;
    const last = rows[rows.length - 1];
    if (last && last.h === text && last.days[last.days.length - 1] === i - 1) last.days.push(i);
    else rows.push({ day: '', h: text, closed: h.closed, days: [i] });
  });
  for (const r of rows) r.day = r.days.length === 1 ? DOW[r.days[0]] : `${DOW[r.days[0]]}–${DOW[r.days[r.days.length - 1]]}`;
  return rows;
}

/** "שבת סגור." / "שני ושבת סגורים." from the branch hours. */
export function closedDaysText(hours: DayHours[] | null) {
  if (!hours) return '';
  const names = hours.map((h, i) => (h.closed ? DOW[i] : null)).filter(Boolean) as string[];
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} סגור.`;
  return `${names.slice(0, -1).join(', ')} ו${names[names.length - 1]} סגורים.`;
}

// ---------- Contact and calendar links ----------

export const fullAddress = (address: string, cityName: string) => (address.includes(cityName) ? address : `${address}, ${cityName}`);

export const wazeHref = (wazeUrl: string | null, address: string) => wazeUrl || `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`;

export const waLink = (e164: string, text: string) => `https://wa.me/${e164.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

const icsStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

export interface CalEvent {
  uid: string;
  title: string;
  startsAt: string; // ISO
  durationMin: number;
  location: string;
  details: string;
}

/** RFC 5545 event (Google, Outlook and iPhone all open it). */
export function icsText(e: CalEvent) {
  const start = new Date(e.startsAt);
  const end = new Date(start.getTime() + e.durationMin * 60_000);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BeautyFind//Booking//HE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsEscape(e.title)}`,
    `LOCATION:${icsEscape(e.location)}`,
    `DESCRIPTION:${icsEscape(e.details)}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(e.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

/** Browser download of the .ics file. Client only. */
export function downloadIcs(e: CalEvent, fileName: string) {
  const blob = new Blob([icsText(e)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function googleCalHref(e: CalEvent) {
  const start = new Date(e.startsAt);
  const end = new Date(start.getTime() + e.durationMin * 60_000);
  const q = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates: `${icsStamp(start)}/${icsStamp(end)}`, details: e.details, location: e.location, ctz: 'Asia/Jerusalem' });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

// ---------- Booking page data (server → client) ----------

export interface BookTreatment {
  id: string;
  name: string;
  catSlug: string;
  catName: string;
  priceType: PriceType;
  priceAgorot: number; // before VAT
  durationMin: number;
  isMedical: boolean;
  requiresDeclaration: boolean;
  depositAgorot: number;
  bookable: boolean; // non-medical, someone can perform it, and a due deposit can actually be charged
  staffIds: string[];
}

export interface BookStaff {
  id: string;
  name: string;
  role: string;
  init: string;
}

export interface BookingData {
  branch: {
    id: string;
    slug: string;
    name: string;
    address: string; // full, with city
    phone: string | null; // E.164
    whatsapp: string | null; // E.164
    wazeUrl: string | null;
    profileHref: string;
    hours: DayHours[] | null;
    medical: { name: string; license: string | null; href: string } | null;
    onlineBooking: boolean;
  };
  treatments: BookTreatment[];
  staff: BookStaff[];
  categories: Array<{ slug: string; name: string }>;
  policy: { depositOn: boolean; refundH: number };
  todayKey: string;
  preselect: string | null;
  prefill: { name: string; phone: string; email: string };
}

/** Slot as the booking client needs it. */
export interface DaySlots {
  date: string;
  open: boolean;
  slots: Array<{ startsAt: string; time: string; practitionerIds: string[] }>;
}

export const SLOT_WEEKS = 8; // availability horizon is 60 days

export type SlotsResult = { ok: true; days: DaySlots[] } | { ok: false };

export type SubmitError =
  | 'invalid'
  | 'rate_limited'
  | 'failed'
  | 'not_found'
  | 'medical_needs_consult'
  | 'slot_taken'
  | 'no_practitioner'
  | 'payments_unavailable';

export type SubmitResult =
  | { ok: true; ref: string; token: string; checkoutUrl: string | null }
  | { ok: false; error: SubmitError };

export interface SubmitInput {
  branchId: string;
  treatmentId: string;
  practitionerId: string | null;
  startsAt: string;
  name: string;
  phone: string;
  email: string;
  consentHealth: boolean;
  consentPolicy: boolean;
  marketing: boolean;
}

/** Mobile numbers only: confirmations go out on WhatsApp. */
export const isMobileE164 = (e164: string | null) => !!e164 && /^\+9725\d{8}$/.test(e164);

// ---------- Manage booking (/b/[token]) ----------

export const CANCEL_REASONS = ['לא מתאים לי המועד', 'לא מרגישה טוב', 'מצאתי מקום אחר', 'שיקולי מחיר', 'אחר'] as const;

export type ManageStatus = 'pending_payment' | 'abandoned' | 'confirmed' | 'checked_in' | 'in_treatment' | 'completed' | 'cancelled_client' | 'cancelled_clinic' | 'no_show';
export type DepositState = 'none' | 'pending' | 'failed' | 'paid' | 'forfeited' | 'refunding' | 'refunded' | 'applied';

export interface ManageData {
  token: string;
  manageUrl: string; // absolute, for the calendar entry
  ref: string;
  status: ManageStatus;
  title: string; // treatment name, or "פגישת ייעוץ"
  durationMin: number;
  practitioner: { name: string; role: string } | null;
  startsAt: string; // ISO
  hoursUntil: number; // at render time
  branch: {
    name: string;
    cityName: string;
    address: string; // full, with city
    phone: string | null;
    whatsapp: string | null;
    wazeUrl: string | null;
    hours: DayHours[] | null;
    profileHref: string;
    bookHref: string;
    freeParking: boolean;
  };
  declaration: 'not_required' | 'signed' | 'missing';
  deposit: {
    state: DepositState;
    agorot: number; // what this booking pays (or paid) up front
    checkoutUrl: string | null; // only while the hold is alive and the payment is pending
    holdUntil: string | null; // ISO
  };
  policy: { refundH: number; depositOn: boolean };
  cancellation: { by: 'client' | 'clinic'; late: boolean } | null;
  hasReceipt: boolean;
  canChange: boolean; // reschedule
  canCancel: boolean;
  paid: '1' | '0' | null;
  todayKey: string;
}
