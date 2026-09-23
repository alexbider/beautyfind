'use server';

import { revalidatePath } from 'next/cache';
import { MAX_SIGNATURE_BYTES } from '@/components/declaration/questions';
import { bookingIdFromToken } from '@/lib/server/booking';
import { reuseDeclaration, submitDeclaration, type SubmitResult } from './service';

// Guest link actions. The signed token is the only credential: it grants this one booking.

export async function signDeclaration(token: string, fd: FormData): Promise<SubmitResult> {
  const bookingId = typeof token === 'string' ? bookingIdFromToken(token) : null;
  if (!bookingId) return { ok: false, error: 'הקישור אינו תקין.' };

  let payload: unknown;
  try {
    const raw = fd.get('payload');
    payload = typeof raw === 'string' && raw.length < 20_000 ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }
  const sig = fd.get('signature');
  if (!(sig instanceof Blob) || sig.size === 0) return { ok: false, error: 'חסרה חתימה' };
  if (sig.size > MAX_SIGNATURE_BYTES) return { ok: false, error: 'קובץ החתימה גדול מדי. נקי את החתימה ונסי שוב.' };
  if (sig.type && sig.type !== 'image/png') return { ok: false, error: 'חסרה חתימה' };

  const res = await submitDeclaration(bookingId, payload, Buffer.from(await sig.arrayBuffer()));
  if (res.ok) revalidatePath(`/b/${token}`, 'layout');
  return res;
}

export async function linkExistingDeclaration(token: string, declarationId: string) {
  const bookingId = typeof token === 'string' ? bookingIdFromToken(token) : null;
  if (!bookingId || typeof declarationId !== 'string') return { ok: false as const, error: 'הקישור אינו תקין.' };
  const res = await reuseDeclaration(bookingId, declarationId);
  if (res.ok) revalidatePath(`/b/${token}`, 'layout');
  return res;
}
