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
  /** Overrides the state word on the chip ("מחובר" / "לא מחובר" for the message channels). */
  label?: string;
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
  const storage: ServiceCheck = process.env.STORAGE_ADAPTER === 'blob' || process.env.BLOB_READ_WRITE_TOKEN
    ? { key: 'storage', name: 'אחסון תמונות · Vercel Blob', state: 'ok', ms: null, note: 'מחובר' }
    : { key: 'storage', name: 'אחסון תמונות', state: 'unknown', ms: null, note: 'אחסון מקומי (UPLOAD_DIR)' };
  const [{ messaggioStatus }, { twilioStatus }] = await Promise.all([import('./messaggio'), import('./twilio')]);
  const [mg, tw] = await Promise.all([messaggioStatus().catch(() => null), twilioStatus().catch(() => null)]);
  const mgOn = !!(mg?.configured && mg.settings.enabled);
  const sent = (tw?.sent24h ?? 0) + (mg?.sent24h ?? 0);
  const failed = (tw?.failed24h ?? 0) + (mg?.failed24h ?? 0);
  const providers = [tw?.ready ? 'Twilio (SMS)' : null, mgOn ? 'Messaggio' : null].filter(Boolean).join(' + ');
  // Messages go through the providers set on /ops/messages (src/lib/server/deliver.ts): SMS by Twilio or Messaggio,
  // email by Resend, WhatsApp by Messaggio. MESSAGING_ADAPTER is only the fallback for what no provider carries.
  const { emailStatus } = await import('./email');
  const em = await emailStatus().catch(() => null);
  const smsOn = !!tw?.ready || !!(mgOn && mg?.settings.sms);
  const waOn = !!(mgOn && mg?.settings.whatsapp);
  const emailOn = !!em?.ready;
  const prod = process.env.NODE_ENV === 'production';
  const count = (sent24: number, failed24: number) => `${sent24} נשלחו ב־24 שעות${failed24 ? ` · ${failed24} נכשלו` : ''}`;
  // One row per channel, so it is clear which ones are connected and through which provider.
  const sms: ServiceCheck = smsOn
    ? { key: 'sms', name: `SMS · ${tw?.ready ? 'Twilio' : 'Messaggio'}`, state: failed && !sent ? 'down' : 'ok', ms: null, note: count(sent, failed), label: failed && !sent ? 'שגיאות' : 'מחובר' }
    : { key: 'sms', name: 'SMS', state: prod ? 'down' : 'unknown', ms: null, note: 'להגדרה: /ops/messages', label: 'לא מחובר' };
  const email: ServiceCheck = emailOn
    ? { key: 'email', name: 'אימייל · Resend', state: em!.failed24h && !em!.sent24h ? 'down' : 'ok', ms: null, note: `${count(em!.sent24h, em!.failed24h)}${em!.settings.replyDomain ? ' · מעקב פתיחות ותשובות פעיל' : ''}`, label: em!.failed24h && !em!.sent24h ? 'שגיאות' : 'מחובר' }
    : { key: 'email', name: 'אימייל', state: prod ? 'down' : 'unknown', ms: null, note: em?.configured ? 'מפתח קיים, השליחה כבויה' : 'להגדרה: /ops/messages', label: 'לא מחובר' };
  const whatsapp: ServiceCheck = waOn
    ? { key: 'whatsapp', name: 'WhatsApp · Messaggio', state: 'ok', ms: null, note: 'מחובר', label: 'מחובר' }
    : { key: 'whatsapp', name: 'WhatsApp', state: 'unknown', ms: null, note: smsOn ? 'הודעות WhatsApp נשלחות ב־SMS' : 'להגדרה: /ops/messages', label: 'לא מחובר' };
  const codes: ServiceCheck = providers
    ? { key: 'verification', name: 'קודי אימות', state: failed && !sent ? 'down' : 'ok', ms: null, note: `${providers} · ${sent} נשלחו ב־24 שעות${failed ? ` · ${failed} נכשלו` : ''}` }
    : { key: 'verification', name: 'קודי אימות', state: process.env.NODE_ENV === 'production' ? 'down' : 'unknown', ms: null, note: 'אין ספק פעיל: קודי האימות נרשמים ללוג בלבד (Twilio / Messaggio ב־/ops/messages)' };
  return [site, dbc, worker, codes, sms, email, whatsapp, storage];
}
