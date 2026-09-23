import 'server-only';
import { createHash, createHmac, randomBytes, randomInt, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || (process.env.NODE_ENV === 'production' && s === 'change-me')) throw new Error('SESSION_SECRET is not set');
  return s;
}

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/** Keyed hash so a leaked table of OTP hashes cannot be brute-forced offline. */
export const hmac = (v: string) => createHmac('sha256', secret()).update(v).digest('hex');

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export const randomDigits = (n: number) => Array.from({ length: n }, () => randomInt(0, 10)).join('');

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [algo, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !keyB64) return false;
  const key = Buffer.from(keyB64, 'base64');
  const test = await scrypt(pw, Buffer.from(saltB64, 'base64'), key.length);
  return timingSafeEqual(key, test);
}
