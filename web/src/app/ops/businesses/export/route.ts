import { areaUserOrNull } from '@/components/ops/guard';
import { db } from '@/lib/server/db';
import { BIZ_FILTERS, csvOf, listBusinesses, type BizFilter } from '../data';

export const dynamic = 'force-dynamic';

// CSV of the businesses table under the same filter. Staff only; the export is written to the audit log.
export async function GET(req: Request) {
  const user = await areaUserOrNull('businesses', 'view');
  if (!user) return new Response('Not found', { status: 404 });
  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? 'all';
  const filter = (BIZ_FILTERS.some(f => f.key === status) ? status : 'all') as BizFilter;
  const q = (url.searchParams.get('q') ?? '').slice(0, 80);
  const { rows } = await listBusinesses({ filter, q, take: 5000 });
  await db.auditLog.create({ data: { actorId: user.id, action: 'businesses_export', subjectType: 'business', subjectId: user.id, meta: { filter, q, rows: rows.length } } });
  return new Response('﻿' + csvOf(rows), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="beautyfind-businesses-${filter}.csv"`, 'Cache-Control': 'private, no-store' },
  });
}
