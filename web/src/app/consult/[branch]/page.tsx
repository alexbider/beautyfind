import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ConsultChrome } from '@/components/consult/Chrome';
import { ConsultForm } from '@/components/consult/ConsultForm';
import { ConsultUnavailable } from '@/components/consult/ConsultUnavailable';
import { consultDoctors, consultFee, consultSlots } from '@/components/consult/service';
import { fromE164 } from '@/lib/format';
import { isAdvanced } from '@/lib/server/clinic';
import { db } from '@/lib/server/db';
import { PUBLIC_WHERE, profileHref } from '@/lib/server/public';
import { currentUser } from '@/lib/server/session';

// Design: project/BeautyFind Consult Request.dc.html (side=patient)
// 08-open-decisions.md A2 · 01-flows.md C3 · 03-states.md "Consult request"

export const dynamic = 'force-dynamic';

type Params = { branch: string };
type Search = { t?: string | string[] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadBranch(slug: string) {
  return db.branch.findFirst({
    where: { AND: [PUBLIC_WHERE, { slug }] },
    include: { business: { select: { id: true, settings: true } }, city: { select: { name: true } } },
  });
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { branch: slug } = await params;
  const b = await loadBranch(slug);
  if (!b) return { title: 'בקשת ייעוץ' };
  return {
    title: `בקשת ייעוץ לפני הזרקה · ${b.name}`,
    description: `בקשת ייעוץ רפואי לפני טיפול בהזרקה ב${b.name}, ${b.cityName}: בחרו מועד פנוי ביומן הרופא/ה, או סמנו זמנים נוחים והקליניקה תציע מועד.`,
    robots: { index: false },
  };
}

export default async function ConsultPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
  const [{ branch: slug }, sp] = await Promise.all([params, searchParams]);
  const branch = await loadBranch(slug);
  if (!branch) notFound();

  const profile = profileHref(branch);
  const back = { href: profile, label: 'לפרופיל הקליניקה' };
  const place = [branch.name, branch.city?.name ?? branch.cityName].filter(Boolean).join(' · ');

  // The consult flow is part of the clinic system (advanced plan) and needs a verified doctor.
  const [advanced, doctors] = await Promise.all([isAdvanced(branch.businessId), consultDoctors(branch.id, branch.medicalResponsibleId)]);
  if (!advanced || doctors.length === 0) {
    return (
      <ConsultChrome back={back} flow>
        <ConsultUnavailable branchName={branch.name} place={place} contactHref={`${profile}#contact`} closeHref={profile} />
      </ConsultChrome>
    );
  }

  const tRaw = Array.isArray(sp.t) ? sp.t[0] : sp.t;
  const [treatment, slots, user] = await Promise.all([
    tRaw && UUID_RE.test(tRaw)
      ? db.treatment.findFirst({ where: { id: tRaw, branchId: branch.id, isPublished: true }, select: { id: true, name: true } })
      : null,
    consultSlots(branch.id, doctors.map(d => d.id)),
    currentUser(),
  ]);

  const hours = (Array.isArray(branch.hours) ? branch.hours : []) as Array<{ closed?: boolean; open?: string }>;
  const openDays = [0, 1, 2, 3, 4, 5, 6].filter(d => hours[d] && !hours[d].closed && hours[d].open);
  const client = user?.kind === 'client' ? user : null;
  const doctor = doctors[0];

  return (
    <ConsultChrome back={back} flow>
      <ConsultForm
        branch={{ id: branch.id, name: branch.name, place, profileHref: profile }}
        doctor={{ name: doctor.displayName, license: doctor.licenseNumber, specialty: doctor.specialty }}
        treatment={treatment}
        fee={consultFee(branch.business.settings)}
        slots={slots}
        openDays={openDays.length ? openDays : [0, 1, 2, 3, 4, 5]}
        prefill={{ name: client?.fullName ?? '', phone: client?.phone ? fromE164(client.phone) : '' }}
        signedIn={!!client}
      />
    </ConsultChrome>
  );
}
