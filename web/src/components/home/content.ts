// Static homepage copy shared by the desktop and phone homepages.
// Counts, ratings and prices never live here: they come from the database (lib/server/public.ts).
/** Per-category teaser line and 24px line icon (bento cards). Keyed by category slug. */
export const CATEGORY_TEASER: Record<string, { short: string; icon: string[] }> = {
  'medical-aesthetics': { short: 'בוטוקס, חומרי מילוי וטיפולי מחט בליווי רפואי.', icon: ['M13.8 3.6l6.6 6.6', 'M11.7 5.7l6.6 6.6', 'M16.4 8.1l-8.6 8.6L3.6 20.4l3.7-4.2 8.6-8.6', 'M9.2 11.3l3.5 3.5'] },
  'plastic-surgery': { short: 'ניתוחים אסתטיים ומשחזרים אצל מנתחים מוסמכים.', icon: ['M7.5 3.4v6.2a4.5 4.5 0 0 0 9 0V3.4', 'M12 14.1v6.5', 'M9.2 18.4h5.6'] },
  'dental-aesthetics': { short: 'הלבנות, ציפויי חרסינה ועיצוב חיוך.', icon: ['M12 3.8c-3.4 0-5.6 2-5.6 5 0 3.6 1.2 5.2 1.9 8.5.5 2.3 2.2 2.6 2.7.4l1-4.3 1 4.3c.5 2.2 2.2 1.9 2.7-.4.7-3.3 1.9-4.9 1.9-8.5 0-3-2.2-5-5.6-5Z'] },
  'hair-restoration': { short: 'FUE, FUT ומענה רפואי לנשירת שיער.', icon: ['M12 4.2a7.8 7.8 0 1 0 0 15.6 7.8 7.8 0 0 0 0-15.6', 'M8.4 14.6c1.2-3.4 2.6-5.4 4.6-6.8', 'M10.6 15.4c.6-2.4 1.8-4 3.6-5.1'] },
  facials: { short: 'ניקוי עמוק, פילינג, מזותרפיה והידרו־פייסיאל.', icon: ['M12 4.2c4 4.6 6 7.4 6 10a6 6 0 0 1-12 0c0-2.6 2-5.4 6-10z', 'M9.4 14.8a2.6 2.6 0 0 0 2.6 2.6'] },
  'hair-removal': { short: 'לייזר דיודה, אלכסנדריט, IPL וחשמלית.', icon: ['M9.2 3.6h5.6l-1.1 5.6h-3.4z', 'M12 9.2v3.4', 'M8.8 16.4c.9-1.1 2-1.7 3.2-1.7s2.3.6 3.2 1.7', 'M5.4 20.4h13.2', 'M6.6 12.4 4.4 14.6', 'M17.4 12.4l2.2 2.2'] },
  'hair-salons': { short: 'תספורות, צבע, החלקות ועיצוב לאירועים.', icon: ['M6.2 4.6 14 14.4', 'M17.8 4.6 10 14.4', 'M7 20.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2', 'M17 20.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2'] },
  'brows-lashes': { short: 'שיפוץ גבות, הרמת ריסים ותוספות שיער לריסים.', icon: ['M3.4 12.6c3-4.4 14.2-4.4 17.2 0', 'M6.2 9.6 4.8 7.4', 'M12 8.2V5.6', 'M17.8 9.6l1.4-2.2', 'M9.6 16.6h4.8'] },
  makeup: { short: 'איפור כלות, אירועים וצילומים.', icon: ['M9.4 3.6h5.2l-1 5.2H10.4z', 'M8.6 8.8h6.8v11.6H8.6z', 'M8.6 13.4h6.8'] },
  'permanent-makeup': { short: 'מיקרובליידינג, פאודר ברואוז ושפתיים.', icon: ['M4 20l2.2-5.2L16.4 4.6l3 3L9.2 17.8z', 'M14.6 6.4l3 3', 'M4 20l5.2-2.2'] },
  nails: { short: 'לק ג׳ל, בניית ציפורניים וטיפולי כף רגל.', icon: ['M8 4.6a4 4 0 0 1 8 0v8.2a4 4 0 0 1-8 0z', 'M8 13.8h8v4.2a4 4 0 0 1-8 0z'] },
  'spa-massage': { short: 'עיסוי שוודי, רקמות עמוקות, אבנים חמות וזוגי.', icon: ['M12 4.2c-2.4 2.8-3.6 4.8-3.6 6.6a3.6 3.6 0 0 0 7.2 0c0-1.8-1.2-3.8-3.6-6.6z', 'M3.8 15.6c3-1.6 5.6.8 8.2.8s5.2-2.4 8.2-.8', 'M3.8 19.4c3-1.6 5.6.8 8.2.8s5.2-2.4 8.2-.8'] },
  'body-contouring': { short: 'קריוליפוליזה, HIFU, רדיו־פרקוונסי וחיטוב שרירים.', icon: ['M7.4 3.6c1.9 3.1 1.9 5.3 0 8.4s-1.9 5.3 0 8.4', 'M16.6 3.6c-1.9 3.1-1.9 5.3 0 8.4s1.9 5.3 0 8.4', 'M9.6 12h4.8'] },
  tanning: { short: 'שיזוף בהתזה או בקרם הדרגתי, בלי חשיפה לקרינת UV.', icon: ['M15.4 12a3.4 3.4 0 1 1-6.8 0 3.4 3.4 0 0 1 6.8 0', 'M12 2.6v2.4', 'M12 19v2.4', 'M2.6 12H5', 'M19 12h2.4', 'M5.5 5.5 7.2 7.2', 'M16.8 16.8l1.7 1.7', 'M5.5 18.5l1.7-1.7', 'M16.8 7.2l1.7-1.7'] },
};

/** Fallback card image per first category, when a listing has no cover yet. */
export const CATEGORY_IMAGE: Record<string, string> = {
  'medical-aesthetics': '/assets/biz-medical.jpg', 'plastic-surgery': '/assets/cat-plastic.jpg', 'dental-aesthetics': '/assets/cat-dental.jpg',
  'hair-restoration': '/assets/cat-hairrest.jpg', facials: '/assets/biz-facial.jpg', 'brows-lashes': '/assets/cat-lashes.jpg',
  makeup: '/assets/cat-makeup.jpg', 'permanent-makeup': '/assets/cat-pmu.jpg', 'hair-removal': '/assets/biz-laser.jpg',
  'hair-salons': '/assets/biz-hair.jpg', nails: '/assets/biz-nails.jpg', 'spa-massage': '/assets/biz-spa.jpg',
  'body-contouring': '/assets/cat-body.jpg', tanning: '/assets/cat-tan.jpg',
};

// TODO(cms): no magazine yet. Titles and images from the design; every card links to /magazine
// until articles exist at /magazine/:slug.
export const ARTICLES = [
  { kind: 'מדריך', title: 'איך לבחור מכון יופי או קליניקה', desc: 'על מה להסתכל בצוות, בתפריט הטיפולים ובתהליך הייעוץ.', img: '/assets/art-choose.jpg', href: '/magazine' },
  { kind: 'הסבר', title: 'איך להבין מחירי טיפולים בישראל', desc: 'למה הצעות מחיר משתנות לפי יחידה, אזור ומספר מפגשים, ואיך להשוות נכון.', img: '/assets/art-prices.jpg', href: '/magazine' },
  { kind: 'צ׳קליסט', title: 'שאלות לשאול לפני פגישת הייעוץ', desc: 'רשימה קצרה לקחת איתכם: על איש המקצוע, על התוכנית ועל הטיפול שאחרי.', img: '/assets/art-questions.jpg', href: '/magazine' },
];

/** Alt text for the site's own photos, keyed by path. Listing photos from businesses are not here. */
export const IMAGE_ALT: Record<string, string> = {
  '/assets/hero-facial.jpg': 'טיפול פנים בקליניקה בתל אביב',
  '/assets/hero-clinic.jpg': 'חדר טיפולים בקליניקה לאסתטיקה',
  '/assets/hero-consult.jpg': 'פינת ישיבה לפגישת ייעוץ בקליניקה',
  '/assets/hero-skin.jpg': 'בקבוק סרום לטיפוח העור',
  '/assets/biz-facial.jpg': 'טיפול פנים אצל קוסמטיקאית',
  '/assets/biz-hair.jpg': 'עיצוב שיער במספרה',
  '/assets/biz-laser.jpg': 'טיפול הסרת שיער בלייזר',
  '/assets/biz-medical.jpg': 'הזרקה אסתטית בקליניקה',
  '/assets/biz-nails.jpg': 'טיפול ציפורניים במכון',
  '/assets/biz-spa.jpg': 'חדר טיפולים בספא',
  '/assets/cat-body.jpg': 'טיפול לעיצוב וחיטוב הגוף',
  '/assets/cat-dental.jpg': 'טיפול באסתטיקה דנטלית',
  '/assets/cat-hairrest.jpg': 'פגישת ייעוץ להשתלת שיער',
  '/assets/cat-lashes.jpg': 'הדבקת תוספות ריסים',
  '/assets/cat-makeup.jpg': 'איפור כלה',
  '/assets/cat-plastic.jpg': 'פגישת ייעוץ לפני ניתוח פלסטי',
  '/assets/cat-pmu.jpg': 'איפור קבוע לגבות',
  '/assets/art-choose.jpg': 'דלפק קבלה בקליניקה',
  '/assets/art-prices.jpg': 'מחירון טיפולים',
  '/assets/art-questions.jpg': 'אישה רושמת שאלות בבית קפה בתל אביב',
};

/** Alt text for the homepage region cards (landmark-{slug}.jpg). */
export const LANDMARK_ALT: Record<string, string> = {
  dan: 'יפו העתיקה וקו הרקיע של תל אביב',
  north: 'הכנרת במבט מטבריה',
  haifa: 'הגנים הבהאיים ומפרץ חיפה',
  sharon: 'המצוקים והחוף בנתניה',
  jerusalem: 'חומות העיר העתיקה ומגדל דוד בירושלים',
  shfela: 'כרמים ליד לטרון',
  south: 'אילת וים סוף',
};

/** Alt text for the region page heroes (region-{slug}.jpg). */
export const REGION_IMAGE_ALT: Record<string, string> = {
  dan: 'שדרות רוטשילד בתל אביב',
  north: 'ראש הנקרה',
  haifa: 'המושבה הגרמנית והגנים הבהאיים בחיפה',
  sharon: 'אמת המים בקיסריה',
  jerusalem: 'העיר העתיקה בירושלים במבט מהר הזיתים',
  shfela: 'מערות הפעמונים בבית גוברין',
  south: 'מכתש רמון',
};
