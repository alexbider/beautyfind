import 'server-only';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { get as blobGet, put as blobPut } from '@vercel/blob';

// File storage behind one interface: local disk for development, Vercel Blob on Vercel.
// Keys are opaque; never build them from user input.

export interface StorageAdapter {
  put(key: string, body: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

const ROOT = path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR ?? '.data/uploads');

const localAdapter: StorageAdapter = {
  async put(key, body) {
    const file = path.join(/*turbopackIgnore: true*/ ROOT, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  },
  async get(key) {
    const file = path.join(/*turbopackIgnore: true*/ ROOT, key);
    if (!file.startsWith(ROOT + path.sep)) return null;
    try {
      return await readFile(file);
    } catch {
      return null;
    }
  },
};

// Every blob is private, including public images: files are only ever served through our own
// routes (/media, /ops/media, the signature route), which decide who may see what.
const blobAdapter: StorageAdapter = {
  async put(key, body, mime) {
    await blobPut(key, body, { access: 'private', contentType: mime, addRandomSuffix: false, allowOverwrite: false });
  },
  async get(key) {
    const res = await blobGet(key, { access: 'private' }).catch(() => null);
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    return Buffer.from(await new Response(res.stream).arrayBuffer());
  },
};

export function storage(): StorageAdapter {
  const name = process.env.STORAGE_ADAPTER ?? 'local';
  if (name === 'local') return localAdapter;
  if (name === 'blob') return blobAdapter;
  throw new Error(`Unknown STORAGE_ADAPTER "${name}"`);
}
