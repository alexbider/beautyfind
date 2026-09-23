import { NextResponse } from 'next/server';
import { db } from '@/lib/server/db';
import { currentUser } from '@/lib/server/session';
import { ilDateKey } from '@/lib/time';

// GET /account/export → JSON download of the signed-in client's own data (privacy: right of access).
// Includes only rows tied to this account. Health declaration answers and clinical notes are held by
// the clinic that treated the client, so they are not exported here: a note explains how to request them.

export async function GET() {
  const user = await currentUser();
  if (!user || user.kind !== 'client') return NextResponse.json({ error: 'signed_out' }, { status: 401 });

  const contacts = [user.phone, user.email].filter((x): x is string => !!x);
  const [bookings, reviews, saved, consents, declarations, requests] = await Promise.all([
    db.booking.findMany({
      where: { clientUserId: user.id },
      orderBy: { startsAt: 'desc' },
      select: {
        ref: true, kind: true, status: true, startsAt: true, durationMin: true, priceAgorot: true, depositAgorot: true,
        policyShown: true, cancellation: true, consents: true, createdAt: true, clientName: true, clientPhone: true, clientEmail: true,
        branch: { select: { name: true, address: true, cityName: true } },
        treatment: { select: { name: true } },
        payments: {
          select: {
            purpose: true, status: true, netAgorot: true, vatAgorot: true, grossAgorot: true, installments: true, cardBrand: true, cardLast4: true, paidAt: true,
            documents: { select: { type: true, number: true, netAgorot: true, vatAgorot: true, grossAgorot: true, issuedAt: true } },
            refunds: { select: { amountAgorot: true, status: true, expectedBy: true, createdAt: true } },
          },
        },
      },
    }),
    db.review.findMany({
      where: { booking: { clientUserId: user.id } },
      orderBy: { createdAt: 'desc' },
      select: {
        rating: true, title: true, body: true, aspects: true, tags: true, nameMode: true, authorName: true, treatmentName: true, status: true,
        photoConsent: true, businessReply: true, createdAt: true, branch: { select: { name: true } },
      },
    }),
    db.savedClinic.findMany({ where: { userId: user.id }, orderBy: { savedAt: 'desc' }, select: { savedAt: true, branch: { select: { name: true, cityName: true } } } }),
    contacts.length ? db.messageConsent.findMany({ where: { contact: { in: contacts } }, select: { contact: true, scope: true, channel: true, marketing: true, source: true, updatedAt: true } }) : [],
    db.healthDeclaration.count({ where: { clientUserId: user.id } }),
    db.decision.findMany({ where: { subjectType: 'user', subjectId: user.id }, orderBy: { createdAt: 'asc' }, select: { action: true, createdAt: true } }),
  ]);

  const agorot = (n: number | null) => (n == null ? null : n / 100);
  const data = {
    exportedAt: new Date().toISOString(),
    note: 'כל הסכומים בשקלים. מחירי טיפולים לפני מע״מ; תשלומים ומסמכים כוללים מע״מ כמפורט.',
    account: {
      fullName: user.fullName, phone: user.phone, email: user.email, createdAt: user.createdAt,
      phoneVerifiedAt: user.phoneVerifiedAt, emailVerifiedAt: user.emailVerifiedAt, termsAcceptedAt: user.termsAcceptedAt, marketingOptIn: user.marketingOptIn,
    },
    bookings: bookings.map(b => ({
      ref: b.ref, kind: b.kind, status: b.status, startsAt: b.startsAt, durationMin: b.durationMin,
      business: b.branch.name, address: [b.branch.address, b.branch.cityName].filter(Boolean).join(', '), treatment: b.treatment?.name ?? null,
      priceBeforeVat: agorot(b.priceAgorot), deposit: agorot(b.depositAgorot), policyShown: b.policyShown, cancellation: b.cancellation, consents: b.consents,
      bookedAs: { name: b.clientName, phone: b.clientPhone, email: b.clientEmail }, createdAt: b.createdAt,
      payments: b.payments.map(p => ({
        purpose: p.purpose, status: p.status, net: agorot(p.netAgorot), vat: agorot(p.vatAgorot), gross: agorot(p.grossAgorot), installments: p.installments,
        card: p.cardLast4 ? `${p.cardBrand ?? ''} ${p.cardLast4}`.trim() : null, paidAt: p.paidAt,
        documents: p.documents.map(d => ({ type: d.type, number: d.number, net: agorot(d.netAgorot), vat: agorot(d.vatAgorot), gross: agorot(d.grossAgorot), issuedAt: d.issuedAt })),
        refunds: p.refunds.map(r => ({ amount: agorot(r.amountAgorot), status: r.status, expectedBy: r.expectedBy, createdAt: r.createdAt })),
      })),
    })),
    reviews: reviews.map(({ branch, ...r }) => ({ business: branch.name, ...r })),
    saved: saved.map(s => ({ business: s.branch.name, city: s.branch.cityName, savedAt: s.savedAt })),
    messageConsents: consents,
    healthDeclarations: {
      count: declarations,
      note: 'תשובות הצהרות הבריאות שמורות אצל הקליניקה שטיפלה בך ואינן כלולות בקובץ. אפשר לבקש עותק או תיקון ישירות מהקליניקה.',
    },
    privacyRequests: requests,
  };

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="beautyfind-my-data-${ilDateKey(new Date())}.json"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
