// What the writer did in one run: per listing, the draft's model, length, error and cost as stored on the
// import record (import_places.editorial), and totals. Read-only. For the worker's enhance runs, whose
// Actions log is not always reachable.
//
//   npm run import:editorial-report -- --run <import run id>
//   npm run import:editorial-report -- --run <id> --out reports/editorial-report.csv

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

interface Ed {
  model?: string;
  words?: number;
  error?: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  generatedAt?: string;
  needsMoreInfo?: boolean;
  violations?: string[];
  repairs?: number;
  skipped?: string;
  faqs?: unknown[];
  lengthTier?: string;
  proofread?: boolean;
  promptVersion?: string;
}

/** --run queue: every run the worker would still pick up (queued or running), oldest first. */
async function listQueue() {
  const runs = await db.importRun.findMany({ where: { status: { in: ['queued', 'running'] } }, orderBy: { createdAt: 'asc' }, select: { id: true, label: true, provider: true, status: true, createdAt: true, lockedUntil: true, recordLimit: true } });
  console.log(`QUEUE ${runs.length} run(s) queued or running`);
  for (const r of runs) console.log(`  ${r.status.padEnd(8)} ${r.provider.padEnd(10)} ${r.createdAt.toISOString()} ${r.id} "${r.label}" records=${r.recordLimit}${r.lockedUntil ? ` lockedUntil=${r.lockedUntil.toISOString()}` : ''}`);
}

async function main() {
  const runId = arg('run');
  if (!runId) throw new Error('--run <import run id> is required (or --run queue)');
  if (runId === 'queue') return listQueue();
  const out = arg('out') ?? 'reports/editorial-report.csv';
  const run = await db.importRun.findUnique({ where: { id: runId }, select: { id: true, label: true, status: true, error: true, stats: true, startedAt: true, finishedAt: true, scope: true } });
  if (!run) throw new Error(`run not found: ${runId}`);
  const scope = (run.scope ?? {}) as { branchIds?: string[] };
  const ids = scope.branchIds ?? [];
  const places = await db.importPlace.findMany({
    where: { branchId: { in: ids } },
    select: { branchId: true, name: true, editorial: true, costs: true },
  });
  const since = run.startedAt ?? new Date(0);

  console.log(`run ${run.id} "${run.label}" status=${run.status}${run.error ? ` error=${run.error}` : ''} started=${run.startedAt?.toISOString() ?? '-'} finished=${run.finishedAt?.toISOString() ?? '-'}`);
  const counters = (run.stats as { counters?: Record<string, number>; lastEditorialError?: string; failures?: string[] } | null) ?? {};
  if (counters.counters) console.log(`counters: ${JSON.stringify(counters.counters)}`);
  if (counters.lastEditorialError) console.log(`lastEditorialError: ${counters.lastEditorialError}`);
  if (counters.failures?.length) console.log(`failures: ${counters.failures.join(' | ')}`);

  const rows = places.map(p => {
    const ed = (p.editorial ?? {}) as Ed;
    const fresh = !!ed.generatedAt && new Date(ed.generatedAt) >= since;
    return { branchId: p.branchId!, name: p.name, fresh, model: ed.model ?? '', tier: ed.lengthTier ?? '', words: ed.words ?? '', faqs: Array.isArray(ed.faqs) ? ed.faqs.length : '', proofread: ed.proofread == null ? '' : ed.proofread ? 'yes' : 'no', promptVersion: ed.promptVersion ?? '', error: ed.error ?? ed.skipped ?? '', violations: (ed.violations ?? []).join(' | '), repairs: ed.repairs ?? '', needsMoreInfo: ed.needsMoreInfo ?? '', costUsd: ed.costUsd ?? '', inputTokens: ed.inputTokens ?? '', outputTokens: ed.outputTokens ?? '', generatedAt: ed.generatedAt ?? '' };
  });
  const header = ['branch_id', 'name', 'draft_from_this_run', 'model', 'tier', 'words', 'faqs', 'proofread', 'prompt_version', 'error', 'violations', 'repairs', 'needs_more_info', 'cost_usd', 'input_tokens', 'output_tokens', 'generated_at'];
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `﻿${[header.join(','), ...rows.map(r => [r.branchId, r.name, r.fresh ? 'yes' : 'no', r.model, r.tier, r.words, r.faqs, r.proofread, r.promptVersion, r.error, r.violations, r.repairs, r.needsMoreInfo, r.costUsd, r.inputTokens, r.outputTokens, r.generatedAt].map(csvCell).join(','))].join('\n')}\n`);

  const fresh = rows.filter(r => r.fresh);
  const by = (f: (r: (typeof rows)[number]) => string) => {
    const m = new Map<string, number>();
    for (const r of fresh) m.set(f(r), (m.get(f(r)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k || '(none)'}: ${n}`).join(', ');
  };
  console.log(`listings in scope: ${ids.length}, import records: ${places.length}, drafts written in this run: ${fresh.length}`);
  console.log(`by model: ${by(r => r.model)}`);
  console.log(`by tier: ${by(r => r.tier)}`);
  console.log(`proofread: ${by(r => r.proofread)}`);
  console.log(`by error: ${by(r => String(r.error).slice(0, 60))}`);
  const words = fresh.map(r => Number(r.words)).filter(n => Number.isFinite(n) && n > 0);
  if (words.length) console.log(`words: min ${Math.min(...words)}, median ${words.sort((a, b) => a - b)[Math.floor(words.length / 2)]}, max ${Math.max(...words)}`);
  const cost = fresh.reduce((n, r) => n + (Number(r.costUsd) || 0), 0);
  console.log(`cost recorded on the records: ${cost.toFixed(3)} USD`);
  for (const r of fresh.slice(0, 60)) console.log(`  ${r.model.padEnd(16)} ${String(r.tier).padEnd(6)} words=${String(r.words).padStart(4)} faqs=${String(r.faqs).padStart(2)} pr=${r.proofread || '-'} ${r.error ? `error=${String(r.error).slice(0, 90)} ` : ''}${r.violations ? `violations=${r.violations.slice(0, 80)} ` : ''}| ${r.branchId} ${r.name.slice(0, 40)}`);
  console.log(`CSV: ${out}`);
}

main()
  .catch(e => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
