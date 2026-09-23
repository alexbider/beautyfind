import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { hmac } from '@/lib/server/crypto';
import { siteUrl } from '@/lib/server/site';

// Signed links to a single tax document: /receipt/:doc?t=<hmac of the doc id>.
// Used by the M13 / M11 emails so a guest payer can open the document without an account.

export const receiptSig = (docId: string) => hmac('receipt:' + docId).slice(0, 32);

export function receiptSigValid(docId: string, t: unknown): boolean {
  if (typeof t !== 'string' || t.length !== 32) return false;
  const a = Buffer.from(receiptSig(docId));
  const b = Buffer.from(t);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Relative link, for pages. */
export const receiptPath = (docId: string) => `/receipt/${docId}?t=${receiptSig(docId)}`;

/** Absolute link, for emails and messages. */
export const receiptUrl = (docId: string) => `${siteUrl()}${receiptPath(docId)}`;
