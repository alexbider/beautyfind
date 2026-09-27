// Apify API client (actor runs and datasets). The token is server-side only (APIFY_TOKEN) and never
// logged. Same outcome vocabulary as the DataForSEO client so the budget code treats both alike:
// a run that started is billed by Apify whether or not we read its result, so a timeout after the
// start call is "uncertain" until the run id is known.

const BASE = process.env.APIFY_API_BASE || 'https://api.apify.com';
const NOT_SENT = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']);

export type ApifyRunStatus = 'READY' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMING-OUT' | 'TIMED-OUT' | 'ABORTING' | 'ABORTED';

export interface ApifyRun {
  id: string;
  status: ApifyRunStatus;
  defaultDatasetId: string;
  usageTotalUsd: number | null;
  statusMessage: string | null;
}

export type ApifyStart =
  | { kind: 'ok'; run: ApifyRun }
  | { kind: 'error'; status: number | null; message: string; type: string | null }
  | { kind: 'not_sent'; message: string }
  | { kind: 'uncertain'; message: string };

export type ApifyGet = { kind: 'ok'; run: ApifyRun } | { kind: 'error'; status: number | null; message: string } | { kind: 'unavailable'; message: string };

export function apifyConfigured(): boolean {
  return !!process.env.APIFY_TOKEN;
}

const headers = () => ({ Authorization: `Bearer ${process.env.APIFY_TOKEN}`, 'Content-Type': 'application/json' });

const runOf = (d: Record<string, unknown>): ApifyRun => ({
  id: String(d.id),
  status: (d.status as ApifyRunStatus) ?? 'RUNNING',
  defaultDatasetId: String(d.defaultDatasetId ?? ''),
  usageTotalUsd: typeof d.usageTotalUsd === 'number' ? d.usageTotalUsd : null,
  statusMessage: typeof d.statusMessage === 'string' ? d.statusMessage : null,
});

const errorOf = async (res: Response): Promise<{ message: string; type: string | null }> => {
  try {
    const j = (await res.json()) as { error?: { type?: string; message?: string } };
    return { message: j.error?.message ?? `http_${res.status}`, type: j.error?.type ?? null };
  } catch {
    return { message: `http_${res.status}`, type: null };
  }
};

/** Starts an actor run. `memoryMb` and `timeoutSecs` cap what one run can consume. */
export async function startActorRun(actorId: string, input: unknown, opts: { memoryMb?: number; timeoutSecs?: number } = {}): Promise<ApifyStart> {
  if (!process.env.APIFY_TOKEN) return { kind: 'not_sent', message: 'APIFY_TOKEN not set' };
  const q = new URLSearchParams({ memory: String(opts.memoryMb ?? 2048), timeout: String(opts.timeoutSecs ?? 1800) });
  let res: Response;
  try {
    res = await fetch(`${BASE}/v2/acts/${encodeURIComponent(actorId)}/runs?${q}`, { method: 'POST', headers: headers(), body: JSON.stringify(input ?? {}), signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    const code = ((e as { cause?: { code?: string } }).cause?.code ?? '') as string;
    const msg = `${(e as Error).name}: ${code || (e as Error).message}`.slice(0, 200);
    return NOT_SENT.has(code) ? { kind: 'not_sent', message: msg } : { kind: 'uncertain', message: msg };
  }
  if (res.status !== 201 && res.status !== 200) {
    const e = await errorOf(res);
    return { kind: 'error', status: res.status, message: e.message.slice(0, 300), type: e.type };
  }
  try {
    const j = (await res.json()) as { data?: Record<string, unknown> };
    if (!j.data?.id) return { kind: 'uncertain', message: 'no run id in the answer' };
    return { kind: 'ok', run: runOf(j.data) };
  } catch {
    return { kind: 'uncertain', message: 'unreadable answer after start' };
  }
}

/** Reads a run, waiting on the server up to `waitSecs` for it to finish. */
export async function getRun(runId: string, waitSecs = 0): Promise<ApifyGet> {
  if (!process.env.APIFY_TOKEN) return { kind: 'unavailable', message: 'APIFY_TOKEN not set' };
  let res: Response;
  try {
    res = await fetch(`${BASE}/v2/actor-runs/${encodeURIComponent(runId)}${waitSecs ? `?waitForFinish=${waitSecs}` : ''}`, { headers: headers(), signal: AbortSignal.timeout((waitSecs + 30) * 1000) });
  } catch (e) {
    return { kind: 'unavailable', message: `${(e as Error).name}: ${(e as Error).message}`.slice(0, 200) };
  }
  if (res.status >= 500) return { kind: 'unavailable', message: `http_${res.status}` };
  if (res.status !== 200) return { kind: 'error', status: res.status, message: (await errorOf(res)).message.slice(0, 300) };
  try {
    const j = (await res.json()) as { data?: Record<string, unknown> };
    return j.data ? { kind: 'ok', run: runOf(j.data) } : { kind: 'unavailable', message: 'empty answer' };
  } catch {
    return { kind: 'unavailable', message: 'unreadable answer' };
  }
}

/** The run's dataset, cleaned (no hidden fields), in pages of up to 1,000 items. */
export async function datasetItems<T = Record<string, unknown>>(datasetId: string, max = 5000): Promise<T[] | null> {
  if (!process.env.APIFY_TOKEN || !datasetId) return null;
  const out: T[] = [];
  for (let offset = 0; offset < max; offset += 1000) {
    let res: Response;
    try {
      res = await fetch(`${BASE}/v2/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&offset=${offset}&limit=${Math.min(1000, max - offset)}`, { headers: headers(), signal: AbortSignal.timeout(120_000) });
    } catch {
      return null;
    }
    if (res.status !== 200) return null;
    let page: T[];
    try {
      page = (await res.json()) as T[];
    } catch {
      return null;
    }
    if (!Array.isArray(page)) return null;
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

/** Stops a run we no longer need (a paused or canceled import run). Best effort. */
export async function abortRun(runId: string): Promise<void> {
  if (!process.env.APIFY_TOKEN) return;
  await fetch(`${BASE}/v2/actor-runs/${encodeURIComponent(runId)}/abort`, { method: 'POST', headers: headers(), signal: AbortSignal.timeout(30_000) }).catch(() => {});
}
