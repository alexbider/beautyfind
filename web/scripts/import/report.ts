// Aggregate numbers for the latest import runs, printed as GitHub annotations by the maintenance
// workflow. Counts only: no names, phones, emails or URLs (the repository's logs are public).

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const note = (title: string, msg: string) => console.log(`::notice title=${title}::${msg.replace(/\n/g, ' ')}`);

async function main() {
  const runs = await db.importRun.findMany({ orderBy: { createdAt: 'desc' }, take: 4 });
  for (const r of runs) {
    const [row] = await db.$queryRaw<Array<Record<string, bigint | number | null>>>`
      SELECT count(*) AS records,
        count(*) FILTER (WHERE status = 'ready') AS ready,
        count(*) FILTER (WHERE status = 'needs_review') AS review,
        count(*) FILTER (WHERE status = 'incomplete') AS incomplete,
        count(*) FILTER (WHERE phone IS NOT NULL) AS phone,
        count(*) FILTER (WHERE email IS NOT NULL) AS email,
        count(*) FILTER (WHERE website IS NOT NULL) AS website,
        count(*) FILTER (WHERE google_rating IS NOT NULL) AS rating,
        count(*) FILTER (WHERE jsonb_array_length(COALESCE(treatments, '[]'::jsonb)) > 0) AS services,
        count(*) FILTER (WHERE logo_url IS NOT NULL) AS logo,
        count(*) FILTER (WHERE cardinality(photo_urls) > 0) AS photos,
        count(*) FILTER (WHERE crawl->'imageCandidates' IS NOT NULL) AS read_by_new_code
      FROM import_places WHERE run_id = ${r.id}::uuid`;
    const n = (k: string) => Number(row[k] ?? 0);
    note(`run ${r.createdAt.toISOString().slice(0, 16)} ${r.provider} ${r.status}`,
      `records ${n('records')}: ready ${n('ready')}, review ${n('review')}, incomplete ${n('incomplete')} | phone ${n('phone')}, email ${n('email')}, website ${n('website')}, rating ${n('rating')} | services ${n('services')}, logo ${n('logo')}, photos ${n('photos')} | read by current website stage ${n('read_by_new_code')} | spent $${(Number(r.spentMicros) / 1e6).toFixed(4)}`);
    const sites = await db.$queryRaw<Array<{ site: string | null; n: bigint }>>`
      SELECT crawl->>'site' AS site, count(*) AS n FROM import_places WHERE run_id = ${r.id}::uuid GROUP BY 1 ORDER BY 2 DESC`;
    note(`websites ${r.createdAt.toISOString().slice(0, 16)}`, sites.map(s => `${s.site ?? 'not read'} ${Number(s.n)}`).join(', '));
    const reasons = await db.$queryRaw<Array<{ reason: string; n: bigint }>>`
      SELECT unnest(reasons) AS reason, count(*) AS n FROM import_places WHERE run_id = ${r.id}::uuid GROUP BY 1 ORDER BY 2 DESC`;
    if (reasons.length) note(`reasons ${r.createdAt.toISOString().slice(0, 16)}`, reasons.map(x => `${x.reason} ${Number(x.n)}`).join(', '));
    const kinds = await db.$queryRaw<Array<{ provider: string; field: string; n: bigint }>>`
      SELECT o.provider, o.field, count(*) AS n FROM field_observations o JOIN import_places p ON p.id = o.import_place_id
      WHERE p.run_id = ${r.id}::uuid AND o.field IN ('logo', 'photo', 'rating') GROUP BY 1, 2 ORDER BY 1, 2`;
    if (kinds.length) note(`image and rating observations ${r.createdAt.toISOString().slice(0, 16)}`, kinds.map(k => `${k.provider}/${k.field} ${Number(k.n)}`).join(', '));
  }
}

main()
  .catch(e => {
    console.log(`::error title=report::${e instanceof Error ? e.message : e}`);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
