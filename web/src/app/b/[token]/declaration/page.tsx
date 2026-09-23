import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { dayName, roleOfProfession } from '@/components/clinic/labels';
import { DeclarationForm, type DeclarationProps } from '@/components/declaration/DeclarationForm';
import { fromE164, telHref } from '@/lib/format';
import { bookingIdFromToken } from '@/lib/server/booking';
import { hhmm, ilDate } from '@/lib/time';
import { SIGNABLE, declTypeFor, findReusable, isValidDeclaration, loadDeclarationBooking, yesCount } from './service';

// Design: project/BeautyFind Health Declaration.dc.html

export const metadata: Metadata = {
  title: 'הצהרת בריאות',
  description: 'הצהרת בריאות דיגיטלית לפני טיפול: שאלון רפואי, תרופות קבועות וחתימה, נשמרים אצל הצוות המטפל בלבד.',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default async function DeclarationPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const bookingId = bookingIdFromToken(token);
  if (!bookingId) notFound();
  const b = await loadDeclarationBooking(bookingId);
  if (!b) notFound();

  const type = declTypeFor(b);
  const linked = isValidDeclaration(b.declaration) && b.declaration!.type === type ? b.declaration! : null;
  const open = SIGNABLE.includes(b.status);
  const reusable = !linked && open ? await findReusable(b) : null;

  const doctor = b.branch.medicalResponsible;
  const doctorOk = doctor?.license?.status === 'verified' && doctor.license.kind === 'doctor';
  const pr = b.practitioner;
  const resp = type === 'medical'
    ? doctorOk
      ? `אחריות רפואית: ${doctor!.displayName}, רישיון משרד הבריאות ${doctor!.license!.number}. ההצהרה נשמרת בתיק הרפואי.`
      : 'ההצהרה נשמרת בתיק הרפואי בקליניקה.'
    : pr
      ? `איש מקצוע אחראי: ${pr.displayName}${pr.license?.status === 'verified' ? ', בעל/ת תעודה מקצועית מאומתת' : ''}.`
      : '';

  const clinicTel = b.branch.phone ?? b.branch.whatsapp;
  const props: DeclarationProps = {
    token,
    kiosk: sp.kiosk === '1',
    type,
    initialView: linked ? 'done' : !open ? 'closed' : reusable ? 'reuse' : 'form',
    client: { name: b.clientName, phone: fromE164(b.clientPhone), accountHref: b.clientUserId ? '/account' : null },
    clinicPhone: clinicTel ? { display: fromE164(clinicTel), href: telHref(clinicTel) } : null,
    appt: {
      name: b.treatment?.name ?? 'פגישת ייעוץ',
      clinic: [b.branch.name, b.branch.cityName].filter(Boolean).join(' · '),
      whoRole: roleOfProfession(pr?.profession),
      who: pr?.displayName ?? '',
      day: dayName(b.startsAt),
      when: `${ilDate(b.startsAt)} ${hhmm(b.startsAt)}`,
      ref: b.ref,
      resp,
      doctor: doctorOk ? doctor!.displayName : null,
    },
    done: linked ? { signedAt: `${ilDate(linked.signedAt)} · ${hhmm(linked.signedAt)}`, yes: yesCount(linked.answersEnc) } : null,
    reusable: reusable ? { id: reusable.id, signedOn: ilDate(reusable.signedAt), validUntil: ilDate(reusable.validUntil) } : null,
  };

  return <DeclarationForm {...props} />;
}
