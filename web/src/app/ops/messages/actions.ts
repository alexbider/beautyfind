'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { areaUserOrNull } from '@/components/ops/guard';
import { db } from '@/lib/server/db';
import { platformSettings, savePlatformSettings } from '@/lib/server/platformSettings';
import { TEMPLATES } from './catalog';

// Draft copy for a template, kept in platform settings until it is submitted to the messaging
// provider (WhatsApp templates need Meta's approval; the code sends by template id, not by text).

const Input = z.object({ id: z.string().max(10), text: z.string().max(2000) });

export async function saveTemplateDraftAction(input: z.input<typeof Input>): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await areaUserOrNull('messages', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = Input.safeParse(input);
  if (!p.success || !TEMPLATES.some(t => t.id === p.data.id)) return { ok: false, error: 'תבנית לא מוכרת' };
  const cur = await platformSettings();
  const drafts = { ...cur.templateDrafts };
  if (p.data.text.trim()) drafts[p.data.id] = p.data.text.trim();
  else delete drafts[p.data.id];
  await savePlatformSettings(user.id, { templateDrafts: drafts });
  await db.auditLog.create({ data: { actorId: user.id, action: 'template_draft', subjectType: 'platform_settings', subjectId: user.id, meta: { ref: p.data.id } } });
  revalidatePath('/ops/messages');
  return { ok: true };
}

// ---------- Messaggio (SMS and WhatsApp verification codes) ----------

type Res = { ok: true; text: string } | { ok: false; error: string };

const FLAGS = ['enabled', 'sms', 'whatsapp', 'fallbackToSms'] as const;

export async function setMessaggioFlagAction(name: string, value: boolean): Promise<{ ok: boolean; error?: string }> {
  const user = await areaUserOrNull('messages', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  if (!(FLAGS as readonly string[]).includes(name)) return { ok: false, error: 'הגדרה לא מוכרת' };
  const cur = await platformSettings();
  await savePlatformSettings(user.id, { messaggio: { ...cur.messaggio, [name]: value } });
  await db.auditLog.create({ data: { actorId: user.id, action: 'messaggio_update', subjectType: 'platform_settings', subjectId: user.id, meta: { ref: name, value } } });
  revalidatePath('/ops/messages');
  return { ok: true };
}

const Senders = z.object({
  smsSender: z.string().trim().min(1, 'חסר שם שולח ל־SMS').max(11, 'שם שולח ל־SMS: עד 11 תווים').regex(/^[A-Za-z0-9 ._-]+$|^\+?\d{6,15}$/, 'שם שולח ל־SMS: אותיות לטיניות וספרות, או מספר טלפון'),
  whatsappSender: z.string().trim().max(64),
  whatsappTemplate: z.string().trim().max(120),
  baseUrl: z.string().trim().url('כתובת API לא תקינה').max(200).refine(u => u.startsWith('https://'), 'כתובת ה־API חייבת להתחיל ב־https://'),
});

export async function saveMessaggioSettingsAction(input: Record<string, string>): Promise<Res> {
  const user = await areaUserOrNull('messages', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = Senders.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'קלט לא תקין' };
  const cur = await platformSettings();
  await savePlatformSettings(user.id, { messaggio: { ...cur.messaggio, ...p.data } });
  revalidatePath('/ops/messages');
  return { ok: true, text: 'נשמר' };
}

export async function saveMessaggioKeyAction(raw: string): Promise<Res> {
  const user = await areaUserOrNull('messages', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const { saveMessaggioLogin } = await import('@/lib/server/messaggio');
  const r = await saveMessaggioLogin(raw, user.id);
  if (!r.ok) return r;
  await db.auditLog.create({ data: { actorId: user.id, action: 'messaggio_key', subjectType: 'platform_settings', subjectId: user.id, meta: { ref: r.hint, op: 'save' } } });
  revalidatePath('/ops/messages');
  return { ok: true, text: `המפתח נשמר (${r.hint})` };
}

export async function removeMessaggioKeyAction(): Promise<Res> {
  const user = await areaUserOrNull('messages', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const { removeMessaggioLogin } = await import('@/lib/server/messaggio');
  await removeMessaggioLogin();
  await db.auditLog.create({ data: { actorId: user.id, action: 'messaggio_key', subjectType: 'platform_settings', subjectId: user.id, meta: { ref: 'removed', op: 'remove' } } });
  revalidatePath('/ops/messages');
  return { ok: true, text: 'המפתח הוסר' };
}

const TestInput = z.object({ phone: z.string().trim().max(24), channel: z.enum(['sms', 'whatsapp']) });

/** Sends one real test message to the phone entered, so staff can see the provider works end to end. */
export async function messaggioTestAction(input: z.input<typeof TestInput>): Promise<Res> {
  const user = await areaUserOrNull('messages', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = TestInput.safeParse(input);
  if (!p.success) return { ok: false, error: 'קלט לא תקין' };
  const { toE164 } = await import('@/lib/format');
  const to = p.data.phone.startsWith('+') ? p.data.phone.replace(/[^\d+]/g, '') : toE164(p.data.phone);
  if (!to || !/^\+\d{8,15}$/.test(to)) return { ok: false, error: 'מספר טלפון לא תקין' };
  const { messaggioTestSend } = await import('@/lib/server/messaggio');
  const r = await messaggioTestSend(to, p.data.channel);
  await db.auditLog.create({ data: { actorId: user.id, action: 'messaggio_test', subjectType: 'platform_settings', subjectId: user.id, meta: { ref: p.data.channel, ok: r.ok } } });
  revalidatePath('/ops/messages');
  return r.ok ? { ok: true, text: `נשלח. מזהה ב־Messaggio: ${r.id}. בדקו שההודעה הגיעה לטלפון.` } : { ok: false, error: r.error };
}
