// Israeli phone numbers to E.164 with libphonenumber-js (country IL). The original string is always
// kept by the caller (phoneRaw); this only produces the normalized matching/display value.
// Returns null for anything that is not a valid Israeli number, so a wrong number never reaches a
// listing. A mobile number is never assumed to be on WhatsApp.

// Validity uses the pattern-based (min) metadata: the "max" metadata also checks allocated number
// blocks, which lag real allocations and rejected real numbers such as 050-123-xxxx. "max" is kept only
// for the number type (mobile or landline).
import { parsePhoneNumberFromString as parseMin, findPhoneNumbersInText } from 'libphonenumber-js/min';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

// 1-700 / 1-800 national numbers, which some metadata versions do not validate.
const NATIONAL_SPECIAL = /^1(700|800|599|801)\d{6}$/;

/** "+97231234567" or null. `raw` may contain spaces, dashes, dots, brackets and the +972/00972 prefix. */
export function normalizeIlPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, '');
  const bare = digits.replace(/^\+?(00)?972/, '').replace(/^0/, '');
  if (NATIONAL_SPECIAL.test(bare)) return `+972${bare}`;
  // "00972..." is the international prefix written out; libphonenumber reads it only as "+972".
  const p = parseMin(raw.trim().replace(/^00\s*-?\s*972/, '+972'), 'IL');
  if (!p || p.country !== 'IL' || !p.isValid()) return null;
  return p.number;
}

export function isMobile(e164: string): boolean {
  const p = parsePhoneNumberFromString(e164, 'IL');
  return p?.getType() === 'MOBILE';
}

/** 050-123-4567 / 03-123-4567 for screens. */
export function formatIlPhone(e164: string): string {
  const d = '0' + e164.replace(/^\+972/, '');
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  return d;
}

/** Valid Israeli numbers written in free text. */
export function findPhones(text: string): string[] {
  const out = new Set<string>();
  for (const m of findPhoneNumbersInText(text, 'IL')) {
    if (m.number.country === 'IL' && m.number.isValid()) out.add(m.number.number);
  }
  return [...out];
}
