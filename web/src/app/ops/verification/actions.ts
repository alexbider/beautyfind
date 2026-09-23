'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { verifierOrNull } from '@/components/ops/guard';
import { decide } from '@/lib/server/verification';
import { pendingLicenseRef } from './data';
import type { DecideActionResult } from './shared';

const Input = z.object({
  requestId: z.uuid(),
  action: z.enum(['approve', 'reject', 'request_document', 'reopen']),
  reason: z.string().max(600).optional(),
});

/** Every decision goes through decide(); this only re-checks access and shapes the result. */
export async function decideAction(input: { requestId: string; action: string; reason?: string }): Promise<DecideActionResult> {
  const user = await verifierOrNull();
  if (!user) return { ok: false, error: 'forbidden' };
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { requestId, action, reason } = parsed.data;

  try {
    const res = await decide({ requestId, actor: { id: user.id, opsRole: user.opsRole }, action, reason });
    if (!res.ok) {
      if (res.error === 'closed' || res.error === 'not_found') revalidatePath('/ops/verification');
      if (res.error === 'license_pending') return { ok: false, error: res.error, related: await pendingLicenseRef(requestId) };
      return { ok: false, error: res.error };
    }
    revalidatePath('/ops/verification');
    return { ok: true, status: res.status };
  } catch (e) {
    console.error('[verification] decide failed', e);
    return { ok: false, error: 'failed' };
  }
}
