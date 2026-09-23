// AES-256-GCM sealing without the server-only guard, so scripts (seeds, jobs) can use it.
// App code imports lib/server/secure.ts instead.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export function dataKey(): Buffer {
  const raw = process.env.DATA_KEY;
  if (raw) {
    const k = Buffer.from(raw, 'base64');
    if (k.length !== 32) throw new Error('DATA_KEY must be 32 bytes, base64 encoded');
    return k;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('DATA_KEY is not set');
  // Development only: derived from SESSION_SECRET so local data stays readable across restarts.
  return createHash('sha256').update('bf-dev-data-key:' + (process.env.SESSION_SECRET ?? 'dev')).digest();
}

/** Encrypts any JSON-serialisable value to "v1.<iv>.<tag>.<ciphertext>" (base64url parts). */
export function seal(value: unknown): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', dataKey(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

export function open<T = unknown>(sealed: string): T {
  const [v, iv, tag, body] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !body) throw new Error('Unknown sealed format');
  const d = createDecipheriv('aes-256-gcm', dataKey(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8')) as T;
}
