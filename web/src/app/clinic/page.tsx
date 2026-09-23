import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { DAY_SHORT, ddmm, plBookings, shortName } from '@/components/clinic/labels';
import { CLINIC_NAV, clinicLevel } from '@/components/clinic/levels';
import { TodayBoard, type DayGroup } from '@/components/clinic/TodayBoard';
import { UpgradeCard } from '@/components/clinic/UpgradeCard';
import { TopBar } from '@/components/shell/TopBar';
import { bizContext } from '@/lib/server/biz';
import { releaseExpiredHolds } from '@/lib/server/booking';
import { clinicContext } from '@/lib/server/clinic';
import { db } from '@/lib/server/db';
import { addDays, dowOf, hhmm, ilDateKey, ilToUtc } from '@/lib/time';
import styles from './page.module.css';

// Clinic landing: today and upcoming bookings for the branch, each linking to its Clinic Booking card.
// On phones this is the "היום" tab (spec §6): today's timeline first, the next appointment
// highlighted, one-tap check-in and pull to refresh. The full back office (Noa Clinic: calendar,
// CRM ...) is a later phase.

export const metadata: Metadata = { title: 'תורים', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const DAYS_AHEAD = 14;

export default async function ClinicHome() {
  // Staff without the bookings area (e.g. bookkeeping) land on the first clinic area they have.
  const biz = await bizContext();
  if (clinicLevel(biz, 'bookings') === 'none') {
    const first = CLINIC_NAV.find(n => clinicLevel(biz, n.area) !== 'none');
    if (first) redirect(first.href);
    notFound();
  }

  const ctx = await clinicContext('bookings');
  if (!ctx.advanced) {
    return (
      <div className={styles.page}>
        <TopBar mode="root" largeTitle="היום" />
        <UpgradeCard area="תורים והצהרות בריאות" />
      </div>
    );
  }
  const branch = ctx.branch;
  // No scheduler yet: close checkout holds that ran out so they don't show as waiting for a deposit.
  await releaseExpiredHolds();

  const now = new Date();
  const today = ilDateKey(now);
  const from = ilToUtc(today, '00:00');
  const to = ilToUtc(addDays(today, DAYS_AHEAD + 1), '00:00');
  const rows = branch
    ? await db.booking.findMany({
        where: {
          branchId: branch.id,
          startsAt: { gte: from, lt: to },
          status: { not: 'abandoned' },
          ...(ctx.level === 'own' ? { practitionerId: ctx.member.id } : {}),
        },
        orderBy: { startsAt: 'asc' },
        take: 500,
        select: {
          id: true, startsAt: true, durationMin: true, status: true, clientName: true, requiresDeclaration: true, kind: true,
          treatment: { select: { name: true } },
          practitioner: { select: { displayName: true } },
          declaration: { select: { flagged: true, physicianAckAt: true, supersededById: true, validUntil: true } },
        },
      })
    : [];

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = ilDateKey(r.startsAt);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const todayRows = groups.get(today) ?? [];
  const arrived = todayRows.filter(r => ['checked_in', 'in_treatment', 'completed'].includes(r.status)).length;
  const dayLabel = (k: string) => (k === today ? 'היום' : k === addDays(today, 1) ? 'מחר' : DAY_SHORT[dowOf(k)]);
  // The next appointment of today: the first one still ahead, or already waiting in the clinic.
  const nextId = todayRows.find(
    r => ['pending_payment', 'confirmed', 'checked_in'].includes(r.status) && r.startsAt.getTime() + r.durationMin * 60_000 > now.getTime(),
  )?.id;

  const days: DayGroup[] = [...groups.entries()].map(([k, list]) => ({
    key: k,
    label: dayLabel(k),
    prefix: k === today || k === addDays(today, 1) ? `${DAY_SHORT[dowOf(k)]} · ` : '',
    date: ddmm(ilToUtc(k, '12:00')),
    count: plBookings(list.length),
    today: k === today,
    rows: list.map(r => {
      const open = ['pending_payment', 'confirmed', 'checked_in'].includes(r.status);
      const d = r.declaration;
      const valid = !!d && !d.supersededById && d.validUntil > now;
      const tag = !open ? null
        : r.requiresDeclaration && !valid ? { t: 'הצהרה חסרה', tone: 'warn' }
        : valid && d!.flagged && !d!.physicianAckAt ? { t: 'ממצאים לעיון רופא/ה', tone: 'warn' }
        : null;
      return {
        id: r.id,
        time: hhmm(r.startsAt),
        late: r.startsAt < now && r.status === 'confirmed',
        dim: ['cancelled_client', 'cancelled_clinic', 'no_show'].includes(r.status),
        name: shortName(r.clientName),
        what: [r.treatment?.name ?? (r.kind === 'consult' ? 'פגישת ייעוץ' : ''), r.practitioner?.displayName].filter(Boolean).join(' · '),
        tag,
        status: r.status,
        next: r.id === nextId,
        // Same rule as the booking card (manage level); the shortcut is offered on today's rows only.
        canCheckIn: ctx.canManage && k === today && r.status === 'confirmed',
      };
    }),
  }));

  return (
    <div className={styles.page}>
      <TopBar mode="root" largeTitle="היום" />
      <div className={styles.head}>
        <div className={styles.headText}>
          <span className={styles.kicker}>{branch?.name ?? 'העסק שלי'}{ctx.level === 'own' ? ' · התורים שלי' : ''}</span>
          <h1 className={`${styles.h1} bf-desk-only`}>תורים</h1>
          <p className={styles.sub}>
            היום: {todayRows.length ? plBookings(todayRows.length) : 'אין תורים'}
            {arrived === 1 ? ' · מטופלת אחת הגיעה' : arrived > 1 ? <> · <span className="ltr">{arrived}</span> הגיעו</> : null}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>אין תורים בשבועיים הקרובים</h2>
          <p>תורים שנקבעים אונליין, בטלפון או מרשימת ההמתנה יופיעו כאן, מקובצים לפי יום.</p>
        </div>
      ) : (
        <TodayBoard days={days} />
      )}
    </div>
  );
}
