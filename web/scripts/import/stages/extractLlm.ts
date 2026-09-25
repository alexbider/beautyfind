// Optional LLM step (settings.llmEnabled, off by default). With it off, enriched records go straight
// to checking. With it on, each record with website text costs one Claude call, reserved against the
// run's separate LLM budget; only facts with a verified quote from the page are kept.

import { Prisma, type ImportRun } from '@prisma/client';
import { BudgetExceeded, commit, release, reserve, withCaps } from '../../../src/lib/import/budget';
import { pricing, toMicros } from '../../../src/lib/import/pricing';
import { serviceKey } from '../../../src/lib/import/services';
import { bump, db, heartbeat, log, pool, setStats, settings } from '../ctx';
import { extract, keepEvidenced } from '../extract';

let transientStreak = 0;

/** The website stage's services stay; the model adds new ones and fills missing prices. */
function mergeTreatments(current: unknown, found: Array<{ name: string; priceNis?: number | null }>): unknown[] {
  const list = (Array.isArray(current) ? current : []) as Array<{ name: string; priceNis?: number | null }>;
  const byKey = new Map(list.map(t => [serviceKey(t.name), { ...t }]));
  for (const t of found) {
    const cur = byKey.get(serviceKey(t.name));
    if (!cur) byKey.set(serviceKey(t.name), t);
    else if (cur.priceNis == null && t.priceNis != null) Object.assign(cur, t);
  }
  return [...byKey.values()].slice(0, 80);
}

export async function extractStage(run: ImportRun): Promise<boolean> {
  const s = await settings();
  if (!s.llmEnabled) {
    const r = await db.importPlace.updateMany({ where: { runId: run.id, status: 'enriched' }, data: { status: 'extracted', extractedAt: new Date() } });
    void r;
    return false;
  }
  const places = await db.importPlace.findMany({ where: { runId: run.id, status: 'enriched' }, orderBy: { enrichedAt: 'asc' }, take: 6 });
  if (!places.length) return false;
  await heartbeat(run.id);
  let fatal: string | null = null;
  let budgetOut = false;
  await pool(places, 2, async p => {
    if (fatal || budgetOut) return;
    const crawl = (p.crawl ?? {}) as Record<string, unknown>;
    const text = typeof crawl.text === 'string' ? crawl.text : '';
    const done = (data: Prisma.ImportPlaceUpdateInput) => db.importPlace.update({ where: { id: p.id }, data: { status: 'extracted', extractedAt: new Date(), ...data } });
    if (text.length < 200) return void (await done({}));

    const key = `llm:${run.id}:${p.id}`;
    const est = toMicros(pricing().llm.perRecordUsd);
    try {
      const st = await reserve(db, withCaps({ runId: run.id, provider: 'anthropic', endpoint: 'messages', requestKey: key, estimateMicros: est, caps: [{ key: `llm:run:${run.id}`, limitMicros: toMicros(s.llmBudgetUsd) }] }));
      if (st === 'exists') return void (await done({}));
    } catch (e) {
      if (e instanceof BudgetExceeded) {
        budgetOut = true;
        return void (await done({ crawl: { ...crawl, extractSkipped: 'budget' } }));
      }
      throw e;
    }
    const r = await extract({ name: p.name, address: p.address, types: p.types, text });
    if (!r.ok) {
      if (r.transient) {
        await release(db, key, r.error);
        transientStreak++;
        await db.importPlace.update({ where: { id: p.id }, data: { enrichedAt: new Date() } });
        return;
      }
      await commit(db, key, null, est);
      if (r.fatal) {
        fatal = r.error;
        return;
      }
      await setStats(run.id, { lastExtractError: r.error });
      return void (await done({ crawl: { ...crawl, extractError: r.error } }));
    }
    transientStreak = 0;
    await commit(db, key, null, est);
    const d = keepEvidenced(r.data, text);
    const now = new Date();
    if (d.treatments.length || d.categories.length) {
      await db.fieldObservation.createMany({
        data: [
          ...d.categories.map(c => ({ importPlaceId: p.id, field: 'category', value: c.slug, provider: 'llm', retrievedAt: now, confidence: 0.6, evidence: c.evidence.slice(0, 300), publishable: true })),
          ...d.treatments.map(t => ({ importPlaceId: p.id, field: 'service', value: t as unknown as Prisma.InputJsonValue, provider: 'llm', retrievedAt: now, confidence: 0.6, evidence: t.evidence.slice(0, 300), publishable: true })),
        ],
      });
    }
    await done({
      categories: d.categories.length ? [...new Set([...p.categories, ...d.categories.map(c => c.slug)])] : p.categories,
      businessType: d.businessType ?? undefined,
      treatments: d.treatments.length ? (mergeTreatments(p.treatments, d.treatments) as unknown as Prisma.InputJsonValue) : undefined,
      crawl: { ...crawl, notBeauty: !d.isBeautyBusiness, text: undefined },
    });
    await bump(run.id, { extracted: 1, tokensIn: r.inputTokens, tokensOut: r.outputTokens });
  });
  if (fatal) throw new Error(`Claude: ${fatal}`);
  if (budgetOut) {
    log('LLM budget used; remaining records continue without it');
    await db.importPlace.updateMany({ where: { runId: run.id, status: 'enriched' }, data: { status: 'extracted', extractedAt: new Date() } });
    return false;
  }
  if (transientStreak >= 6) {
    await new Promise(r => setTimeout(r, 60_000));
    transientStreak = 0;
  }
  return true;
}
