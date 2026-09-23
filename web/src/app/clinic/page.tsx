import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { DAY_SHORT, STATUS, ddmm, plBookings, shortName } from '@/components/clinic/labels';
import { CLINIC_NAV, clinicLevel } from '@/components/clinic/levels';
import { UpgradeCard } from '@/components/clinic/UpgradeCard';
import { bizContext } from '@/lib/server/biz';
import { releaseExpiredHolds } from '@/lib/server/booking';
import { clinicContext } from '@/lib/server/clinic';
import { db } from '@/lib/server/db';
import { addDays, dowOf, hhmm, ilDateKey, ilToUtc } from '@/lib/time';
import styles from './page.module.css';

// Clinic landing: today and upcoming bookings for the branch, each linking to its Clinic Booking card.
// The full back office (Noa Clinic: calendar, CRM ...) is a later phase.

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
  if (!ctx.advanced) return <div className={styles.page}><UpgradeCard area="תורים והצהרות בריאות" /></div>;
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

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <span className={styles.kicker}>{branch?.name ?? 'העסק שלי'}{ctx.level === 'own' ? ' · התורים שלי' : ''}</span>
          <h1 className={styles.h1}>תורים</h1>
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
        <div className={styles.days}>
          {[...groups.entries()].map(([k, list]) => (
            <section key={k} aria-labelledby={`d-${k}`} className={styles.day}>
              <h2 id={`d-${k}`} className={styles.dayHead}>
                <span>{dayLabel(k)}</span>
                <span className={styles.dayDate}>{k === today || k === addDays(today, 1) ? `${DAY_SHORT[dowOf(k)]} · ` : ''}<span className="ltr tnum">{ddmm(ilToUtc(k, '12:00'))}</span></span>
                <span className={styles.dayCount}>{plBookings(list.length)}</span>
              </h2>
              <ul className={styles.list}>
                {list.map(r => {
                  const st = STATUS[r.status];
                  const open = ['pending_payment', 'confirmed', 'checked_in'].includes(r.status);
                  const d = r.declaration;
                  const valid = !!d && !d.supersededById && d.validUntil > now;
                  const tag = !open ? null
                    : r.requiresDeclaration && !valid ? { t: 'הצהרה חסרה', tone: 'warn' }
                    : valid && d!.flagged && !d!.physicianAckAt ? { t: 'ממצאים לעיון רופא/ה', tone: 'warn' }
                    : null;
                  const past = r.startsAt < now && r.status === 'confirmed';
                  return (
                    <li key={r.id}>
                      <Link href={`/clinic/booking/${r.id}`} className={styles.row} data-dim={['cancelled_client', 'cancelled_clinic', 'no_show'].includes(r.status) || undefined}>
                        <span className={`${styles.time} ltr tnum`} data-late={past || undefined}>{hhmm(r.startsAt)}</span>
                        <span className={styles.who}>
                          <span className={styles.name}>{shortName(r.clientName)}</span>
                          <span className={styles.what}>{[r.treatment?.name ?? (r.kind === 'consult' ? 'פגישת ייעוץ' : ''), r.practitioner?.displayName].filter(Boolean).join(' · ')}</span>
                        </span>
                        {tag && <span className={styles.tag} data-tone={tag.tone}>{tag.t}</span>}
                        <span className={styles.pill} data-tone={st.tone}>{st.name}</span>
                        <svg className={styles.chev} width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 3 5 7l4 4" /></svg>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
