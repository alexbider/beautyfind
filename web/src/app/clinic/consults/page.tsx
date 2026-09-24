import type { Metadata } from 'next';
import Link from 'next/link';
import { ConsultInbox, type InboxRequest } from '@/components/consult/ConsultInbox';
import { FLAGS, FORMATS, PRIOR, TIMES, DAY_LETTERS, type FlagKey } from '@/components/consult/constants';
import { consultActor, consultDoctors, slotLabel } from '@/components/consult/service';
import styles from '@/components/consult/consult.module.css';
import ix from '@/components/consult/inbox.module.css';
import { TopBar } from '@/components/shell/TopBar';
import { fromE164 } from '@/lib/format';
import { clinicContext } from '@/lib/server/clinic';
import { db } from '@/lib/server/db';
import { addDays, hhmm, ilDate, ilDateKey } from '@/lib/time';

// Design: project/BeautyFind Consult Request.dc.html (side=clinic)
// 03-states.md "Consult request" · 04-permissions.md (medical decline: physician only)

export const metadata: Metadata = { title: 'בקשות ייעוץ רפואי', robots: { index: false } };
export const dynamic = 'force-dynamic';

const MAX_ROWS = 300;
const LIVE = new Set(['pending_payment', 'confirmed', 'checked_in', 'in_treatment', 'completed']);

/** היום 09:14 · אתמול 18:40 · יום ב׳ · 12/09/2026 */
function received(at: Date, now = new Date()) {
  const key = ilDateKey(at);
  const today = ilDateKey(now);
  if (key === today) return `היום ${hhmm(at)}`;
  if (key === addDays(today, -1)) return `אתמול ${hhmm(at)}`;
  for (let i = 2; i < 7; i++) if (key === addDays(today, -i)) return `יום ${DAY_LETTERS[new Date(key + 'T12:00:00Z').getUTCDay()]}`;
  return ilDate(at);
}

export default async function ConsultsInboxPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const ctx = await clinicContext('consults');

  if (!ctx.advanced) {
    return (
      <div className={styles.root}>
        <TopBar mode="root" largeTitle="בקשות ייעוץ" />
        <div className={`${ix.page} ${ix.upgradePage}`}>
        <span className={styles.kicker}>{ctx.branch?.name ?? 'העסק שלי'} · פניות</span>
        <h1 className={`${styles.h1} bf-desk-only`}>בקשות ייעוץ רפואי</h1>
        <div className={styles.upgrade}>
          <h2 className={styles.h2}>תיבת בקשות הייעוץ היא חלק ממערכת הקליניקה</h2>
          <p className={styles.upgradeBody}>
            ברישום מתקדם + CRM, מטופלות בוחרות מועד לייעוץ ישירות מהיומן של הרופא/ה, והבקשות מגיעות לכאן. מכאן מציעים מועד, מבקשים פרטים או סוגרים בקשה מסיבה רפואית, וכל פעולה מתועדת. בינתיים, פניות מגיעות מטופס יצירת הקשר בפרופיל.
          </p>
          <div className={styles.row}>
            <Link href="/biz/billing" className={styles.btnLink}>לשדרוג המנוי</Link>
            <Link href="/biz/leads" className={styles.btnGhostLink}>לפניות מהפרופיל</Link>
          </div>
        </div>
        </div>
      </div>
    );
  }

  const actor = await consultActor(ctx);
  const { r } = await searchParams;

  const rows = await db.consultRequest.findMany({
    where: { branchId: { in: actor.branchIds } },
    orderBy: { createdAt: 'desc' },
    take: MAX_ROWS,
    include: { branch: { select: { id: true, name: true, slug: true, medicalResponsibleId: true } } },
  });
  const ids = rows.map(x => x.id);
  const tIds = [...new Set(rows.map(x => x.treatmentId).filter((x): x is string => !!x))];
  const [bookings, treatments] = await Promise.all([
    ids.length
      ? db.booking.findMany({
          where: { consultRequestId: { in: ids } },
          select: { consultRequestId: true, startsAt: true, status: true, ref: true, practitioner: { select: { displayName: true } } },
        })
      : [],
    tIds.length ? db.treatment.findMany({ where: { id: { in: tIds } }, select: { id: true, name: true } }) : [],
  ]);
  const bookingOf = new Map(bookings.map(b => [b.consultRequestId!, b]));
  const treatmentOf = new Map(treatments.map(t => [t.id, t.name]));

  const firstBranch = ctx.business.branches.find(b => actor.branchIds.includes(b.id)) ?? ctx.branch;
  const doctors = firstBranch ? await consultDoctors(firstBranch.id, firstBranch.medicalResponsibleId) : [];

  const requests: InboxRequest[] = rows.map(x => {
    const b = bookingOf.get(x.id);
    const live = !!b && LIVE.has(b.status);
    const flags = x.medicalFlags.filter((f): f is FlagKey => FLAGS.some(g => g.key === f));
    const when = x.preferredTimes.length
      ? [
          TIMES.filter(t => x.preferredTimes.includes(t.key)).map(t => t.name).join(', '),
          x.preferredDays.length ? `ימים ${x.preferredDays.map(d => DAY_LETTERS[d]).join(' ')}` : '',
        ].filter(Boolean).join(' · ')
      : x.chosenSlot
        ? slotLabel(x.chosenSlot)
        : '';
    return {
      id: x.id,
      ref: x.ref,
      name: x.clientName,
      phone: fromE164(x.clientPhone),
      phoneE164: x.clientPhone,
      received: received(x.createdAt),
      areas: x.areas,
      goal: x.goal,
      prior: PRIOR.find(p => p.key === x.priorInjections)?.name ?? x.priorInjections,
      format: FORMATS.find(f => f.key === x.format)?.name ?? x.format,
      when,
      status: x.status,
      flags,
      outcome: x.outcomeText,
      proposed: x.proposedSlot && x.proposedSlot.getTime() > Date.now() && !live ? { iso: x.proposedSlot.toISOString(), label: slotLabel(x.proposedSlot) } : null,
      booking: b ? { label: slotLabel(b.startsAt), live, ref: b.ref, practitioner: b.practitioner?.displayName ?? null, lapsed: !live } : null,
      treatment: x.treatmentId ? treatmentOf.get(x.treatmentId) ?? null : null,
      branchName: x.branch.name,
      feeShekels: x.feeAgorot / 100,
    };
  });

  const initial = r && requests.some(q => q.id === r) ? r : null;
  const consultHref = firstBranch ? `/consult/${firstBranch.slug}` : null;

  // Own wrapper instead of ConsultChrome: the phone top bar and rows run edge to edge.
  return (
    <div className={styles.root}>
      <div className={ix.page}>
      <ConsultInbox
        bizName={firstBranch?.name ?? 'הקליניקה'}
        requests={requests}
        initialId={initial}
        canManage={ctx.canManage}
        isPhysician={actor.isPhysician}
        viewer={{ name: ctx.member.displayName, roleName: ctx.roleName }}
        doctorName={doctors[0]?.displayName ?? 'הרופא/ה'}
        multiBranch={actor.branchIds.length > 1}
        consultHref={consultHref}
      />
      </div>
    </div>
  );
}
