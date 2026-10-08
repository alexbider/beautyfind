import 'server-only';
import { createSign } from 'node:crypto';
import { after } from 'next/server';
import { db } from './db';
import { open, seal } from './secure';
import { indexingPolicy } from './indexing';
import { platformSettings, type PlatformSettings } from './platformSettings';
import { siteUrl } from './site';
import { sitemapEntries } from './sitemapEntries';

// Google indexing: keeps every sitemap URL in indexing_urls, asks Search Console's URL Inspection API which
// of them Google has indexed, and notifies the Indexing API (URL_UPDATED) about new URLs first and then
// about URLs Google has not indexed, within the daily quotas set on /ops/content (tab גוגל).
//
// Credentials: a Google Cloud service account JSON key, either uploaded on the Google tab (stored in
// platform_secrets, encrypted with DATA_KEY) or set as GOOGLE_INDEXING_CREDENTIALS on Vercel (raw JSON or
// base64), which wins when both exist. Server-side only: the key is never logged or shown, only its email.
// The service account must be an Owner of the Search Console property, or the Indexing API refuses it.
// The source of URLs is sitemapEntries(), so the indexer follows the indexing policy exactly: staging,
// the master switch, section switches and noindex pages never reach Google.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PUBLISH_URL = 'https://indexing.googleapis.com/v3/urlNotifications:publish';
const INSPECT_URL = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';
const SCOPES = 'https://www.googleapis.com/auth/indexing https://www.googleapis.com/auth/webmasters.readonly';

const DAY = 86_400_000;
/** A URL Google has not indexed is sent again after this long, at most MAX_SUBMITS times in all. */
const RESUBMIT_AFTER = 14 * DAY;
const MAX_SUBMITS = 3;
/** Inspection results go stale: not-indexed URLs are checked again weekly, indexed ones monthly. */
const REINSPECT_NOT_INDEXED = 7 * DAY;
const REINSPECT_INDEXED = 30 * DAY;
/** A run stops starting new Google calls after this, to finish inside the function's time limit (300 s). */
const RUN_BUDGET_MS = 250_000;
/** Inspection stops here, so the last submit step always has time. */
const INSPECT_BUDGET_MS = 190_000;
const INSPECT_PARALLEL = 10;

// Tests point the client at a local mock server. Never in production.
function endpoint(real: string): string {
  const base = process.env.NODE_ENV !== 'production' ? process.env.GOOGLE_API_TEST_BASE : undefined;
  return base ? base + new URL(real).pathname : real;
}

// ---------- credentials and access token ----------

export interface ServiceAccount { clientEmail: string; privateKey: string }

/** Reads the service account from GOOGLE_INDEXING_CREDENTIALS (JSON or base64 JSON). Null when unset or unusable. */
export function serviceAccount(raw = process.env.GOOGLE_INDEXING_CREDENTIALS): ServiceAccount | null {
  if (!raw?.trim()) return null;
  const text = raw.trim().startsWith('{') ? raw.trim() : Buffer.from(raw.trim(), 'base64').toString('utf8');
  try {
    const j = JSON.parse(text) as { client_email?: unknown; private_key?: unknown };
    if (typeof j.client_email !== 'string' || typeof j.private_key !== 'string' || !j.private_key.includes('PRIVATE KEY')) return null;
    return { clientEmail: j.client_email, privateKey: j.private_key.replace(/\\n/g, '\n') };
  } catch {
    return null;
  }
}

const SECRET_KEY = 'google_indexing_credentials';

export type KeySource = 'env' | 'admin';

/** The service account in use: GOOGLE_INDEXING_CREDENTIALS first, then the key uploaded in the admin. */
export async function resolveServiceAccount(): Promise<{ sa: ServiceAccount; source: KeySource } | null> {
  const env = serviceAccount();
  if (env) return { sa: env, source: 'env' };
  const row = await db.platformSecret.findUnique({ where: { key: SECRET_KEY } }).catch(() => null);
  if (!row) return null;
  try {
    const sa = serviceAccount(open<string>(row.valueEnc));
    return sa ? { sa, source: 'admin' } : null;
  } catch {
    return null; // DATA_KEY changed or missing: treated as not configured
  }
}

/** Checks an uploaded key (parses it and signs once with it), then stores it encrypted. Returns only the email. */
export async function saveServiceAccountKey(raw: string, actorId: string): Promise<{ ok: true; clientEmail: string } | { ok: false; error: string }> {
  const sa = serviceAccount(raw);
  if (!sa) return { ok: false, error: 'זה לא קובץ מפתח של חשבון שירות: חסרים client_email או private_key' };
  try {
    createSign('RSA-SHA256').update('check').sign(sa.privateKey);
  } catch {
    return { ok: false, error: 'המפתח הפרטי שבקובץ פגום' };
  }
  const valueEnc = seal(JSON.stringify({ client_email: sa.clientEmail, private_key: sa.privateKey }));
  await db.platformSecret.upsert({ where: { key: SECRET_KEY }, create: { key: SECRET_KEY, valueEnc, label: sa.clientEmail, updatedById: actorId }, update: { valueEnc, label: sa.clientEmail, updatedById: actorId } });
  cached = null;
  return { ok: true, clientEmail: sa.clientEmail };
}

export async function removeServiceAccountKey(): Promise<void> {
  await db.platformSecret.deleteMany({ where: { key: SECRET_KEY } });
  cached = null;
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

let cached: { email: string; token: string; until: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cached && cached.email === sa.clientEmail && cached.until > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.clientEmail, scope: SCOPES, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const signature = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(sa.privateKey);
  const assertion = `${head}.${claims}.${b64url(signature)}`;
  const r = await fetch(endpoint(TOKEN_URL), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!r.ok || !j.access_token) throw new GoogleError(`token: ${j.error_description ?? j.error ?? r.status}`, r.status);
  cached = { email: sa.clientEmail, token: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

export class GoogleError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
  /** Quota or rate limit: the run stops calling that API for today. */
  get quota() { return this.status === 429; }
}

async function call<T>(sa: ServiceAccount, url: string, body: object): Promise<T> {
  const token = await accessToken(sa);
  const r = await fetch(endpoint(url), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: { message?: string; status?: string } };
  if (!r.ok) throw new GoogleError((j.error?.message ?? `HTTP ${r.status}`).slice(0, 300), r.status);
  return j;
}

/** The Search Console property the inspections run against: the saved one, else SITE_URL with a trailing slash. */
export function propertyOf(s: PlatformSettings['googleIndexing']): string {
  return s.property || `${siteUrl().replace(/\/+$/, '')}/`;
}

// ---------- the two Google APIs ----------

export interface InspectionState { indexed: boolean; verdict: string | null; coverageState: string | null; lastCrawlAt: Date | null }

/** Maps a URL Inspection result to what the indexer keeps. PASS is the only verdict that means "on Google". */
export function inspectionState(res: { inspectionResult?: { indexStatusResult?: { verdict?: string; coverageState?: string; lastCrawlTime?: string } } }): InspectionState {
  const s = res.inspectionResult?.indexStatusResult ?? {};
  const crawl = s.lastCrawlTime ? new Date(s.lastCrawlTime) : null;
  return { indexed: s.verdict === 'PASS', verdict: s.verdict ?? null, coverageState: s.coverageState ?? null, lastCrawlAt: crawl && !Number.isNaN(crawl.getTime()) ? crawl : null };
}

export async function inspectUrl(sa: ServiceAccount, url: string, property: string): Promise<InspectionState> {
  return inspectionState(await call(sa, INSPECT_URL, { inspectionUrl: url, siteUrl: property, languageCode: 'he' }));
}

export async function publishUrl(sa: ServiceAccount, url: string): Promise<void> {
  await call(sa, PUBLISH_URL, { url, type: 'URL_UPDATED' });
}

// ---------- status for the admin ----------

export interface IndexingStatus {
  configured: boolean;
  clientEmail: string | null;
  keySource: KeySource | null;
  property: string;
  settings: PlatformSettings['googleIndexing'];
  blockedBy: 'staging' | 'site' | null;
  cron: boolean;
  submittedToday: number;
  inspectedToday: number;
}

export async function googleIndexingStatus(): Promise<IndexingStatus> {
  const [s, policy, key] = await Promise.all([platformSettings(), indexingPolicy(), resolveServiceAccount()]);
  const since = new Date(Date.now() - DAY);
  const [submittedToday, inspectedToday] = await Promise.all([
    db.indexingUrl.count({ where: { lastSubmittedAt: { gte: since } } }),
    db.indexingUrl.count({ where: { inspectedAt: { gte: since } } }),
  ]);
  return {
    configured: !!key,
    clientEmail: key?.sa.clientEmail ?? null,
    keySource: key?.source ?? null,
    property: propertyOf(s.googleIndexing),
    settings: s.googleIndexing,
    blockedBy: policy.staging ? 'staging' : !policy.site ? 'site' : null,
    cron: !!process.env.CRON_SECRET,
    submittedToday,
    inspectedToday,
  };
}

/** Test connection: gets a token and inspects the homepage. Read-only on Google's side. */
export async function testGoogleConnection(): Promise<{ ok: true; homepage: InspectionState } | { ok: false; error: string }> {
  const sa = (await resolveServiceAccount())?.sa;
  if (!sa) return { ok: false, error: 'לא הועלה מפתח של חשבון שירות' };
  const s = (await platformSettings()).googleIndexing;
  try {
    return { ok: true, homepage: await inspectUrl(sa, `${siteUrl().replace(/\/+$/, '')}/`, propertyOf(s)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------- the run ----------

export type RunTrigger = 'cron' | 'manual' | 'publish';

export interface RunResult {
  ok: boolean;
  skipped?: string;
  runId?: string;
  discovered: number;
  removed: number;
  inspected: number;
  submitted: number;
  errors: number;
  note?: string;
}

const EMPTY = { discovered: 0, removed: 0, inspected: 0, submitted: 0, errors: 0 };

/**
 * One pass: sync the sitemap into indexing_urls; send new URLs and known not-indexed URLs; inspect what is
 * due (within the daily inspection quota); then send what the inspection found not indexed, all within the
 * daily submit quota. `paths` limits sending to those paths (after a publish) and skips the inspection.
 */
export async function runGoogleIndexing(opts: { trigger: RunTrigger; actorId?: string | null; paths?: string[] }): Promise<RunResult> {
  const s = (await platformSettings()).googleIndexing;
  const policy = await indexingPolicy();
  const sa = (await resolveServiceAccount())?.sa;
  if (!s.enabled) return { ok: true, skipped: 'disabled', ...EMPTY };
  if (!sa) return { ok: false, skipped: 'not_configured', ...EMPTY };
  if (policy.staging || !policy.site) return { ok: true, skipped: 'site_not_indexable', ...EMPTY };

  const started = Date.now();
  const run = await db.indexingRun.create({ data: { trigger: opts.trigger, actorId: opts.actorId ?? null } });
  const out = { ...EMPTY };
  const notes: string[] = [];

  try {
    // 1. Sync. The very first sync marks everything as existing (not new); later additions are new.
    const entries = await sitemapEntries();
    const firstSync = (await db.indexingUrl.count()) === 0;
    const urls = new Set(entries.map(e => e.url));
    const created = await db.indexingUrl.createMany({ data: entries.map(e => ({ url: e.url, path: e.path, type: e.type, isNew: !firstSync })), skipDuplicates: true });
    out.discovered = created.count;
    const gone = await db.indexingUrl.findMany({ where: { removedAt: null }, select: { id: true, url: true } });
    const goneIds = gone.filter(g => !urls.has(g.url)).map(g => g.id);
    if (goneIds.length) out.removed = (await db.indexingUrl.updateMany({ where: { id: { in: goneIds } }, data: { removedAt: new Date() } })).count;
    await db.indexingUrl.updateMany({ where: { removedAt: { not: null }, url: { in: [...urls] } }, data: { removedAt: null } });

    const since = new Date(Date.now() - DAY);
    const property = propertyOf(s);
    const scope = opts.paths ? { path: { in: opts.paths } } : {};
    const retryBefore = new Date(Date.now() - RESUBMIT_AFTER);
    let submitStopped = false;
    const submitLeft = async () => s.dailySubmitLimit - (await db.indexingUrl.count({ where: { lastSubmittedAt: { gte: since } } }));
    const pick = async (where: object, take: number) => take > 0
      ? db.indexingUrl.findMany({ where: { removedAt: null, ...scope, ...where }, orderBy: [{ firstSeenAt: 'desc' }], take, select: { id: true, url: true } })
      : [];
    // Sends URL_UPDATED one URL at a time (Google's default quota is 200 a day, so this is never long) and
    // stops for the day on a quota answer or a permission refusal.
    const submit = async (list: Array<{ id: string; url: string }>) => {
      for (const u of list) {
        if (submitStopped) return;
        if (Date.now() - started > RUN_BUDGET_MS) { notes.push('time budget reached'); submitStopped = true; return; }
        try {
          await publishUrl(sa, u.url);
          await db.indexingUrl.update({ where: { id: u.id }, data: { submitCount: { increment: 1 }, lastSubmittedAt: new Date(), lastSubmitError: null } });
          out.submitted++;
        } catch (e) {
          out.errors++;
          const err = e instanceof GoogleError ? e : null;
          await db.indexingUrl.update({ where: { id: u.id }, data: { lastSubmitError: (err?.message ?? String(e)).slice(0, 300) } });
          if (err && (err.quota || err.status === 401 || err.status === 403)) { notes.push(err.quota ? 'submit quota reached' : 'submit refused: permission'); submitStopped = true; return; }
        }
      }
    };
    const notIndexedWhere = (exclude: string[]) => ({ id: { notIn: exclude }, indexed: false, submitCount: { lt: MAX_SUBMITS }, OR: [{ lastSubmittedAt: null }, { lastSubmittedAt: { lt: retryBefore } }] });

    // 2. Submit what is already known first, so the daily quota is used even when inspection takes the
    //    rest of the run: new URLs, then URLs an earlier inspection found not indexed.
    if (s.submitNew || s.submitBacklog) {
      const left = await submitLeft();
      const fresh = s.submitNew ? await pick({ isNew: true, submitCount: 0, OR: [{ indexed: false }, { indexed: null }] }, left) : [];
      const known = s.submitBacklog ? await pick(notIndexedWhere(fresh.map(f => f.id)), left - fresh.length) : [];
      await submit([...fresh, ...known]);
    }

    // 3. Inspect: never-inspected first, then stale results, ten at a time, until the inspection share of
    //    the run is used. Skipped after a publish (that run only submits).
    if (s.inspect && !opts.paths) {
      const left = s.dailyInspectLimit - (await db.indexingUrl.count({ where: { inspectedAt: { gte: since } } }));
      if (left > 0) {
        const now = Date.now();
        const stale = new Date(now - REINSPECT_NOT_INDEXED);
        const due = await db.indexingUrl.findMany({
          where: { removedAt: null, OR: [{ inspectedAt: null }, { indexed: false, inspectedAt: { lt: stale } }, { indexed: null, inspectedAt: { lt: stale } }, { indexed: true, inspectedAt: { lt: new Date(now - REINSPECT_INDEXED) } }] },
          orderBy: [{ isNew: 'desc' }, { inspectedAt: { sort: 'asc', nulls: 'first' } }, { firstSeenAt: 'asc' }],
          take: left,
          select: { id: true, url: true },
        });
        for (let i = 0; i < due.length; i += INSPECT_PARALLEL) {
          if (Date.now() - started > INSPECT_BUDGET_MS) { notes.push(`inspection paused: ${due.length - i} due`); break; }
          const batch = due.slice(i, i + INSPECT_PARALLEL);
          const results = await Promise.allSettled(batch.map(u => inspectUrl(sa, u.url, property)));
          let stop = false;
          await Promise.all(results.map(async (r, k) => {
            if (r.status === 'fulfilled') {
              await db.indexingUrl.update({ where: { id: batch[k].id }, data: { ...r.value, inspectedAt: new Date(), inspectError: null } });
              out.inspected++;
            } else {
              out.errors++;
              const err = r.reason instanceof GoogleError ? r.reason : null;
              await db.indexingUrl.update({ where: { id: batch[k].id }, data: { inspectError: (err?.message ?? String(r.reason)).slice(0, 300) } });
              if (err && (err.quota || err.status === 401 || err.status === 403)) stop = true;
            }
          }));
          if (stop) { notes.push('inspection stopped: quota or permission'); break; }
        }
      }
    }

    // 4. Submit what this run's inspection found not indexed, with what is left of the quota. URLs never
    //    inspected are sent only when inspection is off: with it on, they wait for their check, so the quota
    //    is not spent on pages Google already has.
    if (s.submitBacklog && !submitStopped) {
      const left = await submitLeft();
      const found = await pick(notIndexedWhere([]), left);
      const unknown = !s.inspect ? await pick({ id: { notIn: found.map(f => f.id) }, indexed: null, submitCount: 0 }, left - found.length) : [];
      await submit([...found, ...unknown]);
    }
  } catch (e) {
    out.errors++;
    notes.push((e instanceof Error ? e.message : String(e)).slice(0, 300));
  }

  const note = notes.join('; ') || undefined;
  await db.indexingRun.update({ where: { id: run.id }, data: { ...out, note: note ?? null, finishedAt: new Date() } });
  return { ok: !notes.some(n => n.includes('refused')), runId: run.id, ...out, note };
}

/**
 * After a publish: a run limited to these paths, once the response is sent (or right away outside a
 * request, as in tests). Does nothing unless indexing is on and new URLs are to be submitted.
 */
export function indexSoon(paths: string[]): void {
  const job = async () => {
    const s = (await platformSettings()).googleIndexing;
    if (!s.enabled || !s.submitNew || !(await resolveServiceAccount())) return;
    await runGoogleIndexing({ trigger: 'publish', paths });
  };
  const safe = () => job().catch(() => undefined);
  try { after(safe); } catch { void safe(); }
}
