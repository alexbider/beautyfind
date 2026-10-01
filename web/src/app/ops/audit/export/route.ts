import { areaUserOrNull } from '@/components/ops/guard';
import { ACTOR_KIND_NAMES, type ActorKind } from '@/components/ops/activity';
import { db } from '@/lib/server/db';
import { recentActivity } from '@/lib/server/opsStats';

export const dynamic = 'force-dynamic';

const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;

// CSV of the activity list under the same filter. The export itself is an audit row.
export async function GET(req: Request) {
  const user = await areaUserOrNull('audit', 'view');
  if (!user) return new Response('Not found', { status: 404 });
  const f = new URL(req.url).searchParams.get('filter') ?? '';
  const filter = (['person', 'ai', 'system'] as string[]).includes(f) ? (f as ActorKind) : undefined;
  const rows = await recentActivity(5000, filter);
  await db.auditLog.create({ data: { actorId: user.id, action: 'audit_export', subjectType: 'audit', subjectId: user.id, meta: { filter: filter ?? 'all', rows: rows.length } } });
  const lines = [['זמן', 'סוג', 'מי', 'פעולה', 'פרטים'].map(cell).join(',')];
  for (const r of rows) lines.push([r.at.toISOString(), ACTOR_KIND_NAMES[r.kind], r.who, r.text, r.detail].map(cell).join(','));
  return new Response('﻿' + lines.join('\n'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="beautyfind-audit-${filter ?? 'all'}.csv"`, 'Cache-Control': 'private, no-store' },
  });
}
