'use server';

import { z } from 'zod';
import { areaUserOrNull } from '@/components/ops/guard';
import { db } from '@/lib/server/db';
import { checkIntegration, type CheckResult } from '@/lib/server/integrations';

export async function checkIntegrationAction(input: { key: string }): Promise<{ ok: true; result: CheckResult } | { ok: false; error: string }> {
  const user = await areaUserOrNull('integrations', 'view');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = z.object({ key: z.string().max(60) }).safeParse(input);
  if (!p.success) return { ok: false, error: 'קלט לא תקין' };
  const result = await checkIntegration(p.data.key);
  await db.auditLog.create({ data: { actorId: user.id, action: 'integration_check', subjectType: 'integration', subjectId: user.id, meta: { key: p.data.key, ok: result.ok, note: result.note, ms: result.ms } } }).catch(() => {});
  return { ok: true, result };
}
