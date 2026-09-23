// Hebrew-aware text matching for client-side search.
// Strips niqqud and cantillation, folds final letters (ך→כ, ם→מ, ן→נ, ף→פ, ץ→צ), drops
// geresh/gershayim and quotes (so "מעמ" finds "מע״מ"), and treats maqaf and punctuation as spaces.

const MARKS = /[֑-ׇֽֿׁׂׅׄ̀-ͯ]/g;
const FINALS: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const QUOTES = /[״׳"'`’‘”“]/g;
const SEPARATORS = new RegExp('[\\u05BE\\u05C0\\u05C3\\u05C6\\u2013\\u2014\\-_.,:;!?()[\\]{}/\\\\|+*=<>#%&@~^]+', 'g');

export function normalizeHe(s: string): string {
  return s
    .normalize('NFKD')
    .replace(MARKS, '')
    .replace(/[ךםןףץ]/g, ch => FINALS[ch])
    .replace(QUOTES, '')
    .replace(SEPARATORS, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every word of the query must appear somewhere in the text (any order). */
export function matchesQuery(normalizedText: string, query: string): boolean {
  const q = normalizeHe(query);
  if (!q) return true;
  return q.split(' ').every(t => normalizedText.includes(t));
}
