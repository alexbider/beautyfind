'use server';

import { revalidatePath } from 'next/cache';
import { cancelCard, deskLookup, redeem, type DeskCard, type RedeemError } from '@/components/gift/server';
import { money } from '@/components/gift/shared';
import { requireClinic } from '@/lib/server/clinic';
import { db } from '@/lib/server/db';

// Reception desk actions. Look-up needs `giftcards: view`; redeeming and cancelling need `manage`
// and the advanced plan. Every action re-checks on the server.

const FORBIDDEN = 'אין לך הרשאה לפעולה הזאת. מימוש וביטול שוברים אפשריים רק בהרשאת ניהול.';

async function guard(need: 'view' | 'manage') {
  try {
    return await requireClinic('giftcards', need);
  } catch {
    return null;
  }
}

export type LookupResult = { ok: true; card: DeskCard } | { ok: false; error: string };

export async function deskFind(code: string): Promise<LookupResult> {
  const ctx = await guard('view');
  if (!ctx) return { ok: false, error: FORBIDDEN };
  const card = await deskLookup(ctx.business.id, String(code).slice(0, 40));
  return card ? { ok: true, card } : { ok: false, error: 'קוד לא נמצא בשוברים של הקליניקה.' };
}

const REDEEM_ERRORS: Record<RedeemError, string> = {
  not_found: 'קוד לא נמצא בשוברים של הקליניקה.',
  expired: 'תוקף השובר פג.',
  refunded: 'השובר בוטל והכסף הוחזר לקונה.',
  empty: 'השובר מומש במלואו.',
  amount: 'הכניסי סכום למימוש.',
  over_balance: 'הסכום גבוה מהיתרה בשובר.',
  booking_not_found: 'לא מצאנו תור עם המספר הזה בקליניקה.',
  needs_consult: 'שובר לטיפול רפואי: המימוש רק אחרי ייעוץ שבו הרופא/ה אישר/ה את הטיפול. קשרי את התור שנקבע מהייעוץ.',
  conflict: 'היתרה השתנתה בזמן הפעולה. בדקי שוב את השובר.',
};

export type RedeemActionResult = { ok: true; message: string; card: DeskCard; invoiceNote: string | null } | { ok: false; error: string };

export async function deskRedeem(input: { code: string; amount: string; bookingRef?: string }): Promise<RedeemActionResult> {
  const ctx = await guard('manage');
  if (!ctx) return { ok: false, error: FORBIDDEN };
  if (!ctx.branch) return { ok: false, error: 'לא נמצא סניף לרישום המימוש.' };
  const shekels = Number(String(input.amount).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(shekels) || shekels <= 0) return { ok: false, error: REDEEM_ERRORS.amount };
  const r = await redeem({
    businessId: ctx.business.id,
    branchId: ctx.branch.id,
    staffId: ctx.preview ? null : ctx.member.id,
    code: String(input.code).slice(0, 40),
    amountAgorot: Math.round(shekels * 100),
    bookingRef: input.bookingRef ? String(input.bookingRef).slice(0, 20) : undefined,
  });
  if (!r.ok) {
    return { ok: false, error: r.error === 'over_balance' && r.balanceAgorot != null ? `היתרה בשובר ${money(r.balanceAgorot)} בלבד.` : REDEEM_ERRORS[r.error] };
  }
  revalidatePath('/clinic/gift-cards');
  const inv = typeof r.invoice === 'object' ? ` · חשבונית מס ${r.invoice.number} הופקה` : '';
  const invoiceNote =
    r.invoice === 'none'
      ? 'אין חיבור למערכת חשבוניות, לכן לא הופקה חשבונית אוטומטית. הפיקו חשבונית מס על הסכום במערכת של הקליניקה.'
      : r.invoice === 'failed'
        ? 'המימוש נרשם, אבל הפקת החשבונית נכשלה. הפיקו חשבונית מס על הסכום במערכת של הקליניקה.'
        : null;
  return { ok: true, message: `מומשו ${money(r.amountAgorot)} · יתרה ${money(r.balanceAgorot)}${inv}`, card: r.card, invoiceNote };
}

export type CancelActionResult = { ok: true; message: string; card: DeskCard } | { ok: false; error: string };

export async function deskCancel(cardId: string): Promise<CancelActionResult> {
  const ctx = await guard('manage');
  if (!ctx) return { ok: false, error: FORBIDDEN };
  const r = await cancelCard(ctx.business.id, String(cardId));
  if (!r.ok) {
    return {
      ok: false,
      error: r.error === 'provider' ? 'ההחזר לא עבר אצל חברת הסליקה. השובר נשאר פעיל, נסו שוב מאוחר יותר.' : 'אפשר לבטל רק שובר שלא מומש, תוך 14 ימים מהקנייה.',
    };
  }
  if (!ctx.preview) {
    await db.auditLog.create({ data: { actorId: ctx.user.id, action: 'gift_card_cancel', subjectType: 'gift_card', subjectId: r.card.id, businessId: ctx.business.id } });
  }
  revalidatePath('/clinic/gift-cards');
  return { ok: true, message: `השובר בוטל · ${money(r.card.valueAgorot)} יוחזרו לכרטיס של הקונה`, card: r.card };
}
