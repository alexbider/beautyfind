// Stage 2C: editorial writing. One structured call per changed evidence packet (cached by evidence
// hash + prompt version), at most one repair call, reserved against the run budget and the run's
// editorial cap before dispatch. A draft that cannot reach 450 words stays short and flagged
// (needsMoreInfo) with the missing evidence listed for the admin; nothing is padded.

import { Prisma, type ImportPlace, type ImportRun } from '@prisma/client';
import { BudgetExceeded, commit, release, reserve, withCaps } from '../../../src/lib/import/budget';
import { buildPacket, countWords, packetHash, PROMPT_VERSION, templateDraft, WORDS_MIN, type EditorialRecord } from '../../../src/lib/import/editorial';
import { pricing, toMicros } from '../../../src/lib/import/pricing';
import { bump, db, heartbeat, log, pool, setStats, settings } from '../ctx';
import { writeEditorial } from '../editorialCall';

export type EditorialOutcome = 'written' | 'cached' | 'skipped' | 'budget' | 'failed' | 'transient';

const stored = (p: ImportPlace) => (p.editorial ?? null) as (Partial<EditorialRecord> & { skipped?: string; error?: string }) | null;

/** Writes (or reuses) the editorial draft of one record. `force` ignores the cache (admin "regenerate"). */
export async function editorialFor(p: ImportPlace, run: ImportRun | null, opts: { force?: boolean; claimed?: boolean; bookingOnline?: boolean; counter?: { calls: number } } = {}): Promise<EditorialOutcome> {
  const s = await settings();
  if (!s.editorialEnabled) return 'skipped';
  const packet = buildPacket(p, { claimed: opts.claimed, bookingOnline: opts.bookingOnline });
  const hash = packetHash(packet);
  const cur = stored(p);
  if (!opts.force && cur?.evidenceHash === hash && cur.promptVersion === PROMPT_VERSION && !cur.skipped) return 'cached';
  if (opts.counter && opts.counter.calls >= s.editorialMaxPerRun) return 'budget';

  const est = toMicros(pricing().editorial.perProfileUsd);
  const key = `editorial:${p.id}:${hash}:${PROMPT_VERSION}${opts.force ? `:f${Date.now()}` : ''}`;
  try {
    const st = await reserve(db, withCaps({ runId: run?.id ?? null, provider: 'anthropic', endpoint: 'editorial', requestKey: key, estimateMicros: est, caps: run ? [{ key: `editorial:run:${run.id}`, limitMicros: toMicros(s.editorialBudgetUsd) }] : [] }));
    if (st === 'exists' && !opts.force) return 'cached';
  } catch (e) {
    if (e instanceof BudgetExceeded) {
      await db.importPlace.update({ where: { id: p.id }, data: { editorial: { skipped: 'budget', evidenceHash: hash, promptVersion: 'none', generatedAt: new Date().toISOString() } as Prisma.InputJsonValue } });
      return 'budget';
    }
    throw e;
  }
  if (opts.counter) opts.counter.calls++;
  const r = await writeEditorial(packet);
  if (!r.ok) {
    if (r.transient) {
      await release(db, key, r.error);
      return 'transient';
    }
    await commit(db, key, toMicros(r.costUsd ?? 0), est);
    if (r.fatal) throw new Error(`editorial: ${r.error}`);
    // The writer answered badly: the deterministic template draft stands in, clearly labelled.
    const draft = templateDraft(packet);
    const words = countWords(draft.description);
    const rec: EditorialRecord & { error: string } = {
      ...draft, words, evidenceHash: hash, promptVersion: PROMPT_VERSION, model: 'template', generatedAt: new Date().toISOString(),
      needsMoreInfo: words < WORDS_MIN || draft.insufficientEvidence, violations: [], repairs: 0, inputTokens: r.inputTokens ?? 0, outputTokens: r.outputTokens ?? 0, costUsd: r.costUsd ?? 0, error: r.error,
    };
    await db.importPlace.update({ where: { id: p.id }, data: { editorial: rec as unknown as Prisma.InputJsonValue, costs: { ...((p.costs as object) ?? {}), editorialUsd: (((p.costs as { editorialUsd?: number }) ?? {}).editorialUsd ?? 0) + (r.costUsd ?? 0) } as Prisma.InputJsonValue } });
    return 'failed';
  }
  await commit(db, key, toMicros(r.costUsd), est);
  const words = countWords(r.output.description);
  const rec: EditorialRecord = {
    ...r.output, words, evidenceHash: hash, promptVersion: PROMPT_VERSION, model: r.model, generatedAt: new Date().toISOString(),
    needsMoreInfo: words < WORDS_MIN || r.output.insufficientEvidence, violations: r.violations, repairs: r.repairs, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd,
  };
  const costs = (p.costs as Record<string, number> | null) ?? {};
  await db.importPlace.update({
    where: { id: p.id },
    data: { editorial: rec as unknown as Prisma.InputJsonValue, costs: { ...costs, editorialUsd: (costs.editorialUsd ?? 0) + r.costUsd, editorialTokensIn: (costs.editorialTokensIn ?? 0) + r.inputTokens, editorialTokensOut: (costs.editorialTokensOut ?? 0) + r.outputTokens } as Prisma.InputJsonValue },
  });
  return 'written';
}

/** Import runs: every extracted record of the run gets a draft (or a cached one). Batches of six, two calls at a time. */
export async function editorialStage(run: ImportRun): Promise<boolean> {
  const s = await settings();
  if (!s.editorialEnabled) return false;
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM import_places WHERE run_id = ${run.id}::uuid AND status = 'extracted'
      AND (editorial IS NULL OR editorial->>'promptVersion' IS DISTINCT FROM ${PROMPT_VERSION})
    ORDER BY created_at ASC LIMIT 6`;
  if (!rows.length) return false;
  await heartbeat(run.id);
  const stats = (run.stats ?? {}) as { counters?: Record<string, number> };
  const counter = { calls: stats.counters?.editorialCalls ?? 0 };
  const before = counter.calls;
  const counts: Record<string, number> = {};
  let budgetOut = false;
  let transient = 0;
  await pool(rows, 2, async ({ id }) => {
    if (budgetOut) return;
    const p = await db.importPlace.findUniqueOrThrow({ where: { id } });
    try {
      const r = await editorialFor(p, run, { counter });
      counts[`editorial_${r}`] = (counts[`editorial_${r}`] ?? 0) + 1;
      if (r === 'budget') budgetOut = true;
      if (r === 'transient') transient++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/editorial: (no_credit|auth|model_not_found)/.test(msg)) {
        await setStats(run.id, { lastEditorialError: msg.slice(0, 200) });
        throw e;
      }
      counts.editorial_failed = (counts.editorial_failed ?? 0) + 1;
      await setStats(run.id, { lastEditorialError: msg.slice(0, 200) });
      await db.importPlace.update({ where: { id }, data: { editorial: { error: msg.slice(0, 200), evidenceHash: null, promptVersion: PROMPT_VERSION, generatedAt: new Date().toISOString(), skipped: 'error' } as Prisma.InputJsonValue } });
    }
  });
  await bump(run.id, { ...counts, editorialCalls: counter.calls - before });
  if (budgetOut) {
    log('editorial budget used; remaining records keep their source text');
    await db.importPlace.updateMany({ where: { runId: run.id, status: 'extracted', editorial: { equals: Prisma.DbNull } }, data: { editorial: { skipped: 'budget', promptVersion: 'none' } } });
    return false;
  }
  if (transient >= rows.length) {
    await new Promise(r => setTimeout(r, 30_000));
  }
  return true;
}
