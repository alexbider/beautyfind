'use server';

import type { AcceptActionResult, PassActionResult } from '@/components/waitlist/OfferView';
import { OFFER_TOKEN_RE } from '@/components/waitlist/shared';
import { acceptOfferCore, passOfferCore } from '../offers';

// Server actions for /w/[token]. The token is the only credential: it was sent to the client's phone.

export async function acceptOfferAction(token: string): Promise<AcceptActionResult> {
  if (typeof token !== 'string' || !OFFER_TOKEN_RE.test(token)) return { ok: false, error: 'not_found' };
  try {
    return await acceptOfferCore(token);
  } catch (e) {
    console.error('[waitlist] accept failed', e);
    return { ok: false, error: 'server' };
  }
}

export async function passOfferAction(token: string): Promise<PassActionResult> {
  if (typeof token !== 'string' || !OFFER_TOKEN_RE.test(token)) return { ok: false, error: 'not_found' };
  try {
    return await passOfferCore(token);
  } catch (e) {
    console.error('[waitlist] pass failed', e);
    return { ok: false, error: 'server' };
  }
}
