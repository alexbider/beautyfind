// Onboarding wizard: step list, form shape and validation rules.
// Imported by the client wizard and by the server action so both apply the same rules.

import { CATEGORIES, CITIES, type City, type RegionSlug } from '@/lib/catalog';
import { EMAIL_RE, IL_PHONE_RE, isCompanyNo } from '@/lib/format';
import type { PlanKey } from '@/lib/pricing';

export const STEPS = [
  { key: 'basics', name: 'פרטי העסק', title: 'נתחיל בפרטים הבסיסיים', sub: 'המידע הזה מופיע בכרטיס הפומבי, חוץ מהח״פ שמשמש לאימות בלבד.' },
  { key: 'cats', name: 'קטגוריות', title: 'אילו טיפולים אתם מבצעים?', sub: 'בחרו את הקטגוריות שאתם מבצעים בפועל. הן קובעות באילו חיפושים תופיעו.' },
  { key: 'medical', name: 'אחריות מקצועית', title: 'מי אחראי מקצועית?', sub: 'זה השדה שהלקוחות בודקות ראשון, והוא מה שמבדיל בין מדריך אמין לרשימה.' },
  { key: 'services', name: 'טיפולים ומחירים', title: 'טיפולים ומחירים', sub: 'שלושה טיפולים מספיקים לפרסום. אפשר להוסיף ולערוך בכל זמן בלוח הבקרה.' },
  { key: 'hours', name: 'שעות פעילות', title: 'מתי אתם פתוחים?', sub: 'ראשון עד שישי, שבת סגור כברירת מחדל. אפשר לשנות כל יום בנפרד.' },
  { key: 'photos', name: 'תמונות', title: 'תמונות הכרטיס', sub: 'תמונת כיסוי, לוגו וגלריה. אפשר לדלג ולהשלים אחר כך, אבל זה משפיע ישירות על פניות.' },
  { key: 'verify', name: 'סיכום ואימות', title: 'בדיקה אחרונה ושליחה', sub: 'עברו על הפרטים, אשרו את ההצהרות, ואנחנו נתחיל את האימות.' },
] as const;

export type StepKey = (typeof STEPS)[number]['key'];

export type BizType = 'clinic' | 'medspa' | 'cosmetics';

export const BIZ_TYPES: Array<{ key: BizType; name: string; note: string }> = [
  { key: 'clinic', name: 'קליניקה רפואית', note: 'רופא/ה מבצע/ת טיפולים רפואיים, כולל הזרקות' },
  { key: 'medspa', name: 'מדיספא · קליניקה משולבת', note: 'קוסמטיקה מקצועית לצד טיפולים רפואיים באחריות רופא/ה' },
  { key: 'cosmetics', name: 'קוסמטיקה וטיפולי פנים', note: 'קוסמטיקאית או קוסמטיקאית רפואית, ללא הזרקות' },
];

export const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export type DeclKey = 'accurate' | 'authorized' | 'standards' | 'medical';

export const DECLARATIONS: Array<{ key: DeclKey; label: string; note: string }> = [
  { key: 'accurate', label: 'כל הפרטים שמסרתי נכונים ומעודכנים', note: 'פרט שגוי שדווח נבדק בתוך 5 ימי עסקים' },
  { key: 'authorized', label: 'אני בעל/ת העסק או מוסמך/ת לפעול בשמו', note: 'נדרש לאימות בעלות על הכרטיס' },
  { key: 'standards', label: 'קראתי את תקן הרישום ואני מתחייב/ת לעמוד בו', note: 'כולל איסור על הבטחת תוצאה ועל הנחה בעד ביקורת' },
  { key: 'medical', label: 'טיפולים רפואיים בקליניקה מבוצעים על ידי רופא/ה בלבד', note: 'חובה כשנבחרו קטגוריות הזרקה' },
];

export interface Fields {
  name: string; legal: string; hp: string; phone: string; wa: string; email: string;
  address: string; city: string; region: RegionSlug | ''; bizType: BizType | '';
  docName: string; docLic: string; docSpec: string; docPresence: string;
  proName: string; proCert: string; proYears: string;
}

export interface ServiceRow { id: number; name: string; price: string; dur: string }
export interface HoursRow { open: string; close: string; closed: boolean }

/** Everything the wizard sends to the server. Photos are not included (no storage yet). */
export interface JoinPayload {
  plan: PlanKey;
  f: Fields;
  cats: string[];
  svcs: ServiceRow[];
  hours: HoursRow[];
  decl: DeclKey[];
}

export const EMPTY_FIELDS: Fields = {
  name: '', legal: '', hp: '', phone: '', wa: '', email: '', address: '', city: '', region: '', bizType: '',
  docName: '', docLic: '', docSpec: '', docPresence: '', proName: '', proCert: '', proYears: '',
};

// Index 0 = Sunday.
export const DEFAULT_HOURS: HoursRow[] = [
  { open: '09:00', close: '19:00', closed: false },
  { open: '09:00', close: '19:00', closed: false },
  { open: '09:00', close: '19:00', closed: false },
  { open: '09:00', close: '19:00', closed: false },
  { open: '09:00', close: '20:00', closed: false },
  { open: '09:00', close: '13:00', closed: false },
  { open: '', close: '', closed: true },
];

const norm = (s: string) => s.replace(/[\s\-–־'"״׳]/g, '');

/** Catalog city for a typed name. Also accepts the short form, e.g. "תל אביב" for "תל אביב–יפו". */
export function matchCity(typed: string): City | undefined {
  const t = norm(typed);
  if (!t) return undefined;
  return CITIES.find(c => norm(c.name) === t) ?? CITIES.find(c => norm(c.name.split(/[–־]/)[0]) === t);
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Whole shekels from "1,200" or "450". Null when it is not a positive whole number. */
export function parseShekels(v: string): number | null {
  const t = v.replace(/[,\s₪]/g, '');
  if (!/^\d{1,6}$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}

export function parseMinutes(v: string): number | null {
  const t = v.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n <= 600 ? n : null;
}

export const isFilledService = (s: ServiceRow) => s.name.trim() !== '' && s.price.trim() !== '';

/** Validation state for the whole form. Same rules as the design, plus format checks the database needs. */
export function validate(p: Omit<JoinPayload, 'plan'>) {
  const f = p.f;
  const pickedCats = CATEGORIES.filter(c => p.cats.includes(c.slug));
  const medCats = pickedCats.filter(c => c.isMedical);
  const hasMedical = medCats.length > 0;

  const nameOk = f.name.trim().length >= 2;
  const hpOk = isCompanyNo(f.hp);
  const phoneOk = IL_PHONE_RE.test(f.phone.trim());
  const waOk = f.wa.trim() === '' || IL_PHONE_RE.test(f.wa.trim());
  const emailOk = EMAIL_RE.test(f.email.trim());
  const addressOk = f.address.trim().length >= 4;
  const cityOk = f.city.trim().length >= 2;
  const regionOk = !!f.region;
  const typeOk = !!f.bizType;
  const basicsOk = nameOk && hpOk && phoneOk && waOk && emailOk && addressOk && cityOk && regionOk && typeOk;

  const catsOk = pickedCats.length > 0;
  const docNameOk = f.docName.trim().length >= 2;
  const docLicOk = f.docLic.trim().length >= 4;
  const proNameOk = f.proName.trim().length >= 2;
  const medOk = hasMedical ? docNameOk && docLicOk : proNameOk;

  const filledSvcs = p.svcs.filter(isFilledService);
  const badPriceIds = filledSvcs.filter(s => parseShekels(s.price) === null).map(s => s.id);
  const badDurIds = p.svcs.filter(s => s.dur.trim() !== '' && parseMinutes(s.dur) === null).map(s => s.id);
  const svcsOk = filledSvcs.length >= 3 && badPriceIds.length === 0 && badDurIds.length === 0;

  const badHours = p.hours
    .map((h, i) => (h.closed || (TIME_RE.test(h.open) && TIME_RE.test(h.close) && h.open < h.close) ? -1 : i))
    .filter(i => i >= 0);
  const hoursOk = p.hours.length === 7 && badHours.length === 0;

  const declRequired = DECLARATIONS.filter(d => d.key !== 'medical' || hasMedical);
  const declOk = declRequired.every(d => p.decl.includes(d.key));

  const stepOk: Record<StepKey, boolean> = {
    basics: basicsOk, cats: catsOk, medical: medOk, services: svcsOk, hours: hoursOk, photos: true, verify: declOk,
  };

  const errors: Record<StepKey, string> = {
    basics: !nameOk ? 'נדרש שם מסחרי' : !hpOk ? 'ח״פ או עוסק מורשה חייב להיות 9 ספרות' : !phoneOk ? 'מספר הטלפון אינו תקין'
      : !waOk ? 'מספר הוואטסאפ אינו תקין' : !emailOk ? 'כתובת הדוא״ל אינה תקינה' : !addressOk ? 'נדרשת כתובת'
      : !cityOk ? 'נדרשת עיר' : !regionOk ? 'בחרו אזור' : !typeOk ? 'בחרו סוג עסק' : '',
    cats: 'בחרו לפחות קטגוריה אחת',
    medical: hasMedical ? 'נדרשים שם הרופא/ה ומספר רישיון' : 'נדרש שם איש/אשת המקצוע האחראי/ת',
    services: filledSvcs.length < 3 ? 'נדרשים לפחות שלושה טיפולים עם שם ומחיר'
      : badPriceIds.length ? 'מחיר צריך להיות מספר שלם בשקלים' : 'משך הטיפול צריך להיות מספר דקות',
    hours: 'בדקו את שעות הפעילות: פתיחה וסגירה בפורמט 09:00, והסגירה אחרי הפתיחה',
    photos: '',
    verify: hasMedical ? 'יש לאשר את כל ארבעת האישורים' : 'יש לאשר את שלושת האישורים',
  };

  // Furthest step the rail lets you jump to, as in the design.
  const reach = !basicsOk ? 0 : !catsOk ? 1 : !medOk ? 2 : !svcsOk ? 3 : !hoursOk ? 4 : 6;

  return {
    pickedCats, medCats, hasMedical, filledSvcs, declRequired, stepOk, errors, reach,
    bad: {
      name: !nameOk, hp: !hpOk, phone: !phoneOk, wa: !waOk, email: !emailOk, address: !addressOk, city: !cityOk,
      region: !regionOk, bizType: !typeOk, docName: hasMedical && !docNameOk, docLic: hasMedical && !docLicOk,
      proName: !hasMedical && !proNameOk, badPriceIds, badDurIds, badHours,
    },
  };
}
