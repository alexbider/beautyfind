'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { areaUserOrNull } from '@/components/ops/guard';
import { PlatformSettingsSchema, savePlatformSettings, type PlatformSettings } from '@/lib/server/platformSettings';

// Platform settings. Numbers are saved as one patch from the form; feature switches save one at a
// time. The public pages that read a setting are refreshed so the change shows at once.

const NUMBER_KEYS = ['basicMonthlyNis', 'advancedMonthlyNis', 'sponsoredWeeklyNis', 'sponsoredMaxPerList', 'vatRatePct', 'retryFirstDays', 'retrySecondDays', 'hideInDebtDays', 'giftCardMinYears'] as const;
const FLAG_KEYS = ['onlineBooking', 'giftCards', 'waitlist', 'clientAssistant', 'maintenanceMode'] as const;
export type NumberKey = (typeof NUMBER_KEYS)[number];
export type FlagKey = (typeof FLAG_KEYS)[number];

const refresh = () => { for (const p of ['/', '/search', '/ops', '/ops/settings', '/for-business', '/regions']) revalidatePath(p); };

export async function saveNumbersAction(input: Record<string, number | string>): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await areaUserOrNull('settings', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const shape = Object.fromEntries(NUMBER_KEYS.map(k => [k, PlatformSettingsSchema.shape[k]])) as Pick<typeof PlatformSettingsSchema.shape, NumberKey>;
  const p = z.object(shape).safeParse(Object.fromEntries(Object.entries(input).map(([k, v]) => [k, typeof v === 'string' ? Number(v) : v])));
  if (!p.success) return { ok: false, error: p.error.issues.map(i => `${String(i.path[0])}: ${i.message}`).join('; ') };
  if (p.data.retrySecondDays <= p.data.retryFirstDays) return { ok: false, error: 'הניסיון השני חייב להיות אחרי הראשון' };
  if (p.data.hideInDebtDays <= p.data.retrySecondDays) return { ok: false, error: 'הסתרה בחוב חייבת להיות אחרי הניסיון השני' };
  await savePlatformSettings(user.id, p.data);
  refresh();
  return { ok: true };
}

export async function setFlagAction(name: string, value: boolean): Promise<{ ok: boolean; error?: string }> {
  const user = await areaUserOrNull('settings', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  if (!(FLAG_KEYS as readonly string[]).includes(name)) return { ok: false, error: 'הגדרה לא מוכרת' };
  await savePlatformSettings(user.id, { [name]: value } as Partial<PlatformSettings>);
  refresh();
  return { ok: true };
}

export async function saveMaintenanceMessageAction(message: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await areaUserOrNull('settings', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = PlatformSettingsSchema.shape.maintenanceMessage.safeParse(message.trim());
  if (!p.success || !p.data) return { ok: false, error: 'עד 300 תווים, לא ריק' };
  await savePlatformSettings(user.id, { maintenanceMessage: p.data });
  refresh();
  return { ok: true };
}
