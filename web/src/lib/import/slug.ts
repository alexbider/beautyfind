// Listing addresses: a readable slug from the business name. A Latin name becomes "ehud-elbaz-beauty-salon";
// a Hebrew name keeps its Hebrew letters ("סלון-יופי-אהוד-אלבז"), which browsers show as typed and search
// engines index well. No random suffix: uniqueness is handled by the caller (city, then a counter).

const NOISE = /^(the|a|an|בית|של)$/i;

export function slugBase(name: string, fallback: string): string {
  const latin = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w && !NOISE.test(w))
    .join('-');
  if (latin.replace(/-/g, '').length >= 4) return latin.slice(0, 60).replace(/-+$/, '');
  const hebrew = name
    .replace(/[֑-ׇ]/g, '') // niqqud and cantillation
    .replace(/["'״׳]/g, '') // ד"ר stays one word
    .replace(/[.,;:()[\]{}!?|/\\]/g, ' ')
    .replace(/[^א-ת0-9a-zA-Z\s-]/g, ' ')
    .trim()
    .split(/[\s-]+/)
    .filter(w => w && !NOISE.test(w))
    .join('-')
    .toLowerCase();
  return hebrew.replace(/-/g, '').length >= 2 ? hebrew.slice(0, 60).replace(/-+$/, '') : fallback;
}

/** The candidates to try in order: the base, then with the city, then numbered. */
export function slugCandidates(base: string, city: string | null): string[] {
  const out = [base];
  if (city) out.push(`${base}-${city}`);
  for (let i = 2; i <= 9; i++) out.push(`${base}-${i}`);
  return out;
}
