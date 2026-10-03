// Which treatment records are not treatments. Price lists and service pages drop product names, sentences,
// article titles and stray words into the treatment table; those must not reach meta descriptions, the
// city aggregates or the business schema, and staff review them from the CSV that
// scripts/import/treatmentHygiene.ts writes. Pure, shared by the pages, the catalog and the script.

export type TreatmentNameProblem = 'product' | 'sentence' | 'article' | 'function_word' | 'package' | 'empty';

/** A bundle of sessions or a subscription: a real offer, but not a treatment name for a description or an aggregate. */
const PACKAGE_WORDS = /(^|\s)(חבילת|חבילה|חבילות|מפגשים|סדרה|סדרת|מנוי|קורס|קורסים|package|sessions|course|bundle)(?=\s|$|\d)/iu;

/** Words of a product line (creams, serums, day and night care, kits, bottles), not a treatment. */
const PRODUCT_WORDS = /(^|[\s,/(])(קרם|קרמים|סרום|סרומים|שמפו|מרכך|תחליב|לוסיון|אמפולה|אמפולות|ליום|ללילה|מוצר|מוצרי|מוצרים|ערכת|ערכה|סט|בקבוק|שפופרת|אריזת|אריזה|מארז|קופסה|cream|serum|shampoo|conditioner|lotion|kit|bottle)(?=$|[\s,/).])/iu;
/** Verbs and pronouns that make a line a sentence rather than a name. */
const SENTENCE_WORDS = /(^|\s)(מתמחה|מתמחים|מתמחות|מציע|מציעה|מציעים|מציעות|אנחנו|אנו|שלנו|אצלנו|אתם|אתן|תוכלו|ניתן|אפשר|כדאי|חשוב|מומלץ|נשמח|בואו|הגיעו|צרו|התקשרו)(?=\s|$)/u;
/** Openers of an article or a guide title. */
const ARTICLE_OPENERS = /^(היתרונות|היתרון|החסרונות|איך|כיצד|מה|מהו|מהי|מהם|למה|מדוע|האם|מתי|כמה|טיפים|מדריך|המדריך|כל מה ש|הסוד|סודות|\d+\s+(דברים|טיפים|סיבות|שאלות|דרכים)|how|what|why|when|tips|guide)(?=\s|$|\?)/iu;
/** Lone words that carry no treatment: qualifiers, list labels, filler. */
const FUNCTION_WORDS = new Set(['בלבד', 'ועוד', 'עוד', 'כולל', 'או', 'עם', 'ללא', 'חינם', 'מחיר', 'מחירים', 'מחירון', 'שירותים', 'שירות', 'טיפולים', 'טיפול', 'אחר', 'אחרים', 'נוסף', 'נוספים', 'שונות', 'שונים', 'כללי', 'הכל', 'הכול', 'ועוד...', 'לפי', 'בהתאמה', 'בתיאום', 'מבצע', 'מבצעים', 'חדש', 'חדשה', 'כן', 'לא', 'יש', 'אין', 'other', 'misc', 'more', 'etc', 'service', 'services', 'price', 'prices', 'treatment', 'treatments', 'only', 'and', 'or', 'with', 'without', 'new', 'sale']);

/**
 * Why a stored name is not a treatment name, or null when it is one: a product line (קרם ליום, סרום), a
 * package of sessions (חבילת 6 מפגשים), a sentence (ends with a period, carries a verb, or runs long), an
 * article title (היתרונות של..., איך...) or a lone function word (בלבד, ועוד).
 */
export function treatmentNameProblem(raw: string): TreatmentNameProblem | null {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name) return 'empty';
  const words = name.split(' ');
  const bare = name.replace(/[.!?,;:]+$/u, '').toLowerCase();
  if (words.length === 1 && (FUNCTION_WORDS.has(bare) || bare.replace(/[^א-תa-z0-9]/giu, '').length <= 1)) return 'function_word';
  if (ARTICLE_OPENERS.test(name) || /\?$/u.test(name)) return 'article';
  if (PRODUCT_WORDS.test(name)) return 'product';
  if (PACKAGE_WORDS.test(name)) return 'package';
  if (/[.!]$/u.test(name) || name.length > 40 || words.length > 5 || SENTENCE_WORDS.test(name) || /[.!?;]\s+\S/u.test(name)) return 'sentence';
  return null;
}

/** True when the record is still an offer for the business schema: a treatment or a package of one. */
export const isOffer = (raw: string) => {
  const p = treatmentNameProblem(raw);
  return p === null || p === 'package';
};

/** True when the stored name reads as a treatment and may be shown in descriptions, aggregates and schema. */
export const isTreatmentName = (raw: string) => treatmentNameProblem(raw) === null;
