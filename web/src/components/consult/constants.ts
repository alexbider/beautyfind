// Consult Request vocabulary shared by the patient form, the clinic inbox and the server.
// Design: project/BeautyFind Consult Request.dc.html (AREAS, PREV, FORMATS, TIMES, WHY, ST, DECLINES).

import type { ConsultStatus } from '@prisma/client';

export const AREAS = ['קמטי הבעה במצח', 'בין הגבות', 'קמטי צחוק בעיניים', 'שפתיים', 'מתחת לעיניים', 'קו לסת וסנטר', 'לחיים'] as const;

export const PRIOR = [
  { key: 'never', name: 'אף פעם' },
  { key: 'over_year', name: 'לפני יותר משנה' },
  { key: 'within_year', name: 'בשנה האחרונה' },
] as const;
export type PriorKey = (typeof PRIOR)[number]['key'];

export const FORMATS = [
  { key: 'clinic', name: 'פגישה בקליניקה', note: 'כ־30 דקות · כולל בדיקה, אפשר לטפל באותו יום אם מתאים', minutes: 30 },
  { key: 'video', name: 'שיחת וידאו קצרה', note: 'כ־15 דקות · להיכרות ושאלות. לא מחליפה בדיקה לפני הזרקה', minutes: 15 },
] as const;
export type FormatKey = (typeof FORMATS)[number]['key'];

/** Slot search always uses the clinic-visit length, so a video call fits in any offered slot. */
export const CONSULT_SLOT_MIN = 30;

export const TIMES = [
  { key: 'morning', name: 'בוקר', range: '08–12' },
  { key: 'noon', name: 'צהריים', range: '12–16' },
  { key: 'evening', name: 'ערב', range: '16–20' },
] as const;
export type TimeKey = (typeof TIMES)[number]['key'];

/** Sunday-first, like Branch.hours. */
export const DAY_LETTERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'] as const;

export const WHY = [
  'הזרקה היא פעולה רפואית: רק רופא/ה רשאי/ת להחליט ולבצע',
  'הכמות והמחיר נקבעים אחרי בדיקה, לא מראש לפי מחירון',
  'טיפולים אסתטיים אינם בסל הבריאות ואינם מכוסים בקופה',
  'לא בכל מקרה ההזרקה היא הפתרון. ייעוץ כנה חוסך כסף',
] as const;

/**
 * Medical flags the client may raise before the consult. Stored as ConsultRequest.medicalFlags.
 * `note` is shown to the client when selected; `title` + `body` to the clinic (consult access only).
 */
export const FLAGS = [
  {
    key: 'pregnancy',
    name: 'הריון או הנקה',
    note: 'בזמן הריון או הנקה לא מזריקים בוטוקס או חומרי מילוי. אפשר להיפגש לייעוץ ולתכנן את הטיפול לאחר מכן.',
    title: 'ציינה הריון או הנקה.',
    body: 'לא מזריקים בתקופה זו. הרופא/ה יוצר/ת קשר להסביר ולתכנן מועד מתאים.',
  },
  {
    key: 'anticoagulants',
    name: 'נוטלת מדללי דם',
    note: 'חשוב לציין בייעוץ איזו תרופה ובאיזה מינון. ההחלטה על התאמה ותזמון בידי הרופא/ה בלבד. אין להפסיק תרופה על דעת עצמך.',
    title: 'ציינה נטילת מדללי דם.',
    body: 'ההחלטה על התאמה ותזמון בידי הרופא/ה בלבד.',
  },
] as const;
export type FlagKey = (typeof FLAGS)[number]['key'];

export const GOAL_MIN = 15;
export const GOAL_MAX = 1000;
export const NAME_MAX = 80;

export const STATUS: Record<ConsultStatus, { name: string; tone: 'new' | 'wait' | 'ok' | 'closed' }> = {
  new: { name: 'חדשה', tone: 'new' },
  awaiting_client: { name: 'ממתינה למטופלת', tone: 'wait' },
  consult_scheduled: { name: 'נקבע ייעוץ', tone: 'ok' },
  closed_treatment_booked: { name: 'אושר טיפול', tone: 'ok' },
  closed_declined: { name: 'נסגרה', tone: 'closed' },
};

export const OPEN_STATUSES: ConsultStatus[] = ['new', 'awaiting_client', 'consult_scheduled'];

export const DECLINES = [
  { key: 'medical', name: 'התווית נגד רפואית', who: 'החלטת רופא/ה', physicianOnly: true },
  { key: 'scope', name: 'מחוץ לתחום הקליניקה: הפניה למקום אחר', who: 'כל צוות ההזמנות', physicianOnly: false },
  { key: 'duplicate', name: 'בקשה כפולה', who: 'כל צוות ההזמנות', physicianOnly: false },
] as const;
export type DeclineKey = (typeof DECLINES)[number]['key'];

export const DEFAULT_CONSULT_FEE = 200;

export interface SlotDay {
  date: string; // YYYY-MM-DD, Israel
  label: string; // ה׳ 24/09
  dow: number;
  slots: Array<{ startsAt: string; time: string }>;
}

// ---------- Copy helpers (client and server render the same text) ----------

export const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? '';

/** "ה׳ 24/09" from a YYYY-MM-DD key. */
export function dayLabel(dateKey: string) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return `${DAY_LETTERS[dow]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

export function proposeMessage(o: { first: string; business: string; doctor: string; day: string; time: string; fee: number }) {
  const feeLine = o.fee > 0 ? `עלות הייעוץ ₪${o.fee} ומתקזזת מהטיפול.` : 'הייעוץ ללא עלות.';
  return `היי ${o.first}, כאן ${o.business}. נשמח לקבוע לך ייעוץ עם ${o.doctor} ביום ${o.day} בשעה ${o.time}. ${feeLine} לאשר?`;
}

export function declineMessage(reason: DeclineKey, o: { first: string; doctor: string }) {
  switch (reason) {
    case 'medical':
      return `היי ${o.first}, הבקשה שלך נבדקה על ידי ${o.doctor}. בגלל המידע הרפואי ששלחת, הזרקה כרגע לא מתאימה לך בבטחה. נשמח להסביר בשיחה, ללא עלות.`;
    case 'scope':
      return `היי ${o.first}, תודה על הפנייה. הטיפול שביקשת לא ניתן אצלנו, ואנחנו ממליצות לפנות לרופא/ה עור. נשמח לעזור בכל שאלה.`;
    case 'duplicate':
      return `היי ${o.first}, קיבלנו את הבקשה הקודמת שלך ונחזור אלייך עליה.`;
  }
}
