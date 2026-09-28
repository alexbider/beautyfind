import { z } from 'zod';
import { importerOrNull } from '@/components/ops/guard';
import { MANIFEST, SECTION_NAME } from '@/lib/import/coverage';
import { db } from '@/lib/server/db';
import { importReport, STATE_NAME } from '@/lib/server/importReport';

// CSV of the profiles report under the same filters as the screen: one row per business with its
// link, state, readiness, each template section's state, the sources that answered and the cost.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const cell = (v: unknown) => {
  const s = v == null ? '' : Array.isArray(v) ? v.join('|') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};
const csv = (rows: unknown[][]) => '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
const WEIGHTED = MANIFEST.filter(m => m.weight > 0).map(m => m.id);

export async function GET(req: Request) {
  const user = await importerOrNull();
  if (!user) return new Response('forbidden', { status: 403 });
  const u = new URL(req.url);
  const g = (k: string) => (u.searchParams.get(k) ?? '').slice(0, 120);
  const f = { region: g('region'), city: g('city'), category: g('cat'), state: g('state'), missing: g('missing'), runId: g('run'), q: g('q').trim() };
  const origin = process.env.NEXT_PUBLIC_SITE_URL || u.origin;
  const { rows } = await importReport(f);
  const head = ['name', 'city', 'categories', 'state', 'state_he', 'readiness', 'profile_status', 'url', 'review_url', 'missing', ...WEIGHTED.map(id => `section_${id}`), 'provider', 'site', 'maps', 'facebook', 'instagram', 'render', 'research', 'research_filled', 'editorial_words', 'editorial_model', 'photos', 'services', 'cost_usd', 'last_activity', 'run_id', 'claimed'];
  const out: unknown[][] = [head];
  for (const r of rows) {
    const sec = Object.fromEntries(r.sections.map(s => [s.id, s.state]));
    out.push([
      r.name, r.cityName, r.categories, r.state, STATE_NAME[r.state], r.readiness, r.profileStatus, `${origin}${r.href}`, `${origin}${r.reviewHref}`,
      r.missing.map(m => SECTION_NAME[m] ?? m), ...WEIGHTED.map(id => sec[id] ?? ''),
      r.sources.provider, r.sources.site, r.sources.maps, r.sources.facebook, r.sources.instagram, r.sources.render, r.sources.research, r.sources.researchFilled,
      r.editorial?.words ?? '', r.editorial?.model ?? '', r.photos, r.services, r.costUsd.toFixed(4), r.lastActivity, r.runId, r.claimed,
    ]);
  }
  // The subject is the run when the export is for one run, otherwise the exporting user (the column is a UUID).
  await db.auditLog.create({ data: { actorId: user.id, action: 'import_export', subjectType: 'import_report', subjectId: z.uuid().safeParse(f.runId).success ? f.runId : user.id, meta: { filter: f, rows: rows.length } } });
  return new Response(csv(out), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="profiles-report.csv"`,
      'cache-control': 'no-store',
    },
  });
}
