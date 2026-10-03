// Treatment names as they go into meta descriptions: Hebrew. An English treatment name from a price list
// is translated with this catalog (Hairstyling = עיצוב שיער, Hair colouring = צבע לשיער); a brand or
// device name stays as it is (Hydrafacial, Morpheus8); any other Latin or Cyrillic name is left out of
// the description rather than printed in English. Pure, shared by the profile metadata, the writer's
// template and the tests.

import { normalizeHebrew } from '../import/textRules';

/** English treatment names and their Hebrew form, matched whole (case and punctuation insensitive). */
export const TREATMENT_HE: Record<string, string> = {
  // hair
  'hairstyling': 'עיצוב שיער', 'hair styling': 'עיצוב שיער', 'styling': 'עיצוב שיער', 'hair style': 'עיצוב שיער',
  'hair colouring': 'צבע לשיער', 'hair coloring': 'צבע לשיער', 'colouring': 'צבע לשיער', 'coloring': 'צבע לשיער', 'hair colour': 'צבע לשיער', 'hair color': 'צבע לשיער', 'color': 'צבע לשיער', 'colour': 'צבע לשיער', 'root touch up': 'צבע שורשים', 'roots': 'צבע שורשים',
  'haircut': 'תספורת', 'hair cut': 'תספורת', 'cut': 'תספורת', 'womens haircut': 'תספורת נשים', "women's haircut": 'תספורת נשים', 'mens haircut': 'תספורת גברים', "men's haircut": 'תספורת גברים', 'kids haircut': 'תספורת ילדים', 'childrens haircut': 'תספורת ילדים', 'fringe trim': 'קיצור פוני', 'trim': 'קיצור קצוות',
  'blow dry': 'פן', 'blowdry': 'פן', 'blowout': 'פן', 'wash and blow dry': 'חפיפה ופן', 'updo': 'תסרוקת', 'hairstyle': 'תסרוקת', 'bridal hair': 'תסרוקת כלה', 'braids': 'צמות',
  'highlights': 'גוונים', 'balayage': 'באלייאז׳', 'ombre': 'אומברה', 'bleach': 'הבהרה', 'bleaching': 'הבהרה', 'toner': 'טונר', 'gloss': 'גלוס לשיער',
  'keratin': 'החלקת קרטין', 'keratin treatment': 'החלקת קרטין', 'brazilian': 'ברזילאית', 'brazilian blowout': 'החלקה ברזילאית', 'japanese straightening': 'החלקה יפנית', 'straightening': 'החלקת שיער', 'hair straightening': 'החלקת שיער', 'perm': 'סלסול', 'curls': 'תלתלים',
  'hair treatment': 'טיפול לשיער', 'deep conditioning': 'טיפול הזנה לשיער', 'scalp treatment': 'טיפול קרקפת', 'hair extensions': 'תוספות שיער', 'extensions': 'תוספות שיער', 'olaplex treatment': 'טיפול אולפלקס',
  'beard trim': 'עיצוב זקן', 'beard': 'עיצוב זקן', 'shave': 'גילוח', 'hot towel shave': 'גילוח במגבת חמה', 'barber': 'תספורת גברים',
  // hair removal
  'laser hair removal': 'הסרת שיער בלייזר', 'hair removal': 'הסרת שיער', 'laser': 'הסרת שיער בלייזר', 'waxing': 'שעווה', 'wax': 'שעווה', 'full body wax': 'שעווה לכל הגוף', 'bikini wax': 'שעווה לביקיני', 'brazilian wax': 'שעווה ברזילאית', 'leg wax': 'שעווה לרגליים', 'underarm wax': 'שעווה לבתי השחי', 'sugaring': 'הסרת שיער בסוכר', 'threading': 'הסרת שיער בחוט', 'electrolysis': 'אלקטרוליזה',
  // face and skin
  'facial': 'טיפול פנים', 'facials': 'טיפולי פנים', 'classic facial': 'טיפול פנים קלאסי', 'deep cleansing facial': 'ניקוי פנים עמוק', 'deep cleanse': 'ניקוי פנים עמוק', 'cleansing': 'ניקוי פנים', 'face cleansing': 'ניקוי פנים', 'skin cleansing': 'ניקוי פנים', 'acne treatment': 'טיפול באקנה', 'acne': 'טיפול באקנה', 'anti aging': 'טיפול אנטי־אייג׳ינג', 'anti-aging': 'טיפול אנטי־אייג׳ינג', 'anti aging facial': 'טיפול פנים אנטי־אייג׳ינג',
  'peeling': 'פילינג', 'chemical peel': 'פילינג כימי', 'peel': 'פילינג', 'microdermabrasion': 'מיקרודרמבריישן', 'microneedling': 'מיקרונידלינג', 'micro needling': 'מיקרונידלינג', 'dermaplaning': 'דרמהפלנינג', 'led therapy': 'טיפול אור LED', 'oxygen facial': 'טיפול פנים בחמצן', 'hydrating facial': 'טיפול פנים מלחלח', 'pigmentation treatment': 'טיפול בפיגמנטציה', 'pigmentation': 'טיפול בפיגמנטציה', 'skin tightening': 'מיצוק העור', 'radiofrequency': 'רדיו תדר', 'rf': 'רדיו תדר', 'mesotherapy': 'מזותרפיה', 'skin booster': 'סקין בוסטר', 'skin boosters': 'סקין בוסטר',
  // medical aesthetics
  'botox': 'בוטוקס', 'botox injections': 'הזרקות בוטוקס', 'fillers': 'חומרי מילוי', 'filler': 'חומרי מילוי', 'dermal fillers': 'חומרי מילוי', 'lip filler': 'מילוי שפתיים', 'lip fillers': 'מילוי שפתיים', 'lip augmentation': 'עיבוי שפתיים', 'hyaluronic acid': 'חומצה היאלורונית', 'thread lift': 'הרמת פנים בחוטים', 'threads': 'חוטים נמסים', 'prp': 'PRP', 'prp treatment': 'טיפול PRP', 'vampire facial': 'טיפול PRP לפנים',
  // body
  'massage': 'עיסוי', 'swedish massage': 'עיסוי שוודי', 'deep tissue massage': 'עיסוי רקמות עמוק', 'deep tissue': 'עיסוי רקמות עמוק', 'thai massage': 'עיסוי תאילנדי', 'hot stone massage': 'עיסוי אבנים חמות', 'hot stones': 'עיסוי אבנים חמות', 'reflexology': 'רפלקסולוגיה', 'shiatsu': 'שיאצו', 'lymphatic drainage': 'ניקוז לימפטי', 'sports massage': 'עיסוי ספורטאים', 'couples massage': 'עיסוי זוגי', 'back massage': 'עיסוי גב', 'foot massage': 'עיסוי כפות רגליים', 'aromatherapy': 'ארומתרפיה', 'body scrub': 'פילינג גוף', 'body wrap': 'עטיפת גוף', 'sauna': 'סאונה', 'hammam': 'חמאם', 'spa day': 'יום ספא', 'spa package': 'חבילת ספא',
  'body contouring': 'חיטוב הגוף', 'body sculpting': 'עיצוב הגוף', 'cellulite treatment': 'טיפול בצלוליט', 'cellulite': 'טיפול בצלוליט', 'cryolipolysis': 'קריוליפוליזה', 'fat freezing': 'הקפאת שומן', 'cavitation': 'קוויטציה', 'lipo laser': 'ליפו לייזר',
  // nails
  'manicure': 'מניקור', 'pedicure': 'פדיקור', 'gel manicure': 'מניקור ג׳ל', 'gel polish': 'לק ג׳ל', 'gel': 'לק ג׳ל', 'gel nails': 'לק ג׳ל', 'shellac': 'לק ג׳ל', 'acrylic nails': 'ציפורניים אקריליות', 'acrylic': 'בניית ציפורניים באקריל', 'nail extensions': 'בניית ציפורניים', 'nail art': 'ציורי ציפורניים', 'nails': 'ציפורניים', 'medical pedicure': 'פדיקור רפואי', 'spa pedicure': 'פדיקור ספא', 'polish': 'לק', 'polygel': 'פולי ג׳ל', 'nail repair': 'השלמת ציפורן', 'french manicure': 'מניקור צרפתי',
  // brows and lashes
  'eyebrows': 'עיצוב גבות', 'brows': 'עיצוב גבות', 'brow shaping': 'עיצוב גבות', 'eyebrow shaping': 'עיצוב גבות', 'brow tint': 'צביעת גבות', 'eyebrow tint': 'צביעת גבות', 'brow lamination': 'למינציית גבות', 'eyebrow lamination': 'למינציית גבות', 'henna brows': 'גבות בחינה', 'brow threading': 'גבות בחוט', 'eyebrow threading': 'גבות בחוט',
  'lashes': 'ריסים', 'eyelashes': 'ריסים', 'lash extensions': 'הארכת ריסים', 'eyelash extensions': 'הארכת ריסים', 'lash lift': 'הרמת ריסים', 'eyelash lift': 'הרמת ריסים', 'lash tint': 'צביעת ריסים', 'eyelash tint': 'צביעת ריסים', 'classic lashes': 'ריסים קלאסיים', 'volume lashes': 'ריסים בנפח', 'hybrid lashes': 'ריסים היברידיים', 'lash removal': 'הסרת ריסים',
  // makeup
  'makeup': 'איפור', 'make up': 'איפור', 'make-up': 'איפור', 'bridal makeup': 'איפור כלה', 'evening makeup': 'איפור ערב', 'event makeup': 'איפור לאירועים', 'makeup lesson': 'שיעור איפור',
  'permanent makeup': 'איפור קבוע', 'microblading': 'מיקרובליידינג', 'powder brows': 'פאודר ברו', 'lip blush': 'פיגמנטציית שפתיים', 'permanent eyeliner': 'אייליינר קבוע', 'micropigmentation': 'מיקרופיגמנטציה', 'scalp micropigmentation': 'מיקרופיגמנטציה לקרקפת',
  // dental
  'teeth whitening': 'הלבנת שיניים', 'whitening': 'הלבנת שיניים', 'veneers': 'ציפוי חרסינה', 'dental implants': 'השתלות שיניים', 'implants': 'השתלות שיניים', 'invisalign': 'אינויזליין', 'braces': 'יישור שיניים', 'orthodontics': 'יישור שיניים', 'dental cleaning': 'ניקוי אבנית', 'hygiene': 'ניקוי אבנית', 'smile design': 'עיצוב חיוך', 'crowns': 'כתרים', 'root canal': 'טיפול שורש', 'filling': 'סתימה', 'dental checkup': 'בדיקת שיניים', 'checkup': 'בדיקה',
  // hair restoration
  'hair transplant': 'השתלת שיער', 'hair transplantation': 'השתלת שיער', 'fue': 'השתלת שיער בשיטת FUE', 'beard transplant': 'השתלת זקן', 'eyebrow transplant': 'השתלת גבות', 'hair loss treatment': 'טיפול בנשירת שיער', 'prp for hair': 'PRP לשיער',
  // plastic surgery
  'rhinoplasty': 'ניתוח אף', 'nose job': 'ניתוח אף', 'blepharoplasty': 'ניתוח עפעפיים', 'eyelid surgery': 'ניתוח עפעפיים', 'liposuction': 'שאיבת שומן', 'tummy tuck': 'מתיחת בטן', 'abdominoplasty': 'מתיחת בטן', 'breast augmentation': 'הגדלת חזה', 'breast lift': 'הרמת חזה', 'breast reduction': 'הקטנת חזה', 'facelift': 'מתיחת פנים', 'face lift': 'מתיחת פנים', 'otoplasty': 'ניתוח אוזניים',
  // tanning and other
  'spray tan': 'שיזוף בהתזה', 'spray tanning': 'שיזוף בהתזה', 'tanning': 'שיזוף', 'sunbed': 'מיטת שיזוף', 'consultation': 'ייעוץ', 'free consultation': 'ייעוץ', 'treatment': 'טיפול',
};

/** Brand, product and device names that stay in Latin script. */
export const TREATMENT_BRANDS = [
  'hydrafacial', 'hydra facial', 'dermapen', 'morpheus8', 'morpheus', 'emsculpt', 'emsella', 'coolsculpting', 'ultherapy', 'thermage', 'fraxel', 'picosure', 'picoway', 'alexandrite', 'soprano', 'gentlemax', 'gentle max', 'candela', 'lumenis', 'venus', 'elos', 'exilis', 'vaser', 'velashape',
  'botox', 'dysport', 'xeomin', 'juvederm', 'restylane', 'profhilo', 'sculptra', 'radiesse', 'belotero', 'teosyal', 'olaplex', 'kerastase', 'kérastase', 'invisalign', 'zoom', 'opalescence', 'philips zoom',
  'hifu', 'ipl', 'prp', 'led', 'rf', 'co2', 'dpl', 'shr', 'fue', 'fut', 'dhi', 'spf', 'bb glow', 'oxygeneo', 'geneo', 'dermalux', 'hollywood peel', 'carbon peel', 'ems', 'lpg', 'endermologie',
];

const HEBREW = /[א-ת]/;
const LATIN = /[A-Za-z]/;
const CYRILLIC = /[Ѐ-ӿ]/;

/** Lower case, one space, no punctuation, for catalog lookups. */
const key = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/gi, ' ').replace(/\s+/g, ' ').trim();

const BRANDS = new Set(TREATMENT_BRANDS.map(key));

const isBrand = (word: string) => BRANDS.has(key(word));

/**
 * The Hebrew name of a treatment for a meta description, or null when it cannot be written in Hebrew:
 * a Hebrew name is kept (typography normalized), an English name is translated through the catalog,
 * a brand or device name stays, and anything else in Latin or Cyrillic script is left out.
 */
export function hebrewTreatmentName(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim();
  // A sentence (ends with a period, has a verb like מתמחה or מציעים), a package line or a long label is not a treatment name.
  if (!name || name.length > 40 || name.split(' ').length > 5 || /[.!?;]$/u.test(name) || /(^|\s)(מתמחה|מתמחים|מציע|מציעה|מציעים|אנחנו|אנו|שלנו)(\s|$)/u.test(name)) return null;
  if (CYRILLIC.test(name)) return null;
  if (!LATIN.test(name)) return normalizeHebrew(name);
  // Hebrew with a Latin brand word inside ("טיפול Hydrafacial") stays; Hebrew with other English is cut to the Hebrew part.
  if (HEBREW.test(name)) {
    const words = name.split(' ');
    const kept = words.filter(w => !LATIN.test(w) || isBrand(w));
    const he = kept.join(' ').replace(/^[\s,:;/()-]+|[\s,:;/()-]+$/g, '');
    return HEBREW.test(he) ? normalizeHebrew(he) : null;
  }
  const k = key(name);
  if (TREATMENT_HE[k]) return TREATMENT_HE[k];
  if (BRANDS.has(k)) return name;
  // "Hydrafacial treatment", "Classic facial": a brand or a catalog name with one extra catalog word.
  const words = k.split(' ');
  if (words.every(w => BRANDS.has(w) || TREATMENT_HE[w])) {
    const brand = words.filter(w => BRANDS.has(w));
    const rest = words.filter(w => !BRANDS.has(w)).map(w => TREATMENT_HE[w]);
    if (brand.length && rest.length) return `${rest.join(' ')} ${name.split(' ').filter(w => BRANDS.has(key(w))).join(' ')}`;
    if (brand.length) return name;
  }
  // The longest catalog phrase inside the name ("Deep cleansing facial 60 min" -> ניקוי פנים עמוק).
  let best: string | null = null;
  for (const [en, he] of Object.entries(TREATMENT_HE)) {
    if (en.length < 4 || (best && en.length <= best.length)) continue;
    if (new RegExp(`(^| )${en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(k)) best = en;
  }
  return best ? TREATMENT_HE[best] : null;
}

// ---------- one treatment, one name ----------

// Words that say the same thing: the right side is the stem both are reduced to.
const SYNONYM_STEMS: Record<string, string> = {
  'בלונד': 'הבהרה', 'הבהרות': 'הבהרה', 'הבהרת': 'הבהרה',
  'צביעת': 'צבע', 'צביעה': 'צבע', 'צבעים': 'צבע', 'גוון': 'גוונים',
  'תספורות': 'תספורת', 'פנים': 'פנים', 'פן': 'פן',
  'עיסויים': 'עיסוי', 'מסאז': 'עיסוי', "מסאז׳": 'עיסוי',
  'ריסים': 'ריס', 'גבות': 'גבה',
  'ניקוי': 'ניקוי', 'פילינגים': 'פילינג',
  'הסרת': 'הסרה', 'הארכת': 'הארכה', 'הרמת': 'הרמה', 'בניית': 'בנייה', 'עיצוב': 'עיצוב', 'החלקת': 'החלקה', 'השתלת': 'השתלה', 'השתלות': 'השתלה',
  'הזרקת': 'הזרקה', 'הזרקות': 'הזרקה', 'מילוי': 'מילוי', 'חומרי': 'חומר',
};
// Words that never decide whether two names mean the same: the kind of thing, the body part, the audience.
const WEAK_STEMS = new Set(['טיפול', 'טיפולים', 'שירות', 'חבילה', 'חבילת', 'מפגש', 'מפגשים', 'סדרה', 'לנשים', 'לגברים', 'לילדים', 'לילדות', 'לכלה', 'לכלות', 'מקצועי', 'מקצועית', 'מתקדם', 'מתקדמת', 'קלאסי', 'קלאסית', 'רגיל', 'רגילה', 'מלא', 'מלאה', 'חלקי', 'חלקית',
  'פנים', 'שיער', 'גוף', 'ציפורניים', 'עור', 'ראש', 'עם', 'של', 'או', 'ללא', 'כולל', 'אזור', 'אזורים', 'אחד', 'שלושה', 'שני', 'כל']);

/** A word reduced to its stem: prefixes ו/ה/ב/ל off, plural and construct endings off, synonyms folded. */
function stem(word: string): string {
  let w = word.replace(/[^א-ת׳״A-Za-z0-9]/gu, '');
  if (!w) return '';
  if (/^[A-Za-z0-9]/.test(w)) return w.toLowerCase();
  if (SYNONYM_STEMS[w]) return SYNONYM_STEMS[w];
  if (w.length > 3 && /^[והבל]/u.test(w) && SYNONYM_STEMS[w.slice(1)]) return SYNONYM_STEMS[w.slice(1)];
  if (w.length > 3 && /^ו/u.test(w)) w = w.slice(1);
  if (SYNONYM_STEMS[w]) return SYNONYM_STEMS[w];
  if (w.length > 4 && /ים$/u.test(w)) w = w.slice(0, -2);
  else if (w.length > 4 && /ות$/u.test(w)) w = `${w.slice(0, -2)}ה`;
  else if (w.length > 4 && /י$/u.test(w)) w = w.slice(0, -1);
  return SYNONYM_STEMS[w] ?? w;
}

/** The stems that carry a name's meaning (weak words left out), as a set. */
export const treatmentStems = (name: string): Set<string> => new Set(name.split(/\s+/).map(stem).filter(x => x && !WEAK_STEMS.has(x)));

/**
 * Whether two treatment names mean the same thing: the same meaning stems, or one name's meaning stems
 * all inside the other's (גוונים inside גוונים והבהרות; טיפול פנים and טיפולי פנים both reduce to nothing
 * beyond the body part, so they match each other only).
 */
export function sameTreatment(a: string, b: string): boolean {
  const sa = treatmentStems(a);
  const sb = treatmentStems(b);
  // Names made only of weak words (טיפול פנים, טיפול פנים קלאסי) are compared on every stem instead.
  const [la, lb] = sa.size && sb.size ? [sa, sb] : [allStems(a), allStems(b)];
  const [small, big] = la.size <= lb.size ? [la, lb] : [lb, la];
  return small.size > 0 && [...small].every(x => big.has(x));
}
const allStems = (name: string) => new Set(name.split(/\s+/).map(stem).filter(Boolean));

/** One name per meaning, in order of first appearance; of two names that mean the same, the shorter one stays. */
export function dedupeTreatments(names: string[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    const at = out.findIndex(o => sameTreatment(o, n));
    if (at < 0) out.push(n);
    else if (n.length < out[at].length) out[at] = n;
  }
  return out;
}

/** The first `n` treatments that have a Hebrew name, in order, one per meaning (the shorter name of two that mean the same). */
export function hebrewTreatmentNames(names: string[], n = 3): string[] {
  const he = names.map(hebrewTreatmentName).filter((x): x is string => !!x);
  return dedupeTreatments(he).slice(0, n);
}
