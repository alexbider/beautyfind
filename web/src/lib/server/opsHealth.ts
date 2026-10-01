import 'server-only';
import { db } from './db';
import { siteUrl } from './site';

// System health for /ops and /ops/health: measured here, never guessed. Each probe is cheap and
// bounded; a probe that cannot run says so instead of showing a number.

export type ServiceState = 'ok' | 'degraded' | 'down' | 'unknown';
export interface ServiceCheck {
  key: string;
  name: string;
  state: ServiceState;
  ms: number | null;
  note: string;
}

const timed = async <T>(fn: () => Promise<T>): Promise<{ ms: number; value: T | null; error: string | null }> => {
  const t0 = Date.now();
  try {
    const value = await fn();
    return { ms: Date.now() - t0, value, error: null };
  } catch (e) {
    return { ms: Date.now() - t0, value: null, error: e instanceof Error ? e.message : String(e) };
  }
};

/** Postgres round trip through Prisma. */
export async function checkDatabase(): Promise<ServiceCheck> {
  const r = await timed(() => db.$queryRaw`SELECT 1`);
  if (r.error) return { key: 'db', name: 'מסד נתונים · Postgres', state: 'down', ms: null, note: r.error.slice(0, 120) };
  return { key: 'db', name: 'מסד נתונים · Postgres', state: r.ms > 1500 ? 'degraded' : 'ok', ms: r.ms, note: r.ms > 1500 ? 'איטי מהרגיל' : 'תקין' };
}

/** The public site answering (its robots.txt, served by this deployment). */
export async function checkSite(): Promise<ServiceCheck> {
  const url = `${siteUrl()}/robots.txt`;
  const r = await timed(async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), cache: 'no-store', headers: { 'User-Agent': 'BeautyFind-admin-health' } });
    return res.status;
  });
  if (r.error || !r.value) return { key: 'site', name: 'אתר ציבורי', state: 'unknown', ms: null, note: `לא נבדק: ${(r.error ?? '').slice(0, 80)}` };
  const state: ServiceState = r.value >= 500 ? 'down' : r.ms > 2500 ? 'degraded' : 'ok';
  return { key: 'site', name: 'אתר ציבורי', state, ms: r.ms, note: state === 'ok' ? `HTTP ${r.value}` : state === 'degraded' ? 'תגובה איטית' : `HTTP ${r.value}` };
}

/** The import worker's last report (written at every worker start) and whether a run is being worked now. */
export async function checkWorker(): Promise<ServiceCheck & { lastSeen: Date | null; running: number; queued: number }> {
  const [row, running, queued] = await Promise.all([
    db.importSettings.findUnique({ where: { id: 1 } }).catch(() => null),
    db.importRun.count({ where: { status: 'running', lockedUntil: { gt: new Date() } } }).catch(() => 0),
    db.importRun.count({ where: { status: 'queued' } }).catch(() => 0),
  ]);
  const status = ((row?.values as { workerStatus?: { at?: string } } | null)?.workerStatus ?? null);
  const lastSeen = status?.at ? new Date(status.at) : null;
  const base = { key: 'worker', name: 'עובד הייבוא · GitHub Actions', ms: null, lastSeen, running, queued };
  if (running) return { ...base, state: 'ok', note: `${running} ריצה בעבודה` };
  if (queued && lastSeen && Date.now() - lastSeen.getTime() > 20 * 60_000) return { ...base, state: 'degraded', note: `${queued} בתור, העובד לא דיווח ${Math.round((Date.now() - lastSeen.getTime()) / 60_000)} דק׳` };
  if (!lastSeen) return { ...base, state: 'unknown', note: 'העובד עוד לא רץ' };
  return { ...base, state: 'ok', note: 'פנוי' };
}

/** Everything on one list, for the overview card and the health page. */
export async function serviceChecks(): Promise<ServiceCheck[]> {
  const [dbc, site, worker] = await Promise.all([checkDatabase(), checkSite(), checkWorker()]);
  const messaging = process.env.MESSAGING_ADAPTER ?? 'console';
  const msg: ServiceCheck = messaging === 'console'
    ? { key: 'messaging', name: 'הודעות · WhatsApp / SMS / אימייל', state: process.env.NODE_ENV === 'production' ? 'down' : 'unknown', ms: null, note: 'אין ספק הודעות מחובר (MESSAGING_ADAPTER=console)' }
    : { key: 'messaging', name: 'הודעות · WhatsApp / SMS / אימייל', state: 'ok', ms: null, note: `ספק: ${messaging}` };
  const storage: ServiceCheck = process.env.STORAGE_ADAPTER === 'blob' || process.env.BLOB_READ_WRITE_TOKEN
    ? { key: 'storage', name: 'אחסון תמונות · Vercel Blob', state: 'ok', ms: null, note: 'מחובר' }
    : { key: 'storage', name: 'אחסון תמונות', state: 'unknown', ms: null, note: 'אחסון מקומי (UPLOAD_DIR)' };
  return [site, dbc, worker, msg, storage];
}
