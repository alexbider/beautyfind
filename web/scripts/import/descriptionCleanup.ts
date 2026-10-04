// Finds stored descriptions and FAQs that break the text rules (src/lib/import/textRules.ts): sentences
// about missing or unverified information, record language, generator language, English inside Hebrew,
// Latin street words, em dashes, emoji. Prints counts per rule, writes a CSV of the failing listings, and
// with --confirm queues a rewrite run (the same "כתיבה מחדש" the admin starts) for the listings the writer
// may change.
//
//   npm run import:description-cleanup                       dry run: counts + CSV
//   npm run import:description-cleanup -- --confirm --actor <userId>   queue rewrite runs
//   options: --out reports/description-cleanup.csv   --batch 50 (listings per run)   --budget 0.12 (USD per listing)
//            --rewritten-since 2026-10-03   also include listings whose import record carries a writer draft
//                                           from that date on under an older prompt version (a prompt change
//                                           re-queues what was already rewritten)
//            --limit 10                     queue only this many listings (one small batch to review first),
//                                           spread across the length tiers (sparse, normal, rich)
//            --cancel-queued                with --confirm: cancel the earlier "ניקוי תיאורים" runs still queued
//                                           or running, so only the new runs are picked up
//
// Never changed: claimed listings, listings whose text staff marked approved (editorial.ownerApproved) and the
// hand-written reference profiles (src/lib/import/reference.ts).
// Listings without an import record cannot be rewritten by the worker; the admin "gaps" view creates one
// (ensureImportRecords). The queued runs are picked up by the worker (npm run import:work -- --run <id>).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PrismaClient, type Prisma } from '@prisma/client';
import { buildPacket, lengthTier, PROMPT_VERSION, type LengthTier } from '../../src/lib/import/editorial';
import { isReferenceBranch } from '../../src/lib/import/reference';
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
  tier: LengthTier | '';
  why: 'text_rules' | 'older_prompt' | 'both';
  draftVersion: string;
  problems: TextProblem[];
  action: 'rewrite' | 'skipped_claimed' | 'skipped_approved' | 'skipped_reference' | 'needs_import_record';
}

async function main() {
  const confirm = process.argv.includes('--confirm');
  const cancelQueued = process.argv.includes('--cancel-queued');
  const out = arg('out') ?? 'reports/description-cleanup.csv';
  const batch = Math.max(1, Math.min(200, Number(arg('batch') ?? 50)));
  const perListingUsd = Math.max(0.01, Number(arg('budget') ?? 0.12));
  const limit = arg('limit') ? Math.max(1, Number(arg('limit'))) : null;
  const since = arg('rewritten-since') ? new Date(arg('rewritten-since')!) : null;
  if (since && Number.isNaN(since.getTime())) throw new Error('--rewritten-since needs a date (2026-10-03)');

  const branches = await db.branch.findMany({
    where: { OR: [{ description: { not: null } }, { faqs: { not: [] } }] },
    select: { id: true, name: true, cityName: true, status: true, isClaimed: true, websiteUrl: true, description: true, faqs: true, editorial: true, treatments: { select: { name: true, isPublished: true } } },
    orderBy: [{ regionSlug: 'asc' }, { name: 'asc' }],
  });
  const places = await db.importPlace.findMany({ where: { branchId: { in: branches.map(b => b.id) }, status: { in: ['approved', 'merged'] } } });
  const placeOf = new Map(places.map(p => [p.branchId!, p]));

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
    const place = placeOf.get(b.id);
    const draft = (place?.editorial ?? null) as { promptVersion?: string; model?: string; generatedAt?: string } | null;
    // A draft the writer produced under an older prompt version, from the given date on (not the template fallback).
    const older = !!since && !!draft?.generatedAt && new Date(draft.generatedAt) >= since && !!draft.model && draft.model !== 'template' && draft.promptVersion !== PROMPT_VERSION;
    if (!problems.length && !older) continue;
    for (const p of problems) {
      perCode.set(p.code, (perCode.get(p.code) ?? 0) + 1);
      const k = `${p.code}:${p.match}`;
      perMatch.set(k, (perMatch.get(k) ?? 0) + 1);
    }
    const ownerApproved = (b.editorial as { ownerApproved?: boolean } | null)?.ownerApproved === true;
    const action: Row['action'] = isReferenceBranch(b.id) ? 'skipped_reference' : b.isClaimed ? 'skipped_claimed' : ownerApproved ? 'skipped_approved' : place ? 'rewrite' : 'needs_import_record';
    const tier: Row['tier'] = place ? lengthTier(buildPacket(place, { claimed: b.isClaimed, publishedTreatments: b.treatments.filter(t => t.isPublished).map(t => t.name) })) : '';
    rows.push({ branchId: b.id, name: b.name, city: b.cityName, status: b.status, claimed: b.isClaimed, ownerApproved, hasImportRecord: !!place, tier, why: problems.length && older ? 'both' : older ? 'older_prompt' : 'text_rules', draftVersion: draft?.promptVersion ?? '', problems, action });
  }

  const header = ['branch_id', 'name', 'city', 'status', 'claimed', 'owner_approved', 'has_import_record', 'tier', 'why', 'draft_prompt_version', 'action', 'problems'];
  const csv = [header.join(','), ...rows.map(r => [r.branchId, r.name, r.city, r.status, r.claimed ? 'yes' : 'no', r.ownerApproved ? 'yes' : 'no', r.hasImportRecord ? 'yes' : 'no', r.tier, r.why, r.draftVersion, r.action, r.problems.map(problemCode).join(' | ')].map(csvCell).join(','))].join('\n');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `﻿${csv}\n`);

  console.log('by rule:');
  for (const [k, n] of [...perCode.entries()].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(6)}  ${k}`);
  console.log('most frequent matches:');
  for (const [k, n] of [...perMatch.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${String(n).padStart(6)}  ${k}`);
  const count = (a: Row['action']) => rows.filter(r => r.action === a).length;
  const tiers = (list: Row[]) => (['sparse', 'normal', 'rich'] as const).map(t => `${t}=${list.filter(r => r.tier === t).length}`).join(' ');
  const candidates = rows.filter(r => r.action === 'rewrite');
  console.log(`SUMMARY scanned=${branches.length} failing=${rows.length} text_rules=${rows.filter(r => r.why !== 'older_prompt').length} older_prompt=${rows.filter(r => r.why !== 'text_rules').length} rewrite=${count('rewrite')} needs_import_record=${count('needs_import_record')} skipped_claimed=${count('skipped_claimed')} skipped_approved=${count('skipped_approved')} skipped_reference=${count('skipped_reference')} tiers(rewrite): ${tiers(candidates)} csv=${out}`);

  // The listings to queue: all candidates, or with --limit a spread across the tiers (round robin, so a
  // review batch of ten holds every tier).
  let ids = candidates.map(r => r.branchId);
  if (limit && limit < candidates.length) {
    const byTier = (['rich', 'normal', 'sparse'] as const).map(t => candidates.filter(r => r.tier === t));
    const picked: Row[] = [];
    for (let i = 0; picked.length < limit && byTier.some(l => l.length > i); i++) for (const l of byTier) if (l[i] && picked.length < limit) picked.push(l[i]);
    ids = picked.map(r => r.branchId);
    console.log(`LIMIT ${limit}: queueing ${ids.length} of ${candidates.length} candidates (${tiers(picked)})`);
  }

  if (!confirm) return console.log(`dry run: nothing queued (review the CSV, then add --confirm --actor <userId>)${cancelQueued ? '; --cancel-queued would cancel the earlier queued runs' : ''}`);

  const actorId = arg('actor') ?? (await db.user.findFirst({ where: { opsRole: 'ops' }, select: { id: true } }))?.id;
  if (!actorId) throw new Error('--actor <userId> is required (no ops user found)');

  if (cancelQueued) {
    const old = await db.importRun.findMany({ where: { provider: 'enhance', status: { in: ['queued', 'running', 'paused'] }, label: { startsWith: 'ניקוי תיאורים' } }, select: { id: true, label: true, status: true } });
    for (const r of old) {
      await db.importRun.update({ where: { id: r.id }, data: { status: 'canceled', lockedBy: null, lockedUntil: null, finishedAt: new Date(), error: 'בוטל: הרשימה נבנתה מחדש עם כללי כתיבה חדשים' } });
      await db.auditLog.create({ data: { actorId, action: 'import_run_cancel', subjectType: 'import_run', subjectId: r.id, meta: { ref: r.label, was: r.status, source: 'scripts/import/descriptionCleanup.ts', reason: 'requeued under a new prompt version' } } });
    }
    console.log(`CANCELED ${old.length} earlier rewrite run(s): ${old.map(r => `${r.label} (${r.status})`).join(', ') || 'none'}`);
  }

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
    await db.auditLog.create({ data: { actorId, action: 'import_run_create', subjectType: 'import_run', subjectId: run.id, meta: { ref: run.label, source: 'scripts/import/descriptionCleanup.ts', listings: chunk.length, promptVersion: PROMPT_VERSION } } });
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
