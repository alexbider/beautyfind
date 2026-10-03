// Finds published treatment records whose name is not a treatment (src/lib/seo/treatmentHygiene.ts): product
// lines, sentences, article titles, lone function words. The pages already leave these out of meta
// descriptions, city aggregates and the business schema; this script lists them for staff to rename,
// recategorize or unpublish. Read-only: it changes nothing.
//
//   npm run import:treatment-hygiene                      counts + CSV (reports/treatment-hygiene.csv)
//   npm run import:treatment-hygiene -- --out path.csv    choose the CSV path

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { treatmentNameProblem, type TreatmentNameProblem } from '../../src/lib/seo/treatmentHygiene';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function main() {
  const db = new PrismaClient();
  const out = arg('out') ?? 'reports/treatment-hygiene.csv';
  const rows = await db.treatment.findMany({
    where: { isPublished: true, branch: { status: 'live', business: { status: 'live' } } },
    select: { id: true, name: true, categorySlug: true, priceAgorot: true, priceType: true, source: true, branch: { select: { id: true, name: true, cityName: true, regionSlug: true, slug: true } } },
    orderBy: [{ branch: { cityName: 'asc' } }, { name: 'asc' }],
  });
  const flagged = rows.map(r => ({ ...r, problem: treatmentNameProblem(r.name) })).filter((r): r is typeof r & { problem: TreatmentNameProblem } => r.problem !== null);
  const counts: Record<string, number> = {};
  for (const r of flagged) counts[r.problem] = (counts[r.problem] ?? 0) + 1;

  const header = ['treatment_id', 'branch_id', 'business', 'city', 'region', 'name', 'problem', 'category', 'price_type', 'price_nis', 'source', 'admin_href'];
  const lines = flagged.map(r => [
    r.id, r.branch.id, r.branch.name, r.branch.cityName, r.branch.regionSlug, r.name, r.problem, r.categorySlug ?? '', r.priceType, r.priceAgorot != null ? r.priceAgorot / 100 : '', r.source ?? '',
    `/ops/businesses?branch=${r.branch.id}`,
  ].map(csvCell).join(','));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `﻿${[header.join(','), ...lines].join('\n')}\n`);

  console.log(`Published treatments: ${rows.length}. Not treatment names: ${flagged.length}.`);
  for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);
  console.log(`CSV: ${out}`);
  await db.$disconnect();
}

main().catch(e => {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
