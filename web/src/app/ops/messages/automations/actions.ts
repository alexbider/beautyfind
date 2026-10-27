'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { areaUserOrNull } from '@/components/ops/guard';
import { db } from '@/lib/server/db';
import { platformSettings, savePlatformSettings } from '@/lib/server/platformSettings';

// Automations screen (/ops/messages/automations): switches, claim-invite batches, run now, retry and cancel.

type Res = { ok: true; text: string } | { ok: false; error: string };
const PATH = '/ops/messages/automations';
const SWITCHES = ['reviewRequest', 'reminderSms', 'giftDelivery', 'giftExpiry', 'paymentFailed', 'sponsored', 'onboarding', 'claimInvites'] as const;

export async function setAutomationAction(name: string, value: boolean): Promise<{ ok: boolean; error?: string }> {
  const user = await areaUserOrNull('messages', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  if (!(SWITCHES as readonly string[]).includes(name)) return { ok: false, error: 'הגדרה לא מוכרת' };
  const cur = await platformSettings();
  await savePlatformSettings(user.id, { automations: { ...cur.automations, [name]: value } });
  await db.auditLog.create({ data: { actorId: user.id, action: 'automation_switch', subjectType: 'platform_settings', subjectId: user.id, meta: { name, value } } });
  revalidatePath(PATH);
  return { ok: true };
}

const Batch = z.object({ count: z.coerce.number().int().min(1).max(300) });

export async function queueClaimInvitesAction(input: z.input<typeof Batch>): Promise<Res> {
  const user = await areaUserOrNull('messages', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = Batch.safeParse(input);
  if (!p.success) return { ok: false, error: 'אפשר לשלוח בין 1 ל־300 הזמנות בכל פעם' };
  const { queueClaimInvites } = await import('@/lib/server/automations');
  const n = await queueClaimInvites(p.data.count, user.id);
  const on = (await platformSettings()).automations.claimInvites;
  revalidatePath(PATH);
  return { ok: true, text: n ? `${n} הזמנות נכנסו לתור.${on ? ' הן יישלחו בריצה הבאה, בשעות 08:00 עד 21:00 ולא בשבת ובחגים.' : ' המתג של הזמנות לבעלי עסקים כבוי, אז הן ממתינות עד שתפעילו אותו.'}` : 'לא נמצאו עסקים חדשים להזמנה.' };
}

export async function runNowAction(): Promise<Res> {
  const user = await areaUserOrNull('messages', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const [{ planAutomations }, { runQueue }] = await Promise.all([import('@/lib/server/automations'), import('@/lib/server/scheduler')]);
  const planned = await planAutomations();
  const r = await runQueue(new Date(), 40_000);
  const queued = Object.values(planned.queued).reduce((a, b) => a + (b ?? 0), 0);
  revalidatePath(PATH);
  return { ok: true, text: `נוספו לתור ${queued}. נשלחו ${r.sent}, נדחו לחלון השליחה ${r.postponed}, ממתינים לספק ${r.waiting}, דולגו ${r.skipped}, נכשלו ${r.failed}.` };
}

const Id = z.object({ id: z.string().uuid() });

export async function retryMessageAction(input: z.input<typeof Id>): Promise<Res> {
  const user = await areaUserOrNull('messages', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = Id.safeParse(input);
  if (!p.success) return { ok: false, error: 'קלט לא תקין' };
  const { retryMessage } = await import('@/lib/server/scheduler');
  const ok = await retryMessage(p.data.id);
  revalidatePath(PATH);
  return ok ? { ok: true, text: 'הוחזר לתור' } : { ok: false, error: 'אפשר להחזיר רק הודעה שנכשלה, דולגה או בוטלה' };
}

export async function cancelMessageAction(input: z.input<typeof Id>): Promise<Res> {
  const user = await areaUserOrNull('messages', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = Id.safeParse(input);
  if (!p.success) return { ok: false, error: 'קלט לא תקין' };
  const r = await db.scheduledMessage.updateMany({ where: { id: p.data.id, status: 'pending' }, data: { status: 'cancelled', note: 'בוטל ידנית' } });
  if (r.count) await db.auditLog.create({ data: { actorId: user.id, action: 'scheduled_message_cancel', subjectType: 'scheduled_message', subjectId: p.data.id } });
  revalidatePath(PATH);
  return r.count ? { ok: true, text: 'בוטל' } : { ok: false, error: 'ההודעה כבר לא בתור' };
}
