// The "about" preview: how many words show before "קראו עוד". Pure, so the profile tests can cover it.

export const ABOUT_PREVIEW_WORDS = 250;

/**
 * Splits paragraphs at a word budget: the head holds the first `limit` words (the paragraph that
 * crosses the line is cut mid-way, at a word boundary), the tail holds the rest. A text within the
 * budget has an empty tail.
 */
export function splitAtWords(paragraphs: string[], limit = ABOUT_PREVIEW_WORDS): { head: string[]; tail: string[] } {
  const total = paragraphs.reduce((n, p) => n + p.split(/\s+/).filter(Boolean).length, 0);
  if (total <= limit) return { head: paragraphs, tail: [] };
  const head: string[] = [];
  const tail: string[] = [];
  let used = 0;
  for (const p of paragraphs) {
    const words = p.split(/\s+/).filter(Boolean);
    if (tail.length > 0 || used >= limit) {
      tail.push(p);
      continue;
    }
    if (used + words.length <= limit) {
      head.push(p);
      used += words.length;
      continue;
    }
    const cut = limit - used;
    head.push(words.slice(0, cut).join(' '));
    tail.push(words.slice(cut).join(' '));
    used = limit;
  }
  return { head, tail };
}
