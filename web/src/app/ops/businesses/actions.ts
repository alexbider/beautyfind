'use server';

import type { BusinessStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { areaUserOrNull } from '@/components/ops/guard';
import { db } from '@/lib/server/db';

// Staff actions on a business: its status (live, hidden, past due, pending) with a reason. Every
// change is an append-only decision plus an audit row, and the public pages are refreshed so a hidden
// business leaves the directory at once.

const Input = z.object({ id: z.string().uuid(), status: z.enum(['pending', 'live', 'past_due', 'hidden']), reason: z.string().trim().max(300).optional() });

export type BizActionResult = { ok: true } | { ok: false; error: 'forbidden' | 'invalid' | 'not_found' };

export async function setBusinessStatusAction(input: z.input<typeof Input>): Promise<BizActionResult> {
  const user = await areaUserOrNull('businesses', 'edit');
  if (!user) return { ok: false, error: 'forbidden' };
  const p = Input.safeParse(input);
  if (!p.success) return { ok: false, error: 'invalid' };
  const b = await db.business.findUnique({ where: { id: p.data.id }, select: { id: true, status: true, branches: { select: { regionSlug: true, slug: true } } } });
  if (!b) return { ok: false, error: 'not_found' };
  if (b.status === p.data.status) return { ok: true };
  await db.$transaction([
    db.business.update({ where: { id: b.id }, data: { status: p.data.status as BusinessStatus } }),
    db.decision.create({ data: { actorId: user.id, actorRole: user.opsRole ?? 'ops', subjectType: 'business', subjectId: b.id, action: `status_${p.data.status}`, reason: p.data.reason || null } }),
    db.auditLog.create({ data: { actorId: user.id, action: 'business_status', subjectType: 'business', subjectId: b.id, businessId: b.id, meta: { from: b.status, to: p.data.status, note: p.data.reason || null } } }),
  ]);
  revalidatePath('/');
  revalidatePath('/search');
  for (const br of b.branches) revalidatePath(`/${br.regionSlug}`);
  revalidatePath(`/ops/businesses/${b.id}`);
  revalidatePath('/ops/businesses');
  return { ok: true };
}
