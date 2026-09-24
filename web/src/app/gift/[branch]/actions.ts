'use server';

import { z } from 'zod';
import { createGiftCard, retryGiftPayment, type BuyError } from '@/components/gift/server';

// Public gift card purchase. Everything is re-validated on the server; the client only picks.

export type BuyActionResult = { ok: true; checkoutUrl: string } | { ok: false; error: string };

const ERRORS: Record<BuyError, string> = {
  not_found: 'העמוד הזה כבר לא זמין. נסו לרענן.',
  cannot_sell: 'הקליניקה לא מוכרת כרגע שוברים באתר.',
  amount: 'סכום בין ₪100 ל־₪5,000, בשקלים שלמים.',
  treatment: 'הטיפול שבחרתם כבר לא זמין לשובר. בחרו טיפול אחר או סכום.',
  recipient: 'למי השובר?',
  contact: 'פרטי השליחה למקבל/ת לא תקינים.',
  message: 'הברכה ארוכה מ־140 תווים.',
  date: 'בחרו תאריך שליחה מהיום ועד שנה קדימה.',
  buyer_name: 'מה השם שלכם?',
  buyer_phone: 'מספר הטלפון שלכם לא תקין.',
  buyer_email: 'כתובת הדוא״ל שלכם לא תקינה. הקבלה נשלחת אליה.',
  provider: 'לא הצלחנו לפתוח את דף התשלום. נסו שוב בעוד רגע.',
};

const Input = z.object({
  kind: z.enum(['amount', 'treatment']),
  amountShekels: z.number().int().optional(),
  treatmentId: z.string().uuid().optional(),
  recipientName: z.string().max(80),
  channel: z.enum(['wa', 'email', 'self']),
  contact: z.string().max(160),
  message: z.string().max(400),
  when: z.enum(['now', 'date']),
  date: z.string().max(10).optional(),
  buyerName: z.string().max(120),
  buyerPhone: z.string().max(30),
  buyerEmail: z.string().max(160),
});

export async function buyGiftCard(slug: string, raw: unknown): Promise<BuyActionResult> {
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'חלק מהפרטים חסרים או לא תקינים.' };
  const r = await createGiftCard(String(slug), parsed.data);
  return r.ok ? { ok: true, checkoutUrl: r.checkoutUrl } : { ok: false, error: ERRORS[r.error] };
}

export async function retryGiftCard(slug: string, cardId: string): Promise<BuyActionResult> {
  const r = await retryGiftPayment(String(slug), String(cardId));
  return r.ok ? { ok: true, checkoutUrl: r.checkoutUrl } : { ok: false, error: ERRORS[r.error] };
}
