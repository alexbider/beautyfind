import { seoCityName, seoName } from '@/lib/seo/seoName';
import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { imageInfo, usable } from '@/lib/import/imageInfo';
import { acceptPhoto, dedupeVariants, dhash, hamming, logoScore, NEAR_DUPLICATE, photoScore, type ImageSignals } from '@/lib/import/imageQuality';
import { safeFetch } from '@/lib/import/safeFetch';
import { db } from '@/lib/server/db';
import { storage } from '@/lib/vendors/storage';

// Copies the logo and photos chosen for a listing into our storage, so the listing never hotlinks a
// third-party site. Every download goes through safeFetch (SSRF-safe, size capped) and must be a real
// JPEG, PNG or WebP of a usable size. Each copy keeps a provenance record: where it came from, when,
// its dimensions and hash (duplicates are dropped by hash, near-duplicates by a perceptual hash, size
// variants by URL), and the reuse basis. Photos are scored (src/lib/import/imageQuality.ts): the cover is
// the best landscape photograph, the gallery follows by score, and decoration never gets in. Derivatives: the served
// file is a WebP (orientation corrected, metadata stripped, banner up to 1600px and gallery up to 1200px
// wide) when sharp is available; the safe original is kept privately next to it.

const MAX_BYTES = 8 * 1024 * 1024;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
const WIDTH = { banner: 1600, photo: 1200, logo: 512, poster: 640 } as const;
const TARGET_BYTES = { banner: 350_000, photo: 160_000, logo: 120_000, poster: 60_000 } as const;

export interface MediaProvenance {
  url: string; // our /media/... URL of the served derivative
  originalKey: string | null; // storage key of the safe original (private)
  kind: 'logo' | 'cover' | 'gallery';
  sourceUrl: string; // asset URL on the source
  pageUrl: string | null; // page or profile it was found on
  provider: 'website' | 'google_profile' | 'google_post' | 'instagram' | 'facebook' | 'owner';
  retrievedAt: string;
  width: number;
  height: number;
  bytes: number;
  hash: string; // sha256 of the original bytes
  alt: string;
  // Reuse basis. Public accessibility alone is not permission: these are the business's own published
  // materials about itself, kept until the owner replaces them.
  reuse: 'business_published' | 'owner_upload';
  status: 'approved' | 'pending_owner';
  derivative: 'webp' | 'original';
  score?: number; // photo quality score at copy time (imageQuality.photoScore)
  dhash?: string; // perceptual hash, for near-duplicate detection
}

export interface Candidate {
  url: string;
  pageUrl?: string | null;
  provider?: MediaProvenance['provider'];
  alt?: string | null; // alt text on the source, when it is descriptive
  rank?: number; // position among logo candidates (source order), a tiebreaker in logoScore
}

type Sharp = typeof import('sharp').default;
let sharpMod: Promise<Sharp | null> | null = null;
function sharp(): Promise<Sharp | null> {
  sharpMod ??= import('sharp').then(m => (m.default ?? m) as unknown as Sharp).catch(() => null);
  return sharpMod;
}

const derivativesOn = () => process.env.IMPORT_IMAGE_DERIVATIVES !== '0';
// Strict photo quality (decoration, transparency and flat graphics rejected) is the default; tests and the
// simulated pilot use flat fixture images and turn it off.
const strictQuality = () => process.env.IMPORT_IMAGE_QUALITY !== '0';

/** Entropy, sharpness, alpha and a perceptual hash from sharp; null fields when sharp is unavailable. */
export async function photoSignals(bytes: Buffer): Promise<{ entropy: number | null; sharpness: number | null; hasAlpha: boolean | null; dhash: string | null }> {
  const s = await sharp();
  if (!s) return { entropy: null, sharpness: null, hasAlpha: null, dhash: null };
  try {
    const img = s(bytes, { failOn: 'error', limitInputPixels: 40_000_000 });
    const [meta, stats, thumb] = await Promise.all([
      img.clone().metadata(),
      img.clone().stats(),
      img.clone().rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer(),
    ]);
    // An alpha channel that is fully opaque is not transparency.
    const hasAlpha = !!meta.hasAlpha && !stats.isOpaque;
    return { entropy: stats.entropy, sharpness: stats.sharpness, hasAlpha, dhash: thumb.length >= 72 ? dhash(thumb) : null };
  } catch {
    return { entropy: null, sharpness: null, hasAlpha: null, dhash: null };
  }
}

async function derive(bytes: Buffer, as: keyof typeof WIDTH): Promise<{ bytes: Buffer; mime: 'image/webp'; width: number; height: number } | null> {
  const s = await sharp();
  if (!s || !derivativesOn()) return null;
  try {
    let quality = 80;
    for (;;) {
      const img = s(bytes, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate().resize({ width: WIDTH[as], withoutEnlargement: true, fit: 'inside' });
      const out = await img.webp({ quality, effort: 4 }).toBuffer({ resolveWithObject: true });
      if (out.data.length <= TARGET_BYTES[as] || quality <= 60) return { bytes: out.data, mime: 'image/webp', width: out.info.width, height: out.info.height };
      quality -= 10;
    }
  } catch {
    return null;
  }
}

async function fetchImage(url: string): Promise<{ bytes: Buffer; info: NonNullable<ReturnType<typeof imageInfo>> } | null> {
  try {
    const r = await safeFetch(url, {
      timeoutMs: 10_000,
      maxBytes: MAX_BYTES,
      headers: { 'User-Agent': 'BeautyFindBot/1.0 (+https://beautyfind.co.il/bot)', Accept: 'image/webp,image/jpeg,image/png' },
      allowPrivate: process.env.IMPORT_TEST_ALLOW_PRIVATE === '1',
    });
    if (r.status !== 200 || r.truncated) return null;
    const info = imageInfo(r.bytes);
    return info ? { bytes: r.bytes, info } : null;
  } catch {
    return null;
  }
}

async function store(bytes: Buffer, mime: keyof typeof EXT, ownerId: string, businessId: string, alt: string, isPrivate = false): Promise<{ url: string; key: string; id: string }> {
  const key = `${isPrivate ? 'orig' : 'public'}/${randomUUID()}.${EXT[mime]}`;
  await storage().put(key, bytes, mime);
  const row = await db.mediaFile.create({ data: { ownerId, businessId, key, mime, bytes: bytes.length, alt, isPrivate } });
  return { url: `/media/${row.id}`, key, id: row.id };
}

type Seen = { hashes: Set<string>; dhashes: string[] };

async function copyOne(c: Candidate, as: 'logo' | 'photo', ownerId: string, businessId: string, alt: string, seen: Seen): Promise<{ url: string; score: number; prov: Omit<MediaProvenance, 'kind' | 'alt'> & { alt: string } } | null> {
  const got = await fetchImage(c.url);
  if (!got || !usable(got.info, as)) return null;
  const hash = createHash('sha256').update(got.bytes).digest('hex');
  if (seen.hashes.has(hash)) return null; // the same file under two URLs
  let score = 100;
  let sig: Awaited<ReturnType<typeof photoSignals>> = { entropy: null, sharpness: null, hasAlpha: null, dhash: null };
  if (as === 'logo') {
    sig = await photoSignals(got.bytes);
    score = logoScore({ url: c.url, alt: c.alt, provider: c.provider ?? 'website', width: got.info.width, height: got.info.height, bytes: got.bytes.length, hasAlpha: sig.hasAlpha, entropy: sig.entropy, rank: c.rank });
  }
  if (as === 'photo') {
    sig = await photoSignals(got.bytes);
    const signals: ImageSignals = { url: c.url, alt: c.alt, provider: c.provider ?? 'website', width: got.info.width, height: got.info.height, bytes: got.bytes.length, hasAlpha: sig.hasAlpha, entropy: sig.entropy, sharpness: sig.sharpness };
    if (!acceptPhoto(signals, strictQuality())) return null; // decoration, a graphic, a transparent cut-out
    // A perceptual hash only means something for a structured picture; flat graphics all hash alike.
    if (sig.dhash && (sig.entropy ?? 8) < 4) sig = { ...sig, dhash: null };
    if (sig.dhash && seen.dhashes.some(d => hamming(d, sig.dhash!) <= NEAR_DUPLICATE)) return null; // the same picture, resized or re-encoded
    score = photoScore(signals);
  }
  seen.hashes.add(hash);
  if (sig.dhash) seen.dhashes.push(sig.dhash);
  const der = await derive(got.bytes, as === 'logo' ? 'logo' : 'photo');
  const served = der ? await store(der.bytes, 'image/webp', ownerId, businessId, alt) : await store(got.bytes, got.info.mime, ownerId, businessId, alt);
  // The safe original is kept privately only when a derivative is served (otherwise the served file is it).
  const orig = der ? await store(got.bytes, got.info.mime, ownerId, businessId, alt, true).catch(() => null) : null;
  return {
    url: served.url,
    score,
    prov: {
      url: served.url, originalKey: orig?.key ?? null, sourceUrl: c.url, pageUrl: c.pageUrl ?? null, provider: c.provider ?? 'website', retrievedAt: new Date().toISOString(),
      width: der?.width ?? got.info.width, height: der?.height ?? got.info.height, bytes: (der?.bytes ?? got.bytes).length, hash, alt, reuse: c.provider === 'owner' ? 'owner_upload' : 'business_published', status: 'approved', derivative: der ? 'webp' : 'original',
      ...(as === 'photo' ? { score, ...(sig.dhash ? { dhash: sig.dhash } : {}) } : {}),
    },
  };
}

/** Which source a logo URL comes from, when the candidate list did not say. */
const logoProvider = (u: string): MediaProvenance['provider'] => (/googleusercontent\.com|ggpht\.com/.test(u) ? 'google_profile' : /cdninstagram\.com|instagram\.com/.test(u) ? 'instagram' : /fbcdn\.net|facebook\.com/.test(u) ? 'facebook' : 'website');

/**
 * Posters for the profile's videos: the YouTube thumbnail copied into our storage at import time, so the
 * card shows the real cover without a request to YouTube from the visitor's browser. Returns the same
 * records with `poster` set where a thumbnail could be copied.
 */
export async function copyVideoPosters<T extends { id: string; status?: string; thumbnail?: string | null; poster?: string | null }>(videos: T[], ownerId: string, businessId: string, businessName: string): Promise<{ videos: T[]; copied: number }> {
  let copied = 0;
  const out: T[] = [];
  for (const v of videos) {
    if (v.poster || (v.status && v.status !== 'ok') || !/^[A-Za-z0-9_-]{11}$/.test(v.id)) {
      out.push(v);
      continue;
    }
    const tries = [`https://i.ytimg.com/vi/${v.id}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`, ...(v.thumbnail ? [v.thumbnail] : [])];
    let poster: string | null = null;
    for (const u of tries) {
      const got = await fetchImage(u);
      // hqdefault always exists; a placeholder is 120x90 and maxresdefault is missing for many videos.
      if (!got || got.info.width < 320) continue;
      const der = await derive(got.bytes, 'poster');
      const served = der ? await store(der.bytes, 'image/webp', ownerId, businessId, `תמונת הסרטון של ${businessName}`) : await store(got.bytes, got.info.mime, ownerId, businessId, `תמונת הסרטון של ${businessName}`);
      poster = served.url;
      break;
    }
    if (poster) copied++;
    out.push(poster ? { ...v, poster } : v);
  }
  return { videos: out, copied };
}

/** Removes a copied file (served derivative, private original and their rows) that the ranking left out. */
async function discard(prov: { url: string; originalKey: string | null }): Promise<void> {
  const id = prov.url.split('/').pop() ?? '';
  const rows = await db.mediaFile.findMany({ where: { OR: [{ id }, ...(prov.originalKey ? [{ key: prov.originalKey }] : [])] }, select: { id: true, key: true } }).catch(() => []);
  for (const r of rows) {
    await storage().del(r.key).catch(() => undefined);
    await db.mediaFile.delete({ where: { id: r.id } }).catch(() => undefined);
  }
}

export interface CopiedImages {
  logoUrl: string | null;
  photos: Array<{ url: string; alt: string }>;
  provenance: MediaProvenance[];
}

const generic = (alt: string | null | undefined) => !alt || alt.length < 4 || /^(img|image|photo|picture|logo|לוגו|תמונה|banner|slide|\d+)$/i.test(alt.trim());
const isHebrew = (s: string) => /[א-ת]/.test(s);

/**
 * Copies the logo and the photos. Size variants of one picture are fetched once (the plain file first).
 * When a candidate cannot be used (broken link, too small, not an image, decoration, a graphic, a
 * duplicate or near-duplicate), the next one from the site or the Google profile is tried. A few more
 * than maxPhotos are read so the best can be chosen: the cover is the best-scoring landscape photograph,
 * the gallery follows by score. The template shows one large and four small photos, so five or more is
 * the aim, never a requirement.
 */
export async function copyListingImages(
  place: { name: string; cityName?: string | null; logoUrl: string | null; photoUrls: string[]; fallbackPhotos?: string[]; fallbackLogos?: string[]; candidates?: Candidate[] },
  ownerId: string,
  businessId: string,
  maxPhotos: number,
): Promise<CopiedImages> {
  const where = place.cityName ? `, ${place.cityName}` : '';
  const seen: Seen = { hashes: new Set<string>(), dhashes: [] };
  const provenance: MediaProvenance[] = [];
  const meta = new Map((place.candidates ?? []).map(c => [c.url, c]));
  const cand = (url: string): Candidate => meta.get(url) ?? { url, provider: /googleusercontent\.com|ggpht\.com/.test(url) ? 'google_profile' : 'website' };
  const altFor = (c: Candidate, i: number) => (c.alt && !generic(c.alt) && isHebrew(c.alt) ? `${c.alt.slice(0, 80)}, ${seoName(place.name)}` : i === 0 ? `${seoName(place.name)}${where ? ` ב${seoCityName(place.cityName!)}` : ''}` : `${seoName(place.name)}: תמונה ${i + 1}`);

  const logoJob = (async () => {
    // Every logo candidate is read (the site's own logo, the Google profile logo, social profile pictures, a touch
    // icon) and the best mark wins (imageQuality.logoScore); the others are removed again.
    const urls = [...new Set([place.logoUrl, ...(place.fallbackLogos ?? [])].filter((x): x is string => !!x))].slice(0, 6);
    const got = await Promise.all(urls.map(async (u, rank) => {
      const c = { ...cand(u), rank, provider: cand(u).provider ?? logoProvider(u) };
      return copyOne(c, 'logo', ownerId, businessId, `הלוגו של ${place.name}`, seen);
    }));
    const ok = got.filter((r): r is NonNullable<typeof r> => !!r).sort((a, b) => b.score - a.score);
    if (!ok.length) return null;
    await Promise.all(ok.slice(1).map(r => discard(r.prov)));
    provenance.push({ ...ok[0].prov, kind: 'logo', score: ok[0].score });
    return ok[0].url;
  })();
  const queue = dedupeVariants([...new Set([...place.photoUrls, ...(place.fallbackPhotos ?? [])])]).slice(0, 30);
  const want = maxPhotos + 3; // a few spare, so the ranking has a choice
  const photos: Array<{ url: string; c: Candidate; score: number; landscape: boolean; prov: Omit<MediaProvenance, 'kind' | 'alt'> & { alt: string } }> = [];
  while (photos.length < want && queue.length) {
    const batch = queue.splice(0, Math.min(6, want - photos.length + 2));
    // Sequential within a batch would be slower; parallel means two near-duplicates in one batch can both pass. The ranking below drops the second.
    const got = await Promise.all(batch.map(async u => {
      const c = cand(u);
      const r = await copyOne(c, 'photo', ownerId, businessId, altFor(c, 0), seen);
      return r ? { r, c } : null;
    }));
    for (const g of got) {
      if (!g) continue;
      photos.push({ url: g.r.url, c: g.c, score: g.r.score, landscape: g.r.prov.width >= g.r.prov.height * 1.15, prov: g.r.prov });
    }
  }
  // Rank: near-duplicates that slipped through a parallel batch go, then the best landscape photograph
  // becomes the cover and the rest follow by score, up to maxPhotos.
  const ranked: typeof photos = [];
  for (const p of [...photos].sort((a, b) => b.score - a.score)) {
    if (p.prov.dhash && ranked.some(q => q.prov.dhash && hamming(q.prov.dhash, p.prov.dhash!) <= NEAR_DUPLICATE)) continue;
    ranked.push(p);
  }
  const coverIdx = ranked.findIndex(p => p.landscape);
  const ordered = (coverIdx > 0 ? [ranked[coverIdx], ...ranked.filter((_, i) => i !== coverIdx)] : ranked).slice(0, maxPhotos);
  const kept = ordered.map((p, i) => {
    const alt = altFor(p.c, i);
    const prov: MediaProvenance = { ...p.prov, alt, kind: i === 0 ? 'cover' : 'gallery' };
    provenance.push(prov);
    return { url: p.url, alt };
  });
  // Copies that did not make the cut are removed again so nothing unused stays in storage.
  const dropped = photos.filter(p => !ordered.includes(p));
  await Promise.all(dropped.map(p => discard(p.prov)));
  return { logoUrl: await logoJob, photos: kept, provenance };
}
