// Copy helpers for the directory. No em dashes anywhere in user-facing strings:
// commas, periods or colons instead. Maqaf (־) and the en dash in "תל אביב–יפו" stay.

export const fmtNum = (n: number) => n.toLocaleString('en-US');

/** Hebrew count phrase as a plain string: "עסק אחד" · "שני עסקים" · "12 עסקים". */
export function countText(n: number, f: { one: string; two: string; many: string }) {
  if (n === 1) return f.one;
  if (n === 2) return f.two;
  return `${fmtNum(n)} ${f.many}`;
}

export const BIZ = { one: 'עסק אחד', two: 'שני עסקים', many: 'עסקים' };
export const RESULTS = { one: 'תוצאה אחת', two: 'שתי תוצאות', many: 'תוצאות' };
export const CITIES_N = { one: 'עיר אחת', two: 'שתי ערים', many: 'ערים' };
export const FIELDS_N = { one: 'תחום אחד', two: 'שני תחומים', many: 'תחומים' };

/** Search-intent phrase per category for <title> ("קוסמטיקאיות בתל אביב–יפו"). */
export const SEO_TERM: Record<string, string> = {
  facials: 'קוסמטיקאיות',
  'medical-aesthetics': 'מרפאות אסתטיקה',
  'plastic-surgery': 'כירורגיה פלסטית',
  'dental-aesthetics': 'אסתטיקה דנטלית',
  'hair-restoration': 'השתלות שיער',
  'hair-salons': 'מספרות',
  'hair-removal': 'הסרת שיער',
  'brows-lashes': 'גבות וריסים',
  makeup: 'מאפרות',
  'permanent-makeup': 'איפור קבוע',
  nails: 'מניקור ופדיקור',
  'spa-massage': 'ספא ועיסויים',
  'body-contouring': 'עיצוב וחיטוב הגוף',
  tanning: 'שיזוף',
};

const TZ = 'Asia/Jerusalem';
/** "16 בספטמבר 2026" */
export const heDate = (d: Date) => new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }).format(d);
/** "ספטמבר 2026" */
export const heMonth = (d: Date) => new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: TZ }).format(d);
export const isoDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);

/**
 * Sidebar FAQ. Answers follow the locked decisions: booking is native on BeautyFind with the
 * clinic calendar synced (A1); Google and BeautyFind ratings are shown separately (A4);
 * prices are before VAT; aesthetic treatments are not in the סל.
 */
export function directoryFaqs(cityName: string): Array<{ q: string; a: string }> {
  return [
    {
      q: 'מי מורשה להזריק בוטוקס בישראל?',
      a: 'הזרקת בוטוקס וחומרי מילוי היא פעולה רפואית ומחייבת רופא או רופאה מוסמכים. קוסמטיקאיות אינן מורשות להזריק. בעסקים עם טיפולים רפואיים מופיע ברישום הרופא האחראי.',
    },
    {
      q: 'אפשר לקבוע תור דרך BeautyFind?',
      a: 'כן. בוחרים טיפול, מטפלת ומועד ישירות בפרופיל העסק. היומן של העסק מסונכרן עם BeautyFind, כך שהמועדים שמוצגים פנויים באמת, והאישור והתזכורות מגיעים בוואטסאפ, ב־SMS או במייל. טיפולי הזרקה נקבעים דרך ייעוץ רפואי קודם. אפשר תמיד גם לפנות לעסק בוואטסאפ או בטלפון.',
    },
    {
      q: 'למה יש לכל עסק שני דירוגים?',
      a: 'דירוג Google מגיע מ־Google, מתעדכן מדי שבוע ומוצג עם קישור למקור. ביקורות BeautyFind נכתבות רק אחרי ביקור מאומת. אנחנו מציגים את שניהם זה לצד זה ולא ממזגים אותם לממוצע אחד.',
    },
    {
      q: `המחירים ב${cityName} כוללים מע״מ?`,
      a: 'לא. המחירים בפרופילים ובטבלת המחירים מוצגים לפני מע״מ, כפי שהעסקים מפרסמים אותם. על כל תשלום העסק מנפיק חשבונית מס, ובחלק מהעסקים אפשר לשלם בתשלומים.',
    },
    {
      q: 'הטיפולים האלה בסל הבריאות?',
      a: 'לא. טיפולים אסתטיים אינם בסל הבריאות ואינם מכוסים על ידי קופות החולים. חלק מהביטוחים המשלימים מכסים טיפולים רפואיים בעור, לא אסתטיקה.',
    },
    {
      q: 'איך נקבע הסדר ברשימה?',
      a: 'עסקים מאומתים מופיעים ראשונים, ואחריהם הסדר נקבע לפי דירוג Google ומספר הביקורות. עסקים אינם יכולים לשלם כדי לשנות את מקומם; מקום ממומן, כשיש, מופיע בנפרד ומסומן תמיד.',
    },
  ];
}

export const TRUST: Array<{ title: string; body: string; icon: string[] }> = [
  {
    title: 'רישומים מאומתים',
    body: 'בעלות על כל עסק מאומתת בקוד שנשלח לטלפון או לדוא״ל הרשומים של העסק, ובבדיקת הח״פ מול רשם החברות.',
    icon: ['M10 2.7 4 5.1v4.3c0 3.7 2.5 6.4 6 7.5 3.5-1.1 6-3.8 6-7.5V5.1z', 'M7.3 9.7 9.1 11.5 12.5 8'],
  },
  {
    title: 'הסדר אינו נמכר',
    body: 'הסדר נקבע לפי אימות הרישום, דירוג Google ומספר הביקורות. מקום ממומן מסומן תמיד בתג נפרד.',
    icon: ['M3.3 16.7h13.4', 'M6.5 16.7V9.2', 'M10 16.7V4.5', 'M13.5 16.7v-5'],
  },
  {
    title: 'שני סוגי ביקורות, בנפרד',
    body: 'דירוג Google מוצג עם קישור למקור, וביקורות BeautyFind נכתבות רק אחרי ביקור מאומת. לא ממזגים ביניהם, לא עורכים ולא מוחקים ביקורת בגלל שהיא שלילית.',
    icon: ['M10 2.8l2.1 4.3 4.7.6-3.4 3.3.8 4.7L10 13.4l-4.2 2.3.8-4.7-3.4-3.3 4.7-.6z'],
  },
  {
    title: 'אחריות מקצועית גלויה',
    body: 'בעסקים עם טיפולים רפואיים מופיע ברישום הרופא האחראי, ורק אחרי שהרישיון שלו נבדק.',
    icon: ['M10 17.2a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4', 'M10 6.6v6.8', 'M6.6 10h6.8'],
  },
];
