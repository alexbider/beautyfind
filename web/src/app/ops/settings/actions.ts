'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { areaUserOrNull } from '@/components/ops/access';
import { MARKET_PRICES_SEED, MarketPriceItemSchema, currentMonth, marketPriceUnits, type MarketPriceItem } from '@/lib/marketPrices';
import { marketPrices } from '@/lib/server/marketPrices';
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

export async function saveMedicalDisclaimerAction(text: string, kind: 'noDoctor' | 'stated' = 'noDoctor'): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await areaUserOrNull('settings', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const key = kind === 'stated' ? 'medicalStatedDisclaimer' : 'medicalDisclaimer';
  const p = PlatformSettingsSchema.shape[key].safeParse(text.trim());
  if (!p.success) return { ok: false, error: kind === 'stated' ? 'בין 20 ל־800 תווים, עם {name}' : 'בין 20 ל־800 תווים' };
  await savePlatformSettings(user.id, { [key]: p.data });
  refresh();
  return { ok: true };
}

/**
 * Market price ranges of one category (the "טווחי מחירים בשוק" card). The rows arrive in display order; min is
 * required, max is at least min or empty, the unit is one already in the data. Saving stamps meta.updated with
 * the current month and refreshes every public page that shows a range.
 */
export async function saveMarketPricesAction(category: string, rows: unknown): Promise<{ ok: true; updated: string } | { ok: false; error: string }> {
  const user = await areaUserOrNull('settings', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const cur = await marketPrices();
  if (!(category in MARKET_PRICES_SEED.categories) && !(category in cur.categories)) return { ok: false, error: 'תחום לא מוכר' };
  const units = new Set(marketPriceUnits(cur));
  const p = z.array(MarketPriceItemSchema).max(40).safeParse(rows);
  if (!p.success) return { ok: false, error: p.error.issues.map(i => `שורה ${Number(i.path[0]) + 1}, ${String(i.path[1] ?? '')}: ${i.message}`).join('; ') };
  const badUnit = p.data.find(r => !units.has(r.unit));
  if (badUnit) return { ok: false, error: `יחידה לא מוכרת: ${badUnit.unit}` };
  const labels = new Set<string>();
  for (const r of p.data) {
    if (labels.has(r.label)) return { ok: false, error: `שם טיפול כפול: ${r.label}` };
    labels.add(r.label);
  }
  const items: MarketPriceItem[] = p.data.map(r => ({ ...r, note: r.note || undefined }));
  const updated = currentMonth();
  const next = { ...cur, meta: { ...cur.meta, updated }, categories: { ...cur.categories, [category]: items } };
  await savePlatformSettings(user.id, { marketPrices: next });
  // Category pages, the index, the regions and every city page carry a range.
  revalidatePath('/', 'layout');
  revalidatePath('/ops/settings');
  return { ok: true, updated };
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
