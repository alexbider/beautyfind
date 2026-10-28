'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { areaUserOrNull } from '@/components/ops/access';
import { db } from '@/lib/server/db';
import { setupEmailTracking, type SetupResult } from '@/lib/server/emailTracking';
import { platformSettings, savePlatformSettings } from '@/lib/server/platformSettings';
import { fromAddress } from '@/lib/vendors/resend';

// /ops/emails: mark replies handled, run the Resend tracking setup, and set where replies are forwarded.

type Result = { ok: true } | { ok: false; error: string };

export async function setReplyStatusAction(input: { id: string; status: 'new' | 'handled' }): Promise<Result> {
  const user = await areaUserOrNull('emails', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = z.object({ id: z.string().uuid(), status: z.enum(['new', 'handled']) }).safeParse(input);
  if (!p.success) return { ok: false, error: 'קלט לא תקין' };
  const r = await db.emailReply.updateMany({
    where: { id: p.data.id },
    data: p.data.status === 'handled' ? { status: 'handled', handledById: user.id, handledAt: new Date() } : { status: 'new', handledById: null, handledAt: null },
  });
  if (!r.count) return { ok: false, error: 'לא נמצא' };
  await db.auditLog.create({ data: { actorId: user.id, action: `email_reply_${p.data.status}`, subjectType: 'email_reply', subjectId: p.data.id } });
  revalidatePath('/ops/emails');
  return { ok: true };
}

export async function runTrackingSetupAction(): Promise<SetupResult> {
  const user = await areaUserOrNull('emails', 'full');
  if (!user) return { ok: false, error: 'אין הרשאה', steps: [], dns: [] };
  const r = await setupEmailTracking(user.id);
  // DNS records are public values (no secrets); logged so the team can add them from the deployment logs too.
  console.info(`[email-setup] ${JSON.stringify({ ok: r.ok, error: r.error ?? null, steps: r.steps, dns: r.dns })}`);
  await db.auditLog.create({ data: { actorId: user.id, action: 'email_tracking_setup', subjectType: 'platform', subjectId: 'email', meta: { ok: r.ok, steps: r.steps.map(s => `${s.key}:${s.ok}`) } } });
  revalidatePath('/ops/emails');
  return r;
}

export async function saveReplySettingsAction(input: { forwardTo: string; replyDomain: string }): Promise<Result> {
  const user = await areaUserOrNull('emails', 'full');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const forwardTo = input.forwardTo.trim();
  const replyDomain = input.replyDomain.trim().toLowerCase();
  if (!fromAddress(forwardTo)) return { ok: false, error: 'כתובת ההעברה לא תקינה' };
  if (replyDomain && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(replyDomain)) return { ok: false, error: 'תת־הדומיין לתשובות לא תקין' };
  if (replyDomain && fromAddress(forwardTo)!.endsWith(`@${replyDomain}`)) return { ok: false, error: 'כתובת ההעברה לא יכולה להיות על דומיין התשובות' };
  const cur = await platformSettings();
  await savePlatformSettings(user.id, { email: { ...cur.email, forwardTo, replyDomain } });
  await db.auditLog.create({ data: { actorId: user.id, action: 'email_reply_settings', subjectType: 'platform', subjectId: 'email', meta: { forwardTo, replyDomain } } });
  revalidatePath('/ops/emails');
  return { ok: true };
}
