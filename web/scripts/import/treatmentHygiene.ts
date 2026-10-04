// Treatment records that are not treatments (src/lib/seo/treatmentHygiene.ts), and records whose stored
// category disagrees with the service matcher (src/lib/import/services.ts). The pages already leave the
// non-treatments out of meta descriptions, city aggregates and the business schema.
//
//   npm run import:treatment-hygiene                      dry run: counts + staff CSV, nothing changes
//   npm run import:treatment-hygiene -- --confirm         unpublish sentences and article titles (soft hide),
//                                                         then write the staff CSV for what is left
//   npm run import:treatment-hygiene -- --republish <csv> undo: publish again the ids listed in an
//                                                         "unpublished" CSV from an earlier --confirm run
//   options: --out reports/treatment-hygiene.csv   --undo-out reports/treatment-hygiene-unpublished.csv
//
// The staff CSV lists products, packages, lone or foreign words, and treatments whose stored category is
// not the one the matcher reads from the name (problem "category", with the matcher's answer in
// matcher_category). Sentences and article titles are hidden by --confirm rather than listed: they are
// never a service. Claimed listings are never touched. Every hide is written to the undo CSV and to the
// audit log (action treatment_unpublish, one row per listing), so --republish can reverse it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { matchService } from '../../src/lib/import/services';
import { treatmentNameProblem, type TreatmentNameProblem } from '../../src/lib/seo/treatmentHygiene';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const writeCsv = (path: string, header: string[], rows: unknown[][]) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `﻿${[header.join(','), ...rows.map(r => r.map(csvCell).join(','))].join('\n')}\n`);
};

/** Problems that --confirm hides: text that can never be a service. */
const HIDE: ReadonlySet<TreatmentNameProblem> = new Set<TreatmentNameProblem>(['sentence', 'article']);
/** Problems staff review by hand: real offers filed wrong, or words that need a rename. */
const REVIEW: ReadonlySet<TreatmentNameProblem> = new Set<TreatmentNameProblem>(['product', 'package', 'function_word', 'empty', 'trailing_comma']);

type Problem = TreatmentNameProblem | 'category';

const db = new PrismaClient();
const SOURCE = 'scripts/import/treatmentHygiene.ts';

async function republish(path: string) {
  if (!existsSync(path)) throw new Error(`undo file not found: ${path}`);
  const lines = readFileSync(path, 'utf8').replace(/^﻿/, '').split('\n').slice(1).filter(Boolean);
  const ids = lines.map(l => l.split(',')[0].trim()).filter(id => /^[0-9a-f-]{36}$/i.test(id));
  const rows = await db.treatment.findMany({ where: { id: { in: ids }, isPublished: false }, select: { id: true, branchId: true, name: true } });
  const byBranch = new Map<string, typeof rows>();
  for (const r of rows) byBranch.set(r.branchId, [...(byBranch.get(r.branchId) ?? []), r]);
  let n = 0;
  for (const [branchId, list] of byBranch) {
    await db.$transaction(async tx => {
      await tx.treatment.updateMany({ where: { id: { in: list.map(r => r.id) } }, data: { isPublished: true } });
      await tx.auditLog.create({ data: { actorId: null, action: 'treatment_republish', subjectType: 'branch', subjectId: branchId, meta: { ids: list.map(r => r.id), names: list.map(r => r.name), source: SOURCE, from: path } } });
    });
    n += list.length;
  }
  console.log(`REPUBLISHED ${n} of ${ids.length} listed records (${ids.length - n} were already published or gone).`);
}

async function main() {
  const undoFile = arg('republish');
  if (undoFile) return republish(undoFile);

  const confirm = process.argv.includes('--confirm');
  const out = arg('out') ?? 'reports/treatment-hygiene.csv';
  const undoOut = arg('undo-out') ?? 'reports/treatment-hygiene-unpublished.csv';

  const rows = await db.treatment.findMany({
    where: { isPublished: true, branch: { status: 'live', business: { status: 'live' } } },
    select: { id: true, name: true, categorySlug: true, priceAgorot: true, priceType: true, source: true, branch: { select: { id: true, name: true, cityName: true, regionSlug: true, isClaimed: true } } },
    orderBy: [{ branch: { cityName: 'asc' } }, { branch: { name: 'asc' } }, { name: 'asc' }],
  });

  const classified = rows.map(r => {
    const nameProblem = treatmentNameProblem(r.name);
    const matcher = nameProblem === null ? matchService(r.name)?.category ?? null : null;
    const problem: Problem | null = nameProblem ?? (matcher && r.categorySlug && matcher !== r.categorySlug ? 'category' : null);
    return { ...r, problem, matcher };
  });

  const toHide = classified.filter(r => r.problem && HIDE.has(r.problem as TreatmentNameProblem));
  const hideable = toHide.filter(r => !r.branch.isClaimed);
  const counts: Record<string, number> = {};
  for (const r of classified) if (r.problem) counts[r.problem] = (counts[r.problem] ?? 0) + 1;

  console.log(`Published treatments: ${rows.length}. Flagged: ${classified.filter(r => r.problem).length}.`);
  for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);
  console.log(`To hide (sentence + article): ${toHide.length}, on unclaimed listings: ${hideable.length}, on claimed listings (kept): ${toHide.length - hideable.length}.`);

  let hidden = 0;
  if (confirm && hideable.length) {
    writeCsv(undoOut, ['treatment_id', 'branch_id', 'business', 'name', 'problem'], hideable.map(r => [r.id, r.branch.id, r.branch.name, r.name, r.problem]));
    const byBranch = new Map<string, typeof hideable>();
    for (const r of hideable) byBranch.set(r.branch.id, [...(byBranch.get(r.branch.id) ?? []), r]);
    for (const [branchId, list] of byBranch) {
      await db.$transaction(async tx => {
        await tx.treatment.updateMany({ where: { id: { in: list.map(r => r.id) }, isPublished: true }, data: { isPublished: false } });
        await tx.auditLog.create({ data: { actorId: null, action: 'treatment_unpublish', subjectType: 'branch', subjectId: branchId, meta: { ids: list.map(r => r.id), names: list.map(r => r.name), problems: list.map(r => r.problem), source: SOURCE, undo: undoOut } } });
      });
      hidden += list.length;
    }
    console.log(`UNPUBLISHED ${hidden} records on ${byBranch.size} listings. Undo list: ${undoOut} (npm run import:treatment-hygiene -- --republish ${undoOut}).`);
  }

  // The staff CSV: what is left for a person to rename, recategorize or delete. After --confirm the hidden
  // records are gone from it; in a dry run they are listed too, marked as "would hide".
  const review = classified.filter(r => r.problem && (REVIEW.has(r.problem as TreatmentNameProblem) || r.problem === 'category' || (!confirm && HIDE.has(r.problem as TreatmentNameProblem)) || (confirm && HIDE.has(r.problem as TreatmentNameProblem) && r.branch.isClaimed)));
  const header = ['treatment_id', 'branch_id', 'business', 'city', 'region', 'claimed', 'name', 'problem', 'action', 'category', 'matcher_category', 'price_type', 'price_nis', 'source', 'admin_href'];
  writeCsv(out, header, review.map(r => [
    r.id, r.branch.id, r.branch.name, r.branch.cityName, r.branch.regionSlug, r.branch.isClaimed ? 'yes' : 'no', r.name, r.problem,
    HIDE.has(r.problem as TreatmentNameProblem) ? (r.branch.isClaimed ? 'claimed: review by hand' : confirm ? 'hidden' : 'would hide with --confirm') : r.problem === 'category' ? 'recategorize' : r.problem === 'trailing_comma' ? 'rename: drop the comma' : 'review',
    r.categorySlug ?? '', r.matcher ?? '', r.priceType, r.priceAgorot != null ? r.priceAgorot / 100 : '', r.source ?? '', `/ops/businesses?branch=${r.branch.id}`,
  ]));
  console.log(`CSV: ${out} (${review.length} rows)`);
  if (!confirm) console.log('dry run: nothing changed (add --confirm to hide sentences and article titles)');
}

main()
  .catch(e => {
    console.error(e instanceof Error ? e.stack ?? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
