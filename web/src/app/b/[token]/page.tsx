import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ManageBooking } from '@/components/booking/ManageBooking';
import { fullAddress, type DepositState, type ManageData } from '@/components/booking/shared';
import { PROFESSION_NAME, parseHours, type PractitionerProfession } from '@/components/profile/format';
import { bookingIdFromToken, hoursUntil, manageUrl, refundWindowHours, releaseExpiredHolds, type PolicySnapshot } from '@/lib/server/booking';
import { db } from '@/lib/server/db';
import { profileHref } from '@/lib/server/public';
import { ilDateKey } from '@/lib/time';

// Design: project/BeautyFind Manage Booking.dc.html. Guest link from the confirmation message, no login.
// The token grants this one booking only. No clinical data is read here: the declaration is loaded
// for its status (id and validity) only, never its answers, and the clinical record is not selected.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ paid?: string | string[] }> };

export const metadata: Metadata = {
  title: 'ניהול התור',
  robots: { index: false, follow: false, nocache: true },
  // The token is in the URL: never send it to WhatsApp, Waze or the payment provider as a referrer.
  referrer: 'no-referrer',
};

function depositState(payments: Array<{ purpose: string; status: string; refunds: Array<{ status: string }> }>): DepositState {
  const p = payments.find(x => x.purpose === 'deposit' || x.purpose === 'consult');
  if (!p) return 'none';
  switch (p.status) {
    case 'pending':
      return 'pending';
    case 'succeeded':
      return 'paid';
    case 'forfeited':
      return 'forfeited';
    case 'applied':
      return 'applied';
    case 'refunded':
    case 'partially_refunded':
      return p.refunds.some(r => r.status === 'requested' || r.status === 'issued' || r.status === 'sent_to_card') ? 'refunding' : 'refunded';
    default:
      return 'failed';
  }
}

export default async function ManageBookingPage({ params, searchParams }: Props) {
  const { token } = await params;
  const id = bookingIdFromToken(token);
  if (!id) notFound();
  await releaseExpiredHolds();

  const b = await db.booking.findUnique({
    where: { id },
    select: {
      id: true, ref: true, status: true, kind: true, startsAt: true, durationMin: true, depositAgorot: true, policyShown: true, holdUntil: true,
      requiresDeclaration: true, cancellation: true, treatmentId: true,
      treatment: { select: { name: true } },
      practitioner: { select: { displayName: true, profession: true } },
      declaration: { select: { id: true, validUntil: true, supersededById: true } },
      branch: { select: { name: true, slug: true, regionSlug: true, cityName: true, address: true, phone: true, whatsapp: true, wazeUrl: true, hours: true, freeParking: true } },
      payments: {
        orderBy: { createdAt: 'desc' },
        select: { purpose: true, status: true, checkoutUrl: true, refunds: { select: { status: true } } },
      },
    },
  });
  if (!b) notFound();

  const sp = await searchParams;
  const paidRaw = Array.isArray(sp.paid) ? sp.paid[0] : sp.paid;
  const now = new Date();
  const future = b.startsAt.getTime() > now.getTime();
  const policy = b.policyShown as unknown as Partial<PolicySnapshot> | null;
  const deposit = depositState(b.payments);
  const holdAlive = b.status === 'pending_payment' && !!b.holdUntil && b.holdUntil > now;
  const pendingPay = b.payments.find(p => (p.purpose === 'deposit' || p.purpose === 'consult') && p.status === 'pending');
  const cx = b.cancellation as { by?: string; late?: boolean } | null;
  const decl = b.declaration && !b.declaration.supersededById && b.declaration.validUntil > now;
  const role = b.practitioner ? PROFESSION_NAME[b.practitioner.profession as PractitionerProfession] ?? '' : '';

  const data: ManageData = {
    token,
    manageUrl: manageUrl(b.id),
    ref: b.ref,
    status: b.status,
    title: b.treatment?.name ?? 'פגישת ייעוץ',
    durationMin: b.durationMin,
    practitioner: b.practitioner ? { name: b.practitioner.displayName, role } : null,
    startsAt: b.startsAt.toISOString(),
    hoursUntil: hoursUntil(b, now),
    branch: {
      name: b.branch.name,
      cityName: b.branch.cityName,
      address: fullAddress(b.branch.address, b.branch.cityName),
      phone: b.branch.phone,
      whatsapp: b.branch.whatsapp,
      wazeUrl: b.branch.wazeUrl,
      hours: parseHours(b.branch.hours),
      profileHref: profileHref(b.branch),
      bookHref: b.treatmentId && b.kind === 'treatment' ? `/book/${b.branch.slug}?t=${b.treatmentId}` : `/book/${b.branch.slug}`,
      freeParking: b.branch.freeParking,
    },
    declaration: !b.requiresDeclaration ? 'not_required' : decl ? 'signed' : 'missing',
    deposit: {
      state: deposit,
      agorot: b.depositAgorot,
      checkoutUrl: holdAlive && pendingPay?.checkoutUrl ? pendingPay.checkoutUrl : null,
      holdUntil: holdAlive ? b.holdUntil!.toISOString() : null,
    },
    policy: { refundH: refundWindowHours(b), depositOn: (policy?.depositAgorot ?? b.depositAgorot) > 0 },
    cancellation: cx && (cx.by === 'client' || cx.by === 'clinic') ? { by: cx.by, late: !!cx.late } : null,
    hasReceipt: b.payments.some(p => p.status !== 'pending' && p.status !== 'failed'),
    canChange: b.status === 'confirmed' && future && !!b.practitioner,
    canCancel: (b.status === 'confirmed' || holdAlive) && future,
    paid: paidRaw === '1' || paidRaw === '0' ? paidRaw : null,
    todayKey: ilDateKey(now),
  };

  return <ManageBooking data={data} />;
}
