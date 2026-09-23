// Health declaration questionnaires (02-data-model.md "HealthDeclaration").
// Shared by the client form and the clinic card. Copy from BeautyFind Health Declaration.dc.html;
// `short` is the label the clinic card uses (BeautyFind Clinic Booking.dc.html ANS).

export type DeclType = 'medical' | 'cosmetic';

export interface Question {
  key: string;
  label: string;
  note: string;
  placeholder: string;
  short: string;
}

export const QUESTIONNAIRE_VERSION = '2026-09';

export const QUESTIONS: Record<DeclType, Question[]> = {
  medical: [
    { key: 'preg', label: 'הריון, ניסיון להרות או הנקה', note: 'בתקופה הזו לא מבצעים הזרקות', placeholder: 'באיזה שבוע / עד מתי הנקה', short: 'הריון או הנקה' },
    { key: 'blood', label: 'נוטלת מדללי דם', note: 'אספירין, קומדין, אליקוויס, קלקסן וכד׳', placeholder: 'שם התרופה והמינון', short: 'מדללי דם' },
    { key: 'neuro', label: 'מחלה נוירו־שרירית', note: 'למשל מיאסטניה גרביס', placeholder: 'איזו ומתי אובחנה', short: 'מחלה נוירו־שרירית' },
    { key: 'auto', label: 'מחלה אוטואימונית או הפרעת קרישה', note: '', placeholder: 'איזו ואיך מטופלת', short: 'אוטואימונית או הפרעת קרישה' },
    { key: 'allergy', label: 'אלרגיה ידועה', note: 'לידוקאין, חומרי הרדמה, חלבון ביצה, אנטיביוטיקה', placeholder: 'למה ואיך הגיבה', short: 'אלרגיה ידועה' },
    { key: 'herpes', label: 'נטייה להרפס (פצעי קור) באזור', note: 'אפשר לתת טיפול מונע מראש', placeholder: 'מתי הייתה ההתפרצות האחרונה', short: 'נטייה להרפס באזור' },
    { key: 'recent', label: 'טיפול אסתטי באזור בשבועיים האחרונים', note: 'כולל פילינג, לייזר או הזרקה בקליניקה אחרת', placeholder: 'איזה טיפול ומתי', short: 'טיפול באזור לאחרונה' },
    { key: 'infect', label: 'דלקת, פצע או זיהום פעיל באזור', note: '', placeholder: 'איפה ומה מצבו', short: 'דלקת או זיהום באזור' },
  ],
  cosmetic: [
    { key: 'preg', label: 'הריון או הנקה', note: 'חלק מהחומרים מוחלפים בתקופה הזו', placeholder: 'באיזה שבוע / עד מתי הנקה', short: 'הריון או הנקה' },
    { key: 'roacc', label: 'נטלת רואקוטן בחצי השנה האחרונה', note: 'איזוטרטינואין מדלל את העור', placeholder: 'עד מתי נטלת', short: 'רואקוטן בחצי השנה האחרונה' },
    { key: 'skin', label: 'מצב עור פעיל', note: 'אקזמה, פסוריאזיס, רוזציאה או אקנה דלקתי', placeholder: 'מה ואיפה', short: 'מצב עור פעיל' },
    { key: 'allergy', label: 'אלרגיה לחומרים קוסמטיים', note: 'בשמים, חומצות, לטקס', placeholder: 'למה ואיך הגיבה', short: 'אלרגיה לחומרים קוסמטיים' },
    { key: 'sun', label: 'שיזוף או חשיפה ממושכת לשמש בשבוע האחרון', note: '', placeholder: 'מתי', short: 'שיזוף בשבוע האחרון' },
    { key: 'recent', label: 'טיפול באזור בשבועיים האחרונים', note: 'פילינג, לייזר או שעווה', placeholder: 'איזה טיפול ומתי', short: 'טיפול באזור לאחרונה' },
  ],
};

/** What is sealed into HealthDeclaration.answersEnc. */
export interface SealedDeclaration {
  answers: Array<{ key: string; yes: boolean; detail: string }>;
  medications: string;
  noMedications: boolean;
  birthDate?: string; // YYYY-MM-DD
  idLast4?: string;
  signatureMode?: 'drawn' | 'typed';
}

export const MIN_INK_POINTS = 10;
export const MAX_SIGNATURE_BYTES = 200 * 1024;
export const LIMITS = { detail: 500, meds: 1000, name: 80 };

/** "תשובה אחת · שתי תשובות · N תשובות" */
export const plAnswers = (n: number) => (n === 1 ? 'תשובה אחת' : n === 2 ? 'שתי תשובות' : `${n} תשובות`);

/** First and last name at least. Same rule the design validates with. */
export const nameOk = (s: string) => s.trim().split(/\s+/).filter(Boolean).length >= 2;
