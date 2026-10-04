// Counting businesses in natural Hebrew, per category: "3 מספרות", "קוסמטיקאית אחת", "שתי מרפאות אסתטיקה",
// and "6 עסקי יופי ואסתטיקה" when no category is in play. Pure, shared by the directory, the treatment pages,
// the profile and the tests.

export interface BusinessNoun {
  one: string; // "מספרה אחת"
  many: string; // "מספרות"
  fem: boolean; // the gender of the plural, for "שתי" or "שני"
}

export const BUSINESS_NOUN: Record<string, BusinessNoun> = {
  facials: { one: 'קוסמטיקאית אחת', many: 'קוסמטיקאיות', fem: true },
  'medical-aesthetics': { one: 'מרפאת אסתטיקה אחת', many: 'מרפאות אסתטיקה', fem: true },
  'plastic-surgery': { one: 'מנתח פלסטי אחד', many: 'מנתחים פלסטיים', fem: false },
  'dental-aesthetics': { one: 'מרפאת שיניים אחת', many: 'מרפאות שיניים', fem: true },
  'hair-restoration': { one: 'מרפאת השתלות שיער אחת', many: 'מרפאות השתלות שיער', fem: true },
  'hair-salons': { one: 'מספרה אחת', many: 'מספרות', fem: true },
  'hair-removal': { one: 'מכון הסרת שיער אחד', many: 'מכוני הסרת שיער', fem: false },
  'brows-lashes': { one: 'מעצבת גבות וריסים אחת', many: 'מעצבות גבות וריסים', fem: true },
  makeup: { one: 'מאפרת אחת', many: 'מאפרות', fem: true },
  'permanent-makeup': { one: 'סטודיו אחד לאיפור קבוע', many: 'סטודיואים לאיפור קבוע', fem: false },
  nails: { one: 'סלון ציפורניים אחד', many: 'סלוני ציפורניים', fem: false },
  'spa-massage': { one: 'ספא אחד', many: 'מכוני ספא ועיסוי', fem: false },
  'body-contouring': { one: 'מכון חיטוב אחד', many: 'מכוני חיטוב', fem: false },
  tanning: { one: 'מכון שיזוף אחד', many: 'מכוני שיזוף', fem: false },
};

export const GENERAL_NOUN: BusinessNoun = { one: 'עסק יופי ואסתטיקה אחד', many: 'עסקי יופי ואסתטיקה', fem: false };

export const businessNoun = (slug?: string | null): BusinessNoun => (slug && BUSINESS_NOUN[slug]) || GENERAL_NOUN;

/** The plural alone: "מספרות", "עסקי יופי ואסתטיקה". */
export const businessPlural = (slug?: string | null) => businessNoun(slug).many;

/** "מספרה אחת", "שתי מספרות", "12 מספרות"; without a category "6 עסקי יופי ואסתטיקה". */
export function businessCount(n: number, slug?: string | null): string {
  const f = businessNoun(slug);
  if (n === 1) return f.one;
  if (n === 2) return `${f.fem ? 'שתי' : 'שני'} ${f.many}`;
  return `${n.toLocaleString('en-US')} ${f.many}`;
}
