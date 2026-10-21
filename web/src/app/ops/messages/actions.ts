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

// ---------- Twilio (SMS verification codes) ----------

export async function setTwilioFlagAction(name: string, value: boolean): Promise<{ ok: boolean; error?: string }> {
  const user = await areaUserOrNull('messages', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  if (name !== 'enabled') return { ok: false, error: 'הגדרה לא מוכרת' };
  const cur = await platformSettings();
  if (value && !cur.twilio.from && !cur.twilio.messagingServiceSid) return { ok: false, error: 'הגדירו קודם שולח (From או Messaging Service SID)' };
  await savePlatformSettings(user.id, { twilio: { ...cur.twilio, enabled: value } });
  await db.auditLog.create({ data: { actorId: user.id, action: 'twilio_update', subjectType: 'platform_settings', subjectId: user.id, meta: { ref: name, value } } });
  revalidatePath('/ops/messages');
  return { ok: true };
}

export async function saveTwilioSenderAction(input: { from: string; messagingServiceSid: string }): Promise<Res> {
  const user = await areaUserOrNull('messages', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const { isSender, isServiceSid } = await import('@/lib/vendors/twilio');
  const rawFrom = (input.from ?? '').trim();
  const { toE164 } = await import('@/lib/format');
  const from = /^\+/.test(rawFrom) ? rawFrom.replace(/[\s-]/g, '') : /^\d/.test(rawFrom) ? (toE164(rawFrom) ?? rawFrom) : rawFrom;
  const mg = (input.messagingServiceSid ?? '').trim();
  if (!from && !mg) return { ok: false, error: 'צריך מספר שולח (From) או Messaging Service SID' };
  if (from && !isSender(from)) return { ok: false, error: 'From: מספר Twilio בפורמט +972… או שם שולח של עד 11 תווים לטיניים' };
  if (mg && !isServiceSid(mg)) return { ok: false, error: 'Messaging Service SID מתחיל ב־MG ואחריו 32 תווים' };
  const cur = await platformSettings();
  await savePlatformSettings(user.id, { twilio: { ...cur.twilio, from, messagingServiceSid: mg } });
  revalidatePath('/ops/messages');
  return { ok: true, text: 'נשמר' };
}

export async function saveTwilioCredsAction(input: { accountSid: string; authToken: string }): Promise<Res> {
  const user = await areaUserOrNull('messages', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const { saveTwilioCreds, twilioCheck } = await import('@/lib/server/twilio');
  const r = await saveTwilioCreds(input.accountSid ?? '', input.authToken ?? '', user.id);
  if (!r.ok) return r;
  await db.auditLog.create({ data: { actorId: user.id, action: 'twilio_key', subjectType: 'platform_settings', subjectId: user.id, meta: { ref: r.label, op: 'save' } } });
  revalidatePath('/ops/messages');
  const check = await twilioCheck();
  return check.ok ? { ok: true, text: `נשמר. ${check.text}` } : { ok: false, error: `נשמר, אבל הבדיקה נכשלה: ${check.error}` };
}

export async function removeTwilioCredsAction(): Promise<Res> {
  const user = await areaUserOrNull('messages', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const { removeTwilioCreds } = await import('@/lib/server/twilio');
  await removeTwilioCreds();
  await db.auditLog.create({ data: { actorId: user.id, action: 'twilio_key', subjectType: 'platform_settings', subjectId: user.id, meta: { ref: 'removed', op: 'remove' } } });
  revalidatePath('/ops/messages');
  return { ok: true, text: 'הפרטים הוסרו' };
}

export async function twilioCheckAction(): Promise<Res> {
  const user = await areaUserOrNull('messages', 'view');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const { twilioCheck } = await import('@/lib/server/twilio');
  return twilioCheck();
}

export async function twilioTestAction(input: { phone: string }): Promise<Res> {
  const user = await areaUserOrNull('messages', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const { toE164 } = await import('@/lib/format');
  const raw = (input.phone ?? '').trim();
  const to = raw.startsWith('+') ? raw.replace(/[^\d+]/g, '') : toE164(raw);
  if (!to || !/^\+\d{8,15}$/.test(to)) return { ok: false, error: 'מספר טלפון לא תקין' };
  const { twilioTestSend } = await import('@/lib/server/twilio');
  const r = await twilioTestSend(to);
  await db.auditLog.create({ data: { actorId: user.id, action: 'twilio_test', subjectType: 'platform_settings', subjectId: user.id, meta: { ref: 'sms', ok: r.ok } } });
  revalidatePath('/ops/messages');
  return r.ok ? { ok: true, text: `נשלח. מזהה ב־Twilio: ${r.id}. מצב המסירה יופיע ביומן למטה תוך כמה שניות.` } : { ok: false, error: r.error };
}

// ---------- Twilio voice (the ownership claim's "שיחה קולית") ----------

export async function saveTwilioVoiceAction(input: { voiceFrom: string; voice: string }): Promise<Res> {
  const user = await areaUserOrNull('messages', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const { toE164 } = await import('@/lib/format');
  const { isPhone } = await import('@/lib/vendors/twilio');
  const raw = (input.voiceFrom ?? '').trim();
  const voiceFrom = !raw ? '' : raw.startsWith('+') ? raw.replace(/[\s-]/g, '') : (toE164(raw) ?? raw);
  if (voiceFrom && !isPhone(voiceFrom)) return { ok: false, error: 'מספר לשיחות: מספר Twilio בפורמט +972… (או ריק כדי להשתמש בשולח ה־SMS)' };
  const voice = (input.voice ?? '').trim() || 'Google.he-IL-Standard-A';
  if (!/^[A-Za-z0-9.\-_]{2,60}$/.test(voice)) return { ok: false, error: 'שם קול לא תקין, למשל Google.he-IL-Standard-A' };
  const cur = await platformSettings();
  await savePlatformSettings(user.id, { twilio: { ...cur.twilio, voiceFrom, voice } });
  revalidatePath('/ops/messages');
  return { ok: true, text: 'נשמר' };
}

export async function twilioTestCallAction(input: { phone: string }): Promise<Res> {
  const user = await areaUserOrNull('messages', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const { toE164 } = await import('@/lib/format');
  const raw = (input.phone ?? '').trim();
  const to = raw.startsWith('+') ? raw.replace(/[^\d+]/g, '') : toE164(raw);
  if (!to || !/^\+\d{8,15}$/.test(to)) return { ok: false, error: 'מספר טלפון לא תקין' };
  const { twilioTestCall } = await import('@/lib/server/twilio');
  const r = await twilioTestCall(to);
  await db.auditLog.create({ data: { actorId: user.id, action: 'twilio_test', subjectType: 'platform_settings', subjectId: user.id, meta: { ref: 'voice', ok: r.ok } } });
  revalidatePath('/ops/messages');
  return r.ok ? { ok: true, text: `השיחה יצאה. מזהה ב־Twilio: ${r.id}. בסיום השיחה המצב יופיע ביומן למטה.` } : { ok: false, error: r.error };
}

export type TwilioSetupRes = { ok: true; checks: Array<{ ok: boolean | null; text: string }>; numbers: Array<{ phone: string; name: string; voice: boolean; sms: boolean }>; voiceFrom: string | null } | { ok: false; error: string };

/** Reads the Twilio account (sends nothing) and reports what is set up for codes, SMS and calls. */
export async function twilioSetupAction(): Promise<TwilioSetupRes> {
  const user = await areaUserOrNull('messages', 'view');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const { twilioSetup } = await import('@/lib/server/twilio');
  const r = await twilioSetup();
  return r.ok ? { ok: true, ...r.setup } : r;
}

// ---------- Email (Resend) ----------

export async function setEmailFlagAction(name: string, value: boolean): Promise<{ ok: boolean; error?: string }> {
  const user = await areaUserOrNull('messages', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  if (name !== 'enabled') return { ok: false, error: 'הגדרה לא מוכרת' };
  const { resendKey } = await import('@/lib/server/email');
  if (value && !(await resendKey())) return { ok: false, error: 'הזינו קודם מפתח API של Resend' };
  const cur = await platformSettings();
  await savePlatformSettings(user.id, { email: { ...cur.email, enabled: value } });
  await db.auditLog.create({ data: { actorId: user.id, action: 'email_update', subjectType: 'platform_settings', subjectId: user.id, meta: { ref: name, value } } });
  revalidatePath('/ops/messages');
  return { ok: true };
}

export async function saveEmailKeyAction(input: { key: string }): Promise<Res> {
  const user = await areaUserOrNull('messages', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const { saveResendKey, emailDomainCheck } = await import('@/lib/server/email');
  const r = await saveResendKey(input.key ?? '', user.id);
  if (!r.ok) return r;
  await db.auditLog.create({ data: { actorId: user.id, action: 'email_key', subjectType: 'platform_settings', subjectId: user.id, meta: { ref: r.hint, op: 'save' } } });
  revalidatePath('/ops/messages');
  const check = await emailDomainCheck();
  return check.ok ? { ok: true, text: `נשמר. ${check.text}` } : { ok: true, text: `נשמר. ${check.error}` };
}

export async function removeEmailKeyAction(): Promise<Res> {
  const user = await areaUserOrNull('messages', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const { removeResendKey } = await import('@/lib/server/email');
  await removeResendKey();
  await db.auditLog.create({ data: { actorId: user.id, action: 'email_key', subjectType: 'platform_settings', subjectId: user.id, meta: { ref: 'removed', op: 'remove' } } });
  revalidatePath('/ops/messages');
  return { ok: true, text: 'המפתח הוסר' };
}

export async function saveEmailSenderAction(input: { from: string; replyTo: string }): Promise<Res> {
  const user = await areaUserOrNull('messages', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const { fromAddress } = await import('@/lib/vendors/resend');
  const from = (input.from ?? '').trim();
  const replyTo = (input.replyTo ?? '').trim();
  if (!fromAddress(from)) return { ok: false, error: 'כתובת שולח לא תקינה. למשל: BeautyFind <noreply@beautyfind.co.il>' };
  if (replyTo && !fromAddress(replyTo)) return { ok: false, error: 'כתובת לתשובות לא תקינה' };
  const cur = await platformSettings();
  await savePlatformSettings(user.id, { email: { ...cur.email, from, replyTo } });
  revalidatePath('/ops/messages');
  return { ok: true, text: 'נשמר' };
}

export async function emailDomainCheckAction(): Promise<Res> {
  const user = await areaUserOrNull('messages', 'view');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const { emailDomainCheck } = await import('@/lib/server/email');
  return emailDomainCheck();
}

export async function emailTestAction(input: { email: string }): Promise<Res> {
  const user = await areaUserOrNull('messages', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const to = (input.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) return { ok: false, error: 'כתובת אימייל לא תקינה' };
  const { emailTestSend } = await import('@/lib/server/email');
  const r = await emailTestSend(to);
  await db.auditLog.create({ data: { actorId: user.id, action: 'email_test', subjectType: 'platform_settings', subjectId: user.id, meta: { ref: 'email', ok: r.ok } } });
  revalidatePath('/ops/messages');
  return r.ok ? { ok: true, text: `נשלח. מזהה ב־Resend: ${r.id}. בדקו את תיבת הדואר (וגם את הספאם).` } : { ok: false, error: r.error };
}
