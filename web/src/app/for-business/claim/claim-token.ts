import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { hmac } from '@/lib/server/crypto';
import { CLAIM_METHODS, type ClaimMethod } from './shared';

// Proof that this user passed the ownership code for this branch. Signed, httpOnly,
// short-lived; submitClaim refuses to create a request without it.

const COOKIE = 'bf_claim';
const TTL_MS = 60 * 60_000;

export interface ClaimProof {
  branchId: string;
  userId: string;
  method: ClaimMethod;
  target: string; // masked, for the request snapshot
  verifiedAt: string; // ISO
  exp: number; // epoch ms
}

const sign = (payload: string) => hmac(`claim-proof:${payload}`);

export async function setClaimProof(p: Omit<ClaimProof, 'exp'>) {
  const exp = Date.now() + TTL_MS;
  const payload = Buffer.from(JSON.stringify({ ...p, exp })).toString('base64url');
  (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(exp),
  });
}

export async function readClaimProof(): Promise<ClaimProof | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ClaimProof;
    if (typeof p.exp !== 'number' || p.exp < Date.now()) return null;
    if (typeof p.branchId !== 'string' || typeof p.userId !== 'string' || !CLAIM_METHODS.includes(p.method)) return null;
    return p;
  } catch {
    return null;
  }
}

export async function clearClaimProof() {
  (await cookies()).delete(COOKIE);
}
