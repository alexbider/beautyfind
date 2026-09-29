// Text from providers and websites can carry what JSON and Postgres refuse: a lone UTF-16 surrogate
// (an emoji cut in half by a character-count truncation), NUL and other control characters. A lone
// surrogate makes the database driver fail the whole write ("unexpected end of hex escape"), so every
// string is cleaned before it is stored, and truncation counts code points, never UTF-16 units.

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
// C0 controls except tab, newline and carriage return; C1 controls; NUL.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** A string safe for JSON and Postgres: no lone surrogates, no control characters. */
export function cleanText(s: string): string {
  return s.replace(LONE_SURROGATE, '').replace(CONTROL, '');
}

/** The first `max` characters, counted in code points, so an emoji is kept whole or dropped whole. */
export function cutText(s: string, max: number): string {
  const chars = Array.from(cleanText(s));
  return chars.length <= max ? chars.join('') : chars.slice(0, max).join('');
}

/** Cleans every string inside a JSON-like value (objects, arrays), leaving other types as they are. */
export function cleanDeep<T>(value: T): T {
  if (typeof value === 'string') return cleanText(value) as T;
  if (Array.isArray(value)) return value.map(cleanDeep) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = cleanDeep(v);
    return out as T;
  }
  return value;
}
