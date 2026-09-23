// Contact reasons, response times and per-reason form copy.
// Design: project/BeautyFind Contact.dc.html (REASONS). Shared by /contact, /help and the
// state components so a response time is stated the same way everywhere.

import { ROUTES } from '@/lib/routes';

export const CONTACT_REASONS = ['general', 'business', 'correction', 'complaint', 'access', 'press'] as const;
export type ContactReason = (typeof CONTACT_REASONS)[number];

export const isContactReason = (v: unknown): v is ContactReason =>
  typeof v === 'string' && (CONTACT_REASONS as readonly string[]).includes(v);

/** Where the reason's free "extra" field is stored on ContactMessage. */
export type ExtraTarget = 'subject' | 'businessName' | 'pageOrBusiness' | 'access' | 'org';

export interface ReasonInfo {
  key: ContactReason;
  name: string;
  hint: string;
  /** Business days until the first answer (or until the check is done). */
  days: number;
  /** "מענה" for an answer, "בדיקה" when the promise is a check. */
  kind: 'מענה' | 'בדיקה';
  extraLabel: string;
  extraPh: string;
  extraTarget: ExtraTarget;
  msgHint: string;
  /** Success line after sending. */
  sent: string;
}

export const REASONS: ReasonInfo[] = [
  {
    key: 'general', name: 'פנייה כללית', hint: 'שאלה, הצעה או משהו אחר', days: 3, kind: 'מענה',
    extraLabel: 'נושא הפנייה', extraPh: 'במה מדובר', extraTarget: 'subject',
    msgHint: 'ספרו לנו במה מדובר, בכמה שורות.',
    sent: 'קיבלנו את הפנייה ונחזור אליכם בתוך שלושה ימי עסקים.',
  },
  {
    key: 'business', name: 'רישום או עדכון עסק', hint: 'רישום חדש, אישור בעלות, שינוי פרטים', days: 2, kind: 'מענה',
    extraLabel: 'שם העסק והעיר', extraPh: 'למשל: שרון קליניק, רעננה', extraTarget: 'businessName',
    msgHint: 'ציינו את התחום, את הכתובת ואת מי אחראי מקצועית על הטיפולים.',
    sent: 'הפנייה הועברה לצוות הרישום. נחזור אליכם בתוך שני ימי עסקים עם השלבים הבאים.',
  },
  {
    key: 'correction', name: 'דיווח על טעות', hint: 'מחיר, שעות או פרט שאינו נכון', days: 5, kind: 'בדיקה',
    extraLabel: 'כתובת העמוד או שם העסק', extraPh: 'הדביקו כאן את הקישור', extraTarget: 'pageOrBusiness',
    msgHint: 'מה כתוב עכשיו, ומה צריך לבוא במקומו. אם יש מקור, צרפו אותו.',
    sent: 'תודה. אנחנו בודקים מול העסק ומעדכנים אתכם בכתב בתוך חמישה ימי עסקים.',
  },
  {
    key: 'complaint', name: 'תלונה על עסק', hint: 'פרסום מטעה או פעולה ללא הסמכה', days: 7, kind: 'בדיקה',
    extraLabel: 'שם העסק והעיר', extraPh: 'למשל: לייזר האוס, פתח תקווה, או קישור לעמוד', extraTarget: 'pageOrBusiness',
    msgHint: 'תארו מה קרה, מתי, ומה נאמר לכם. אל תכללו מידע רפואי מזהה.',
    sent: 'התלונה נרשמה. אנחנו בודקים אותה מול העסק ומשיבים לכם בכתב בתוך שבעה ימי עסקים.',
  },
  {
    key: 'access', name: 'נגישות', hint: 'קושי בשימוש באתר', days: 7, kind: 'מענה',
    extraLabel: 'העמוד והטכנולוגיה המסייעת', extraPh: 'למשל: עמוד חיפוש, NVDA', extraTarget: 'access',
    msgHint: 'מה ניסיתם לעשות, ומה קרה בפועל. הפנייה מגיעה לרכז/ת הנגישות.',
    sent: 'הפנייה הועברה לרכז/ת הנגישות. נחזור אליכם עם פתרון או עם דרך חלופית בתוך שבעה ימי עסקים.',
  },
  {
    key: 'press', name: 'תקשורת ונתונים', hint: 'עיתונות, מחקר, שימוש בנתונים', days: 3, kind: 'מענה',
    extraLabel: 'הגוף שאתם מייצגים', extraPh: 'שם המערכת או המוסד', extraTarget: 'org',
    msgHint: 'איזה נתון אתם מחפשים ולאיזה תאריך פרסום.',
    sent: 'קיבלנו את הפנייה. נחזור אליכם בתוך שלושה ימי עסקים, וגם אם אין לנו את הנתון נאמר זאת.',
  },
];

export const reasonInfo = (key: ContactReason): ReasonInfo => REASONS.find(r => r.key === key) ?? REASONS[0];

/** "3 ימי עסקים" (digits, for stats and short lines). */
export const businessDays = (n: number) => (n === 1 ? 'יום עסקים אחד' : `${n} ימי עסקים`);

/** "מענה בתוך 3 ימי עסקים" */
export const slaLine = (key: ContactReason) => {
  const r = reasonInfo(key);
  return `${r.kind} בתוך ${businessDays(r.days)}`;
};

/** /contact?reason=correction&page=/dan/biz/x. `page` prefills the page field for corrections and complaints. */
export function contactHref(reason: ContactReason = 'general', extra?: { page?: string; code?: string }) {
  const sp = new URLSearchParams({ reason });
  if (extra?.page) sp.set('page', extra.page);
  if (extra?.code) sp.set('code', extra.code);
  return `${ROUTES.contact}?${sp.toString()}`;
}
