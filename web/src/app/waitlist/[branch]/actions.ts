'use server';

import { z } from 'zod';
import { ilDate } from '@/lib/time';
import { currentUser } from '@/lib/server/session';
import type { JoinActionInput, JoinActionResult } from '@/components/waitlist/JoinForm';
import { ENTRY_TOKEN_RE } from '@/components/waitlist/shared';
import { joinWaitlist, leaveWaitlist } from '../entries';

// Server actions for /waitlist/[branch]. Inputs are parsed here; entries.ts re-checks every rule.

const joinSchema = z.object({
  branchId: z.guid(),
  treatmentId: z.guid(),
  days: z.array(z.number().int().min(0).max(5)).max(6),
  timeRanges: z.array(z.enum(['morning', 'noon', 'evening'])).max(3),
  span: z.enum(['2w', '1m', '2m']),
  practitionerId: z.guid().nullable(),
  name: z.string().max(80),
  phone: z.string().max(20),
});

export async function joinAction(input: JoinActionInput): Promise<JoinActionResult> {
  const p = joinSchema.safeParse(input);
  if (!p.success) return { ok: false, error: 'invalid' };
  try {
    const user = await currentUser();
    const res = await joinWaitlist(p.data, user?.kind === 'client' ? user.id : null);
    if (!res.ok) return res;
    return { ok: true, token: res.token, position: res.position, until: ilDate(res.expiresAt), updated: res.updated };
  } catch (e) {
    console.error('[waitlist] join failed', e);
    return { ok: false, error: 'server' };
  }
}

export async function leaveAction(token: string): Promise<{ ok: boolean }> {
  if (typeof token !== 'string' || !ENTRY_TOKEN_RE.test(token)) return { ok: false };
  const res = await leaveWaitlist(token);
  return { ok: res.ok };
}
