// Finds stored descriptions and FAQs that break the text rules (src/lib/import/textRules.ts): sentences
// about missing or unverified information, generator language, English inside Hebrew, em dashes, emoji.
// Prints counts per rule, writes a CSV of the failing listings, and with --confirm queues a rewrite run
// (the same "כתיבה מחדש" the admin starts) for the listings the writer may change.
//
//   npm run import:description-cleanup                       dry run: counts + CSV
//   npm run import:description-cleanup -- --confirm --actor <userId>   queue rewrite runs
//   options: --out reports/description-cleanup.csv   --batch 50 (listings per run)   --budget 0.08 (USD per listing)
//
// Never changed: claimed listings and listings whose text staff marked approved (editorial.ownerApproved).
// Listings without an import record cannot be rewritten by the worker; the admin "gaps" view creates one
// (ensureImportRecords). The queued runs are picked up by the worker (npm run import:work -- --run <id>).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PrismaClient, type Prisma } from '@prisma/client';
import { problemCode, textProblems, type TextProblem } from '../../src/lib/import/textRules';

const db = new PrismaClient();
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const csvCell = (v: string | number | null | undefined) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const USD = 1_000_000;

interface Row {
  branchId: string;
  name: string;
  city: string;
  status: string;
  claimed: boolean;
  ownerApproved: boolean;
  hasImportRecord: boolean;
  problems: TextProblem[];
  action: 'rewrite' | 'skipped_claimed' | 'skipped_approved' | 'needs_import_record';
}

async function main() {
  const confirm = process.argv.includes('--confirm');
  const out = arg('out') ?? 'reports/description-cleanup.csv';
  const batch = Math.max(1, Math.min(200, Number(arg('batch') ?? 50)));
  const perListingUsd = Math.max(0.01, Number(arg('budget') ?? 0.08));

  const branches = await db.branch.findMany({
    where: { OR: [{ description: { not: null } }, { faqs: { not: [] } }] },
    select: { id: true, name: true, cityName: true, status: true, isClaimed: true, websiteUrl: true, description: true, faqs: true, editorial: true, treatments: { select: { name: true } } },
    orderBy: [{ regionSlug: 'asc' }, { name: 'asc' }],
  });
  const places = await db.importPlace.findMany({ where: { branchId: { in: branches.map(b => b.id) }, status: { in: ['approved', 'merged'] } }, select: { branchId: true } });
  const withPlace = new Set(places.map(p => p.branchId!));

  const rows: Row[] = [];
  const perCode = new Map<string, number>();
  const perMatch = new Map<string, number>();
  for (const b of branches) {
    const faqs = Array.isArray(b.faqs) ? (b.faqs as Array<{ q?: string; a?: string }>) : [];
    const text = [b.description ?? '', ...faqs.flatMap(f => [f.q ?? '', f.a ?? ''])].join('\n');
    let domain = '';
    try {
      domain = b.websiteUrl ? new URL(b.websiteUrl).hostname.replace(/^www\./, '') : '';
    } catch {
      domain = '';
    }
    const problems = textProblems(text, [b.name, domain, ...b.treatments.map(t => t.name)]);
    if (!problems.length) continue;
    for (const p of problems) {
      perCode.set(p.code, (perCode.get(p.code) ?? 0) + 1);
      const k = `${p.code}:${p.match}`;
      perMatch.set(k, (perMatch.get(k) ?? 0) + 1);
    }
    const ownerApproved = (b.editorial as { ownerApproved?: boolean } | null)?.ownerApproved === true;
    const action: Row['action'] = b.isClaimed ? 'skipped_claimed' : ownerApproved ? 'skipped_approved' : withPlace.has(b.id) ? 'rewrite' : 'needs_import_record';
    rows.push({ branchId: b.id, name: b.name, city: b.cityName, status: b.status, claimed: b.isClaimed, ownerApproved, hasImportRecord: withPlace.has(b.id), problems, action });
  }

  const header = ['branch_id', 'name', 'city', 'status', 'claimed', 'owner_approved', 'has_import_record', 'action', 'problems'];
  const csv = [header.join(','), ...rows.map(r => [r.branchId, r.name, r.city, r.status, r.claimed ? 'yes' : 'no', r.ownerApproved ? 'yes' : 'no', r.hasImportRecord ? 'yes' : 'no', r.action, r.problems.map(problemCode).join(' | ')].map(csvCell).join(','))].join('\n');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `﻿${csv}\n`);

  console.log('by rule:');
  for (const [k, n] of [...perCode.entries()].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(6)}  ${k}`);
  console.log('most frequent matches:');
  for (const [k, n] of [...perMatch.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${String(n).padStart(6)}  ${k}`);
  const count = (a: Row['action']) => rows.filter(r => r.action === a).length;
  console.log(`SUMMARY scanned=${branches.length} failing=${rows.length} rewrite=${count('rewrite')} needs_import_record=${count('needs_import_record')} skipped_claimed=${count('skipped_claimed')} skipped_approved=${count('skipped_approved')} csv=${out}`);
  if (!confirm) return console.log('dry run: nothing queued (review the CSV, then add --confirm --actor <userId>)');

  const actorId = arg('actor') ?? (await db.user.findFirst({ where: { opsRole: 'ops' }, select: { id: true } }))?.id;
  if (!actorId) throw new Error('--actor <userId> is required (no ops user found)');
  const ids = rows.filter(r => r.action === 'rewrite').map(r => r.branchId);
  const runs: string[] = [];
  for (let i = 0; i < ids.length; i += batch) {
    const chunk = ids.slice(i, i + batch);
    const scope = { branchIds: chunk, steps: ['editorial', 'regenerate'], regenerate: true, auto: false, focus: ['about', 'faq'] };
    const run = await db.importRun.create({
      data: {
        label: `ניקוי תיאורים ${Math.floor(i / batch) + 1}/${Math.ceil(ids.length / batch)}`.slice(0, 80),
        provider: 'enhance',
        scope: scope as Prisma.InputJsonValue,
        recordLimit: chunk.length,
        budgetMicros: BigInt(Math.ceil(chunk.length * perListingUsd * USD)),
        maxRequests: 0,
        createdById: actorId,
      },
    });
    await db.auditLog.create({ data: { actorId, action: 'import_run_create', subjectType: 'import_run', subjectId: run.id, meta: { ref: run.label, source: 'scripts/import/descriptionCleanup.ts', listings: chunk.length } } });
    runs.push(run.id);
  }
  console.log(`QUEUED ${runs.length} rewrite runs for ${ids.length} listings:`);
  for (const id of runs) console.log(`  npm run import:work -- --run ${id}`);
}

main()
  .catch(e => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
