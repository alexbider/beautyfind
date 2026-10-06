import 'server-only';
import { randomUUID } from 'node:crypto';
import type { MediaFile, Prisma } from '@prisma/client';
import { z } from 'zod';
import { fileSlug } from '@/lib/articleHtml';
import { imageInfo } from '@/lib/import/imageInfo';
import { safeFetch } from '@/lib/import/safeFetch';
import { db } from './db';
import { storage } from '../vendors/storage';

// Images for the magazine (upload_media): fetched from a public URL (SSRF-safe, size capped) or decoded
// from base64, checked to be a real JPEG, PNG or WebP, converted to WebP (metadata stripped, at most
// 1600px wide) when sharp is available, stored with its pixel size, and served from /media/<id>/<filename>
// with a one-year immutable cache. Alt text is required and must be Hebrew.

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_WIDTH = 1600;
const MIN_SIDE = 200;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

type Actor = { id: string };
type Sharp = typeof import('sharp').default;
let sharpMod: Promise<Sharp | null> | null = null;
const sharp = () => (sharpMod ??= import('sharp').then(m => (m.default ?? m) as unknown as Sharp).catch(() => null));

const hebrew = (s: string) => /[א-ת]/.test(s);

export const MediaMetaSchema = z.object({
  alt: z.string().trim().min(4).max(200).refine(hebrew, 'alt text must be Hebrew'),
  title: z.string().trim().max(160).nullable().optional(),
  caption: z.string().trim().max(500).nullable().optional(),
  filename: z.string().trim().max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase letters, digits and hyphens').optional(),
});
export const UploadSchema = MediaMetaSchema.extend({
  url: z.string().trim().url().max(2000).optional().describe('public https URL of the image'),
  base64: z.string().max(Math.ceil(MAX_IMAGE_BYTES * 1.4)).optional().describe('the image bytes as base64 (a data: URL is accepted)'),
}).refine(v => !!v.url !== !!v.base64, { message: 'give url or base64, not both' });

/** The public URL of a media file: with its file name when it has one (magazine images), else the bare id. */
export function mediaUrl(m: Pick<MediaFile, 'id' | 'filename' | 'mime'>): string {
  if (!m.filename) return `/media/${m.id}`;
  return `/media/${m.id}/${m.filename}.${EXT[m.mime] ?? 'bin'}`;
}

export const mediaView = (m: MediaFile) => ({ id: m.id, url: mediaUrl(m), alt: m.alt, title: m.title, caption: m.caption, filename: m.filename, width: m.width, height: m.height, bytes: m.bytes, mime: m.mime, kind: m.kind, createdAt: m.createdAt });

async function uniqueFilename(base: string): Promise<string> {
  let name = base;
  for (let n = 2; await db.mediaFile.findUnique({ where: { filename: name }, select: { id: true } }); n++) name = `${base}-${n}`;
  return name;
}

async function readSource(src: { url?: string; base64?: string }): Promise<{ bytes: Buffer } | { error: string }> {
  if (src.base64) {
    const raw = src.base64.replace(/^data:[^;,]+;base64,/, '').replace(/\s+/g, '');
    let bytes: Buffer;
    try { bytes = Buffer.from(raw, 'base64'); } catch { return { error: 'base64 could not be decoded' }; }
    if (!bytes.length) return { error: 'empty image' };
    if (bytes.length > MAX_IMAGE_BYTES) return { error: `image larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB` };
    return { bytes };
  }
  try {
    const r = await safeFetch(src.url!, { timeoutMs: 15_000, maxBytes: MAX_IMAGE_BYTES, headers: { 'User-Agent': 'BeautyFindBot/1.0 (+https://beautyfind.co.il/bot)', Accept: 'image/webp,image/jpeg,image/png' }, allowPrivate: process.env.IMPORT_TEST_ALLOW_PRIVATE === '1' });
    if (r.status !== 200) return { error: `fetch failed with status ${r.status}` };
    if (r.truncated) return { error: `image larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB` };
    if (!r.bytes.length) return { error: 'empty response' };
    return { bytes: r.bytes };
  } catch (e) {
    return { error: `fetch failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export type UploadResult = { ok: true; media: ReturnType<typeof mediaView>; converted: boolean } | { ok: false; error: string; fields?: Record<string, string> };

/** Fetches or decodes an image, validates it, converts it to WebP and stores it with its metadata. */
export async function uploadArticleImage(actor: Actor, input: unknown): Promise<UploadResult> {
  const p = UploadSchema.safeParse(input);
  if (!p.success) return { ok: false, error: 'invalid input', fields: Object.fromEntries(p.error.issues.map(i => [i.path.join('.') || '_', i.message])) };
  const got = await readSource(p.data);
  if ('error' in got) return { ok: false, error: got.error };
  const info = imageInfo(got.bytes);
  if (!info) return { ok: false, error: 'not a JPEG, PNG or WebP image' };
  if (Math.min(info.width, info.height) < MIN_SIDE) return { ok: false, error: `image too small (${info.width}x${info.height}); at least ${MIN_SIDE}px on the short side` };
  let bytes = got.bytes;
  let mime: string = info.mime;
  let width = info.width;
  let height = info.height;
  let converted = false;
  const s = await sharp();
  if (s) {
    try {
      const out = await s(got.bytes, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true, fit: 'inside' }).webp({ quality: 82, effort: 4 }).toBuffer({ resolveWithObject: true });
      bytes = out.data; mime = 'image/webp'; width = out.info.width; height = out.info.height; converted = true;
    } catch {
      return { ok: false, error: 'the image could not be decoded' };
    }
  }
  const base = fileSlug(p.data.filename ?? p.data.title ?? (p.data.url ? new URL(p.data.url).pathname.split('/').pop() : null), `image-${randomUUID().slice(0, 8)}`);
  const filename = await uniqueFilename(base);
  const key = `public/${randomUUID()}.${EXT[mime]}`;
  await storage().put(key, bytes, mime);
  const row = await db.mediaFile.create({ data: { ownerId: actor.id, key, mime, bytes: bytes.length, alt: p.data.alt, title: p.data.title ?? null, caption: p.data.caption ?? null, filename, width, height, kind: 'article' } });
  await db.auditLog.create({ data: { actorId: actor.id, action: 'media_upload', subjectType: 'media', subjectId: row.id, meta: { ref: filename, source: p.data.url ? 'url' : 'base64', bytes: row.bytes, width, height, converted } as Prisma.InputJsonValue } });
  return { ok: true, media: mediaView(row), converted };
}

export async function updateMedia(actor: Actor, id: string, input: unknown): Promise<{ ok: true; media: ReturnType<typeof mediaView> } | { ok: false; error: string; fields?: Record<string, string> }> {
  const p = MediaMetaSchema.partial().safeParse(input);
  if (!p.success) return { ok: false, error: 'invalid input', fields: Object.fromEntries(p.error.issues.map(i => [i.path.join('.') || '_', i.message])) };
  const cur = await db.mediaFile.findUnique({ where: { id } });
  if (!cur || cur.isPrivate) return { ok: false, error: 'media not found' };
  if (p.data.filename && p.data.filename !== cur.filename) {
    const clash = await db.mediaFile.findUnique({ where: { filename: p.data.filename }, select: { id: true } });
    if (clash) return { ok: false, error: 'conflict: a file with this name exists', fields: { filename: p.data.filename } };
  }
  const row = await db.mediaFile.update({ where: { id }, data: { ...(p.data.alt !== undefined ? { alt: p.data.alt } : {}), ...(p.data.title !== undefined ? { title: p.data.title } : {}), ...(p.data.caption !== undefined ? { caption: p.data.caption } : {}), ...(p.data.filename !== undefined ? { filename: p.data.filename } : {}) } });
  await db.auditLog.create({ data: { actorId: actor.id, action: 'media_update', subjectType: 'media', subjectId: row.id, meta: { ref: row.filename ?? row.id, fields: Object.keys(p.data) } } });
  return { ok: true, media: mediaView(row) };
}

export async function listMedia(opts: { q?: string; kind?: string | null; page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
  const where: Prisma.MediaFileWhereInput = {
    isPrivate: false,
    ...(opts.kind === undefined ? { kind: 'article' } : opts.kind ? { kind: opts.kind } : {}),
    ...(opts.q ? { OR: [{ alt: { contains: opts.q, mode: 'insensitive' } }, { title: { contains: opts.q, mode: 'insensitive' } }, { filename: { contains: opts.q, mode: 'insensitive' } }] } : {}),
  };
  const [total, rows] = await Promise.all([db.mediaFile.count({ where }), db.mediaFile.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize })]);
  return { total, page, pageSize, items: rows.map(mediaView) };
}
