import 'server-only';
import { addDays, hhmm, ilDate, ilDateKey, ilToUtc } from '../time';
import { messaging } from '../vendors/messaging';
import { manageUrl } from './bookingLink';
import { db } from './db';
import { emailReady } from './email';
import { paidBusinessIds } from './plan';

// M2, the day-before reminder: once a day (the reminders cron, late afternoon in Israel) every confirmed booking
// for tomorrow, at a business on a paid plan, whose client left an email, gets one reminder email. reminded_at is
// claimed before sending, so a booking is never reminded twice even if two runs overlap.

const BATCH = 500;

export interface ReminderRun { day: string; emailOn: boolean; due: number; sent: number; skippedNotPaid: number; failed: number }

export async function runReminders(now = new Date()): Promise<ReminderRun> {
  const day = addDays(ilDateKey(now), 1);
  // Without Resend nothing would reach the client; leave every booking unreminded rather than mark it as sent.
  if (!(await emailReady())) return { day, emailOn: false, due: 0, sent: 0, skippedNotPaid: 0, failed: 0 };
  const from = ilToUtc(day, '00:00');
  const to = ilToUtc(addDays(day, 1), '00:00');
  const rows = await db.booking.findMany({
    where: { status: 'confirmed', remindedAt: null, clientEmail: { not: null }, startsAt: { gte: from, lt: to } },
    include: { branch: { select: { name: true, address: true, businessId: true } }, treatment: { select: { name: true } }, practitioner: { select: { displayName: true } } },
    orderBy: { startsAt: 'asc' },
    take: BATCH,
  });
  const paid = await paidBusinessIds([...new Set(rows.map(b => b.branch.businessId))]);
  const run: ReminderRun = { day, emailOn: true, due: rows.length, sent: 0, skippedNotPaid: 0, failed: 0 };
  for (const b of rows) {
    if (!paid.has(b.branch.businessId)) { run.skippedNotPaid++; continue; }
    const claimed = await db.booking.updateMany({ where: { id: b.id, remindedAt: null, status: 'confirmed' }, data: { remindedAt: new Date() } });
    if (!claimed.count) continue;
    const r = await messaging().send({
      channel: 'email', to: b.clientEmail!, template: 'M2_reminder', kind: 'service',
      vars: {
        name: b.clientName, business: b.branch.name, treatment: b.treatment?.name ?? 'פגישת ייעוץ', date: ilDate(b.startsAt), time: hhmm(b.startsAt),
        practitioner: b.practitioner?.displayName ?? '', address: b.branch.address ?? '', ref: b.ref, link: manageUrl(b.id),
      },
    }).catch(() => ({ id: 'failed', channel: undefined }));
    if (r.id === 'failed' || r.channel !== 'email') {
      run.failed++;
      // Not delivered: release the claim, so the booking does not show as reminded.
      await db.booking.update({ where: { id: b.id }, data: { remindedAt: null } }).catch(() => undefined);
    } else run.sent++;
  }
  return run;
}
