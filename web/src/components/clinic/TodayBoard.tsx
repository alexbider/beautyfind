'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { BookingStatus } from '@prisma/client';
import { bookingOp } from '@/app/clinic/booking/[id]/actions';
import styles from '@/app/clinic/page.module.css';
import { haptic } from '../shell/haptics';
import { PullToRefresh } from '../shell/PullToRefresh';
import { STATUS } from './labels';

// Clinic "היום" list (spec §6 Noa Clinic): days with their bookings, the next appointment of today
// highlighted, and a one-tap check-in on today's confirmed rows. The check-in shows at once and
// rolls back with a toast when the server refuses it; the server re-checks every rule.

export interface DayRow {
  id: string;
  time: string;
  late: boolean;
  dim: boolean;
  name: string;
  what: string;
  tag: { t: string; tone: string } | null;
  status: BookingStatus;
  next: boolean;
  canCheckIn: boolean;
}

export interface DayGroup {
  key: string;
  label: string;
  date: string;
  prefix: string;
  count: string;
  today: boolean;
  rows: DayRow[];
}

export function TodayBoard({ days }: { days: DayGroup[] }) {
  const router = useRouter();
  const [over, setOver] = useState<Record<string, BookingStatus>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = (text: string, bad?: boolean) => {
    clearTimeout(timer.current);
    setToast({ text, bad });
    timer.current = setTimeout(() => setToast(null), 3200);
  };

  // Server data wins once it arrives (after router.refresh or a pull to refresh).
  useEffect(() => setOver({}), [days]);

  const checkIn = async (r: DayRow) => {
    if (busy[r.id]) return;
    haptic('light');
    setOver(o => ({ ...o, [r.id]: 'checked_in' }));
    setBusy(b => ({ ...b, [r.id]: true }));
    let res: Awaited<ReturnType<typeof bookingOp>>;
    try {
      res = await bookingOp(r.id, 'check_in');
    } catch {
      res = { ok: false, error: 'הפעולה לא הושלמה. בדקו את החיבור ונסו שוב.' };
    }
    setBusy(b => ({ ...b, [r.id]: false }));
    if (res.ok) {
      flash(`צ׳ק־אין נרשם · ${r.name}`);
      router.refresh();
    } else {
      setOver(o => {
        const next = { ...o };
        delete next[r.id];
        return next;
      });
      haptic('warning');
      flash(res.error, true);
      router.refresh(); // the row may have changed elsewhere (e.g. cancelled): show what is true now
    }
  };

  return (
    <PullToRefresh>
      <div className={styles.days}>
        {days.map(g => (
          <section key={g.key} aria-labelledby={`d-${g.key}`} className={styles.day} data-today={g.today || undefined}>
            <h2 id={`d-${g.key}`} className={styles.dayHead}>
              <span>{g.label}</span>
              <span className={styles.dayDate}>
                {g.prefix}
                <span className="ltr tnum">{g.date}</span>
              </span>
              <span className={styles.dayCount}>{g.count}</span>
            </h2>
            <ul className={styles.list}>
              {g.rows.map(r => {
                const status = over[r.id] ?? r.status;
                const st = STATUS[status];
                const showCheckIn = r.canCheckIn && status === 'confirmed';
                return (
                  <li key={r.id} className={styles.item} data-next={r.next || undefined}>
                    <Link href={`/clinic/booking/${r.id}`} className={styles.row} data-dim={r.dim || undefined}>
                      <span className={`${styles.time} ltr tnum`} data-late={r.late || undefined}>
                        {r.time}
                      </span>
                      <span className={styles.who}>
                        {r.next && <span className={styles.nextTag}>התור הבא</span>}
                        <span className={styles.name}>{r.name}</span>
                        <span className={styles.what}>{r.what}</span>
                      </span>
                      {r.tag && (
                        <span className={styles.tag} data-tone={r.tag.tone}>
                          {r.tag.t}
                        </span>
                      )}
                      <span className={styles.pill} data-tone={st.tone}>
                        {st.name}
                      </span>
                      <svg className={styles.chev} width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M9 3 5 7l4 4" />
                      </svg>
                    </Link>
                    {showCheckIn && (
                      <button type="button" className={styles.checkIn} onClick={() => checkIn(r)} disabled={busy[r.id]} aria-label={`צ׳ק־אין: ${r.name} הגיעה`}>
                        צ׳ק־אין
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <div role="status" aria-live="polite">
        {toast && (
          <div className={styles.toast} data-bad={toast.bad || undefined}>
            {toast.text}
          </div>
        )}
      </div>
    </PullToRefresh>
  );
}
