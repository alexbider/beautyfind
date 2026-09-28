// Which of a business's images deserve the profile: pure scoring and duplicate detection, used by the
// copy step (src/lib/server/importMedia.ts). A photo of the place beats a decorative graphic, a larger
// and sharper file beats a smaller one, and the same picture under two URLs or two sizes counts once.
//
// Signals come from the file itself (pixel size, bytes, alpha channel) and, when sharp is available,
// from its statistics: entropy (bits per pixel; flat graphics and logos sit near 0 to 4, photographs
// near 6 to 8) and a perceptual difference hash for near-duplicates (resized, re-encoded, lightly
// cropped copies of one photo).

export interface ImageSignals {
  url: string;
  alt?: string | null;
  provider?: string | null; // website | google_profile | google_post | instagram | facebook | owner
  width: number;
  height: number;
  bytes: number; // original file size
  hasAlpha?: boolean | null;
  entropy?: number | null; // 0..8
  sharpness?: number | null;
}

// Filenames and alt texts of images that are not photos of the business: backgrounds, patterns, badges,
// certificates, maps, icons, arrows, dividers, screenshots, stock decoration.
const DECORATIVE = /(^|[\/_\-.])(bg|background|backgrounds|pattern|texture|overlay|shape|shapes|decor|deco|ornament|stars?|badge|award|certificate|diploma|map|qr|icon|icons|logo|screenshot|screen|divider|separator|arrow|frame|border|watermark|stock|placeholder|default|noimage|no-image|blank|mask|gradient|noise|dots|wave|waves|swirl|blob|bubble|sparkle|glitter|confetti|ribbon|seal|stamp|sticker|emoji)([\/_\-.]|$|\d)/i;
const DECORATIVE_ALT = /(רקע|עיטור|תעודה|הסמכה|פרס|מפה|לוגו|אייקון|סמל|תבנית|background|pattern|certificate|award|badge|logo|icon|map|decoration)/i;

/** Filename or alt text says this is decoration, a certificate, a map or an icon, not a photo of the place. */
export function decorativeHint(url: string, alt?: string | null): boolean {
  let path = url;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    /* keep the raw string */
  }
  const file = path.split('/').pop() ?? path;
  return DECORATIVE.test(file) || (!!alt && DECORATIVE_ALT.test(alt));
}

/**
 * One key per picture regardless of the size variant: WordPress "-300x200", "-scaled", Wix and Google
 * sizing parameters, cache-busting queries. Two URLs with the same key are the same picture.
 */
export function canonicalImageUrl(url: string): string {
  try {
    const u = new URL(url);
    let path = u.pathname
      .replace(/-\d{2,4}x\d{2,4}(?=\.[a-z0-9]+$)/i, '') // WordPress size suffix
      .replace(/-scaled(?=\.[a-z0-9]+$)/i, '')
      .replace(/@\dx(?=\.[a-z0-9]+$)/i, '') // retina suffix
      .replace(/\/v1\/(?:fill|fit|crop)\/[^/]+\//i, '/') // Wix static transforms
      .replace(/=(?:w|h|s)\d+(?:-[a-z0-9]+)*$/i, ''); // Google user content sizing
    path = path.toLowerCase();
    return `${u.hostname.toLowerCase()}${path}`;
  } catch {
    return url.toLowerCase();
  }
}

/** True when the variant is the plain file (no size suffix), which is the one to fetch first. */
export const isPlainVariant = (url: string): boolean => {
  try {
    return !/-\d{2,4}x\d{2,4}\.[a-z0-9]+$|-scaled\.[a-z0-9]+$|@\dx\.[a-z0-9]+$/i.test(new URL(url).pathname) && !/=[whs]\d+/i.test(url);
  } catch {
    return true;
  }
};

/**
 * 0 to 100. Photographs of a reasonable size score above 55; flat graphics, tiny or very thin files
 * score low. Without sharp (no entropy) the score rests on size and the filename.
 */
export function photoScore(s: ImageSignals): number {
  const area = Math.max(1, s.width * s.height);
  const size = Math.max(0, Math.min(1, Math.log2(area / (480 * 320)) / 4)); // 1 at about 2500x1600
  const ratio = s.width / Math.max(1, s.height);
  const shape = ratio >= 1.15 && ratio <= 2.2 ? 1 : ratio > 2.6 || ratio < 0.6 ? 0.2 : 0.7;
  const bpp = s.bytes / area; // bytes per pixel of the original: a flat graphic compresses far below a photo
  const density = bpp >= 0.12 ? 1 : bpp >= 0.05 ? 0.7 : bpp >= 0.02 ? 0.35 : 0;
  const entropy = s.entropy == null ? 0.65 : Math.max(0, Math.min(1, (s.entropy - 3) / 4.5)); // 3 bits gives 0, 7.5 gives 1
  let score = 0.35 * size + 0.35 * entropy + 0.15 * density + 0.15 * shape;
  if (s.hasAlpha) score -= 0.25; // transparency means a cut-out, logo or graphic
  if (decorativeHint(s.url, s.alt)) score -= 0.5;
  if (s.provider === 'google_profile' || s.provider === 'google_post') score += 0.08; // photos the business put on its Google profile
  if (s.sharpness != null && s.sharpness < 0.3) score -= 0.1; // very blurry
  return Math.round(Math.max(0, Math.min(1, score)) * 100);
}

/**
 * Whether a photo may reach a profile at all. Strict (production): no decoration, no transparency, no
 * flat graphic (entropy under 4.5 when known), score at least 40. Lenient (tests and the simulated
 * pilot, whose fixture images are flat colours): only the size rules of imageInfo.usable apply.
 */
export function acceptPhoto(s: ImageSignals, strict = true): boolean {
  if (!strict) return true;
  if (decorativeHint(s.url, s.alt)) return false;
  if (s.hasAlpha) return false;
  if (s.entropy != null && s.entropy < 4.5) return false;
  return photoScore(s) >= 40;
}

/** Difference hash of a 9x8 greyscale thumbnail (72 values, row-major): 64 bits as a hex string. */
export function dhash(gray: ArrayLike<number>): string {
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += gray[y * 9 + x] < gray[y * 9 + x + 1] ? '1' : '0';
  return BigInt(`0b${bits}`).toString(16).padStart(16, '0');
}

/** Bits that differ between two hashes; 0 to 6 is the same picture in practice. */
export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

export const NEAR_DUPLICATE = 6;

/** Orders candidates so the plain file comes before its size variants, and drops repeats of one picture. */
export function dedupeVariants(urls: string[]): string[] {
  const byKey = new Map<string, string>();
  for (const u of urls) {
    const k = canonicalImageUrl(u);
    const cur = byKey.get(k);
    if (!cur || (!isPlainVariant(cur) && isPlainVariant(u))) byKey.set(k, u);
  }
  return [...byKey.values()];
}
