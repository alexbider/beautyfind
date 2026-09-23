// Help centre content. Design: project/BeautyFind Help.dc.html (TOPICS, FAQ).
// Answers follow 08-open-decisions.md A1–A5 and 07-rules-and-tokens.md; wording that
// contradicted them in the design was corrected here (see the report in the PR).

import { nis } from '@/lib/format';
import { PLAN_MONTHLY_NIS, YEARLY_MULTIPLIER } from '@/lib/pricing';
import { ROUTES } from '@/lib/routes';

export type Audience = 'client' | 'biz';
export const isAudience = (v: unknown): v is Audience => v === 'client' || v === 'biz';

export type ClientTopic = 'book' | 'pay' | 'medical' | 'reviews' | 'gift' | 'privacy';
export type BizTopic = 'join' | 'profile' | 'billing' | 'team' | 'breviews' | 'ads';
export type TopicKey = ClientTopic | BizTopic;

export interface Topic {
  key: TopicKey;
  name: string;
}

export interface Faq {
  audience: Audience;
  topic: TopicKey;
  q: string;
  a: string;
  link?: { label: string; href: string };
}

// Production routes from 01-flows.md that are not in ROUTES yet.
const PATHS = {
  giftCheck: '/gift/check',
  saved: '/saved',
  branches: '/biz/branches',
  sponsoredBuy: '/biz/sponsored',
  medicalAesthetics: '/treatments/medical-aesthetics',
} as const;

const basic = nis(PLAN_MONTHLY_NIS.basic);
const advanced = nis(PLAN_MONTHLY_NIS.advanced);

export const TOPICS: Record<Audience, Topic[]> = {
  client: [
    { key: 'book', name: 'תורים וביטולים' },
    { key: 'pay', name: 'מקדמות וחשבוניות' },
    { key: 'medical', name: 'טיפולים רפואיים' },
    { key: 'reviews', name: 'ביקורות' },
    { key: 'gift', name: 'שוברי מתנה' },
    { key: 'privacy', name: 'חשבון ופרטיות' },
  ],
  biz: [
    { key: 'join', name: 'הצטרפות ובעלות' },
    { key: 'profile', name: 'פרופיל ותוכן' },
    { key: 'billing', name: 'מנוי וחשבוניות' },
    { key: 'team', name: 'צוות והרשאות' },
    { key: 'breviews', name: 'ביקורות ומענה' },
    { key: 'ads', name: 'מקום ממומן' },
  ],
};

export const FAQS: Faq[] = [
  // ---------- Clients ----------
  {
    audience: 'client', topic: 'book', q: 'איך מבטלים או מזיזים תור?',
    a: 'דרך הקישור בהודעת האישור בוואטסאפ, ב־SMS או במייל, בלי להתחבר. אפשר לבטל או לבחור מועד אחר לפי מדיניות הביטול של הקליניקה, שמופיעה לפני האישור. אם יש לכם חשבון, התורים מופיעים גם בו.',
    link: { label: 'לתורים שלי', href: ROUTES.account },
  },
  {
    audience: 'client', topic: 'book', q: 'אין תור פנוי במועד שמתאים לי. מה עושים?',
    a: 'הצטרפו לרשימת ההמתנה של הטיפול, מתוך עמוד הקליניקה. כשמתפנה תור שמתאים להעדפות שלכם, נשלח הודעה והתור נשמר לכם לזמן מוגבל.',
  },
  {
    audience: 'client', topic: 'book', q: 'התור נקבע ישירות ביומן של הקליניקה?',
    a: 'כן. התור נקבע ב־BeautyFind, והיומן של הקליניקה מסתנכרן איתנו בשני הכיוונים (Google, Outlook או מערכת התורים שלה). לכן מוצגים רק מועדים פנויים באמת. האישור והתזכורת נשלחים בוואטסאפ, ב־SMS או במייל.',
  },
  {
    audience: 'client', topic: 'pay', q: 'למה נגבית מקדמה, ומתי היא מוחזרת?',
    a: 'המקדמה נקבעת על ידי כל קליניקה: סכום קבוע או אחוז, ולפעמים רק לטיפולים רפואיים. היא מתקזזת מהתשלום בקליניקה, ומוחזרת במלואה עם חשבונית זיכוי אם מבטלים בזמן.',
    link: { label: 'לקבלות בחשבון', href: ROUTES.account },
  },
  {
    audience: 'client', topic: 'pay', q: 'האם המחירים כוללים מע״מ?',
    a: 'לא. המחירים באתר מוצגים לפני מע״מ, והסכום הסופי מופיע בחשבונית המס. רוב הקליניקות מאפשרות תשלומים.',
  },
  {
    audience: 'client', topic: 'pay', q: 'הקופה או הביטוח מכסים את הטיפול?',
    a: 'לא. טיפולים אסתטיים אינם בסל הבריאות ואינם מכוסים בקופות החולים. חלק מהביטוחים הפרטיים מכסים ייעוץ עור רפואי, כדאי לבדוק מול הביטוח.',
  },
  {
    audience: 'client', topic: 'medical', q: 'למה אי אפשר לקבוע בוטוקס ישירות?',
    a: 'הזרקה היא פעולה רפואית. רופא/ה צריכים לבדוק אתכם ולהחליט אם, איך ובאיזו כמות. לכן טיפולים כאלה מתחילים בבקשת ייעוץ: בוחרים מועד ייעוץ פנוי אצל הרופא/ה, או משאירים העדפות והקליניקה מציעה מועד.',
    link: { label: 'לקליניקות אסתטיקה רפואית', href: PATHS.medicalAesthetics },
  },
  {
    audience: 'client', topic: 'medical', q: 'מי רשאי להזריק?',
    a: 'רופא/ה, או אח/ות מוסמך/ת בפיקוח רופא. קוסמטיקאיות אינן רשאיות להזריק. בכל פרופיל מופיע מי אחראי/ת רפואית, והרישיון נבדק מול מאגר משרד הבריאות.',
    link: { label: 'איך אנחנו בודקים', href: ROUTES.listingStandards },
  },
  {
    audience: 'client', topic: 'medical', q: 'מה זו הצהרת הבריאות ומי רואה אותה?',
    a: 'שאלון קצר שנחתם דיגיטלית לפני הטיפול. רק הצוות המטפל בתור רואה אותו, לא הקבלה ולא BeautyFind.',
    link: { label: 'למדיניות הפרטיות', href: ROUTES.privacy },
  },
  {
    audience: 'client', topic: 'reviews', q: 'למה הביקורת שלי עוד לא פורסמה?',
    a: 'כל ביקורת נבדקת לפני פרסום, בדרך כלל תוך 6 שעות. אנחנו מפרסמים רק ביקורות על ביקור שאומת מול היומן של הקליניקה.',
    link: { label: 'איך נבדקות ביקורות', href: ROUTES.listingStandards },
  },
  {
    audience: 'client', topic: 'reviews', q: 'מה ההבדל בין דירוג Google לביקורות BeautyFind?',
    a: 'אלה שני מקורות נפרדים, ומוצגים זה לצד זה בלי ממוצע משותף. דירוג Google מתעדכן מדי שבוע ומקשר למקור. ביקורות BeautyFind נכתבות רק אחרי ביקור מאומת ועוברות בדיקה לפני פרסום.',
    link: { label: 'תקן הרישום', href: ROUTES.listingStandards },
  },
  {
    audience: 'client', topic: 'reviews', q: 'הקליניקה יכולה למחוק ביקורת שלילית?',
    a: 'לא. קליניקה יכולה להגיב פומבית או לדווח על ביקורת שמפרה את התקן. ההחלטה של צוות הבדיקה, והיא מתועדת.',
    link: { label: 'תקן הרישום', href: ROUTES.listingStandards },
  },
  {
    audience: 'client', topic: 'gift', q: 'כמה זמן שובר מתנה בתוקף?',
    a: 'לפחות 5 שנים מיום הקנייה. אפשר לממש בכמה ביקורים עד שהיתרה נגמרת, ולבדוק יתרה בכל עת עם הקוד.',
    link: { label: 'לבדיקת יתרה', href: PATHS.giftCheck },
  },
  {
    audience: 'client', topic: 'privacy', q: 'איך מקבלים או מוחקים את המידע שלי?',
    a: 'מתוך החשבון, בהגדרות הפרטיות, אפשר לבקש עותק של המידע או מחיקה. מידע רפואי שנמצא בתיק בקליניקה נשמר אצלה לפי חובת השמירה החוקית.',
    link: { label: 'למדיניות הפרטיות', href: ROUTES.privacy },
  },
  {
    audience: 'client', topic: 'privacy', q: 'איך מפסיקים לקבל הודעות שיווקיות?',
    a: 'בכל הודעה שיווקית יש קישור להסרה. אפשר להסיר קליניקה אחת או את כולן, ולבחור בנפרד לכל ערוץ: וואטסאפ, SMS או מייל. הודעות על תורים (אישור, תזכורת והנחיות אחרי טיפול) ימשיכו להגיע.',
    link: { label: 'להגדרות בחשבון', href: ROUTES.account },
  },

  // ---------- Businesses ----------
  {
    audience: 'biz', topic: 'join', q: 'העסק שלי כבר מופיע. איך מקבלים שליטה?',
    a: 'בקשו בעלות על הכרטיס הקיים. שולחים קוד לטלפון או למייל שרשומים בכרטיס, ובודקים את הח״פ מול רשם החברות. אם יש טיפולים רפואיים, רישיון הרופא/ה נבדק גם מול משרד הבריאות. רוב הבקשות נסגרות באותו יום עסקים.',
    link: { label: 'לבקשת בעלות', href: ROUTES.claim },
  },
  {
    audience: 'biz', topic: 'join', q: 'אני קוסמטיקאית. אפשר להציע בוטוקס בפרופיל?',
    a: 'רק אם יש בעסק רופא/ה שמבצע/ת את ההזרקות ורשום/ה כאחראי/ת רפואית. בלי זה, טיפולי הזרקה לא יופיעו בתפריט.',
    link: { label: 'להצטרפות', href: ROUTES.join },
  },
  {
    audience: 'biz', topic: 'profile', q: 'מה מותר לפרסם בתמונות לפני/אחרי?',
    a: 'רק תמונות אמיתיות של מטופלות שנתנו הסכמה מפורשת בכתב, בלי פרטים מזהים ובלי עריכה. בטיפולים רפואיים, בלי הבטחת תוצאה.',
    link: { label: 'תקן הרישום', href: ROUTES.listingStandards },
  },
  {
    audience: 'biz', topic: 'profile', q: 'איך קביעת התורים עובדת עם היומן שלי?',
    a: 'לקוחות קובעים תור ישירות בפרופיל. יומן הסניף מסתנכרן בשני הכיוונים עם Google Calendar, Outlook או מערכת התורים שלכם: תורים מ־BeautyFind נכתבים אצלכם, ואירועים אצלכם חוסמים את המועד. אישורים ותזכורות יוצאים בוואטסאפ, SMS ומייל. זה כלול בשני המסלולים.',
    link: { label: 'לעמוד הרישום', href: ROUTES.forBusiness },
  },
  {
    audience: 'biz', topic: 'billing', q: 'מה ההבדל בין בסיסי למתקדם?',
    a: `בסיסי (${basic} לסניף לחודש): פרופיל מאומת, קביעת תור אונליין עם סנכרון יומן, אישורים ותזכורות בוואטסאפ, SMS ומייל, ביקורות Google וביקורות מאומתות, ולוח פניות. מתקדם + CRM (${advanced} לסניף לחודש): כל הבסיסי, ובנוסף מערכת ניהול הקליניקה: יומן מלא, כרטיסי לקוחות, הצהרות בריאות, צ׳ק־אין, מקדמות, שוברים, רשימת המתנה, בקשות ייעוץ, מלאי ואוטומציות. המחירים לפני מע״מ.`,
    link: { label: 'להשוואת המסלולים', href: ROUTES.pricing },
  },
  {
    audience: 'biz', topic: 'billing', q: 'איך עובד החיוב על כמה סניפים?',
    a: `מנוי אחד וחשבונית אחת. החיוב לפי מספר הסניפים המפורסמים: ${basic} לסניף בבסיסי או ${advanced} לסניף במתקדם עם CRM, לחודש ולפני מע״מ. בתשלום שנתי משלמים על ${YEARLY_MULTIPLIER} חודשים. סניף בטיוטה לא מחויב, וסניף חדש נכנס למחזור החיוב הבא.`,
    link: { label: 'לניהול סניפים', href: PATHS.branches },
  },
  {
    audience: 'biz', topic: 'billing', q: 'BeautyFind גובה עמלה על תורים או מקדמות?',
    a: 'לא. המנוי הוא החיוב היחיד, בלי עמלות על תורים, מקדמות או שוברים. מקדמות, תשלומים ושוברים עוברים ישירות לקליניקה. מקום ממומן נרכש בנפרד, רק אם בוחרים בו.',
    link: { label: 'למחירים', href: ROUTES.pricing },
  },
  {
    audience: 'biz', topic: 'team', q: 'איך מוסיפים רופא/ה לצוות?',
    a: 'מלוח הבקרה, תחת צוות והרשאות, שולחים הזמנה במייל. בהצטרפות הרופא/ה מזינים מספר רישיון, והוא נבדק מול משרד הבריאות. השם מופיע כאחראי/ת רפואית רק אחרי האימות.',
    link: { label: 'ללוח הבקרה', href: ROUTES.dashboard },
  },
  {
    audience: 'biz', topic: 'team', q: 'מי יכול לסגור בקשת ייעוץ מסיבה רפואית?',
    a: 'רק רופא/ה. צוות עם הרשאת הזמנות יכול להציע מועד, לבקש פרטים או לסגור בקשה כפולה, אבל לא לקבוע התווית נגד.',
  },
  {
    audience: 'biz', topic: 'breviews', q: 'אפשר להגיב לביקורת?',
    a: 'לביקורות BeautyFind כן: פעם אחת ופומבית, מלוח הבקרה, בלי פרטים רפואיים של המטופלת, גם אם היא כתבה אותם בעצמה. לביקורות Google מגיבים ב־Google; הדירוג שלהן מוצג בנפרד ולא מתמזג עם ביקורות BeautyFind.',
    link: { label: 'ללוח הבקרה', href: ROUTES.dashboard },
  },
  {
    audience: 'biz', topic: 'ads', q: 'מה זה מקום ממומן ואיך הוא מסומן?',
    a: 'מקום בראש רשימת אזור ותחום, לשבוע או יותר, שנרכש בנפרד מהמנוי. הוא תמיד נושא תג ״ממומן״, לא משפיע על הדירוג, על ההשוואה או על הביקורות, ומוגבל לשני מקומות בכל רשימה.',
    link: { label: 'לרכישת מקום', href: PATHS.sponsoredBuy },
  },
];

export const SIDE: Record<Audience, { title: string; body: string; links: Array<{ name: string; href: string }> }> = {
  client: {
    title: 'קיצורי דרך',
    body: 'הפעולות שהכי מחפשים.',
    links: [
      { name: 'ניהול תור קיים', href: ROUTES.account },
      { name: 'קליניקות שמורות', href: PATHS.saved },
      { name: 'בדיקת יתרת שובר', href: PATHS.giftCheck },
    ],
  },
  biz: {
    title: 'לעסקים',
    body: 'ניהול העסק באזור בעלי העסקים.',
    links: [
      { name: 'לוח הבקרה', href: ROUTES.dashboard },
      { name: 'רכישת מקום ממומן', href: PATHS.sponsoredBuy },
      { name: 'תקן הרישום', href: ROUTES.listingStandards },
    ],
  },
};

export const faqsFor = (aud: Audience) => FAQS.filter(f => f.audience === aud);

export function faqJsonLd(aud: Audience) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqsFor(aud).map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}
