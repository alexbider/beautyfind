import 'server-only';
import { db } from './db';
import { checkDatabase, checkSite } from './opsHealth';
import { emailReady } from './email';
import { hit } from './rateLimit';
import { twilioAttempt, twilioReady } from './twilio';
import { planPriceId, stripe, stripeConfigured } from './billing/stripe';

// Alerts to the people who run BeautyFind, by SMS through Twilio.
// OPS_ALERT_PHONES: comma separated numbers in E.164 (+9725…). Without it, alerts only go to the log.
// Each alert has a key and is sent at most once per 6 hours, so a failing webhook cannot flood a phone.

const recipients = () => (process.env.OPS_ALERT_PHONES ?? '').split(',').map(s => s.trim()).filter(s => /^\+\d{8,15}$/.test(s));

/** Sends one alert (deduplicated by key for 6 hours). Never throws. */
export async function alertOps(key: string, text: string): Promise<void> {
  try {
    console.error(`[alert] ${key}: ${text}`);
    if (!(await hit(`alert:${key}`, { max: 1, windowS: 6 * 3600 })).ok) return;
    const to = recipients();
    if (!to.length) return;
    const tw = await twilioReady();
    if (!tw) return;
    const body = `BeautyFind ⚠ ${text}`.slice(0, 600);
    await Promise.all(to.map(p => twilioAttempt(tw, { to: p, template: 'ops_alert' }, body).catch(() => undefined)));
  } catch (e) {
    console.error('[alert] could not send', e instanceof Error ? e.message : e);
  }
}

/**
 * The daily health check (cron): everything that should be true on a healthy day. Returns the problems found;
 * if there are any they are sent as one alert.
 */
export async function runHealthCheck(): Promise<{ problems: string[]; checked: number }> {
  const problems: string[] = [];
  const since = new Date(Date.now() - 86_400_000);
  const checks: Array<Promise<void>> = [];
  const add = (p: Promise<void>) => checks.push(p.catch(e => { problems.push(`בדיקה נכשלה: ${e instanceof Error ? e.message.slice(0, 80) : e}`); }));

  add((async () => {
    const d = await checkDatabase();
    if (d.state !== 'ok') problems.push(`מסד הנתונים: ${d.note}`);
  })());
  add((async () => {
    const s = await checkSite();
    if (s.state === 'down') problems.push(`האתר לא עונה: ${s.note}`);
  })());
  add((async () => {
    if (!stripeConfigured()) return void problems.push('Stripe לא מחובר (חסר STRIPE_SECRET_KEY)');
    await planPriceId('basic', 'monthly');
    await stripe().balance.retrieve();
  })());
  add((async () => {
    if (!(await twilioReady())) problems.push('Twilio כבוי: קודי SMS לא יישלחו');
  })());
  add((async () => {
    if (!(await emailReady())) problems.push('אימייל (Resend) לא מחובר: איפוס סיסמה ואישורים לא נשלחים');
  })());
  add((async () => {
    const [failed, total] = await Promise.all([
      db.messageSend.count({ where: { createdAt: { gte: since }, test: false, OR: [{ status: 'failed' }, { deliveryStatus: { in: ['failed', 'undelivered'] } }] } }),
      db.messageSend.count({ where: { createdAt: { gte: since }, test: false } }),
    ]);
    if (failed >= 3 && failed / Math.max(total, 1) > 0.2) problems.push(`${failed} מתוך ${total} הודעות נכשלו ב־24 שעות`);
  })());
  add((async () => {
    const late = await db.verificationRequest.count({ where: { status: 'open', slaDueAt: { lt: new Date() } } });
    if (late) problems.push(`${late} בקשות אימות עברו את זמן המענה`);
  })());
  add((async () => {
    const debt = await db.subscription.count({ where: { status: { in: ['past_due', 'hidden'] } } });
    if (debt) problems.push(`${debt} מנויים בחוב`);
  })());
  add((async () => {
    const noCard = await db.subscription.count({ where: { status: 'active', stripeSubscriptionId: null, business: { branches: { some: { status: 'live' } } } } });
    if (noCard) problems.push(`${noCard} עסקים מסומנים פעילים אבל לא מחויבים (אין כרטיס)`);
  })());

  await Promise.all(checks);
  if (problems.length) await alertOps('daily-health', `בדיקה יומית: ${problems.join(' · ')}`);
  return { problems, checked: checks.length };
}
