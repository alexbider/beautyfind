'use server';

import { submitReply, type ReplyResult } from '@/lib/server/consultReply';

// The reply page's only action. The signed token in the URL is the credential: it was sent to the client's phone.

export async function sendReplyAction(token: string, kind: string, text: string): Promise<ReplyResult | { ok: false; error: 'server' }> {
  if (typeof token !== 'string' || token.length > 100) return { ok: false, error: 'not_found' };
  try {
    return await submitReply(token, String(kind ?? ''), String(text ?? ''));
  } catch (e) {
    console.error('[consult-reply] failed', e instanceof Error ? e.message : String(e));
    return { ok: false, error: 'server' };
  }
}
