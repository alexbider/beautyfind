// Verified-visit review: copy, options and validation shared by the form and the submit route.
// No 'server-only' marker: nothing here touches the database or secrets.
// Rules: 03-states.md "Review" (rating, title ≥4, body ≥40, both declarations; photos publish only with consent).

export const RATING_LABELS = ['', 'חוויה לא טובה. ספרו לנו מה קרה', 'לא עמד בציפיות', 'סביר, היו דברים טובים וגם פחות', 'טוב, שווה לחזור', 'מעולה, מומלץ בחום'];

export const ASPECTS = [
  { key: 'clean', name: 'ניקיון וסטריליזציה' },
  { key: 'explain', name: 'הסבר לפני הטיפול' },
  { key: 'result', name: 'תוצאה בפועל' },
  { key: 'time', name: 'עמידה בזמנים' },
  { key: 'price', name: 'שקיפות מחיר' },
  { key: 'after', name: 'ליווי אחרי הטיפול' },
] as const;
export type AspectKey = (typeof ASPECTS)[number]['key'];

export const TAGS = [
  'ייעוץ בלי לחץ מכירה',
  'הוסבר על סיכונים',
  'המתנה קצרה',
  'מחיר כפי שנאמר מראש',
  'הנחיות המשך בוואטסאפ',
  'חניה נוחה',
  'התאמה אישית',
  'מכשור נקי ומכוסה',
] as const;

export const PHOTO_SLOTS = [
  { kind: 'before', label: 'לפני', placeholder: 'תמונה לפני הטיפול' },
  { kind: 'after', label: 'אחרי', placeholder: 'תמונה אחרי הטיפול' },
  { kind: 'place', label: 'הקליניקה', placeholder: 'חדר טיפול או פינת המתנה' },
] as const;
export type PhotoKind = (typeof PHOTO_SLOTS)[number]['kind'];

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

export type NameMode = 'full' | 'initial' | 'anon';
export const NAME_MODES: NameMode[] = ['full', 'initial', 'anon'];
export const ANON_NAME = 'לקוחה מאומתת';

export const DECLARATIONS = [
  { key: 'real', label: 'הביקורת מתארת טיפול שעברתי בפועל בקליניקה הזו', note: 'ביקורת שאינה מאומתת לא מתפרסמת' },
  { key: 'nointerest', label: 'אין לי קשר עסקי לקליניקה ולא קיבלתי תמורה על הביקורת', note: 'תמורה בעד ביקורת אסורה לפי תקן הרישום' },
] as const;

export const RULES: { ok: boolean; text: string }[] = [
  { ok: true, text: 'חוויה בפועל: מה עשו, איך הוסבר, איך הרגשתם' },
  { ok: true, text: 'ביקורת שלילית עניינית, כולל המתנה, מחיר או תוצאה' },
  { ok: false, text: 'האשמה פלילית ("גנבו", "רימו") ללא אסמכתה' },
  { ok: false, text: 'שם איש צוות בהקשר שלילי' },
  { ok: false, text: 'עצה רפואית או הבטחת תוצאה ללא סיכון' },
];

export const TITLE_MIN = 4;
export const TITLE_MAX = 120;
export const BODY_MIN = 40;
export const BODY_MAX = 4000;

/** "שירה כהן" → full: "שירה כהן" · initial: "ש. כהן" · anon: "לקוחה מאומתת". */
export function formatAuthorName(clientName: string, mode: NameMode): string {
  const parts = clientName.trim().split(/\s+/).filter(Boolean);
  if (mode === 'anon' || parts.length === 0) return ANON_NAME;
  if (mode === 'full') return parts.join(' ');
  if (parts.length === 1) return `${parts[0][0]}.`;
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

export const nameModeLabel = (mode: NameMode, clientName: string) =>
  mode === 'full' ? `בשם מלא: ${formatAuthorName(clientName, 'full')}` : mode === 'initial' ? `בראשי תיבות: ${formatAuthorName(clientName, 'initial')}` : 'אנונימית';

export const NAME_MODE_NOTES: Record<NameMode, string> = {
  full: 'הביקורת מקבלת אמינות גבוהה יותר',
  initial: 'ברירת המחדל שלנו',
  anon: 'מסומנת ״ביקור אומת״, בלי שם',
};

/** How the name will appear, for the success card. */
export const publishedAs = (mode: NameMode, clientName: string) =>
  mode === 'anon' ? 'אנונימית · ביקור אומת' : `${mode === 'full' ? 'בשם מלא' : 'בראשי תיבות'} · ${formatAuthorName(clientName, mode)}`;

export const starsText = (n: number) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);

export type ReviewInput = {
  rating: number;
  aspects: Partial<Record<AspectKey, number>>;
  title: string;
  body: string;
  tags: string[];
  nameMode: NameMode;
  photoConsent: boolean;
  declarations: { real: boolean; nointerest: boolean };
};

export type ReviewField = 'rating' | 'title' | 'body' | 'declarations';

/** Same order as the design: the first failing field wins. */
export function checkReview(r: ReviewInput): { field: ReviewField; error: string } | null {
  if (!(Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5)) return { field: 'rating', error: 'בחרו דירוג בכוכבים' };
  if (r.title.trim().length < TITLE_MIN) return { field: 'title', error: 'הוסיפו כותרת קצרה לביקורת' };
  if (r.body.trim().length < BODY_MIN) return { field: 'body', error: 'כתבו לפחות 40 תווים. ביקורת קצרה מדי לא עוזרת לאחרים' };
  if (!r.declarations.real || !r.declarations.nointerest) return { field: 'declarations', error: 'יש לאשר את שתי ההצהרות בתחתית הטופס' };
  return null;
}

export type SubmitError = 'not_found' | 'not_completed' | 'exists' | 'invalid' | 'photo_type' | 'photo_size' | 'photo_count' | 'server';

export const SUBMIT_ERRORS: Record<SubmitError, string> = {
  not_found: 'הקישור לביקורת לא תקין',
  not_completed: 'אפשר לכתוב ביקורת רק אחרי שהביקור הסתיים',
  exists: 'כבר נשלחה ביקורת על הביקור הזה',
  invalid: 'חלק מהפרטים לא תקינים. בדקו ונסו שוב.',
  photo_type: 'אפשר לצרף תמונות מסוג JPG, PNG או WebP בלבד',
  photo_size: 'כל תמונה עד 8MB',
  photo_count: 'אפשר לצרף עד שלוש תמונות',
  server: 'לא הצלחנו לשלוח. נסו שוב בעוד רגע.',
};

export type SubmittedSummary = { rating: number; title: string; nameMode: NameMode; photos: number; photoConsent: boolean };
