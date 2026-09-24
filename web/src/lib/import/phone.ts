// Israeli phone numbers to E.164. Used by the import worker and the review screen.
// Accepts local (03-1234567, 050-1234567), international (+972 3 123 4567, 00972...) and
// the digits-only forms Google and websites use. Returns null for anything that is not a
// valid Israeli landline, mobile or VoIP number, so a wrong number never reaches a listing.

const LANDLINE = /^(2|3|4|8|9)\d{7}$/; // 02, 03, 04, 08, 09 + 7 digits
const MOBILE = /^5\d{8}$/; // 05X + 7 digits
const VOIP = /^7\d{8}$/; // 07X + 7 digits
const STAR_OR_1800 = /^1(700|800|599|801)\d{6}$/; // 1-700 / 1-800 national numbers

/** "+97231234567" or null. `raw` may contain spaces, dashes, dots and brackets. */
export function normalizeIlPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('972')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  if (LANDLINE.test(d) || MOBILE.test(d) || VOIP.test(d) || STAR_OR_1800.test(d)) return `+972${d}`;
  return null;
}

export const isMobile = (e164: string) => /^\+9725\d{8}$/.test(e164);

/** 050-123-4567 / 03-123-4567 for screens. */
export function formatIlPhone(e164: string): string {
  const d = '0' + e164.replace(/^\+972/, '');
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  return d;
}

/** Candidate phone strings in free text: 0X-XXXXXXX, 05X-XXX-XXXX, +972..., 1-700-... */
export function findPhones(text: string): string[] {
  const out = new Set<string>();
  const re = /(?:\+?972[\s.-]?|0)(?:[2-9]\d?)[\s.-]?\d{3}[\s.-]?\d{3,4}|1[\s.-]?(?:700|800|599)[\s.-]?\d{3}[\s.-]?\d{3}/g;
  for (const m of text.matchAll(re)) {
    const p = normalizeIlPhone(m[0]);
    if (p) out.add(p);
  }
  return [...out];
}
