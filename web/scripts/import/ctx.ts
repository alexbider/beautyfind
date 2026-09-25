// Shared worker context: database, lease, counters, settings and small helpers.

import { promises as dns } from 'node:dns';
import { hostname } from 'node:os';
import { Prisma, PrismaClient } from '@prisma/client';
import { loadSettings, type ImportSettings } from '../../src/lib/import/settings';

export const db = new PrismaClient();
export const WORKER = `${hostname()}-${process.pid}`;
export const LEASE_MS = 10 * 60_000;

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
export const argRun = () => arg('run');
const deadline = Date.now() + Number(arg('max-minutes') ?? 330) * 60_000;
export const timeLeft = () => Date.now() < deadline;
export const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** Paused, canceled, taken over or out of time: stop cleanly, the next worker continues. */
export class Stop extends Error {}

export async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

type Stats = Record<string, unknown> & { counters?: Record<string, number> };

export async function bump(runId: string, patch: Record<string, number>) {
  const run = await db.importRun.findUniqueOrThrow({ where: { id: runId }, select: { stats: true } });
  const stats = (run.stats ?? {}) as Stats;
  const counters = { ...(stats.counters ?? {}) };
  for (const [k, v] of Object.entries(patch)) counters[k] = (counters[k] ?? 0) + v;
  await db.importRun.update({ where: { id: runId }, data: { stats: { ...stats, counters } as Prisma.InputJsonValue } });
}

export async function setStats(runId: string, patch: Record<string, unknown>) {
  const run = await db.importRun.findUniqueOrThrow({ where: { id: runId }, select: { stats: true } });
  await db.importRun.update({ where: { id: runId }, data: { stats: { ...((run.stats ?? {}) as object), ...patch } as Prisma.InputJsonValue } });
}

/** Renews the lease; stops when staff paused or canceled the run, or time is up. */
export async function heartbeat(runId: string) {
  const r = await db.importRun.updateMany({
    where: { id: runId, lockedBy: WORKER, status: 'running' },
    data: { lockedUntil: new Date(Date.now() + LEASE_MS) },
  });
  if (!r.count) throw new Stop('run paused, canceled or taken over');
  if (!timeLeft()) throw new Stop('time budget used');
}

let cached: { at: number; value: ImportSettings } | null = null;
/** Settings, re-read at most every 20 seconds so the admin kill switch takes effect quickly. */
export async function settings(): Promise<ImportSettings> {
  if (!cached || Date.now() - cached.at > 20_000) cached = { at: Date.now(), value: await loadSettings(db) };
  return cached.value;
}

const mxCache = new Map<string, Promise<boolean | null>>();
/** true: domain accepts mail, false: it cannot, null: DNS did not answer. Never probes mailboxes. */
export function hasMx(domain: string): Promise<boolean | null> {
  // Local fixtures use the reserved .test TLD, which has no DNS.
  if (process.env.IMPORT_TEST_ALLOW_PRIVATE === '1' && domain.endsWith('.test')) return Promise.resolve(true);
  if (!mxCache.has(domain)) {
    const check = async (): Promise<boolean | null> => {
      try {
        const mx = await dns.resolveMx(domain);
        return mx.some(r => r.exchange && r.exchange !== '.');
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === 'ENODATA') return dns.resolve4(domain).then(a => a.length > 0, () => false);
        if (code === 'ENOTFOUND' || code === 'NXDOMAIN') return false;
        return null;
      }
    };
    mxCache.set(domain, Promise.race([check(), new Promise<null>(r => setTimeout(() => r(null), 8000))]));
  }
  return mxCache.get(domain)!;
}

/** Unique businesses this run has staged so far. */
export const stagedCount = (runId: string) => db.importPlace.count({ where: { runId } });
