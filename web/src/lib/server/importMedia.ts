import 'server-only';
import { randomUUID } from 'node:crypto';
import { imageInfo, usable } from '@/lib/import/imageInfo';
import { safeFetch } from '@/lib/import/safeFetch';
import { db } from '@/lib/server/db';
import { storage } from '@/lib/vendors/storage';

// Copies the logo and photos staff chose from a business's own website into our storage, so the listing
// never hotlinks a third-party site. Every download goes through safeFetch (SSRF-safe, size capped) and
// must be a real JPEG, PNG or WebP of a usable size. Failures are skipped; the listing keeps our
// category photo in that case.

const MAX_BYTES = 8 * 1024 * 1024;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;

async function copyOne(url: string, as: 'logo' | 'photo', ownerId: string, businessId: string, alt: string): Promise<string | null> {
  try {
    const r = await safeFetch(url, {
      timeoutMs: 10_000,
      maxBytes: MAX_BYTES,
      headers: { 'User-Agent': 'BeautyFindBot/1.0 (+https://beautyfind.co.il/bot)', Accept: 'image/webp,image/jpeg,image/png' },
      allowPrivate: process.env.IMPORT_TEST_ALLOW_PRIVATE === '1',
    });
    if (r.status !== 200 || r.truncated) return null;
    const info = imageInfo(r.bytes);
    if (!info || !usable(info, as)) return null;
    const key = `public/${randomUUID()}.${EXT[info.mime]}`;
    await storage().put(key, r.bytes, info.mime);
    const row = await db.mediaFile.create({ data: { ownerId, businessId, key, mime: info.mime, bytes: r.bytes.length, alt } });
    return `/media/${row.id}`;
  } catch {
    return null;
  }
}

export interface CopiedImages {
  logoUrl: string | null;
  photos: Array<{ url: string; alt: string }>;
}

export async function copyListingImages(
  place: { name: string; logoUrl: string | null; photoUrls: string[] },
  ownerId: string,
  businessId: string,
  maxPhotos: number,
): Promise<CopiedImages> {
  const jobs = [
    place.logoUrl ? copyOne(place.logoUrl, 'logo', ownerId, businessId, `הלוגו של ${place.name}`) : Promise.resolve(null),
    ...place.photoUrls.slice(0, maxPhotos).map(u => copyOne(u, 'photo', ownerId, businessId, place.name)),
  ];
  const [logo, ...photos] = await Promise.all(jobs);
  return { logoUrl: logo, photos: photos.filter((x): x is string => !!x).map(url => ({ url, alt: place.name })) };
}
