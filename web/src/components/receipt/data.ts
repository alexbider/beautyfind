import 'server-only';
import type { PaymentPurpose, Prisma, RefundStatus } from '@prisma/client';
import { fromE164, telHref } from '@/lib/format';
import { refundWindowHours } from '@/lib/server/booking';
import { db } from '@/lib/server/db';
import { hhmm, ilDate } from '@/lib/time';

/** "אחוזה 128, רעננה"; skips the city when the address already names it. */
const joinAddress = (address: string, city: string) => (city && !address.includes(city) ? [address, city].filter(Boolean).join(', ') : address);

// Receipt view models. Clinic documents are issued by the CLINIC through its own invoicing provider
// (docs/decisions.md), so the clinic is always shown as the issuer. Without an invoicing connection
// there is no Document row: the page shows the payment confirmation and says the tax document
// comes from the clinic directly.

export interface Line {
  name: string;
  amount: string; // formatted, may start with "−"
  strong?: boolean;
  soft?: boolean;
}

export interface DocView {
  key: string;
  kind: 'invoice' | 'credit' | 'confirmation';
  kicker: string;
  title: string;
  number: string | null;
  date: string;
  issuer: { name: string; taxId: string | null; address: string };
  meta: Array<{ label: string; value: string; ltr?: boolean }>;
  lines: Line[];
  method: string | null;
  notes: string[];
  pdfUrl: string | null;
}

export interface TrackView {
  key: string;
  title: string;
  intro: string;
  steps: Array<{ name: string; note: string; done: boolean }>;
  failed: boolean;
}

export interface ReceiptData {
  clinic: string;
  phone: { display: string; href: string } | null;
  tracks: TrackView[];
  docs: DocView[];
}

const PURPOSE: Record<PaymentPurpose, string> = {
  deposit: 'מקדמה לתור',
  treatment: 'טיפול',
  gift_card: 'שובר מתנה',
  consult: 'פגישת ייעוץ',
  subscription: 'מנוי',
  sponsored: 'מקום ממומן',
};

/** ₪1,234.50 from agorot (documents show agorot). */
export const money = (agorot: number, neg = false) =>
  (neg ? '−' : '') + '₪' + (Math.abs(agorot) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const vatPct = (net: number, vat: number) => (net > 0 ? Math.round((vat / net) * 100) : 18);
const ddmm = (d: Date) => ilDate(d).slice(0, 5);

const PAYMENT_INCLUDE = {
  documents: { orderBy: { issuedAt: 'asc' } },
  refunds: { orderBy: { createdAt: 'asc' } },
  booking: {
    select: {
      id: true, ref: true, startsAt: true, policyShown: true, cancellation: true, clientUserId: true, clientName: true,
      treatment: { select: { name: true } },
      branch: { select: { name: true, address: true, cityName: true, phone: true, business: { select: { legalName: true, companyNo: true } } } },
    },
  },
} satisfies Prisma.PaymentInclude;

export type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

/** Payments a client should see: paid ones and their after-life. Pending and failed attempts are not receipts. */
const SHOWN: Prisma.EnumPaymentStatusFilter = { in: ['succeeded', 'refunded', 'partially_refunded', 'forfeited', 'applied'] };

async function issuerFor(p: PaymentRow) {
  if (p.booking) {
    const br = p.booking.branch;
    return {
      name: br.business.legalName || br.name,
      clinic: br.name,
      taxId: br.business.companyNo,
      address: joinAddress(br.address, br.cityName),
      phone: br.phone,
    };
  }
  const biz = p.businessId
    ? await db.business.findUnique({
        where: { id: p.businessId },
        select: { legalName: true, companyNo: true, branches: { select: { name: true, address: true, cityName: true, phone: true }, orderBy: { createdAt: 'asc' }, take: 1 } },
      })
    : null;
  const br = biz?.branches[0];
  return {
    name: biz?.legalName || br?.name || 'העסק',
    clinic: br?.name || biz?.legalName || 'העסק',
    taxId: biz?.companyNo ?? null,
    address: br ? joinAddress(br.address, br.cityName) : '',
    phone: br?.phone ?? null,
  };
}

function methodText(p: PaymentRow, refund = false) {
  const card = p.cardLast4 ? `כרטיס אשראי •••• ${p.cardLast4}` : 'כרטיס אשראי';
  if (refund) return `החזר ל${card}`;
  if (p.installments > 1) return `${card} · ${p.installments} תשלומים של ${money(Math.round(p.grossAgorot / p.installments))}`;
  return `${card} · תשלום אחד`;
}

function parseLines(json: unknown): Array<{ description: string; qty: number; unitAgorot: number }> {
  if (!Array.isArray(json)) return [];
  return json.flatMap(l => {
    const o = (l ?? {}) as Record<string, unknown>;
    if (typeof o.description !== 'string' || typeof o.unitAgorot !== 'number') return [];
    return [{ description: o.description, qty: typeof o.qty === 'number' && o.qty > 0 ? o.qty : 1, unitAgorot: o.unitAgorot }];
  });
}

function statusNotes(p: PaymentRow): string[] {
  if (p.status === 'forfeited') return ['המקדמה לא הוחזרה: הביטול היה בתוך חלון הביטול שהוצג בהזמנה.'];
  if (p.status === 'applied') return ['המקדמה קוזזה מהתשלום על הטיפול בקליניקה.'];
  return [];
}

function metaFor(p: PaymentRow): DocView['meta'] {
  const b = p.booking;
  const meta: DocView['meta'] = [{ label: 'לכבוד', value: p.payerName }];
  if (b) {
    meta.push({ label: 'אסמכתת תור', value: b.ref, ltr: true });
    if (b.treatment) meta.push({ label: 'טיפול', value: b.treatment.name });
    meta.push({ label: 'מועד', value: `${ilDate(b.startsAt)} ${hhmm(b.startsAt)}`, ltr: true });
  }
  return meta;
}

type Issuer = Awaited<ReturnType<typeof issuerFor>>;

function docViews(p: PaymentRow, issuer: Issuer, onlyDocId?: string): DocView[] {
  const iss = { name: issuer.name, taxId: issuer.taxId, address: issuer.address };
  const docs = p.documents.filter(d => d.type !== 'platform_invoice' && (!onlyDocId || d.id === onlyDocId));
  const out: DocView[] = docs.map(d => {
    const credit = d.type === 'credit_note';
    const receiptOnly = d.type === 'receipt'; // קבלה only (gift card sale): VAT is invoiced at redemption
    const lines: Line[] = parseLines(d.lines).map(l => ({
      name: l.qty > 1 ? `${l.description} × ${l.qty}` : l.description,
      amount: money(l.qty * l.unitAgorot, credit),
    }));
    if (!lines.length) lines.push({ name: credit ? `זיכוי: ${PURPOSE[p.purpose]}` : PURPOSE[p.purpose], amount: money(d.netAgorot, credit) });
    if (!receiptOnly || d.vatAgorot > 0) {
      if (lines.length > 1) lines.push({ name: 'סה״כ לפני מע״מ', amount: money(d.netAgorot, credit), soft: true });
      lines.push({ name: `מע״מ ${vatPct(d.netAgorot, d.vatAgorot)}%`, amount: money(d.vatAgorot, credit), soft: true });
    }
    lines.push({ name: credit ? 'סה״כ זיכוי' : 'סה״כ שולם', amount: money(d.grossAgorot, credit), strong: true });
    const original = credit && d.referencesDocumentId ? p.documents.find(x => x.id === d.referencesDocumentId) : null;
    const creditedBy = !credit ? p.documents.filter(x => x.type === 'credit_note' && x.referencesDocumentId === d.id) : [];
    const notes: string[] = [];
    if (original) notes.push(`מבטלת את ${original.type === 'receipt' ? 'קבלה' : 'חשבונית מס/קבלה'} מס׳ ${original.number}.`);
    for (const c of creditedBy) notes.push(`זוכתה בחשבונית זיכוי מס׳ ${c.number}.`);
    if (credit) notes.push('ההחזר יופיע בפירוט חיובי הכרטיס תוך 7–10 ימי עסקים, בהתאם לחברת האשראי.');
    else if (receiptOnly) notes.push('קבלה בלבד: חשבונית מס תופק כשהשובר ימומש בקליניקה.');
    else {
      notes.push(...statusNotes(p));
      if (p.purpose === 'deposit' && p.booking && p.status === 'succeeded') {
        notes.push(`ביטול עד ${refundWindowHours(p.booking)} שעות לפני התור: המקדמה מוחזרת במלואה עם חשבונית זיכוי.`);
      }
    }
    return {
      key: d.id,
      kind: credit ? 'credit' : 'invoice',
      kicker: credit ? 'חשבונית זיכוי' : receiptOnly ? 'קבלה' : 'חשבונית מס / קבלה',
      title: 'מס׳',
      number: d.number,
      date: ilDate(d.issuedAt),
      issuer: iss,
      meta: metaFor(p),
      lines,
      method: credit ? methodText(p, true) : methodText(p),
      notes,
      pdfUrl: d.pdfUrl,
    };
  });

  // No tax document from the clinic's invoicing provider: a payment confirmation instead.
  if (!onlyDocId && !docs.some(d => d.type === 'tax_invoice_receipt' || d.type === 'receipt')) {
    out.unshift({
      key: p.id,
      kind: 'confirmation',
      kicker: 'אישור תשלום',
      title: 'אישור תשלום',
      number: null,
      date: ilDate(p.paidAt ?? p.createdAt),
      issuer: iss,
      meta: metaFor(p),
      lines: [
        { name: `${PURPOSE[p.purpose]} (לפני מע״מ)`, amount: money(p.netAgorot) },
        { name: `מע״מ ${vatPct(p.netAgorot, p.vatAgorot)}%`, amount: money(p.vatAgorot), soft: true },
        { name: 'סה״כ שולם', amount: money(p.grossAgorot), strong: true },
      ],
      method: methodText(p),
      notes: [
        `זהו אישור תשלום, לא חשבונית מס. ${issuer.clinic} מנפיקה את חשבונית המס בעצמה ושולחת אותה ישירות. לא קיבלתם? אפשר לבקש אותה מהקליניקה.`,
        ...statusNotes(p),
      ],
      pdfUrl: null,
    });
  }
  return out;
}

const STEP_SENT: RefundStatus[] = ['issued', 'sent_to_card', 'received'];

function trackViews(p: PaymentRow): TrackView[] {
  return p.refunds.map(r => {
    const c = (p.booking?.cancellation ?? null) as { by?: string; at?: string; late?: boolean } | null;
    const cancelAt = c?.at ? new Date(c.at) : null;
    let intro = `ההחזר נפתח ב־${ilDate(r.createdAt)}.`;
    if (cancelAt && c?.by === 'clinic') intro = `הקליניקה ביטלה את התור ב־${ilDate(cancelAt)}, ולכן הסכום מוחזר במלואו.`;
    else if (cancelAt && c?.by === 'client' && !c.late) intro = `התור בוטל ב־${ilDate(cancelAt)}, יותר מ־${refundWindowHours(p.booking!)} שעות לפני המועד, ללא חיוב.`;
    else if (cancelAt) intro = `התור בוטל ב־${ilDate(cancelAt)}.`;

    const cn = r.creditNoteId ? p.documents.find(d => d.id === r.creditNoteId) : null;
    const hasInvoice = p.documents.some(d => d.type === 'tax_invoice_receipt' || d.type === 'receipt');
    const received = r.status === 'received';
    const steps: TrackView['steps'] = [
      cancelAt
        ? { name: 'התור בוטל', note: `${ddmm(cancelAt)} · ${hhmm(cancelAt)}`, done: true }
        : { name: 'בקשת ההחזר נפתחה', note: `${ddmm(r.createdAt)} · ${hhmm(r.createdAt)}`, done: true },
    ];
    if (cn) steps.push({ name: 'חשבונית זיכוי הופקה', note: `מס׳ ${cn.number}${cn.sentTo ? ' · נשלחה בדוא״ל' : ''}`, done: true });
    else if (hasInvoice) steps.push({ name: 'חשבונית זיכוי', note: 'הקליניקה מפיקה אותה עם ההחזר', done: false });
    steps.push({
      name: 'ההחזר בדרך לכרטיס',
      note: received ? `אושר על ידי חברת האשראי` : r.expectedBy ? `צפוי עד ${ddmm(r.expectedBy)}` : 'בטיפול הקליניקה',
      done: STEP_SENT.includes(r.status),
    });
    steps.push({
      name: 'ההחזר התקבל',
      note: received ? `${money(r.amountAgorot)} הוחזרו${p.cardLast4 ? ` ל־•••• ${p.cardLast4}` : ''} · ${ddmm(r.updatedAt)}` : 'נעדכן בהודעה',
      done: received,
    });
    return {
      key: r.id,
      title: p.purpose === 'deposit' ? 'החזר המקדמה' : 'החזר התשלום',
      intro,
      steps,
      failed: r.status === 'failed',
    };
  });
}

async function build(payments: PaymentRow[], onlyDocId?: string): Promise<ReceiptData | null> {
  if (!payments.length) return null;
  const issuer = await issuerFor(payments[0]);
  return {
    clinic: issuer.clinic,
    phone: issuer.phone ? { display: fromE164(issuer.phone), href: telHref(issuer.phone) } : null,
    tracks: payments.flatMap(trackViews),
    docs: payments.flatMap(p => docViews(p, issuer, onlyDocId)),
  };
}

/** All payments of one booking (the /b/:token/receipt view). Null when the booking has none. */
export async function receiptForBooking(bookingId: string) {
  const payments = await db.payment.findMany({
    where: { bookingId, payee: 'business', status: SHOWN },
    include: PAYMENT_INCLUDE,
    orderBy: { createdAt: 'asc' },
  });
  return build(payments);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One clinic document with its payment, for /receipt/:doc. Access is checked by the caller. */
export async function loadDocument(docId: string) {
  if (!UUID_RE.test(docId)) return null;
  const doc = await db.document.findUnique({ where: { id: docId }, select: { id: true, issuer: true, type: true, paymentId: true } });
  if (!doc || doc.issuer !== 'business' || doc.type === 'platform_invoice' || !doc.paymentId) return null;
  const payment = await db.payment.findUnique({ where: { id: doc.paymentId }, include: PAYMENT_INCLUDE });
  return payment ? { doc, payment } : null;
}

/** Is this the signed-in user's own payment (their booking, or paid with their phone or email)? */
export function ownsPayment(p: PaymentRow, user: { id: string; phone: string | null; email: string | null }) {
  if (p.booking?.clientUserId && p.booking.clientUserId === user.id) return true;
  if (user.phone && p.payerPhone && p.payerPhone === user.phone) return true;
  if (user.email && p.payerEmail && p.payerEmail.toLowerCase() === user.email.toLowerCase()) return true;
  return false;
}

export const receiptForDocument = (payment: PaymentRow, docId: string) => build([payment], docId);
