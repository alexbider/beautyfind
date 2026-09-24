// How Google places map to our 14 categories, and what we search for.

/** Google place types searched on the map grid. Checked against the API at the start of a run. */
export const NEARBY_TYPES = [
  'beauty_salon', 'hair_salon', 'hair_care', 'nail_salon', 'spa', 'massage', 'skin_care_clinic', 'barber_shop',
  'tanning_studio', 'makeup_artist', 'beautician', 'massage_spa', 'wellness_center', 'sauna', 'body_art_service',
];

/** Text queries per category, run in every city in scope ("<query> <city>"). */
export const TEXT_QUERIES: Record<string, string[]> = {
  facials: ['קוסמטיקאית', 'טיפולי פנים'],
  'medical-aesthetics': ['אסתטיקה רפואית', 'בוטוקס וחומצה היאלורונית'],
  'plastic-surgery': ['מנתח פלסטי'],
  'dental-aesthetics': ['אסתטיקה דנטלית'],
  'hair-restoration': ['השתלת שיער'],
  'hair-salons': ['מספרה'],
  'hair-removal': ['הסרת שיער בלייזר'],
  'brows-lashes': ['עיצוב גבות וריסים'],
  makeup: ['מאפרת'],
  'permanent-makeup': ['איפור קבוע'],
  nails: ['לק ג׳ל ציפורניים'],
  'spa-massage': ['עיסוי', 'ספא'],
  'body-contouring': ['עיצוב וחיטוב הגוף'],
  tanning: ['שיזוף בהתזה'],
};

const TYPE_CATS: Record<string, string[]> = {
  hair_salon: ['hair-salons'], hair_care: ['hair-salons'], barber_shop: ['hair-salons'],
  nail_salon: ['nails'], spa: ['spa-massage'], massage: ['spa-massage'], massage_spa: ['spa-massage'], sauna: ['spa-massage'],
  skin_care_clinic: ['facials'], beautician: ['facials'], makeup_artist: ['makeup'], tanning_studio: ['tanning'],
  dental_clinic: [], dentist: [], plastic_surgeon: ['plastic-surgery'],
};

// Name keywords, Hebrew and English. Deliberately narrow: a wrong category is worse than none.
const NAME_CATS: Array<[RegExp, string]> = [
  [/מספר[הת]|ספר |ברבר|barber|hair ?(salon|studio|design)|coiffure/i, 'hair-salons'],
  [/ציפורנ|מניקור|פדיקור|לק ג|nails?\b|manicure/i, 'nails'],
  [/גבות|ריסים|brows?|lash/i, 'brows-lashes'],
  [/איפור קבוע|מיקרובליידינג|permanent make ?up|pmu|microblading/i, 'permanent-makeup'],
  [/מאפר|איפור(?! קבוע)|make ?up artist|makeup/i, 'makeup'],
  [/לייזר|הסרת שיער|laser/i, 'hair-removal'],
  [/ספא|עיסוי|מסאז|spa\b|massage/i, 'spa-massage'],
  [/קוסמטיק|טיפולי פנים|cosmetic|skin ?care|facial/i, 'facials'],
  [/אסתטיקה רפואית|בוטוקס|botox|filler|aesthetic (clinic|medicine)/i, 'medical-aesthetics'],
  [/כירורג|פלסטיק|plastic surg/i, 'plastic-surgery'],
  [/השתלת שיער|hair (transplant|restoration)/i, 'hair-restoration'],
  [/שיניים|דנטל|dental|smile design/i, 'dental-aesthetics'],
  [/שיזוף|tanning|spray ?tan/i, 'tanning'],
  [/חיטוב|עיצוב גוף|body contour|slim/i, 'body-contouring'],
];

/** Categories we can say from Google data alone, before reading the website. */
export function categoriesFromGoogle(types: string[], name: string, query?: { category: string } | null): string[] {
  const out = new Set<string>();
  for (const t of types) for (const c of TYPE_CATS[t] ?? []) out.add(c);
  for (const [re, c] of NAME_CATS) if (re.test(name)) out.add(c);
  if (query) out.add(query.category);
  return [...out];
}

/** Google types that mean "not a beauty business" when nothing else points to beauty. */
export const OFF_TOPIC_TYPES = new Set([
  'store', 'clothing_store', 'shoe_store', 'pharmacy', 'drugstore', 'supermarket', 'grocery_store', 'gym', 'fitness_center',
  'school', 'restaurant', 'cafe', 'hotel', 'lodging', 'veterinary_care', 'pet_store', 'car_repair', 'hospital',
]);
