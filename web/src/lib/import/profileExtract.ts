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
  /(רופא(?:ה|ת)?\s*(?:עור|מומחה|מומחית|פלסטי|פלסטיקאי)?|מנהל(?:ת)?\s*רפואי(?:ת)?|אחות|אח\s+מוסמך|קוסמטיקאי(?:ת)?|קוסמטיקאית\s*רפואית|פרא[-־ ]?רפואית|מעצב(?:ת)?\s*(?:שיער|גבות|ציפורניים)|ספר(?:ית)?|מאפר(?:ת)?|מטפל(?:ת)?|טכנאי(?:ת)?|מנהל(?:ת)?\s*(?:הקליניקה|הסלון|המכון|קליניקה|סניף)?|בעל(?:ת|ים)?\s*(?:העסק|הסלון|הקליניקה)|מייסד(?:ת)?|מומחה|מומחית|מדריכ(?:ה)?|פדיקוריסט(?:ית)?|מניקוריסט(?:ית)?|מנתח(?:ת)?|רופא\s*שיניים|nurse|doctor|physician|dermatologist|cosmetician|esthetician|stylist|therapist|manager|owner|founder|technician|surgeon|md|rn)/i;
const TITLE = /^(ד["״]?ר|דר['׳]?|פרופ['׳]?|dr\.?|prof\.?)\s+/i;
const NAME_WORD = /^[א-תA-Za-z'׳"״.\-]{2,20}$/;

/** A short line of two to four name-like words, optionally with a title, no digits and no verbs of a sentence. */
export function looksLikeName(line: string): boolean {
  const s = line.trim().replace(/[,:]+$/, '');
  if (s.length < 3 || s.length > 45 || /\d|@|https?:|₪|\?|!/.test(s)) return false;
  const words = s.replace(TITLE, '').split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 4) return false;
  if (words.length === 1 && !TITLE.test(s)) return false;
  if (!words.every(w => NAME_WORD.test(w.replace(/,$/, '')))) return false;
  // A role ("מנהלת רפואית", "קוסמטיקאית") or a navigation label is not a person's name.
  if (ROLE_WORDS.test(s.replace(TITLE, ''))) return false;
  if (/^(צור קשר|אודות|הצוות|שירותים|טיפולים|מחירון|גלריה|ראשי|בית|תפריט|home|about|contact|team|services|menu)$/i.test(s)) return false;
  return true;
}

const isRoleLine = (line: string) => line.trim().length <= 60 && ROLE_WORDS.test(line) && !/[.!?]\s*\S/.test(line.trim()) && line.split(/\s+/).length <= 8;
const isBio = (line: string) => line.length >= 30 && line.length <= 600 && /[.!]/.test(line);

/**
 * People named on a page as "name + role" cards (name then role, or role then name), with the
 * paragraph under them as the biography. Only pages that look like a team page or that carry two or
 * more such cards count, so a single testimonial signature is not a staff member.
 */
export function teamFrom(text: string, url: string, opts: { teamPage?: boolean } = {}): Fact<TeamMember>[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const out: Fact<TeamMember>[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i];
    const b = lines[i + 1];
    let name: string | null = null;
    let role: string | null = null;
    if (looksLikeName(a) && isRoleLine(b) && !looksLikeName(b)) {
      name = a;
      role = b;
    } else if (isRoleLine(a) && !looksLikeName(a) && looksLikeName(b)) {
      role = a;
      name = b;
    } else continue;
    const key = name.replace(TITLE, '').toLowerCase();
    if (seen.has(key)) continue;
    const bioLine = lines[i + 2];
    const bio = bioLine && isBio(bioLine) && !looksLikeName(bioLine) && !isRoleLine(bioLine) ? bioLine.slice(0, 500) : null;
    seen.add(key);
    out.push({ value: { name: name.replace(/[,:]+$/, ''), role: role.replace(/[,:]+$/, ''), bio }, url, evidence: `${name} | ${role}`.slice(0, 200) });
    i++;
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
