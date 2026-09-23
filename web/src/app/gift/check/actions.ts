'use server';

import { headers } from 'next/headers';
import { allowLookup, publicLookup, type PublicCard } from '@/components/gift/server';

// Balance check for gift card holders. Rate-limited per IP (10 per 10 minutes, in memory), and the answer
// for an unknown code is the same as for a mistyped one, so this is the only place a code can be probed.

export type CheckResult = { ok: true; card: PublicCard } | { ok: false; error: 'not_found' | 'rate' };

async function clientIp() {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
}

export async function checkGiftCode(raw: string): Promise<CheckResult> {
  if (!allowLookup(await clientIp())) return { ok: false, error: 'rate' };
  const card = await publicLookup(String(raw).slice(0, 40));
  return card ? { ok: true, card } : { ok: false, error: 'not_found' };
}
