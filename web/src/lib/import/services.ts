// Treatment vocabulary for reading service lists on business websites (Hebrew and English).
// A short line that names a known treatment is a service the business offers, with or without a
// price. Each term maps to one of our categories; medical categories mark the service medical.

import { CATEGORIES } from '../catalog';

interface Term {
  re: RegExp;
  category: string;
}

// Order matters: the first matching term decides the category, so specific terms come first.
const TERMS: Term[] = [
  // permanent makeup before makeup, laser hair removal before hair
  { re: /איפור\s*קבוע|מיקרובליידינג|מיקרו\s*בליידינג|מיקרופיגמנטציה|הצללת\s*גבות|פאודר\s*(ברו|גבות)|קעקוע\s*(גבות|שפתיים|אייליינר)|permanent\s*make\s*-?up|microblading|micro\s*pigment|powder\s*brows|lip\s*blush/i, category: 'permanent-makeup' },
  { re: /הסרת\s*שיער|לייזר\s*(להסרת|אלכסנדרייט|דיודה)|אלקטרוליזה|שעווה|ווקס|שעוות|שיוף\s*שיער|laser\s*hair|hair\s*removal|electrolysis|waxing|\bwax\b|sugaring|סוכר\s*להסרת/i, category: 'hair-removal' },
  { re: /השתלת\s*שיער|השתלת\s*זקן|השתלת\s*גבות|טיפול\s*בנשירה|נשירת\s*שיער|\bprp\b.*שיער|שיער.*\bprp\b|fue\b|dhi\b|hair\s*transplant|hair\s*loss|hair\s*restoration/i, category: 'hair-restoration' },
  { re: /בוטוקס|דיספורט|חומצה\s*היאלורונית|מילוי\s*(שפתיים|קמטים|פנים|לחיים|סנטר)|פילר|פילרים|סקולפטרה|רדיאס|פרופיילו|מזותרפיה|\bprp\b|פלזמה|חוטים\s*(נמסים|להרמה)|הרמת\s*גבות\s*בחוטים|סקין\s*בוסטר|פילינג\s*כימי\s*עמוק|botox|dysport|hyaluronic|filler|sculptra|radiesse|profhilo|skin\s*booster|mesotherapy|thread\s*lift/i, category: 'medical-aesthetics' },
  { re: /ניתוח|ניתוחי|שאיבת\s*שומן|הגדלת\s*חזה|הקטנת\s*חזה|הרמת\s*חזה|מתיחת\s*בטן|אבדומינופלסטיקה|רינופלסטיקה|אף\s*חדש|הרמת\s*עפעפיים|בלפרופלסטיקה|מתיחת\s*פנים|ליפוסקשן|rhinoplasty|blepharoplasty|liposuction|abdominoplasty|tummy\s*tuck|breast\s*(augmentation|lift|reduction)|face\s*lift/i, category: 'plastic-surgery' },
  { re: /הלבנת\s*שיניים|ציפוי\s*(חרסינה|שיניים)|למינציה|ונירים|כתרים|השתלות\s*שיניים|יישור\s*שיניים|אינויזליין|קשתיות\s*שקופות|עיצוב\s*חיוך|teeth\s*whitening|veneers|invisalign|smile\s*design|dental\s*implant/i, category: 'dental-aesthetics' },
  { re: /לק\s*ג['׳"]?ל|ג['׳]?ל\s*בסיס|בניית\s*ציפורניים|ציפורניים|מניקור|פדיקור|לק\s*(רגיל|קלאסי)|אקריל|פולי\s*ג['׳]?ל|השלמת\s*ציפורן|manicure|pedicure|gel\s*polish|nail|acrylic|polygel/i, category: 'nails' },
  { re: /הרמת\s*ריסים|הארכת\s*ריסים|ריסים|למינציית\s*גבות|למינציה\s*לגבות|עיצוב\s*גבות|צביעת\s*(גבות|ריסים)|גבות\s*בחוט|שזירת\s*גבות|henna\s*brows|lash|brow|threading|tinting/i, category: 'brows-lashes' },
  { re: /איפור\s*(כלה|ערב|אירועים|יום|מקצועי|לאירוע)|איפור(?!\s*קבוע)|מאפרת|make\s*-?up|bridal\s*make/i, category: 'makeup' },
  { re: /תספורת|תספורות|צבע\s*לשיער|צביעת\s*שיער|גוונים|הבהרה|בלונד|באלייאז|בליאז|החלקה\s*(יפנית|אורגנית|ברזילאית|קרטין)?|קרטין|פן\b|תסרוקת|תסרוקות|סלסול|פרמננט|עיצוב\s*זקן|תספורת\s*גברים|טיפול\s*(לשיער|שיער)|תוספות\s*שיער|haircut|hair\s*(colou?r|cut|styling|treatment|extension)|balayage|highlights|blow\s*-?dry|keratin|barber|beard/i, category: 'hair-salons' },
  { re: /עיסוי|מסאז|שוודי|רקמות\s*עמוק|תאילנדי|אבנים\s*חמות|רפלקסולוגיה|שיאצו|ניקוז\s*לימפטי|ספא|חמאם|סאונה|ג['׳]?קוזי|massage|swedish|deep\s*tissue|reflexology|shiatsu|lymphatic|hammam|sauna|\bspa\b/i, category: 'spa-massage' },
  { re: /חיטוב|עיצוב\s*(הגוף|גוף)|צלוליט|הצרת\s*היקפים|קריוליפוליזה|הקפאת\s*שומן|אמסקאלפט|אמסקולפט|רדיו\s*תדר\s*לגוף|מיצוק\s*(הגוף|עור\s*הגוף)|body\s*contour|cellulite|cryolipolysis|coolsculpt|emsculpt|body\s*sculpt/i, category: 'body-contouring' },
  { re: /שיזוף|שיזוף\s*בהתזה|ספריי\s*טן|מיטת\s*שיזוף|spray\s*tan|tanning|sunbed/i, category: 'tanning' },
  { re: /טיפול(י)?\s*פנים|ניקוי\s*(פנים|עמוק)|פילינג|מיקרודרמבריישן|מיקרונידלינג|דרמפן|הידרפישל|הידרה\s*פישל|אקנה|פיגמנטציה|כתמים|אנטי\s*אייג['׳]?ינג|רדיו\s*תדר|הייפו|הרמת\s*פנים\s*ללא\s*ניתוח|מסכה\s*לפנים|facial|peeling|microdermabrasion|microneedling|dermapen|hydrafacial|acne|pigmentation|anti\s*-?aging|skin\s*care/i, category: 'facials' },
];

const MEDICAL = new Set(CATEGORIES.filter(c => c.isMedical).map(c => c.slug));

export interface ServiceMatch {
  category: string;
  isMedical: boolean;
}

/** The category a service name belongs to, or null when it does not name a known treatment. */
export function matchService(name: string): ServiceMatch | null {
  for (const t of TERMS) if (t.re.test(name)) return { category: t.category, isMedical: MEDICAL.has(t.category) };
  return null;
}

/**
 * Whether a short line reads like a service name (a menu item or heading), not a sentence, a
 * navigation label, a date or contact text.
 */
export function looksLikeServiceName(line: string): boolean {
  const s = line.trim();
  if (s.length < 3 || s.length > 70) return false;
  if (s.split(/\s+/).length > 9) return false;
  if (/[.!?]\s*\S/.test(s) || /[?!]$/.test(s)) return false; // sentences
  if (/@|https?:|www\.|\d{2,3}-?\d{7}|טלפון|כתובת|שעות\s*פתיחה|צור\s*קשר|הזמ(ן|ינו)\s*תור|לחצ|קרא\s*עוד|read\s*more|book\s*now|©|כל\s*הזכויות/i.test(s)) return false;
  return true;
}

/** Duration in minutes written next to a service ("60 דק׳", "45 min", "שעה וחצי"). */
export function durationOf(line: string): number | null {
  const m = line.match(/(\d{2,3})\s*(?:דק(?:ות|['׳])?|min(?:utes)?\b)/i);
  if (m) {
    const n = Number(m[1]);
    return n >= 10 && n <= 480 ? n : null;
  }
  if (/שעה\s*וחצי/.test(line)) return 90;
  if (/שעתיים/.test(line)) return 120;
  if (/\bשעה\b/.test(line)) return 60;
  return null;
}

export const serviceKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9א-ת]+/g, ' ').trim();
