import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BookingFlow } from '@/components/booking/BookingFlow';
import type { BookingData, BookStaff, BookTreatment } from '@/components/booking/shared';
import { fullAddress } from '@/components/booking/shared';
import { PROFESSION_NAME, initials, parseHours, type PractitionerProfession, type PriceType } from '@/components/profile/format';
import { fromE164 } from '@/lib/format';
import { eligiblePractitioners } from '@/lib/server/availability';
import { depositFor } from '@/lib/server/booking';
import { isAdvanced } from '@/lib/server/clinic';
import { db } from '@/lib/server/db';
import { canTakePayments } from '@/lib/server/money';
import { PUBLIC_WHERE, profileHref } from '@/lib/server/public';
import { currentUser } from '@/lib/server/session';
import { ilDateKey } from '@/lib/time';

// Design: project/BeautyFind Booking.dc.html. Steps: treatment → practitioner → slot → details + consents.
// Deposit per the business's DepositPolicy (advanced plan only, as createBooking applies it).
// Medical treatments hand off to /consult/[branch]. Availability is per request, so never cached.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ branch: string }>; searchParams: Promise<{ t?: string | string[] }> };

const DEFAULT_REFUND_WINDOW_H = 24;
const OTHER_CAT = { slug: 'other', name: 'טיפולים נוספים' };

async function loadBranch(slug: string) {
  return db.branch.findFirst({
    where: { AND: [PUBLIC_WHERE, { slug }] },
    include: {
      business: { select: { id: true, depositPolicy: true } },
      treatments: { where: { isPublished: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], include: { category: true } },
      medicalResponsible: { select: { id: true, displayName: true, license: { select: { number: true, status: true } } } },
    },
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { branch } = await params;
  const b = await db.branch.findFirst({ where: { AND: [PUBLIC_WHERE, { slug: branch }] }, select: { name: true, cityName: true } });
  if (!b) return { title: 'הקליניקה לא נמצאה', robots: { index: false } };
  return {
    title: `קביעת תור: ${b.name}, ${b.cityName}`,
    description: `קביעת תור אונליין ב${b.name}: בחירת טיפול, מטפלת ומועד פנוי, ואישור בוואטסאפ.`,
    robots: { index: false, follow: true },
  };
}

export default async function BookPage({ params, searchParams }: Props) {
  const { branch: slug } = await params;
  const sp = await searchParams;
  const b = await loadBranch(slug);
  if (!b) notFound();

  const [advanced, paymentsReady, user] = await Promise.all([isAdvanced(b.businessId), canTakePayments(b.businessId), currentUser().catch(() => null)]);
  // Same gate as createBooking: basic listings never take deposits.
  const policy = advanced ? b.business.depositPolicy : null;

  const staffById = new Map<string, BookStaff>();
  const treatments: BookTreatment[] = await Promise.all(
    b.treatments.map(async t => {
      const staff = t.isMedical ? [] : await eligiblePractitioners(b.id, t);
      for (const s of staff) {
        if (!staffById.has(s.id)) {
          staffById.set(s.id, { id: s.id, name: s.displayName, role: PROFESSION_NAME[s.profession as PractitionerProfession] ?? '', init: initials(s.displayName) });
        }
      }
      const deposit = depositFor(policy, t);
      return {
        id: t.id,
        name: t.name,
        catSlug: t.category?.slug ?? OTHER_CAT.slug,
        catName: t.category?.name ?? OTHER_CAT.name,
        priceType: t.priceType as PriceType,
        priceAgorot: t.priceAgorot,
        durationMin: t.durationMin ?? 60,
        isMedical: t.isMedical,
        requiresDeclaration: t.requiresDeclaration,
        depositAgorot: deposit,
        bookable: b.onlineBooking && !t.isMedical && t.onlineBookable && staff.length > 0 && (deposit === 0 || paymentsReady),
        staffIds: staff.map(s => s.id),
      };
    }),
  );

  // Category order follows the catalog (Category.sortOrder), with uncategorised treatments last.
  const cats = new Map<string, { slug: string; name: string; order: number }>();
  for (const t of b.treatments) {
    const c = t.category ? { slug: t.category.slug, name: t.category.name, order: t.category.sortOrder } : { ...OTHER_CAT, order: 1e6 };
    if (!cats.has(c.slug)) cats.set(c.slug, c);
  }

  const t = Array.isArray(sp.t) ? sp.t[0] : sp.t;
  const med = b.medicalResponsible?.license?.status === 'verified' ? b.medicalResponsible : null;

  const data: BookingData = {
    branch: {
      id: b.id,
      slug: b.slug,
      name: b.name,
      address: fullAddress(b.address, b.cityName),
      phone: b.phone,
      whatsapp: b.whatsapp,
      wazeUrl: b.wazeUrl,
      profileHref: profileHref(b),
      hours: parseHours(b.hours),
      medical: med ? { name: med.displayName, license: med.license?.number ?? null, href: `/pro/${med.id}` } : null,
      onlineBooking: b.onlineBooking,
    },
    treatments,
    staff: [...staffById.values()],
    categories: [...cats.values()].sort((a, c) => a.order - c.order).map(({ slug: s, name }) => ({ slug: s, name })),
    policy: { depositOn: !!policy?.enabled, refundH: policy?.refundWindowHours ?? DEFAULT_REFUND_WINDOW_H },
    todayKey: ilDateKey(new Date()),
    preselect: t && treatments.some(x => x.id === t) ? t : null,
    prefill: {
      name: user?.fullName ?? '',
      phone: user?.phone ? fromE164(user.phone) : '',
      email: user?.email ?? '',
    },
  };

  return <BookingFlow data={data} />;
}
