// Stage 2C: editorial writing. One structured call per changed evidence packet (cached by evidence
// hash + prompt version), at most one repair call and one proofreading call, reserved against the run
// budget and the run's editorial cap before dispatch. The length bounds come from the packet's evidence
// tier (sparse, normal, rich); a draft that cannot reach its tier's floor stays short and flagged
// (needsMoreInfo) with the missing evidence listed for the admin; nothing is padded.

import { Prisma, type ImportPlace, type ImportRun } from '@prisma/client';
import { BudgetExceeded, commit, entryStatus, release, reserve, withCaps } from '../../../src/lib/import/budget';
import { buildPacket, countWords, lengthTier, packetHash, PROMPT_VERSION, templateDraft, WORDS_MIN, type EditorialRecord } from '../../../src/lib/import/editorial';
import { writerUsd } from '../../../src/lib/import/enrichPlan';
import { pricing, toMicros } from '../../../src/lib/import/pricing';
import { bump, db, heartbeat, log, pool, setStats, settings } from '../ctx';
import { writeEditorial } from '../editorialCall';

export type EditorialOutcome = 'written' | 'cached' | 'skipped' | 'budget' | 'failed' | 'transient';

const TRANSIENT_PASSES = 10; // about five minutes of rate limits or outages before the run stops with the reason
let transientPasses = 0;

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

  const est = toMicros(writerUsd(pricing(), s.llmProvider));
  const base = `editorial:${p.id}:${hash}:${PROMPT_VERSION}${opts.force ? `:f${Date.now()}` : ''}`;
  let key = base;
  const take = (k: string) => reserve(db, withCaps({ runId: run?.id ?? null, provider: s.llmProvider, endpoint: 'editorial', requestKey: k, estimateMicros: est, caps: run ? [{ key: `editorial:run:${run.id}`, limitMicros: toMicros(s.editorialBudgetUsd) }] : [] }));
  try {
    let st = await take(key);
    if (st === 'exists') {
      // No draft is stored for this evidence (checked above), so the entry under this key is a leftover:
      // a reservation from a worker that was stopped mid-call is given back and taken again; a settled
      // entry (paid, but the draft never reached the record) gets a fresh key. Treating it as "cached"
      // would leave the record unwritten and the stage selecting it forever.
      const prior = await entryStatus(db, key);
      if (prior === 'reserved') {
        await release(db, key, 'stale reservation: the worker stopped mid-call');
      } else {
        key = `${base}:r${Date.now()}`;
      }
      st = await take(key);
      if (st === 'exists') throw new Error('editorial: reservation could not be taken');
    }
  } catch (e) {
    if (e instanceof BudgetExceeded) {
      await db.importPlace.update({ where: { id: p.id }, data: { editorial: { skipped: 'budget', evidenceHash: hash, promptVersion: 'none', generatedAt: new Date().toISOString() } as Prisma.InputJsonValue } });
      return 'budget';
    }
    throw e;
  }
  if (opts.counter) opts.counter.calls++;
  const r = await writeEditorial(packet, s.llmProvider);
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
      ...draft, words, lengthTier: lengthTier(packet), proofread: false, evidenceHash: hash, promptVersion: PROMPT_VERSION, model: 'template', generatedAt: new Date().toISOString(),
      needsMoreInfo: words < WORDS_MIN || draft.insufficientEvidence, violations: [], repairs: 0, inputTokens: r.inputTokens ?? 0, outputTokens: r.outputTokens ?? 0, costUsd: r.costUsd ?? 0, error: r.error,
    };
    await db.importPlace.update({ where: { id: p.id }, data: { editorial: rec as unknown as Prisma.InputJsonValue, costs: { ...((p.costs as object) ?? {}), editorialUsd: (((p.costs as { editorialUsd?: number }) ?? {}).editorialUsd ?? 0) + (r.costUsd ?? 0) } as Prisma.InputJsonValue } });
    return 'failed';
  }
  await commit(db, key, toMicros(r.costUsd), est);
  const words = countWords(r.output.description);
  const rec: EditorialRecord = {
    ...r.output, words, lengthTier: lengthTier(packet), proofread: r.proofread, evidenceHash: hash, promptVersion: PROMPT_VERSION, model: r.model, generatedAt: new Date().toISOString(),
    needsMoreInfo: words < WORDS_MIN || r.output.insufficientEvidence, violations: r.violations, repairs: r.repairs, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd,
  };
  const costs = (p.costs as Record<string, number> | null) ?? {};
  await db.importPlace.update({
    where: { id: p.id },
    data: { editorial: rec as unknown as Prisma.InputJsonValue, costs: { ...costs, editorialUsd: (costs.editorialUsd ?? 0) + r.costUsd, editorialTokensIn: (costs.editorialTokensIn ?? 0) + r.inputTokens, editorialTokensOut: (costs.editorialTokensOut ?? 0) + r.outputTokens } as Prisma.InputJsonValue },
  });
  return 'written';
}

/** Import runs: every extracted record of the run gets a draft (or a cached one). `llmConcurrency` calls at a time, three batches' worth per pass. */
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
  let progress = 0; // rows that left the queue this pass (written, failed, skipped or budget)
  await pool(rows, s.llmConcurrency, async ({ id }) => {
    if (budgetOut) return;
    const p = await db.importPlace.findUniqueOrThrow({ where: { id } });
    try {
      const r = await editorialFor(p, run, { counter });
      counts[`editorial_${r}`] = (counts[`editorial_${r}`] ?? 0) + 1;
      if (r === 'budget') budgetOut = true;
      if (r === 'transient') transient++;
      else if (r !== 'cached') progress++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/editorial: (no_credit|auth|model_not_found)/.test(msg)) {
        await setStats(run.id, { lastEditorialError: msg.slice(0, 200) });
        throw e;
      }
      counts.editorial_failed = (counts.editorial_failed ?? 0) + 1;
      progress++;
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
  // Every pass must move the queue. A pass where the writer only answered with rate limits or outages
  // waits and tries again, up to TRANSIENT_PASSES in a row; then the run stops with the reason so staff
  // can continue it later instead of the run showing "writing" for hours.
  if (progress) transientPasses = 0;
  else if (transient) {
    if (++transientPasses >= TRANSIENT_PASSES) {
      const msg = `transient: the writer answered with rate limits or errors for ${TRANSIENT_PASSES} passes in a row`;
      await setStats(run.id, { lastEditorialError: msg });
      transientPasses = 0;
      throw new Error(`editorial: ${msg}`);
    }
    await new Promise(r => setTimeout(r, 30_000));
  } else {
    // Nothing written, nothing failed, nothing transient: these rows would come back forever. Leave them
    // for the admin with the reason instead.
    log(`editorial: ${rows.length} records made no progress, skipped`);
    await db.importPlace.updateMany({ where: { id: { in: rows.map(r => r.id) } }, data: { editorial: { skipped: 'error', error: 'no draft stored after the call', promptVersion: PROMPT_VERSION, generatedAt: new Date().toISOString() } } });
  }
  return true;
}
