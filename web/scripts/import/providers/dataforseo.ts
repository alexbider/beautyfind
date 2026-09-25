// DataForSEO HTTP client for Business Listings Search (live). Credentials are server-side only
// (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD) and never logged.

import { DFS_SEARCH_PATH, isFatalStatus, isTransientStatus, type DfsResponse, type DfsSearchRequest, type DfsTask } from '../../../src/lib/import/dataforseo';

const BASE = process.env.DATAFORSEO_BASE_URL || 'https://api.dataforseo.com';

export type DfsOutcome =
  | { kind: 'ok'; task: DfsTask; costUsd: number | null }
  // the provider answered with an error: billed or not, it is final for this request
  | { kind: 'error'; fatal: boolean; transient: boolean; code: number | null; message: string; costUsd: number | null }
  // the request never left this machine (DNS, refused connection, missing credentials): not billed
  | { kind: 'not_sent'; message: string }
  // sent, but no answer (timeout, reset): billing unknown
  | { kind: 'uncertain'; message: string };

const NOT_SENT = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']);

export function dfsConfigured(): boolean {
  return !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}

export async function dfsSearch(body: DfsSearchRequest): Promise<DfsOutcome> {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return { kind: 'not_sent', message: 'DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not set' };
  let res: Response;
  try {
    res = await fetch(`${BASE}${DFS_SEARCH_PATH}`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([body]),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    const code = ((e as { cause?: { code?: string } }).cause?.code ?? '') as string;
    const msg = `${(e as Error).name}: ${code || (e as Error).message}`.slice(0, 200);
    return NOT_SENT.has(code) ? { kind: 'not_sent', message: msg } : { kind: 'uncertain', message: msg };
  }
  let json: DfsResponse;
  try {
    json = (await res.json()) as DfsResponse;
  } catch {
    // An answer we cannot read: it may have been billed.
    return res.status >= 500 ? { kind: 'uncertain', message: `http_${res.status}` } : { kind: 'error', fatal: res.status === 401, transient: false, code: res.status, message: `http_${res.status}`, costUsd: null };
  }
  const top = json.status_code;
  const task = json.tasks?.[0];
  const cost = typeof task?.cost === 'number' ? task.cost : typeof json.cost === 'number' ? json.cost : null;
  if (res.status === 401 || isFatalStatus(top)) return { kind: 'error', fatal: true, transient: false, code: top ?? res.status, message: json.status_message ?? `http_${res.status}`, costUsd: cost };
  if (top !== 20000 || !task) return { kind: 'error', fatal: false, transient: isTransientStatus(top), code: top ?? null, message: json.status_message ?? 'no_task', costUsd: cost };
  if (task.status_code !== 20000) {
    return { kind: 'error', fatal: isFatalStatus(task.status_code), transient: isTransientStatus(task.status_code), code: task.status_code ?? null, message: task.status_message ?? 'task_error', costUsd: cost };
  }
  return { kind: 'ok', task, costUsd: cost };
}

export type DfsRaw = { kind: 'ok'; json: DfsResponse } | { kind: 'error'; fatal: boolean; code: number | null; message: string; costUsd: number | null } | { kind: 'not_sent'; message: string } | { kind: 'uncertain'; message: string };

/** Any DataForSEO v3 call (task_post, task_get): same credentials, timeouts and outcome rules as dfsSearch. */
export async function dfsRequest(method: 'GET' | 'POST', path: string, body?: unknown): Promise<DfsRaw> {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return { kind: 'not_sent', message: 'DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not set' };
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    const code = ((e as { cause?: { code?: string } }).cause?.code ?? '') as string;
    const msg = `${(e as Error).name}: ${code || (e as Error).message}`.slice(0, 200);
    return NOT_SENT.has(code) ? { kind: 'not_sent', message: msg } : { kind: 'uncertain', message: msg };
  }
  let json: DfsResponse;
  try {
    json = (await res.json()) as DfsResponse;
  } catch {
    return res.status >= 500 ? { kind: 'uncertain', message: `http_${res.status}` } : { kind: 'error', fatal: res.status === 401, code: res.status, message: `http_${res.status}`, costUsd: null };
  }
  if (res.status === 401 || isFatalStatus(json.status_code)) return { kind: 'error', fatal: true, code: json.status_code ?? res.status, message: json.status_message ?? `http_${res.status}`, costUsd: typeof json.cost === 'number' ? json.cost : null };
  if (json.status_code !== 20000) return { kind: 'error', fatal: false, code: json.status_code ?? null, message: json.status_message ?? 'error', costUsd: typeof json.cost === 'number' ? json.cost : null };
  return { kind: 'ok', json };
}
