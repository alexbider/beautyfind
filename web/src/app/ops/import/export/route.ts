import { z } from 'zod';
import { importerOrNull } from '@/components/ops/guard';
import { fromMicros } from '@/lib/import/pricing';
import { loadSettings } from '@/lib/import/settings';
import { mayPublish } from '@/lib/import/sourcePolicy';
import { db } from '@/lib/server/db';

// CSV exports for one run.
// - canonical: only fields we may publish. No Google content, no Maps links, and provider ratings only
//   when the admin has turned rating publication on for that provider.
// - audit: counts, reasons, site outcomes, spend per provider and open reconciliation items.

export const dynamic = 'force-dynamic';

const cell = (v: unknown) => {
  const s = v == null ? '' : Array.isArray(v) ? v.join('|') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Quote everything, and neutralise spreadsheet formulas.
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};
const csv = (rows: unknown[][]) => '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';

export async function GET(req: Request) {
  const user = await importerOrNull();
  if (!user) return new Response('forbidden', { status: 403 });
  const url = new URL(req.url);
  const runId = url.searchParams.get('run') ?? '';
  const kind = url.searchParams.get('kind') === 'audit' ? 'audit' : 'canonical';
  if (!z.uuid().safeParse(runId).success) return new Response('bad run', { status: 400 });
  const run = await db.importRun.findUnique({ where: { id: runId } });
  if (!run) return new Response('not found', { status: 404 });

  const body = kind === 'canonical' ? await canonical(runId) : await audit(runId);
  await db.auditLog.create({ data: { actorId: user.id, action: 'import_export', subjectType: 'import_run', subjectId: runId, meta: { kind } } });
  const name = `import-${run.label.replace(/[^\w֐-׿-]+/g, '-').slice(0, 40)}-${kind}.csv`;
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${kind}.csv"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'cache-control': 'no-store',
    },
  });
}

async function canonical(runId: string) {
  const s = await loadSettings(db);
  const places = await db.importPlace.findMany({ where: { runId, status: { notIn: ['duplicate', 'rejected', 'closed'] } }, orderBy: { createdAt: 'asc' } });
  const ratingOk = (provider: string | null) => !!provider && provider !== 'google' && mayPublish(provider, 'rating', { publishProviderRatings: s.publishProviderRatings });
  const head = ['id', 'status', 'name', 'address', 'city', 'region', 'lat', 'lng', 'phone', 'email', 'email_status', 'website', 'whatsapp', 'instagram', 'facebook', 'booking_url', 'categories', 'hours', 'rating', 'rating_count', 'rating_source', 'source', 'source_id', 'retrieved_at'];
  const rows: unknown[][] = [head];
  for (const p of places) {
    const src = p.provider;
    const ok = (f: string) => mayPublish(src, f) || mayPublish('website', f);
    const rating = ratingOk(p.ratingProvider);
    rows.push([
      p.id, p.status, p.name, p.address, p.cityName, p.regionSlug, p.lat, p.lng,
      ok('phone') ? p.phone : null, ok('email') ? p.email : null, p.emailStatus, ok('website') ? p.website : null,
      p.whatsapp, p.instagram, p.facebook, p.bookingUrl, p.categories, ok('hours') ? p.hours : null,
      rating ? p.googleRating : null, rating ? p.googleReviewCount : null, rating ? p.ratingProvider : null,
      // Google-sourced records keep their Google id out of exports; DataForSEO's own id is fine.
      src, src === 'google' ? null : p.sourceId, p.retrievedAt?.toISOString() ?? null,
    ]);
  }
  return csv(rows);
}

async function audit(runId: string) {
  const [run, byStatus, reasons, sites, spend, reconcile, tasks] = await Promise.all([
    db.importRun.findUniqueOrThrow({ where: { id: runId } }),
    db.importPlace.groupBy({ by: ['status'], where: { runId }, _count: true }),
    db.$queryRaw<Array<{ reason: string; n: bigint }>>`SELECT unnest(reasons) AS reason, count(*) AS n FROM import_places WHERE run_id = ${runId}::uuid GROUP BY 1 ORDER BY 2 DESC`,
    db.$queryRaw<Array<{ site: string | null; n: bigint }>>`SELECT crawl->>'site' AS site, count(*) AS n FROM import_places WHERE run_id = ${runId}::uuid GROUP BY 1 ORDER BY 2 DESC`,
    db.spendEntry.groupBy({ by: ['provider', 'endpoint', 'status'], where: { runId }, _sum: { estimatedMicros: true, actualMicros: true }, _count: true }),
    db.importTask.findMany({ where: { runId, status: 'needs_reconciliation' }, select: { key: true, error: true, updatedAt: true } }),
    db.importTask.groupBy({ by: ['status'], where: { runId }, _count: true }),
  ]);
  const rows: unknown[][] = [['section', 'key', 'value', 'detail']];
  rows.push(['run', 'label', run.label, ''], ['run', 'provider', run.provider, ''], ['run', 'status', run.status, run.error ?? '']);
  rows.push(['run', 'record_limit', run.recordLimit, ''], ['run', 'budget_usd', run.budgetMicros != null ? fromMicros(run.budgetMicros) : '', '']);
  rows.push(['run', 'spent_usd', fromMicros(run.spentMicros), ''], ['run', 'reserved_usd', fromMicros(run.reservedMicros), '']);
  for (const x of byStatus) rows.push(['records', x.status, x._count, '']);
  for (const x of tasks) rows.push(['tasks', x.status, x._count, '']);
  for (const x of reasons) rows.push(['reasons', x.reason, Number(x.n), '']);
  for (const x of sites) rows.push(['website', x.site ?? 'not_checked', Number(x.n), '']);
  for (const x of spend)
    rows.push(['spend', `${x.provider}/${x.endpoint}/${x.status}`, x.status === 'released' ? 0 : fromMicros(x._sum.actualMicros ?? x._sum.estimatedMicros ?? 0n), `${x._count} calls, estimated ${fromMicros(x._sum.estimatedMicros ?? 0n)}`]);
  for (const t of reconcile) rows.push(['needs_reconciliation', t.key, t.error ?? '', t.updatedAt.toISOString()]);
  return csv(rows);
}
