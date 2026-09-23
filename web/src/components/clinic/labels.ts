import type { BookingSource, BookingStatus, Profession } from '@prisma/client';
import { ilParts } from '@/lib/time';

// Display labels shared by the clinic screens and the guest declaration / aftercare pages.

export const DAY_SHORT = ['יום א׳', 'יום ב׳', 'יום ג׳', 'יום ד׳', 'יום ה׳', 'יום ו׳', 'שבת'];

/** "יום ב׳" in Israel time. */
export const dayName = (at: Date) => DAY_SHORT[ilParts(at).dow];

/** DD/MM in Israel time. */
export const ddmm = (at: Date) => {
  const p = ilParts(at);
  return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}`;
};

/** "DD/MM HH:MM" for logs. */
export const ddmmHhmm = (at: Date) => {
  const p = ilParts(at);
  return `${ddmm(at)} ${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`;
};

export const roleOfProfession = (p: Profession | null | undefined) =>
  p === 'doctor' ? 'רופא/ה' : p === 'nurse' ? 'אח/ות' : 'מטפל/ת';

export const professionTitle: Record<Profession, string> = {
  doctor: 'רופא/ה',
  nurse: 'אח/ות מוסמך/ת',
  cosmetician: 'קוסמטיקאי/ת',
  technician: 'טכנאי/ת',
  front: 'קבלה',
  management: 'הנהלה',
};

export type Tone = 'teal' | 'ok' | 'warn' | 'bad' | 'muted' | 'strong';

export const STATUS: Record<BookingStatus, { name: string; tone: Tone }> = {
  pending_payment: { name: 'ממתין למקדמה', tone: 'warn' },
  abandoned: { name: 'לא הושלם', tone: 'muted' },
  confirmed: { name: 'מאושר', tone: 'teal' },
  checked_in: { name: 'הגיעה', tone: 'ok' },
  in_treatment: { name: 'בטיפול', tone: 'strong' },
  completed: { name: 'הסתיים', tone: 'ok' },
  cancelled_client: { name: 'בוטל על ידי המטופלת', tone: 'muted' },
  cancelled_clinic: { name: 'בוטל על ידי הקליניקה', tone: 'muted' },
  no_show: { name: 'לא הגיעה', tone: 'bad' },
};

export const SOURCE: Record<BookingSource, string> = {
  online: 'אונליין דרך BeautyFind',
  phone: 'בטלפון',
  walkin: 'בהגעה לקליניקה',
  waitlist: 'מרשימת ההמתנה',
  consult: 'אחרי פגישת ייעוץ',
};

/** "שירה כ." for lists. */
export function shortName(full: string) {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
}

/** WhatsApp link from E.164. */
export const waHref = (e164: string) => `https://wa.me/${e164.replace(/\D/g, '')}`;

/** Hebrew plural for bookings: תור אחד · שני תורים · N תורים */
export const plBookings = (n: number) => (n === 1 ? 'תור אחד' : n === 2 ? 'שני תורים' : `${n} תורים`);
