import 'server-only';
import { randomUUID } from 'node:crypto';
import { db } from './db';
import { storage } from '../vendors/storage';

const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const DOC_TYPES: Record<string, string> = { ...IMAGE_TYPES, 'application/pdf': 'pdf' };
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export type UploadResult = { ok: true; id: string; url: string } | { ok: false; error: 'type' | 'size' | 'empty' };

/**
 * Stores an uploaded file and records it. Public images get a /media URL;
 * private documents (license scans) are only readable by BeautyFind staff.
 */
export async function saveUpload(
  file: File,
  opts: { ownerId: string; businessId?: string | null; isPrivate?: boolean; alt?: string },
): Promise<UploadResult> {
  if (!file || file.size === 0) return { ok: false, error: 'empty' };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: 'size' };
  const ext = (opts.isPrivate ? DOC_TYPES : IMAGE_TYPES)[file.type];
  if (!ext) return { ok: false, error: 'type' };

  const key = `${opts.isPrivate ? 'private' : 'public'}/${randomUUID()}.${ext}`;
  await storage().put(key, Buffer.from(await file.arrayBuffer()), file.type);
  const row = await db.mediaFile.create({
    data: { ownerId: opts.ownerId, businessId: opts.businessId ?? null, key, mime: file.type, bytes: file.size, alt: opts.alt, isPrivate: !!opts.isPrivate },
  });
  return { ok: true, id: row.id, url: opts.isPrivate ? `/ops/media/${row.id}` : `/media/${row.id}` };
}
