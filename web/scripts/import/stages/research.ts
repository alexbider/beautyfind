// ChatGPT web research (OpenAI Responses API with the web_search tool) for the template sections a
// record still lacks after the provider, the website and the Apify actors. One call per record,
// held against the run budget, the per-run research cap and the monthly cap, settled from the usage
// the API reports. Facts arrive only with the page they were read on (src/lib/import/openai.ts) and
// are stored as observations; empty fields are filled; a website the model names is crawled
// afterwards by the website stage, which decides whether it belongs to the business.

import { Prisma, type ImportPlace, type ImportRun } from '@prisma/client';
import { CATEGORIES } from '../../../src/lib/catalog';
import { BudgetExceeded, commit, monthKey, release, reserve, uncertain, withCaps } from '../../../src/lib/import/budget';
import { emailDomain, siteHost } from '../../../src/lib/import/email';
import { openaiCostUsd, openaiErrorKind, RESEARCH_PROMPT_VERSION, RESEARCH_SCHEMA, RESEARCH_SYSTEM, researchFacts, researchMessage, researchTargets, type ResearchAnswer, type ResearchFacts } from '../../../src/lib/import/openai';
import { placeCoverage } from '../../../src/lib/import/placeCoverage';
import { cleanTeam } from '../../../src/lib/import/profileExtract';
import { pricing, toMicros } from '../../../src/lib/import/pricing';
import type { ImportedTreatment } from '../../../src/lib/import/rules';
import { serviceKey } from '../../../src/lib/import/services';
import type { Socials } from '../../../src/lib/import/socials';
import { expiryFor, mayPublish } from '../../../src/lib/import/sourcePolicy';
import { bump, db, hasMx, heartbeat, log, pool, setStats, settings, Stop } from '../ctx';
import { openaiConfigured, responses } from '../providers/openai';

export const PROVIDER = 'openai_research';
const BATCH = 5;
const MODEL = () => process.env.IMPORT_OPENAI_MODEL || pricing().openai.model;

/** Creates research tasks for the given records (a few per task, one call each). */
export async function seedResearchTasks(run: ImportRun, placeIds: string[]): Promise<number> {
  if (!placeIds.length) return 0;
  const tasks: Prisma.ImportTaskCreateManyInput[] = [];
  for (let i = 0; i < placeIds.length; i += BATCH) tasks.push({ runId: run.id, key: `research:${i}`, kind: 'research', params: { ids: placeIds.slice(i, i + BATCH) } });
  await db.importTask.createMany({ data: tasks, skipDuplicates: true });
  return placeIds.length;
}

/** Runs one pending research task. Returns false when none is left. */
export async function researchStage(run: ImportRun): Promise<boolean> {
  const task = await db.importTask.findFirst({ where: { runId: run.id, kind: 'research', status: 'pending' }, orderBy: { createdAt: 'asc' } });
  if (!task) return false;
  await heartbeat(run.id);
  const s = await settings();
  if (s.killSwitch) throw new Stop('kill switch on');
  if (!openaiConfigured() || !s.openaiEnabled || !s.researchEnabled) {
    const why = !openaiConfigured() ? 'OPENAI_API_KEY not set on the worker' : 'research disabled in settings';
    await db.importTask.updateMany({ where: { runId: run.id, kind: 'research', status: 'pending' }, data: { status: 'failed', error: why } });
    await setStats(run.id, { openaiMissingKey: !openaiConfigured() });
    log(`research: ${why}, tasks skipped`);
    return true;
  }
  const ids = ((task.params as { ids?: string[] }).ids ?? []);
  const counts: Record<string, number> = {};
  // `llmConcurrency` records at a time; a fatal answer (key, credit) or the kill switch ends the task at once.
  const halt: { fatal: string | null; stop: Stop | null } = { fatal: null, stop: null };
  await pool(ids, s.llmConcurrency, async id => {
    if (halt.fatal || halt.stop) return;
    await heartbeat(run.id);
    const p = await db.importPlace.findUnique({ where: { id } });
    if (!p) return;
    try {
      const r = await researchOne(run, p, s);
      counts[r] = (counts[r] ?? 0) + 1;
    } catch (e) {
      if (e instanceof Stop) {
        halt.stop = e;
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      if (/^research fatal:/.test(msg)) {
        halt.fatal = msg;
        return;
      }
      counts.failed = (counts.failed ?? 0) + 1;
      log('research failed', id, msg.slice(0, 160));
    }
  });
  if (halt.stop) throw halt.stop;
  const fatal = halt.fatal;
  await db.importTask.update({ where: { id: task.id }, data: { status: fatal ? 'failed' : 'done', found: counts.filled ?? 0, error: fatal } });
  await bump(run.id, Object.fromEntries(Object.entries(counts).map(([k, v]) => [`research_${k}`, v])));
  if (fatal) throw new Error(fatal.replace(/^research fatal: /, 'OpenAI research: '));
  return true;
}

type Outcome = 'filled' | 'nothing' | 'cached' | 'budget' | 'failed';

async function researchOne(run: ImportRun, p: ImportPlace, s: Awaited<ReturnType<typeof settings>>): Promise<Outcome> {
  const crawl = (p.crawl ?? {}) as Record<string, unknown> & { research?: { at?: string; version?: string; attempts?: number } };
  const cov = placeCoverage(p, { mapConfigured: true });
  const targets = researchTargets(cov.missing);
  if (!targets.length) return 'nothing';
  const attempt = (crawl.research?.attempts ?? 0) + 1;
  const requestKey = `research:${p.id}:${RESEARCH_PROMPT_VERSION}:${attempt}`;
  const price = pricing().openai;
  const estimate = toMicros(price.research.perRecordUsd);
  try {
    const st = await reserve(db, withCaps({
      runId: run.id, provider: 'openai', endpoint: 'responses/web_search', requestKey, estimateMicros: estimate,
      caps: [{ key: `research:run:${run.id}`, limitMicros: toMicros(s.researchBudgetUsd) }, { key: monthKey('openai_research'), limitMicros: toMicros(s.researchMonthlyUsd) }],
      meta: { placeId: p.id, targets: targets.length },
    }));
    if (st === 'exists') return 'cached';
  } catch (e) {
    if (e instanceof BudgetExceeded) {
      await setStats(run.id, { budgetHit: true, researchBudgetHit: e.scope });
      return 'budget';
    }
    throw e;
  }
  const known = [p.phone && 'phone', p.email && 'email', p.website && 'website', p.hours && 'opening hours', (Array.isArray(p.treatments) && p.treatments.length) && 'services'].filter((x): x is string => !!x);
  const r = await responses({
    model: MODEL(),
    instructions: RESEARCH_SYSTEM,
    input: researchMessage({ name: p.name, address: p.address, cityName: p.cityName, phone: p.phone, website: p.website, categories: p.categories.map(c => CATEGORIES.find(x => x.slug === c)?.name ?? c), known, missing: targets }),
    schema: { name: 'business_research', schema: RESEARCH_SCHEMA as unknown as Record<string, unknown>, strict: false },
    webSearch: { enabled: true, country: 'IL', maxCalls: price.research.maxSearchCalls },
    maxOutputTokens: 4000,
  });
  const note = (patch: Record<string, unknown>) => db.importPlace.update({ where: { id: p.id }, data: { crawl: { ...crawl, research: { ...(crawl.research ?? {}), at: new Date().toISOString(), version: RESEARCH_PROMPT_VERSION, attempts: attempt, model: MODEL(), ...patch } } as Prisma.InputJsonValue } });
  if (r.kind === 'not_sent') {
    await release(db, requestKey, r.message);
    await note({ error: r.message });
    return 'failed';
  }
  if (r.kind === 'uncertain') {
    await uncertain(db, requestKey, estimate, r.message);
    await note({ error: `uncertain: ${r.message}` });
    return 'failed';
  }
  if (r.kind === 'error') {
    await release(db, requestKey, r.message);
    await note({ error: `${r.code ?? r.status}: ${r.message}` });
    const why = openaiErrorKind(r.status, r.code, r.message);
    if (why === 'funds' || why === 'auth') throw new Error(`research fatal: ${r.code ?? r.status}: ${r.message}`);
    return 'failed';
  }
  const costUsd = openaiCostUsd(r.usage, price);
  await commit(db, requestKey, toMicros(costUsd), estimate);
  if (!r.json || typeof r.json !== 'object') {
    await note({ error: 'unreadable answer', costUsd, searchCalls: r.usage.searchCalls });
    return 'failed';
  }
  const facts = researchFacts(r.json as ResearchAnswer);
  const filled = await applyResearch(p, facts, s);
  await db.importPlace.update({
    where: { id: p.id },
    data: {
      costs: { ...((p.costs as object) ?? {}), researchUsd: (((p.costs as { researchUsd?: number }) ?? {}).researchUsd ?? 0) + costUsd } as Prisma.InputJsonValue,
    },
  });
  const fresh = await db.importPlace.findUniqueOrThrow({ where: { id: p.id }, select: { crawl: true } });
  const c2 = (fresh.crawl ?? {}) as Record<string, unknown>;
  await db.importPlace.update({
    where: { id: p.id },
    data: {
      crawl: {
        ...c2,
        research: { at: new Date().toISOString(), version: RESEARCH_PROMPT_VERSION, attempts: attempt, model: r.model, targets, filled, sources: facts.sources.slice(0, 20), notes: facts.notes, notFound: facts.notFound, dropped: facts.dropped, costUsd, searchCalls: r.usage.searchCalls, citations: r.citations.slice(0, 20) },
      } as Prisma.InputJsonValue,
    },
  });
  log(`research: ${p.name}: ${filled.length ? `filled ${filled.join(', ')}` : 'nothing new'} (${r.usage.searchCalls} searches, $${costUsd.toFixed(4)})`);
  return filled.length ? 'filled' : 'nothing';
}

type Obs = Prisma.FieldObservationCreateManyInput;

/** Cited facts onto the record: observations for everything, fills for empty fields only. Returns what was filled. */
export async function applyResearch(p: ImportPlace, f: ResearchFacts, s: Awaited<ReturnType<typeof settings>>): Promise<string[]> {
  const now = new Date();
  const crawl = (p.crawl ?? {}) as Record<string, unknown> & { editedFields?: string[] };
  const edited = new Set(crawl.editedFields ?? []);
  const obs: Obs[] = [];
  const add = (field: string, value: unknown, sourceUrl: string, confidence: number, evidence: string, status?: string) =>
    obs.push({ importPlaceId: p.id, field, value: value as Prisma.InputJsonValue, provider: PROVIDER, sourceUrl, retrievedAt: now, confidence, evidence: evidence.slice(0, 300), retention: expiryFor(PROVIDER) ? 'until_expiry' : 'permanent', expiresAt: expiryFor(PROVIDER), publishable: mayPublish(PROVIDER, field), status });
  const data: Prisma.ImportPlaceUpdateInput = {};
  const filled: string[] = [];
  const own = (u: string) => siteHost(u) && (siteHost(u) === (p.siteDomain ?? siteHost(f.website?.value)) );

  if (f.website) {
    add('website', f.website.value, f.website.sourceUrl, 0.6, 'Website named on a public page; the website stage checks it belongs to the business');
    if (!p.website && !edited.has('website')) {
      Object.assign(data, { website: f.website.value, websiteKind: f.websiteKind, siteDomain: f.websiteKind === 'own' ? siteHost(f.website.value) : null });
      filled.push('website');
    }
  }
  // Phone and opening hours come from the Google Business Profile or the website only; what ChatGPT
  // read elsewhere is kept as evidence and never written to the record.
  if (f.phone) add('phone', f.phone.value, f.phone.sourceUrl, own(f.phone.sourceUrl) ? 0.6 : 0.4, 'Phone on a public page (evidence only)', 'evidence');
  if (f.whatsapp) {
    add('whatsapp', f.whatsapp.value, f.whatsapp.sourceUrl, 0.6, 'WhatsApp number on a public page', 'published');
    if (!p.whatsapp) {
      data.whatsapp = f.whatsapp.value;
      filled.push('whatsapp');
    }
  }
  if (f.email) {
    const mx = await hasMx(emailDomain(f.email.value));
    add('email', f.email.value, f.email.sourceUrl, own(f.email.sourceUrl) ? 0.7 : 0.4, 'Email on a public page (found by search: a person confirms it)', mx ? 'dns_valid' : 'syntax_valid');
    if (!p.email && !edited.has('email') && mx !== false) {
      Object.assign(data, { email: f.email.value, emailSource: 'search', emailStatus: mx ? 'dns_valid' : 'syntax_valid', emailMx: mx, emails: [...new Set([...p.emails, f.email.value])] });
      filled.push('email');
    }
  }
  if (f.booking && !p.bookingUrl) {
    add('booking', f.booking.value, f.booking.sourceUrl, 0.7, 'Booking page linked from a public page');
    data.bookingUrl = f.booking.value;
    filled.push('booking');
  }
  if (f.hours) add('hours', f.hours.value, f.hours.sourceUrl, own(f.hours.sourceUrl) ? 0.5 : 0.4, 'Opening hours on a public page (evidence only)', 'evidence');
  // Services: only names the page shows, with the quoted line; a price fills a missing one, nothing is replaced.
  const existing = (Array.isArray(p.treatments) ? p.treatments : []) as unknown as ImportedTreatment[];
  const byKey = new Map(existing.map(t => [serviceKey(t.name), t]));
  let newServices = 0;
  for (const sv of f.services) {
    add('service', { name: sv.name, priceNis: sv.priceNis, priceType: sv.priceType }, sv.sourceUrl, own(sv.sourceUrl) ? 0.7 : 0.5, sv.quote || 'Service listed on a public page');
    const k = serviceKey(sv.name);
    const cur = byKey.get(k);
    if (cur) {
      if (cur.priceNis == null && sv.priceNis != null) Object.assign(cur, { priceNis: sv.priceNis, priceType: sv.priceType, source: 'llm', sourceText: sv.quote, sourceUrl: sv.sourceUrl, sourceAt: now.toISOString() });
      continue;
    }
    if (byKey.size >= 80) continue;
    byKey.set(k, { name: sv.name, category: null, priceNis: sv.priceNis, priceType: sv.priceType, durationMin: sv.durationMin, isMedical: false, source: 'llm', sourceText: sv.quote, sourceUrl: sv.sourceUrl, sourceAt: now.toISOString() });
    newServices++;
  }
  if (newServices || f.services.some(sv => sv.priceNis != null)) {
    data.treatments = [...byKey.values()] as unknown as Prisma.InputJsonValue;
    if (newServices) filled.push('services');
  }
  const team = cleanTeam<ResearchFacts['team'][number]>(f.team); // the same quality gate as the site reader
  if (team.length) {
    for (const t of team) add('team', { name: t.name, role: t.role }, t.sourceUrl, 0.6, 'Team member named with a role on a public page');
    if ((!Array.isArray(p.team) || !p.team.length) && !edited.has('team')) {
      data.team = team.map(t => ({ name: t.name, role: t.role, bio: null, sourceUrl: t.sourceUrl })) as unknown as Prisma.InputJsonValue;
      filled.push('team');
    }
  }
  if (f.languages) {
    add('languages', f.languages.value, f.languages.sourceUrl, 0.6, 'Languages stated on a public page');
    if (!p.languages.length) {
      data.languages = f.languages.value;
      filled.push('languages');
    }
  }
  if (f.establishedYear) {
    add('established', f.establishedYear.value, f.establishedYear.sourceUrl, 0.6, 'Founding year stated on a public page');
    if (!p.establishedYear) {
      data.establishedYear = f.establishedYear.value;
      filled.push('established');
    }
  }
  if (f.accessible) {
    add('accessible', f.accessible.value, f.accessible.sourceUrl, 0.6, 'Accessibility stated on a public page');
    if (p.accessible == null) {
      data.accessible = f.accessible.value;
      filled.push('accessible');
    }
  }
  if (f.freeParking) {
    add('free_parking', f.freeParking.value, f.freeParking.sourceUrl, 0.6, 'Parking stated on a public page');
    if (p.freeParking == null) {
      data.freeParking = f.freeParking.value;
      filled.push('parking');
    }
  }
  // Social accounts found by search stay unverified until the site or the profile itself confirms them.
  const socials = { ...((p.socials ?? {}) as Socials) };
  let socialAdded = false;
  for (const so of f.socials) {
    add('social', { network: so.network, url: so.url }, so.sourceUrl, 0.4, 'Account named on a public page; not yet confirmed as the business', 'unverified');
    const net = so.network as keyof Socials;
    if (!socials[net]) {
      socials[net] = { url: so.url, verified: false, via: 'unverified', sources: ['search'] };
      socialAdded = true;
    }
  }
  if (socialAdded) {
    data.socials = socials as Prisma.InputJsonValue;
    filled.push('socials');
  }
  if (!s.useProviderImages) { /* research never brings images */ }
  await db.$transaction([
    db.fieldObservation.deleteMany({ where: { importPlaceId: p.id, provider: PROVIDER } }),
    db.fieldObservation.createMany({ data: obs }),
    ...(Object.keys(data).length ? [db.importPlace.update({ where: { id: p.id }, data })] : []),
  ]);
  return filled;
}

/** Records of an import run whose research named a website: they go through the website stage again. */
export function researchGainedWebsite(crawl: unknown): boolean {
  const r = (crawl as { research?: { filled?: string[] } } | null)?.research;
  return !!r?.filled?.includes('website');
}
