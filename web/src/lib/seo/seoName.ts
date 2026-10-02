// Names and places as they go into <title>, meta descriptions and structured data. The stored business
// name is kept for display; the SEO name is the clean short form of it: no "| keywords" tails, no
// " - slogan" tails, no keyword lists, no second-script duplicate ("מספרת רון | Ron Hair Salon"), capped
// at about 35 characters on a word boundary.

export const SEO_NAME_MAX = 35;

const HEBREW = /[א-ת]/;
const LATIN = /[A-Za-z]/;

const hasBoth = (s: string) => HEBREW.test(s) && LATIN.test(s);
const words = (s: string) => s.split(/\s+/).filter(Boolean);

/** Cut at a word boundary so the result is at most `max` characters. */
export function capWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
  const at = cut.lastIndexOf(' ');
  return (at > max * 0.5 ? cut.slice(0, at) : s.slice(0, max)).replace(/[\s,:;·|/-]+$/u, '').trim();
}

/**
 * The name for titles and schema. Steps, in order: take the part before "|", " - ", " – ", " — " or " / ";
 * drop a keyword list (three or more comma-separated items keep only the first); when one script
 * duplicates the other, keep the Hebrew segment (the site is Hebrew); cap at SEO_NAME_MAX.
 */
export function seoName(raw: string, max = SEO_NAME_MAX): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return s;
  // "Name | keywords", "Name - slogan", "Name / city"
  const head = s.split(/\s*\|\s*|\s+[-–—]\s+|\s+\/\s+/u)[0].trim();
  if (head.length >= 3) s = head;
  // "Name, keyword, keyword, keyword"
  const parts = s.split(/\s*,\s*/);
  if (parts.length >= 3 && parts[0].length >= 3) s = parts[0];
  // "מספרת רון Ron Salon": two scripts spelling the same thing; keep the Hebrew one when it stands alone.
  if (hasBoth(s)) {
    const he = words(s).filter(w => HEBREW.test(w));
    const la = words(s).filter(w => LATIN.test(w) && !HEBREW.test(w));
    const heText = he.join(' ');
    const laText = la.join(' ');
    // A Hebrew brand with an English brand copy (both at least two words, or the two halves sit in
    // separate runs): keep the Hebrew. A single English brand word inside a Hebrew name stays.
    const separateRuns = new RegExp(`^(${he.map(escape).join('\\s+')})\\s+(${la.map(escape).join('\\s+')})$|^(${la.map(escape).join('\\s+')})\\s+(${he.map(escape).join('\\s+')})$`, 'u');
    if (he.length >= 2 && la.length >= 2 && separateRuns.test(s)) s = heText;
    else if (he.length >= 1 && la.length >= 2 && separateRuns.test(s) && laText.length >= heText.length) s = heText;
  }
  // "ד"ר" -> "ד״ר", "דק'" -> "דק׳" (Hebrew typography)
  s = s.replace(/([א-ת])"([א-ת])/gu, '$1״$2').replace(/([א-ת])'(?=\s|$)/gu, '$1׳');
  return capWords(s, max) || raw.slice(0, max);
}

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** City names for titles, meta and schema: the display name keeps its en dash (תל אביב–יפו), the SEO form uses a plain hyphen. */
export const seoCityName = (name: string) => name.replace(/–/g, '-');
