// Search-intent words per category, for titles and headings. Pure, shared by the directory, the profile
// titles and the tests.

/** The noun people search for ("קוסמטיקאיות בתל אביב"), used in city + category titles. */
export const SEO_TERM: Record<string, string> = {
  facials: 'קוסמטיקאיות',
  'medical-aesthetics': 'מרפאות אסתטיקה',
  'plastic-surgery': 'מנתחים פלסטיים',
  'dental-aesthetics': 'אסתטיקה דנטלית והלבנת שיניים',
  'hair-restoration': 'השתלות שיער',
  'hair-salons': 'מספרות',
  'hair-removal': 'הסרת שיער בלייזר',
  'brows-lashes': 'גבות וריסים',
  makeup: 'מאפרות',
  'permanent-makeup': 'איפור קבוע',
  nails: 'מניקור ופדיקור',
  'spa-massage': 'ספא ועיסויים',
  'body-contouring': 'עיצוב וחיטוב הגוף',
  tanning: 'שיזוף',
};

/** A short category label for a business title ("{name} ב{city}: {label}"). */
export const CATEGORY_SHORT: Record<string, string> = {
  facials: 'קוסמטיקה',
  'medical-aesthetics': 'אסתטיקה רפואית',
  'plastic-surgery': 'כירורגיה פלסטית',
  'dental-aesthetics': 'אסתטיקה דנטלית',
  'hair-restoration': 'השתלות שיער',
  'hair-salons': 'מספרה',
  'hair-removal': 'הסרת שיער',
  'brows-lashes': 'גבות וריסים',
  makeup: 'איפור',
  'permanent-makeup': 'איפור קבוע',
  nails: 'מניקור ופדיקור',
  'spa-massage': 'ספא ועיסויים',
  'body-contouring': 'חיטוב הגוף',
  tanning: 'שיזוף',
};

/** The brand suffix the root layout appends to every title. */
export const BRAND_SUFFIX = ' | BeautyFind';
/** Google shows about 60 characters; the whole title, suffix included, stays under it. */
export const TITLE_MAX = 60;
