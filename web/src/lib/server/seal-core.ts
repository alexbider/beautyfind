// AES-256-GCM sealing without the server-only guard, so scripts (seeds, jobs) can use it.
// App code imports lib/server/secure.ts instead.
//
// Keys:
//   DATA_KEY           the current key (32 random bytes, base64). Every new value is sealed with it.
//   DATA_KEY_PREVIOUS  optional, comma separated old keys, still used to OPEN values sealed before a rotation.
// Format: "v2.<kid>.<iv>.<tag>.<ciphertext>", kid = first 8 hex chars of sha256(key), so the right key is found
// directly. Older "v1.<iv>.<tag>.<ciphertext>" values (no key id) are opened by trying each key in turn.
//
// To rotate: put the old DATA_KEY into DATA_KEY_PREVIOUS, set a new DATA_KEY, redeploy, then run
// `npx tsx scripts/reseal.ts` to re-seal stored values with the new key. Only then drop the old key.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const decode = (raw: string, name: string): Buffer => {
  const k = Buffer.from(raw.trim(), 'base64');
  if (k.length !== 32) throw new Error(`${name} must be 32 bytes, base64 encoded`);
  return k;
};

export const keyId = (k: Buffer) => createHash('sha256').update(k).digest('hex').slice(0, 8);

export function dataKey(): Buffer {
  const raw = process.env.DATA_KEY;
  if (raw) return decode(raw, 'DATA_KEY');
  if (process.env.NODE_ENV === 'production') throw new Error('DATA_KEY is not set');
  // Development only: derived from SESSION_SECRET so local data stays readable across restarts.
  return createHash('sha256').update('bf-dev-data-key:' + (process.env.SESSION_SECRET ?? 'dev')).digest();
}

/** Current key first, then previous keys. */
export function allKeys(): Buffer[] {
  const prev = (process.env.DATA_KEY_PREVIOUS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map((s, i) => decode(s, `DATA_KEY_PREVIOUS[${i}]`));
  return [dataKey(), ...prev];
}

/** Encrypts any JSON-serialisable value to "v2.<kid>.<iv>.<tag>.<ciphertext>" (base64url parts). */
export function seal(value: unknown): string {
  const key = dataKey();
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return ['v2', keyId(key), iv.toString('base64url'), c.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

function decrypt(key: Buffer, iv: string, tag: string, body: string): string {
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
}

export function open<T = unknown>(sealed: string): T {
  const parts = sealed.split('.');
  if (parts[0] === 'v2' && parts.length === 5) {
    const [, kid, iv, tag, body] = parts;
    const key = allKeys().find(k => keyId(k) === kid);
    if (!key) throw new Error(`No key for sealed value (key id ${kid}); add the old key to DATA_KEY_PREVIOUS`);
    return JSON.parse(decrypt(key, iv, tag, body)) as T;
  }
  if (parts[0] === 'v1' && parts.length === 4) {
    const [, iv, tag, body] = parts;
    let last: unknown;
    for (const key of allKeys()) {
      try {
        return JSON.parse(decrypt(key, iv, tag, body)) as T;
      } catch (e) {
        last = e;
      }
    }
    throw last instanceof Error ? last : new Error('Cannot open sealed value with any key');
  }
  throw new Error('Unknown sealed format');
}

/** True when the value is sealed with the current key in the current format (nothing to re-seal). */
export function isCurrent(sealed: string): boolean {
  const parts = sealed.split('.');
  return parts[0] === 'v2' && parts[1] === keyId(dataKey());
}
