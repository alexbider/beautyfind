// Deterministic extraction of the profile-template facts that go beyond contact details: the people
// named on the site, official YouTube videos, languages the business says it speaks, the year it was
// established. No guessing: every fact carries the page URL and the line it came from. Anything that
// only a sentence implies (the site's own language, the number of cards on a team page) is not a fact.

import type { Fact } from './siteExtract';

export interface TeamMember {
  name: string;
  role: string;
  bio: string | null;
}

// Titles and roles that mark a person card. A line is a role when it is short and matches one of these.
const ROLE_WORDS =
  /(רופא(?:ה|ת|ים|ות)?\s*(?:עור|מומחה|מומחית|פלסטי|פלסטיקאי|שיניים|משפחה|בכיר|בכירה)?|מנהל(?:ת)?\s*רפואי(?:ת)?|אחות|אח\s+מוסמך|אחיות|קוסמטיקאי(?:ת|ות)?|קוסמטיקאית\s*רפואית|פרא[-־ ]?רפואית|אסתטיקאי(?:ת)?|מעצב(?:ת)?\s*(?:שיער|גבות|ציפורניים)|ספר(?:ית)?|מאפר(?:ת)?|מטפל(?:ת|ים|ות)?|טכנאי(?:ת)?|מנהל(?:ת)?\s*(?:הקליניקה|הסלון|המכון|המרפאה|קליניקה|סניף|צוות|שירות|מרפאה)?|בעל(?:ת|ים)?\s*(?:העסק|הסלון|הקליניקה|המכון)|מייסד(?:ת)?|מומח(?:ה|ית|ים)\s*(?:ל\S+)?|מדריכ(?:ה)?|פדיקוריסט(?:ית)?|מניקוריסט(?:ית)?|מנתח(?:ת|ים)?\s*(?:פלסטי|פלסטית|פלסטיקאי)?|כירורג(?:ית|ים)?\s*(?:פלסטי|פלסטית)?|פלסטיקאי(?:ת)?|מרדים(?:ה)?|דיאטנ(?:ית|אי)|תזונאי(?:ת)?|פיזיותרפיסט(?:ית)?|רוקח(?:ת)?|מזכיר(?:ה|ת)\s*(?:רפואית)?|רכז(?:ת)?\s*(?:טיפולים|לקוחות)?|nurse|doctor|physician|dermatologist|cosmetician|esthetician|aesthetician|stylist|therapist|manager|owner|founder|technician|surgeon|receptionist|coordinator|md|rn)/i;
const ROLE = new RegExp(`(?<![א-תA-Za-z])${ROLE_WORDS.source}(?![א-תA-Za-z])`, 'i');
const ROLE_START = new RegExp(`^${ROLE_WORDS.source}(?![א-תA-Za-z])`, 'i');
const TITLE = /^(ד["״]?ר|דר['׳]?|פרופ['׳]?|dr\.?|prof\.?)\s+/i;
const NAME_WORD = /^[א-תA-Za-z'׳"״.\-]{2,20}$/;
// A card whose "role" is a customer signature, or a name that is a menu label, is not staff.
const TESTIMONIAL = /(לקוח(?:ה|ות|ים)?|מטופל(?:ת|ים|ות)?|ממליצ|מרוצ|חוות\s*דעת|ביקורת|review|customer|client|patient)/i;
const NAV = /^(צור קשר|צרו קשר|אודות|הצוות|הצוות שלנו|שירותים|טיפולים|מחירון|גלריה|ראשי|בית|תפריט|home|about|contact|team|services|menu|our team)$/i;
// Words that never appear in a person's name: form labels, navigation, legal lines, treatments and body parts.
// A line with one of them is a label or a service, however name-like its shape ("שם מלא", "דלג לתוכן", "הזרקת בוטוקס").
const STOP = new Set([
  'מלא', 'מספר', 'טלפון', 'נייד', 'דואל', 'דוא"ל', 'אימייל', 'מייל', 'כתובת', 'הודעה', 'תוכן', 'הפנייה', 'הפניה', 'פנייה', 'פניה', 'שלח', 'שלחו', 'שליחה', 'אישור', 'ביטול',
  'דלג', 'לתוכן', 'קרא', 'קראו', 'עוד', 'לחץ', 'לחצו', 'כאן', 'הרשמה', 'התחברות', 'כניסה', 'חיפוש', 'תפריט', 'ניווט', 'עמוד', 'הבית', 'ראשי', 'הבא', 'הקודם', 'סגור', 'פתח',
  'כל', 'הזכויות', 'שמורות', 'מדיניות', 'פרטיות', 'תקנון', 'נגישות', 'הצהרת', 'תנאי', 'שימוש', 'עוגיות', 'קוקיז',
  'טיפול', 'טיפולי', 'טיפולים', 'הזרקת', 'הזרקות', 'הזרקה', 'בוטוקס', 'חומצה', 'היאלורונית', 'מילוי', 'מתיחת', 'הרמת', 'הסרת', 'עיצוב', 'ניתוח', 'ניתוחי', 'לייזר', 'פילינג', 'שיער', 'ציפורניים', 'גבות', 'ריסים', 'פנים', 'גוף', 'עור', 'שפתיים', 'אף', 'חזה', 'בטן', 'קמטים', 'צלוליטיס', 'שיזוף', 'מסאז', "מסאז'", 'עיסוי', 'ייעוץ', 'יעוץ', 'מחיר', 'מחירים', 'מחירון', 'מבצע', 'מבצעים', 'הנחה', 'חבילה', 'חבילת', 'שעות', 'פעילות', 'לפני', 'אחרי', 'ביקורות', 'המלצות', 'שאלות', 'תשובות', 'נפוצות', 'גלריה', 'תמונות', 'סרטון', 'סרטונים', 'אודות', 'אודותינו', 'סניף', 'סניפים', 'מיקום', 'הגעה', 'קביעת', 'תור', 'תורים', 'זימון', 'הזמנת', 'הזמנה',
  'name', 'full', 'phone', 'email', 'message', 'send', 'submit', 'skip', 'content', 'read', 'more', 'click', 'here', 'login', 'search', 'menu', 'home', 'next', 'prev', 'close', 'open', 'privacy', 'policy', 'terms', 'cookies', 'treatment', 'treatments', 'botox', 'filler', 'fillers', 'laser', 'peeling', 'hair', 'nails', 'face', 'body', 'lips', 'prices', 'price', 'gallery', 'before', 'after', 'reviews', 'faq', 'booking', 'book',
]);
const stopWord = (w: string) => STOP.has(w.replace(/["״'׳.,]/g, '').toLowerCase());
// A name and its role on one line: "ד"ר יעל לוינסון - מנהלת רפואית", "נועה בן דוד | אחות", "רונית, קוסמטיקאית".
const SPLIT = /\s+[-–—|·]\s+|,\s+|:\s+/;

/** A short line of two to four name-like words, optionally with a title, no digits and no verbs of a sentence. */
export function looksLikeName(line: string): boolean {
  const s = line.trim().replace(/[,:]+$/, '');
  if (s.length < 3 || s.length > 45 || /\d|@|https?:|₪|\?|!|["״]$/.test(s)) return false;
  const words = s.replace(TITLE, '').split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 4) return false;
  if (words.length === 1 && !TITLE.test(s)) return false;
  if (!words.every(w => NAME_WORD.test(w.replace(/,$/, '')))) return false;
  // A role ("מנהלת רפואית", "קוסמטיקאית"), a navigation label or a form label is not a person's name.
  if (ROLE.test(s.replace(TITLE, ''))) return false;
  if (NAV.test(s) || words.some(stopWord)) return false;
  return true;
}

/** A line that carries a person's name itself ("ד"ר תמיר גיל: מומחה לכירורגיה פלסטית") is its own card and never the role of a neighbouring line. */
const hasOwnName = (line: string): boolean => {
  if (/(^|[\s(])(ד["״]?ר|דר['׳]|פרופ['׳]?|dr\.?|prof\.?)\s+[א-תA-Za-z]/i.test(line)) return true;
  const parts = line.split(SPLIT).map(x => x.trim()).filter(Boolean);
  return parts.length === 2 && (looksLikeName(parts[0]) || looksLikeName(parts[1]));
};

/**
 * Quality gate for stored team entries (from the site, from research, or written earlier by an older
 * reader): a person needs a name that passes the same checks as extraction and a role that names a
 * role. Anything else is dropped, so a form label or a treatment never reaches a profile.
 */
export function cleanTeam<T extends { name?: unknown; role?: unknown }>(items: unknown): T[] {
  if (!Array.isArray(items)) return [];
  const out: T[] = [];
  const seen = new Set<string>();
  for (const it of items as T[]) {
    if (!it || typeof it !== 'object') continue;
    const name = typeof it.name === 'string' ? it.name.trim() : '';
    const role = typeof it.role === 'string' ? it.role.trim() : '';
    if (!looksLikeName(name) || !isRoleLine(role) || hasOwnName(role)) continue;
    const key = norm(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out.slice(0, 12);
}

// A role line: short, names a role, no digits or prices, not a sentence. A line that starts with a role
// may run longer ("מנתח פלסטי מומחה, חבר האיגוד הישראלי לכירורגיה פלסטית").
const isRoleLine = (line: string) => {
  const s = line.trim().replace(/\b(dr|prof|md)\./gi, '$1');
  if (!s || s.length > 90 || /\d|₪|@|https?:|[.!?]/.test(s) || TESTIMONIAL.test(s)) return false;
  if (!ROLE.test(s)) return false;
  const words = s.split(/\s+/).length;
  return words <= 8 || (words <= 12 && ROLE_START.test(s));
};
const isBio = (line: string) => line.length >= 30 && line.length <= 600 && /[.!]/.test(line);

/** The role phrase at the start of a biography ("ד"ר גוברין הוא מנתח פלסטי בכיר, בוגר..." gives "מנתח פלסטי בכיר"). */
function roleFromBio(bio: string): string | null {
  const head = bio.slice(0, 140);
  const m = ROLE.exec(head);
  if (!m || m.index > 100) return null;
  const rest = head.slice(m.index).split(/[,.;:()\n]|\s+(?:עם|של|מאז|בעל|בעלת|בוגר|בוגרת|אשר|המתמחה|שמתמחה|ומנהל|ומנהלת)\s/)[0].trim();
  const role = rest.split(/\s+/).slice(0, 4).join(' ');
  return role.length >= 3 && role.length <= 45 ? role : null;
}

const norm = (s: string) => s.replace(TITLE, '').replace(/["״'׳]/g, '').toLowerCase().trim();

/**
 * People named on a page as "name + role" cards (name then role, role then name, both on one line, or a
 * name followed by a biography that opens with the role), with the paragraph under them as the
 * biography. Only pages that look like a team page or that carry two or more such cards count, so a
 * single testimonial signature is not a staff member. The business's own name is never a person.
 */
export function teamFrom(text: string, url: string, opts: { teamPage?: boolean; siteName?: string | null } = {}): Fact<TeamMember>[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const out: Fact<TeamMember>[] = [];
  const seen = new Set<string>();
  const site = opts.siteName ? norm(opts.siteName) : null;
  const push = (name: string, role: string, bioLine: string | undefined, evidence: string) => {
    const key = norm(name);
    if (seen.has(key) || (site && site === key)) return false;
    const bio = bioLine && isBio(bioLine) && !looksLikeName(bioLine) && !isRoleLine(bioLine) ? bioLine.slice(0, 500) : null;
    seen.add(key);
    out.push({ value: { name: name.replace(/[,:]+$/, '').trim(), role: role.replace(/[,:]+$/, '').trim(), bio }, url, evidence: evidence.slice(0, 200) });
    return true;
  };
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i];
    const b = lines[i + 1] ?? '';
    const prev = lines[i - 1] ?? '';
    // A quoted line before the name is a testimonial, not a card.
    if (/^["״“]/.test(prev) || /["״”]$/.test(prev)) continue;
    // Name and role on one line.
    const parts = a.length <= 70 && !/[.!?]/.test(a) ? a.split(SPLIT).map(x => x.trim()).filter(Boolean) : [];
    if (parts.length === 2) {
      const [x, y] = parts;
      if (looksLikeName(x) && isRoleLine(y) && !looksLikeName(y)) {
        if (push(x, y, b, a)) continue;
      } else if (isRoleLine(x) && !looksLikeName(x) && looksLikeName(y)) {
        if (push(y, x, b, a)) continue;
      }
    }
    if (!b) continue;
    if (looksLikeName(a) && isRoleLine(b) && !looksLikeName(b) && !hasOwnName(b)) {
      if (push(a, b, lines[i + 2], `${a} | ${b}`)) i++;
    } else if (isRoleLine(a) && !looksLikeName(a) && !hasOwnName(a) && looksLikeName(b)) {
      if (push(b, a, lines[i + 2], `${a} | ${b}`)) i++;
    } else if (looksLikeName(a) && isBio(b) && !TESTIMONIAL.test(b.slice(0, 60))) {
      // "ד"ר יוסי גוברין" then "ד"ר גוברין הוא מנתח פלסטי בכיר, ...": the biography names the role.
      const role = roleFromBio(b);
      if (role && push(a, role, b, `${a} | ${b.slice(0, 80)}`)) i++;
    }
  }
  if (!opts.teamPage && out.length < 2) return [];
  return out.slice(0, 12);
}

// ---------- YouTube ----------

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const YT_VIDEO = /(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?(?:[^"'\s]*&)?v=|shorts\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/gi;
const YT_CHANNEL = /https?:\/\/(?:www\.|m\.)?youtube\.com\/(@[A-Za-z0-9._-]{3,60}|channel\/UC[A-Za-z0-9_-]{20,30}|c\/[A-Za-z0-9._-]{2,60}|user\/[A-Za-z0-9._-]{2,60})/gi;

export interface VideoCandidate {
  id: string;
  how: 'embed' | 'link';
}

/** YouTube video ids embedded or linked on a page, and channel links. Other hosts are not embedded. */
export function videosFrom(html: string, url: string): { videos: Fact<VideoCandidate>[]; channels: Fact[] } {
  const videos: Fact<VideoCandidate>[] = [];
  const channels: Fact[] = [];
  for (const m of html.matchAll(YT_VIDEO)) {
    const id = m[1];
    if (!YT_ID.test(id) || videos.some(v => v.value.id === id)) continue;
    const how = /embed\//.test(m[0]) ? 'embed' : 'link';
    videos.push({ value: { id, how }, url, evidence: m[0].slice(0, 120) });
  }
  for (const m of html.matchAll(YT_CHANNEL)) {
    const href = `https://www.youtube.com/${m[1]}`;
    if (!channels.some(c => c.value === href)) channels.push({ value: href, url, evidence: m[0].slice(0, 120) });
  }
  return { videos: videos.slice(0, 20), channels: channels.slice(0, 3) };
}

// ---------- Languages ----------

const LANGS: Array<[RegExp, string]> = [
  [/עברית|hebrew/i, 'עברית'],
  [/אנגלית|english/i, 'אנגלית'],
  [/רוסית|russian/i, 'רוסית'],
  [/ערבית|arabic/i, 'ערבית'],
  [/צרפתית|french/i, 'צרפתית'],
  [/ספרדית|spanish/i, 'ספרדית'],
  [/אמהרית|amharic/i, 'אמהרית'],
  [/אוקראינית|ukrainian/i, 'אוקראינית'],
  [/פורטוגזית|portuguese/i, 'פורטוגזית'],
  [/גרמנית|german/i, 'גרמנית'],
  [/איטלקית|italian/i, 'איטלקית'],
  [/יידיש|yiddish/i, 'יידיש'],
  [/פרסית|farsi|persian/i, 'פרסית'],
];
const LANG_TRIGGER = /(דובר(?:ת|ים|ות)?|שפות|שירות\s*ב|מדברים|מדברת|מדבר|we\s*speak|languages?\s*(?:spoken)?:?|speaks?\b)/i;

/**
 * Languages the business explicitly says it speaks ("דוברות רוסית ואנגלית", "שירות בעברית, אנגלית וערבית",
 * "we speak English"). The language the site is written in is never used.
 */
export function languagesFrom(text: string, url: string): Fact<string[]> | null {
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length > 200 || !LANG_TRIGGER.test(line)) continue;
    const found = LANGS.filter(([re]) => re.test(line)).map(([, name]) => name);
    if (found.length === 0) continue;
    // "דוברי X" needs the language word right after the trigger, so a sentence about English lessons does not count.
    const t = line.match(LANG_TRIGGER)!;
    const after = line.slice((t.index ?? 0) + t[0].length, (t.index ?? 0) + t[0].length + 90);
    const near = LANGS.filter(([re]) => re.test(after)).map(([, name]) => name);
    if (near.length === 0) continue;
    return { value: [...new Set(near)], url, evidence: line.slice(0, 200) };
  }
  return null;
}

// ---------- Established year ----------

const EST = /(?:מאז|החל\s*מ[-־]?|נוסד(?:ה|ו)?\s*ב[-־]?|הוקם(?:ה|ו)?\s*ב[-־]?|פועל(?:ת|ים|ות)?\s*(?:מאז|מ[-־]|משנת)|משנת|בשנת|since|established\s*(?:in)?|founded\s*(?:in)?|est\.?)\s*((?:19|20)\d{2})(?!\d)/i;

/** The year the business says it started ("פועלת מאז 2014", "since 2009"). Years of experience are not a founding year. */
export function establishedFrom(text: string, url: string, now = new Date()): Fact<number> | null {
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length > 240) continue;
    const m = line.match(EST);
    if (!m) continue;
    const year = Number(m[1]);
    if (year < 1900 || year > now.getFullYear()) continue;
    // "נוסדה ב־2014 חברת X" on a supplier page is still about this site; a date of a blog post is not.
    if (/פורסם|posted|published|תאריך|עודכן|updated/i.test(line)) continue;
    return { value: year, url, evidence: line.slice(0, 200) };
  }
  return null;
}

// ---------- Before/after candidates ----------

export const BEFORE_AFTER_HINT = /לפני\s*(ו|-|–)?\s*אחרי|before\s*(and|&|\/|-)?\s*after|תוצאות\s*טיפול/i;
