import 'server-only';
import { Prisma, type GiftCardStatus } from '@prisma/client';
import { BOOKING_LIVE } from '@/lib/features';
import { EMAIL_RE, toE164 } from '@/lib/format';
import { VAT_RATE } from '@/lib/pricing';
import { giftCode } from '@/lib/server/giftcards';
import { db } from '@/lib/server/db';
import { canTakePayments, connectionFor, refundPayment, startPayment } from '@/lib/server/money';
import { PUBLIC_WHERE, profileHref } from '@/lib/server/public';
import { isAdvanced } from '@/lib/server/clinic';
import { addDays, ilDate, ilDateKey, ilParts, ilToUtc } from '@/lib/time';
import { invoiceAdapter } from '@/lib/vendors/invoicing/registry';
import { receiptPath } from '@/components/receipt/token';
import { CANCEL_DAYS, CUSTOM_MAX, CUSTOM_MIN, MESSAGE_MAX, MIN_VALIDITY_YEARS, canonicalCode, type Channel, type LedgerStatus } from './shared';

// Gift card logic for /gift/[branch], /gift/check and /clinic/gift-cards.
// Rules: 03-states.md "Gift card", 07-rules-and-tokens.md. Money goes through the business's own provider (money.ts).

const OPEN: GiftCardStatus[] = ['scheduled', 'active', 'partially_redeemed'];

// ---------- Settings ----------

/** Business.settings.gift_validity_years, never below the legal 5 years. */
export function validityYears(settings: unknown): number {
  const v = Number((settings as Record<string, unknown> | null)?.gift_validity_years);
  return Number.isInteger(v) && v >= MIN_VALIDITY_YEARS && v <= 10 ? v : MIN_VALIDITY_YEARS;
}

const addYears = (d: Date, years: number) => {
  const t = new Date(d);
  t.setUTCFullYear(t.getUTCFullYear() + years);
  return t;
};

// ---------- Code prefix ----------

const SKIP = new Set(['קליניקת', 'קליניקה', 'קליניק', 'מכון', 'סטודיו', 'מרכז', 'בית', 'ד״ר', 'דר', 'ד"ר', 'המרכז', 'הקליניקה', 'סלון', 'מספרת', 'לטיפולי', 'לאסתטיקה', 'ביוטי', 'יופי']);
const HE: Record<string, string> = {
  א: 'A', ב: 'B', ג: 'G', ד: 'D', ה: 'H', ו: 'V', ז: 'Z', ח: 'H', ט: 'T', י: 'Y', כ: 'K', ך: 'K', ל: 'L', מ: 'M', ם: 'M',
  נ: 'N', ן: 'N', ס: 'S', ע: '', פ: 'P', ף: 'F', צ: 'TZ', ץ: 'TZ', ק: 'K', ר: 'R', ש: 'SH', ת: 'T',
};

/** A rough Hebrew → Latin reading, enough for a recognisable prefix (נועה → NOA). */
function transliterate(word: string): string {
  const chars = [...word].filter(c => c in HE);
  return chars
    .map((c, i) => {
      const first = i === 0;
      const last = i === chars.length - 1;
      if (c === 'א') return first ? 'A' : '';
      if (c === 'ו' && !first) return 'O';
      if (c === 'י' && !first) return 'I';
      if ((c === 'ה' || c === 'ע') && last) return 'A';
      return HE[c];
    })
    .join('');
}

/** NOA from "קליניקת נועה", SKIN from "Skin Lab", BF when nothing usable is left. */
export function codePrefix(name: string): string {
  const latin = name.match(/[A-Za-z]{2,}/);
  if (latin) return latin[0].toUpperCase().slice(0, 4);
  const words = name.split(/[\s\-־,.·]+/).filter(w => w && !SKIP.has(w));
  const t = transliterate(words[0] ?? '');
  return t.length >= 2 ? t.slice(0, 4) : 'BF';
}

// ---------- Rate limit (in memory, per server instance) ----------

const WINDOW_MS = 10 * 60_000;
const LIMIT = 10;
const hits = new Map<string, number[]>();

/** true when this IP may make another lookup (10 per 10 minutes). Counts the attempt. */
export function allowLookup(ip: string, now = Date.now()): boolean {
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every(t => now - t > WINDOW_MS)) hits.delete(k);
  const list = (hits.get(ip) ?? []).filter(t => now - t < WINDOW_MS);
  if (list.length >= LIMIT) {
    hits.set(ip, list);
    return false;
  }
  list.push(now);
  hits.set(ip, list);
  return true;
}

// ---------- Display helpers ----------

/** Pending cards are not sold yet; open cards past expiry read as expired. */
export function effectiveStatus(g: { status: GiftCardStatus; expiresAt: Date }, now = new Date()): LedgerStatus {
  if ((g.status === 'active' || g.status === 'partially_redeemed' || g.status === 'scheduled') && g.expiresAt <= now) return 'expired';
  return g.status;
}

const joinHe = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ו${xs[xs.length - 1]}`);
const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? '';

async function businessFace(businessId: string) {
  const branches = await db.branch.findMany({ where: { businessId, ...PUBLIC_WHERE }, orderBy: { createdAt: 'asc' }, select: { name: true, slug: true, regionSlug: true, cityName: true } });
  const main = branches[0] ?? (await db.branch.findFirst({ where: { businessId }, orderBy: { createdAt: 'asc' }, select: { name: true, slug: true, regionSlug: true, cityName: true } }));
  return {
    name: main?.name ?? 'הקליניקה',
    cities: joinHe([...new Set(branches.map(b => b.cityName))]),
    bookHref: main && branches.length ? (BOOKING_LIVE ? `/book/${main.slug}` : profileHref(main)) : null,
  };
}

// ---------- Public check ----------

export interface PublicCard {
  code: string;
  valueAgorot: number;
  balanceAgorot: number;
  from: string;
  status: LedgerStatus;
  expires: string;
  sendDate: string | null;
  treatment: string | null;
  medical: boolean;
  business: string;
  cities: string;
  bookHref: string | null;
  bookLabel: string;
  redemptions: Array<{ amountAgorot: number; date: string; what: string | null }>;
}

/** What a holder may see for a code. null for unknown codes and for cards that were never paid. */
export async function publicLookup(raw: string): Promise<PublicCard | null> {
  const code = canonicalCode(raw);
  if (!code) return null;
  const g = await db.giftCard.findUnique({ where: { code }, include: { redemptions: { orderBy: { createdAt: 'asc' } } } });
  if (!g || g.status === 'pending_payment') return null;
  const [face, treatment, bookings] = await Promise.all([
    businessFace(g.businessId),
    g.treatmentId ? db.treatment.findUnique({ where: { id: g.treatmentId }, select: { name: true, isMedical: true } }) : null,
    db.booking.findMany({ where: { id: { in: g.redemptions.map(r => r.bookingId).filter((x): x is string => !!x) } }, select: { id: true, treatment: { select: { name: true } } } }),
  ]);
  const what = new Map(bookings.map(b => [b.id, b.treatment?.name ?? null]));
  const status = effectiveStatus(g);
  return {
    code: g.code,
    valueAgorot: g.valueAgorot,
    balanceAgorot: status === 'refunded' ? 0 : g.balanceAgorot,
    from: firstName(g.buyerName),
    status,
    expires: ilDate(g.expiresAt),
    sendDate: g.status === 'scheduled' ? ilDate(g.sendAt) : null,
    treatment: treatment?.name ?? null,
    medical: !!treatment?.isMedical,
    business: face.name,
    cities: face.cities,
    bookHref: face.bookHref,
    bookLabel: BOOKING_LIVE ? 'קביעת תור עם השובר' : 'לעמוד הקליניקה',
    redemptions: g.redemptions.map(r => ({ amountAgorot: r.amountAgorot, date: ilDate(r.createdAt), what: r.bookingId ? what.get(r.bookingId) ?? null : null })),
  };
}

// ---------- Buy ----------

export interface SellableBranch {
  branch: { id: string; name: string; slug: string; regionSlug: string; cityName: string; phone: string | null; whatsapp: string | null; email: string | null };
  businessId: string;
  canSell: boolean;
  reason: 'plan' | 'payments' | null;
  years: number;
}

/** The live branch behind /gift/[branch], and whether its business can sell gift cards right now. */
export async function sellableBranch(slug: string): Promise<SellableBranch | null> {
  const b = await db.branch.findFirst({
    where: { slug, ...PUBLIC_WHERE },
    select: { id: true, name: true, slug: true, regionSlug: true, cityName: true, phone: true, whatsapp: true, email: true, businessId: true, business: { select: { settings: true } } },
  });
  if (!b) return null;
  const advanced = await isAdvanced(b.businessId);
  const payments = advanced && (await canTakePayments(b.businessId));
  const { business, businessId, ...branch } = b;
  return { branch, businessId, canSell: advanced && payments, reason: !advanced ? 'plan' : !payments ? 'payments' : null, years: validityYears(business.settings) };
}

/** Published fixed-price treatments of the branch, with the VAT-inclusive value a card would carry. */
export async function giftTreatments(branchId: string) {
  const rows = await db.treatment.findMany({
    where: { branchId, isPublished: true, priceType: 'fixed', priceAgorot: { gt: 0 } },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, priceAgorot: true, durationMin: true, isMedical: true },
  });
  return rows.map(t => ({ id: t.id, name: t.name, valueAgorot: grossOf(t.priceAgorot), durationMin: t.durationMin, isMedical: t.isMedical }));
}

/** Prices are stored before VAT; a treatment card is worth what the client would pay. */
export const grossOf = (netAgorot: number) => Math.round(netAgorot * (1 + VAT_RATE));

export interface BuyInput {
  kind: 'amount' | 'treatment';
  amountShekels?: number;
  treatmentId?: string;
  recipientName: string;
  channel: Channel;
  contact: string;
  message: string;
  when: 'now' | 'date';
  date?: string; // YYYY-MM-DD, Israel
  buyerName: string;
  buyerPhone: string;
  buyerEmail: string;
}

export type BuyError =
  | 'not_found' | 'cannot_sell' | 'amount' | 'treatment' | 'recipient' | 'contact' | 'message' | 'date' | 'buyer_name' | 'buyer_phone' | 'buyer_email' | 'provider';

export type BuyResult = { ok: true; cardId: string; checkoutUrl: string } | { ok: false; error: BuyError };

/** Validates, creates the card as pending_payment with a unique code, and opens the checkout. */
export async function createGiftCard(slug: string, input: BuyInput, now = new Date()): Promise<BuyResult> {
  const s = await sellableBranch(slug);
  if (!s) return { ok: false, error: 'not_found' };
  if (!s.canSell) return { ok: false, error: 'cannot_sell' };

  let valueAgorot = 0;
  let treatmentId: string | null = null;
  let what = 'לכל טיפול';
  if (input.kind === 'amount') {
    const n = Number(input.amountShekels);
    if (!Number.isInteger(n) || n < CUSTOM_MIN || n > CUSTOM_MAX) return { ok: false, error: 'amount' };
    valueAgorot = n * 100;
  } else {
    const t = (await giftTreatments(s.branch.id)).find(x => x.id === input.treatmentId);
    if (!t) return { ok: false, error: 'treatment' };
    valueAgorot = t.valueAgorot;
    treatmentId = t.id;
    what = t.name;
  }

  const recipientName = input.recipientName.trim();
  if (recipientName.length < 2 || recipientName.length > 60) return { ok: false, error: 'recipient' };
  let contact: string | null = null;
  if (input.channel === 'wa') contact = toE164(input.contact);
  else if (input.channel === 'email') contact = EMAIL_RE.test(input.contact.trim()) ? input.contact.trim().toLowerCase() : null;
  else if (input.channel !== 'self') return { ok: false, error: 'contact' };
  if (input.channel !== 'self' && !contact) return { ok: false, error: 'contact' };
  const message = input.message.trim();
  if ([...message].length > MESSAGE_MAX) return { ok: false, error: 'message' };

  let sendAt = now;
  if (input.when === 'date') {
    const today = ilDateKey(now);
    if (!input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || input.date < today || input.date > addDays(today, 365)) return { ok: false, error: 'date' };
    sendAt = ilToUtc(input.date, '09:00');
    if (sendAt < now) sendAt = now;
  }

  const buyerName = input.buyerName.trim();
  if (buyerName.length < 2 || buyerName.length > 80) return { ok: false, error: 'buyer_name' };
  const buyerPhone = toE164(input.buyerPhone);
  if (!buyerPhone) return { ok: false, error: 'buyer_phone' };
  const buyerEmail = input.buyerEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(buyerEmail)) return { ok: false, error: 'buyer_email' };

  const prefix = codePrefix(s.branch.name);
  let card = null;
  for (let i = 0; i < 6 && !card; i++) {
    try {
      card = await db.giftCard.create({
        data: {
          code: giftCode(prefix), businessId: s.businessId, kind: input.kind, treatmentId, valueAgorot, balanceAgorot: valueAgorot,
          buyerName, buyerPhone, buyerEmail, recipientName, recipientChannel: input.channel, recipientContact: contact,
          message: message || null, sendAt, expiresAt: addYears(now, s.years), status: 'pending_payment',
        },
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
  }
  if (!card) return { ok: false, error: 'provider' };

  const pay = await startGiftPayment(card.id, s.branch.slug, s.branch.name, what);
  if (!pay.ok) {
    await db.giftCard.delete({ where: { id: card.id } }).catch(() => {});
    return { ok: false, error: pay.error === 'no_provider' ? 'cannot_sell' : 'provider' };
  }
  return { ok: true, cardId: card.id, checkoutUrl: pay.checkoutUrl };
}

async function startGiftPayment(cardId: string, slug: string, branchName: string, what: string) {
  const g = await db.giftCard.findUniqueOrThrow({ where: { id: cardId } });
  return startPayment({
    businessId: g.businessId,
    purpose: 'gift_card',
    grossAgorot: g.valueAgorot,
    description: `שובר מתנה: ${branchName}, ${what}`,
    customer: { name: g.buyerName, phone: g.buyerPhone, email: g.buyerEmail },
    giftCardId: g.id,
    returnPath: `/gift/${slug}?card=${g.id}`,
  });
}

/** "Try again" after a failed or cancelled checkout: a new payment for the same pending card. */
export async function retryGiftPayment(slug: string, cardId: string): Promise<BuyResult> {
  const s = await sellableBranch(slug);
  if (!s) return { ok: false, error: 'not_found' };
  if (!s.canSell) return { ok: false, error: 'cannot_sell' };
  const g = await db.giftCard.findFirst({ where: { id: cardId, businessId: s.businessId, status: 'pending_payment' } });
  if (!g) return { ok: false, error: 'not_found' };
  const t = g.treatmentId ? await db.treatment.findUnique({ where: { id: g.treatmentId }, select: { name: true } }) : null;
  const pay = await startGiftPayment(g.id, s.branch.slug, s.branch.name, t?.name ?? 'לכל טיפול');
  return pay.ok ? { ok: true, cardId: g.id, checkoutUrl: pay.checkoutUrl } : { ok: false, error: pay.error === 'no_provider' ? 'cannot_sell' : 'provider' };
}

export type ReturnState =
  | { state: 'done'; code: string; valueAgorot: number; what: string; expires: string; channel: Channel; recipient: string; scheduled: boolean; sendDate: string; receipt: boolean; receiptUrl: string | null }
  | { state: 'waiting' }
  | { state: 'failed' };

/** What the buyer sees back from the checkout. */
export async function returnState(businessId: string, cardId: string, paidFlag: string | undefined): Promise<ReturnState | null> {
  if (!/^[0-9a-f-]{36}$/i.test(cardId)) return null;
  const g = await db.giftCard.findFirst({ where: { id: cardId, businessId } });
  if (!g) return null;
  if (g.status === 'pending_payment') {
    const last = await db.payment.findFirst({ where: { giftCardId: g.id }, orderBy: { createdAt: 'desc' }, select: { status: true } });
    return paidFlag === '0' || last?.status === 'failed' || !last ? { state: 'failed' } : { state: 'waiting' };
  }
  if (g.status !== 'active' && g.status !== 'scheduled' && g.status !== 'partially_redeemed' && g.status !== 'redeemed') return null;
  const [t, doc] = await Promise.all([
    g.treatmentId ? db.treatment.findUnique({ where: { id: g.treatmentId }, select: { name: true } }) : null,
    db.document.findFirst({ where: { payment: { giftCardId: g.id }, type: 'receipt' }, orderBy: { issuedAt: 'desc' }, select: { id: true } }),
  ]);
  return {
    state: 'done', code: g.code, valueAgorot: g.valueAgorot, what: t?.name ?? '', expires: ilDate(g.expiresAt),
    channel: (['wa', 'email', 'self'].includes(g.recipientChannel) ? g.recipientChannel : 'self') as Channel,
    recipient: g.recipientName, scheduled: g.status === 'scheduled', sendDate: ilDate(g.sendAt), receipt: !!doc, receiptUrl: doc ? receiptPath(doc.id) : null,
  };
}

// ---------- Clinic desk ----------

export interface DeskCard {
  id: string;
  code: string;
  status: LedgerStatus;
  valueAgorot: number;
  balanceAgorot: number;
  recipient: string;
  buyer: string;
  treatment: string | null;
  medical: boolean;
  expires: string;
  purchased: string;
  redemptions: Array<{ amountAgorot: number; date: string; doc: string | null }>;
  cancellable: boolean;
}

async function paidPayment(giftCardId: string) {
  return db.payment.findFirst({ where: { giftCardId, purpose: 'gift_card', status: 'succeeded' }, orderBy: { paidAt: 'desc' } });
}

function withinCancel(paidAt: Date | null, fallback: Date, now: Date) {
  return now.getTime() - (paidAt ?? fallback).getTime() <= CANCEL_DAYS * 86_400_000;
}

/** A card of this business by code, for the reception desk. */
export async function deskLookup(businessId: string, raw: string, now = new Date()): Promise<DeskCard | null> {
  const code = canonicalCode(raw);
  if (!code) return null;
  const g = await db.giftCard.findFirst({ where: { code, businessId, status: { not: 'pending_payment' } }, include: { redemptions: { orderBy: { createdAt: 'asc' } } } });
  if (!g) return null;
  return toDesk(g, now);
}

async function toDesk(g: Prisma.GiftCardGetPayload<{ include: { redemptions: true } }>, now: Date): Promise<DeskCard> {
  const [t, docs, pay] = await Promise.all([
    g.treatmentId ? db.treatment.findUnique({ where: { id: g.treatmentId }, select: { name: true, isMedical: true } }) : null,
    db.document.findMany({ where: { id: { in: g.redemptions.map(r => r.documentId).filter((x): x is string => !!x) } }, select: { id: true, number: true } }),
    paidPayment(g.id),
  ]);
  const num = new Map(docs.map(d => [d.id, d.number]));
  const status = effectiveStatus(g, now);
  return {
    id: g.id, code: g.code, status, valueAgorot: g.valueAgorot, balanceAgorot: g.balanceAgorot,
    recipient: g.recipientName, buyer: g.buyerName, treatment: t?.name ?? null, medical: !!t?.isMedical,
    expires: ilDate(g.expiresAt), purchased: ilDate(pay?.paidAt ?? g.createdAt),
    redemptions: g.redemptions.map(r => ({ amountAgorot: r.amountAgorot, date: ilDate(r.createdAt), doc: r.documentId ? num.get(r.documentId) ?? null : null })),
    cancellable: (status === 'active' || status === 'scheduled') && g.redemptions.length === 0 && g.balanceAgorot === g.valueAgorot && !!pay && withinCancel(pay.paidAt, g.createdAt, now),
  };
}

export type RedeemError = 'not_found' | 'expired' | 'refunded' | 'empty' | 'amount' | 'over_balance' | 'booking_not_found' | 'needs_consult' | 'conflict';
export type RedeemResult =
  | { ok: true; balanceAgorot: number; amountAgorot: number; invoice: { number: string } | 'none' | 'failed'; card: DeskCard }
  | { ok: false; error: RedeemError; balanceAgorot?: number };

/**
 * Redeems part of a card at the desk. The balance moves with a conditional update, so two desks can't
 * spend the same shekel. The clinic's tax invoice is issued afterwards through its invoicing provider.
 */
export async function redeem(opts: { businessId: string; branchId: string; staffId: string | null; code: string; amountAgorot: number; bookingRef?: string }, now = new Date()): Promise<RedeemResult> {
  const code = canonicalCode(opts.code);
  if (!code) return { ok: false, error: 'not_found' };
  const g = await db.giftCard.findFirst({ where: { code, businessId: opts.businessId } });
  if (!g || g.status === 'pending_payment') return { ok: false, error: 'not_found' };
  if (g.status === 'refunded') return { ok: false, error: 'refunded' };
  if (g.status === 'expired' || g.expiresAt <= now) return { ok: false, error: 'expired' };
  if (g.status === 'redeemed' || g.balanceAgorot <= 0) return { ok: false, error: 'empty' };
  const amount = Math.round(opts.amountAgorot);
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, error: 'amount' };
  if (amount > g.balanceAgorot) return { ok: false, error: 'over_balance', balanceAgorot: g.balanceAgorot };

  // Optional link to a booking of this business (by ref, e.g. BF-4288).
  let booking: { id: string; clientName: string; clientEmail: string | null; consultRequestId: string | null } | null = null;
  const ref = opts.bookingRef?.trim().toUpperCase();
  if (ref) {
    booking = await db.booking.findFirst({ where: { ref, branch: { businessId: opts.businessId } }, select: { id: true, clientName: true, clientEmail: true, consultRequestId: true } });
    if (!booking) return { ok: false, error: 'booking_not_found' };
  }

  // Treatment cards for medical treatments redeem only after the physician approved it in a consult.
  const t = g.treatmentId ? await db.treatment.findUnique({ where: { id: g.treatmentId }, select: { name: true, isMedical: true } }) : null;
  if (g.kind === 'treatment' && t?.isMedical) {
    const consult = booking?.consultRequestId ? await db.consultRequest.findUnique({ where: { id: booking.consultRequestId }, select: { status: true } }) : null;
    if (consult?.status !== 'closed_treatment_booked') return { ok: false, error: 'needs_consult' };
  }

  const done = await db.$transaction(async tx => {
    const moved = await tx.giftCard.updateMany({
      where: { id: g.id, balanceAgorot: { gte: amount }, status: { in: OPEN }, expiresAt: { gt: now } },
      data: { balanceAgorot: { decrement: amount } },
    });
    if (moved.count === 0) return null;
    const after = await tx.giftCard.findUniqueOrThrow({ where: { id: g.id }, select: { balanceAgorot: true } });
    await tx.giftCard.update({ where: { id: g.id }, data: { status: after.balanceAgorot === 0 ? 'redeemed' : 'partially_redeemed' } });
    const r = await tx.giftRedemption.create({
      data: { giftCardId: g.id, amountAgorot: amount, bookingId: booking?.id ?? null, branchId: opts.branchId, byStaffId: opts.staffId },
    });
    return { redemptionId: r.id, balance: after.balanceAgorot };
  });
  if (!done) return { ok: false, error: 'conflict' };

  const invoice = await issueRedemptionInvoice({
    businessId: opts.businessId, redemptionId: done.redemptionId, amountAgorot: amount,
    line: `מימוש שובר מתנה ${g.code}${t ? `: ${t.name}` : ''}`,
    customer: { name: booking?.clientName ?? g.recipientName, email: booking?.clientEmail ?? (g.recipientChannel === 'email' ? g.recipientContact : null) },
  });
  const fresh = await db.giftCard.findUniqueOrThrow({ where: { id: g.id }, include: { redemptions: { orderBy: { createdAt: 'asc' } } } });
  return { ok: true, balanceAgorot: done.balance, amountAgorot: amount, invoice, card: await toDesk(fresh, now) };
}

/** The clinic's tax invoice for a redemption. No invoicing connection: the clinic issues it in its own system. */
async function issueRedemptionInvoice(o: { businessId: string; redemptionId: string; amountAgorot: number; line: string; customer: { name: string; email: string | null } }): Promise<{ number: string } | 'none' | 'failed'> {
  const conn = await connectionFor(o.businessId, 'invoicing');
  if (!conn) return 'none';
  const net = Math.round(o.amountAgorot / (1 + VAT_RATE));
  const vat = o.amountAgorot - net;
  const lines = [{ description: o.line, qty: 1, unitAgorot: net }];
  try {
    const doc = await invoiceAdapter(conn.provider).issue(conn.credentials, {
      type: 'tax_invoice_receipt', customer: { name: o.customer.name, email: o.customer.email }, lines, vatRate: VAT_RATE, sendTo: o.customer.email,
    });
    const d = await db.document.create({
      data: {
        issuer: 'business', businessId: o.businessId, type: 'tax_invoice_receipt', number: doc.number, lines,
        netAgorot: net, vatAgorot: vat, grossAgorot: o.amountAgorot, provider: conn.provider, providerRef: doc.providerRef, pdfUrl: doc.pdfUrl, sentTo: o.customer.email,
      },
    });
    await db.giftRedemption.update({ where: { id: o.redemptionId }, data: { documentId: d.id } });
    return { number: doc.number };
  } catch (e) {
    console.error('[gift] redemption invoice failed', e);
    return 'failed';
  }
}

export type CancelResult = { ok: true; card: DeskCard } | { ok: false; error: 'not_found' | 'not_cancellable' | 'provider' };

/** 14-day cancellation of an unused card: full refund through the business's provider, then status refunded. */
export async function cancelCard(businessId: string, cardId: string, now = new Date()): Promise<CancelResult> {
  const g = await db.giftCard.findFirst({ where: { id: cardId, businessId }, include: { redemptions: { select: { id: true } } } });
  if (!g) return { ok: false, error: 'not_found' };
  const pay = await paidPayment(g.id);
  if (!pay || g.redemptions.length > 0 || g.balanceAgorot !== g.valueAgorot || !withinCancel(pay.paidAt, g.createdAt, now) || (g.status !== 'active' && g.status !== 'scheduled')) {
    return { ok: false, error: 'not_cancellable' };
  }
  const prev = g.status;
  // Lock the card first so a redemption can't slip in while the refund is out at the provider.
  const locked = await db.giftCard.updateMany({ where: { id: g.id, status: prev, balanceAgorot: g.valueAgorot }, data: { status: 'refunded', balanceAgorot: 0 } });
  if (locked.count === 0) return { ok: false, error: 'not_cancellable' };
  const r = await refundPayment(pay.id, pay.grossAgorot, `ביטול שובר מתנה ${g.code} תוך ${CANCEL_DAYS} ימים, לא מומש`);
  if (!r.ok) {
    await db.giftCard.update({ where: { id: g.id }, data: { status: prev, balanceAgorot: g.valueAgorot } });
    return { ok: false, error: r.error === 'not_refundable' ? 'not_cancellable' : 'provider' };
  }
  const fresh = await db.giftCard.findUniqueOrThrow({ where: { id: g.id }, include: { redemptions: true } });
  return { ok: true, card: await toDesk(fresh, now) };
}

// ---------- Ledger ----------

export const FILTERS = ['all', 'open', 'redeemed', 'refunded', 'expired'] as const;
export type LedgerFilter = (typeof FILTERS)[number];

export interface LedgerRow {
  id: string;
  code: string;
  recipient: string;
  buyer: string;
  valueAgorot: number;
  balanceAgorot: number;
  status: LedgerStatus;
  statusNote: string | null; // "יישלח 02/10"
  purchased: string;
  expires: string;
}

function monthStart(now: Date) {
  const p = ilParts(now);
  return ilToUtc(`${p.y}-${String(p.m).padStart(2, '0')}-01`, '00:00');
}

export async function ledger(businessId: string, filter: LedgerFilter, q: string, now = new Date()) {
  const and: Prisma.GiftCardWhereInput[] = [{ businessId, status: { not: 'pending_payment' } }];
  if (filter === 'open') and.push({ status: { in: OPEN }, expiresAt: { gt: now } });
  if (filter === 'redeemed') and.push({ status: 'redeemed' });
  if (filter === 'refunded') and.push({ status: 'refunded' });
  if (filter === 'expired') and.push({ OR: [{ status: 'expired' }, { status: { in: OPEN }, expiresAt: { lte: now } }] });
  const term = q.trim();
  if (term) {
    const code = term.toUpperCase().replace(/\s/g, '');
    and.push({ OR: [{ code: { contains: code } }, { recipientName: { contains: term, mode: 'insensitive' } }, { buyerName: { contains: term, mode: 'insensitive' } }] });
  }
  const openWhere: Prisma.GiftCardWhereInput = { businessId, status: { in: OPEN }, expiresAt: { gt: now } };
  const since = monthStart(now);
  const [rows, total, liability, sold, redeemed, expiring] = await Promise.all([
    db.giftCard.findMany({ where: { AND: and }, orderBy: { createdAt: 'desc' }, take: 200 }),
    db.giftCard.count({ where: { AND: and } }),
    db.giftCard.aggregate({ where: openWhere, _sum: { balanceAgorot: true }, _count: { _all: true } }),
    db.giftCard.aggregate({ where: { businessId, status: { notIn: ['pending_payment', 'refunded'] }, createdAt: { gte: since } }, _sum: { valueAgorot: true }, _count: { _all: true } }),
    db.giftRedemption.aggregate({ where: { giftCard: { businessId }, createdAt: { gte: since } }, _sum: { amountAgorot: true }, _count: { _all: true } }),
    db.giftCard.count({ where: { ...openWhere, balanceAgorot: { gt: 0 }, expiresAt: { gt: now, lte: new Date(now.getTime() + 90 * 86_400_000) } } }),
  ]);
  return {
    total,
    rows: rows.map<LedgerRow>(g => ({
      id: g.id, code: g.code, recipient: g.recipientName, buyer: g.buyerName, valueAgorot: g.valueAgorot,
      balanceAgorot: g.status === 'refunded' ? 0 : g.balanceAgorot, status: effectiveStatus(g, now),
      statusNote: g.status === 'scheduled' && g.expiresAt > now ? `יישלח ${ilDate(g.sendAt).slice(0, 5)}` : null,
      purchased: ilDate(g.createdAt), expires: ilDate(g.expiresAt),
    })),
    kpis: {
      soldCount: sold._count._all,
      soldAgorot: sold._sum.valueAgorot ?? 0,
      redeemedAgorot: redeemed._sum.amountAgorot ?? 0,
      redeemedCount: redeemed._count._all,
      openAgorot: liability._sum.balanceAgorot ?? 0,
      openCount: liability._count._all,
      expiring,
    },
  };
}
