import 'server-only';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// File storage behind one interface. Only a local-disk adapter exists until a vendor
// (S3 / R2 / GCS) is chosen. Keys are opaque; never build them from user input.

export interface StorageAdapter {
  put(key: string, body: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

const ROOT = path.resolve(process.env.UPLOAD_DIR ?? '.data/uploads');

const localAdapter: StorageAdapter = {
  async put(key, body) {
    const file = path.join(ROOT, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  },
  async get(key) {
    const file = path.join(ROOT, key);
    if (!file.startsWith(ROOT + path.sep)) return null;
    try {
      return await readFile(file);
    } catch {
      return null;
    }
  },
};

export function storage(): StorageAdapter {
  const name = process.env.STORAGE_ADAPTER ?? 'local';
  if (name === 'local') return localAdapter;
  throw new Error(`Unknown STORAGE_ADAPTER "${name}"`);
}
