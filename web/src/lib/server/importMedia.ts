import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { imageInfo, usable } from '@/lib/import/imageInfo';
import { safeFetch } from '@/lib/import/safeFetch';
import { db } from '@/lib/server/db';
import { storage } from '@/lib/vendors/storage';

// Copies the logo and photos chosen for a listing into our storage, so the listing never hotlinks a
// third-party site. Every download goes through safeFetch (SSRF-safe, size capped) and must be a real
// JPEG, PNG or WebP of a usable size. Each copy keeps a provenance record: where it came from, when,
// its dimensions and hash (duplicates are dropped by hash), and the reuse basis. Derivatives: the served
// file is a WebP (orientation corrected, metadata stripped, banner up to 1600px and gallery up to 1200px
// wide) when sharp is available; the safe original is kept privately next to it.

const MAX_BYTES = 8 * 1024 * 1024;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
const WIDTH = { banner: 1600, photo: 1200, logo: 512 } as const;
const TARGET_BYTES = { banner: 350_000, photo: 160_000, logo: 120_000 } as const;

export interface MediaProvenance {
  url: string; // our /media/... URL of the served derivative
  originalKey: string | null; // storage key of the safe original (private)
  kind: 'logo' | 'cover' | 'gallery';
  sourceUrl: string; // asset URL on the source
  pageUrl: string | null; // page or profile it was found on
  provider: 'website' | 'google_profile' | 'google_post' | 'owner';
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
}

export interface Candidate {
  url: string;
  pageUrl?: string | null;
  provider?: MediaProvenance['provider'];
  alt?: string | null; // alt text on the source, when it is descriptive
}

type Sharp = typeof import('sharp').default;
let sharpMod: Promise<Sharp | null> | null = null;
function sharp(): Promise<Sharp | null> {
  sharpMod ??= import('sharp').then(m => (m.default ?? m) as unknown as Sharp).catch(() => null);
  return sharpMod;
}

const derivativesOn = () => process.env.IMPORT_IMAGE_DERIVATIVES !== '0';

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

async function copyOne(c: Candidate, as: 'logo' | 'photo', ownerId: string, businessId: string, alt: string, seen: Set<string>): Promise<{ url: string; prov: Omit<MediaProvenance, 'kind' | 'alt'> & { alt: string } } | null> {
  const got = await fetchImage(c.url);
  if (!got || !usable(got.info, as)) return null;
  const hash = createHash('sha256').update(got.bytes).digest('hex');
  if (seen.has(hash)) return null; // the same photo under two URLs
  seen.add(hash);
  const der = await derive(got.bytes, as === 'logo' ? 'logo' : 'photo');
  const served = der ? await store(der.bytes, 'image/webp', ownerId, businessId, alt) : await store(got.bytes, got.info.mime, ownerId, businessId, alt);
  // The safe original is kept privately only when a derivative is served (otherwise the served file is it).
  const orig = der ? await store(got.bytes, got.info.mime, ownerId, businessId, alt, true).catch(() => null) : null;
  return {
    url: served.url,
    prov: {
      url: served.url, originalKey: orig?.key ?? null, sourceUrl: c.url, pageUrl: c.pageUrl ?? null, provider: c.provider ?? 'website', retrievedAt: new Date().toISOString(),
      width: der?.width ?? got.info.width, height: der?.height ?? got.info.height, bytes: (der?.bytes ?? got.bytes).length, hash, alt, reuse: c.provider === 'owner' ? 'owner_upload' : 'business_published', status: 'approved', derivative: der ? 'webp' : 'original',
    },
  };
}

export interface CopiedImages {
  logoUrl: string | null;
  photos: Array<{ url: string; alt: string }>;
  provenance: MediaProvenance[];
}

const generic = (alt: string | null | undefined) => !alt || alt.length < 4 || /^(img|image|photo|picture|logo|לוגו|תמונה|banner|slide|\d+)$/i.test(alt.trim());
const isHebrew = (s: string) => /[א-ת]/.test(s);

/**
 * Copies the logo and the photos. When a chosen photo cannot be used (broken link, too small, not an
 * image, duplicate), the next candidate from the site or the Google profile is tried, until the listing
 * has maxPhotos photos or the candidates run out. The first landscape photo becomes the cover (banner);
 * the template shows one large and four small photos, so five or more is the aim, never a requirement.
 */
export async function copyListingImages(
  place: { name: string; cityName?: string | null; logoUrl: string | null; photoUrls: string[]; fallbackPhotos?: string[]; fallbackLogos?: string[]; candidates?: Candidate[] },
  ownerId: string,
  businessId: string,
  maxPhotos: number,
): Promise<CopiedImages> {
  const where = place.cityName ? `, ${place.cityName}` : '';
  const seen = new Set<string>();
  const provenance: MediaProvenance[] = [];
  const meta = new Map((place.candidates ?? []).map(c => [c.url, c]));
  const cand = (url: string): Candidate => meta.get(url) ?? { url, provider: /googleusercontent\.com|ggpht\.com/.test(url) ? 'google_profile' : 'website' };
  const altFor = (c: Candidate, i: number) => (c.alt && !generic(c.alt) && isHebrew(c.alt) ? `${c.alt.slice(0, 80)}, ${place.name}` : `${place.name}${where}${i > 0 ? `, תמונה ${i + 1}` : ''}`);

  const logoJob = (async () => {
    for (const u of [place.logoUrl, ...(place.logoUrl ? place.fallbackLogos ?? [] : [])].filter((x): x is string => !!x).slice(0, 4)) {
      const r = await copyOne(cand(u), 'logo', ownerId, businessId, `הלוגו של ${place.name}`, seen);
      if (r) {
        provenance.push({ ...r.prov, kind: 'logo' });
        return r.url;
      }
    }
    return null;
  })();
  const queue = [...new Set([...place.photoUrls, ...(place.fallbackPhotos ?? [])])].slice(0, 30);
  const photos: Array<{ url: string; alt: string; landscape: boolean; prov: MediaProvenance }> = [];
  while (photos.length < maxPhotos && queue.length) {
    const batch = queue.splice(0, Math.min(6, maxPhotos - photos.length + 2));
    const got = await Promise.all(batch.map(async u => {
      const c = cand(u);
      const r = await copyOne(c, 'photo', ownerId, businessId, altFor(c, photos.length), seen);
      return r ? { r, c } : null;
    }));
    for (const g of got) {
      if (!g || photos.length >= maxPhotos) continue;
      const alt = altFor(g.c, photos.length);
      photos.push({ url: g.r.url, alt, landscape: g.r.prov.width >= g.r.prov.height * 1.2, prov: { ...g.r.prov, alt, kind: 'gallery' } });
    }
  }
  // Banner: the first landscape photo; the rest keep their order.
  const coverIdx = photos.findIndex(p => p.landscape);
  const ordered = coverIdx > 0 ? [photos[coverIdx], ...photos.filter((_, i) => i !== coverIdx)] : photos;
  ordered.forEach((p, i) => provenance.push({ ...p.prov, kind: i === 0 ? 'cover' : 'gallery' }));
  return { logoUrl: await logoJob, photos: ordered.map(p => ({ url: p.url, alt: p.alt })), provenance };
}
