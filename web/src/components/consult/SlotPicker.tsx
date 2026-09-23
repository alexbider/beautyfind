'use client';

import { useState } from 'react';
import type { SlotDay } from './constants';
import { radioKeys, rove } from './ui';
import styles from './consult.module.css';

export type { SlotDay };

/** Splits "ה׳ 24/09" into the day letter and the LTR date. */
function DayText({ label }: { label: string }) {
  const [letter, date] = label.split(' ');
  return (
    <>
      {letter} <span className="ltr tnum">{date}</span>
    </>
  );
}

/**
 * Real consult slots: a day row, then that day's free times. Both are radio groups.
 * `after` renders at the end of the time row (the patient's "אף מועד לא מתאים").
 * `strip` (patient flow): in the app shell the days become a scroll-snap strip and the times a
 * 3-column grid, with `after` below the grid. Without it the layout is the same everywhere.
 */
export function SlotPicker({
  days,
  value,
  onChange,
  invalid,
  label,
  after,
  strip,
}: {
  days: SlotDay[];
  value: string | null;
  onChange: (startsAt: string) => void;
  invalid?: boolean;
  label: string;
  after?: React.ReactNode;
  strip?: boolean;
}) {
  const initial = (value && days.find(d => d.slots.some(s => s.startsAt === value))?.date) || days[0]?.date || '';
  const [day, setDay] = useState(initial);
  const cur = days.find(d => d.date === day) ?? days[0];
  const dayIdx = days.findIndex(d => d.date === cur?.date);
  const timeIdx = cur ? cur.slots.findIndex(s => s.startsAt === value) : -1;

  return (
    <div>
      {days.length > 0 && (
        <>
          <div role="radiogroup" aria-label={`${label}: יום`} onKeyDown={radioKeys} className={`${styles.chipsTight} ${strip ? styles.dayStrip : ''}`} style={{ marginBottom: 8 }}>
            {days.map((d, i) => (
              <button
                key={d.date}
                type="button"
                role="radio"
                aria-checked={d.date === cur?.date}
                tabIndex={rove(i, dayIdx)}
                onClick={() => setDay(d.date)}
                className={`${styles.chip} ${styles.chipSlot}`}
              >
                <DayText label={d.label} />
              </button>
            ))}
          </div>
        </>
      )}
      <div className={`${styles.chipsTight} ${strip ? styles.timeWrap : ''}`} style={{ marginBottom: 10 }}>
        {cur && (
          <div role="radiogroup" aria-label={`${label}: שעה ביום ${cur.label}`} onKeyDown={radioKeys} className={`${styles.chipsTight} ${strip ? styles.timeGrid : ''}`}>
            {cur.slots.map((s, i) => (
              <button
                key={s.startsAt}
                type="button"
                role="radio"
                aria-checked={s.startsAt === value}
                tabIndex={rove(i, timeIdx)}
                onClick={() => onChange(s.startsAt)}
                className={`${styles.chip} ${styles.chipSlot}`}
                data-invalid={invalid || undefined}
              >
                <span className="ltr tnum">{s.time}</span>
              </button>
            ))}
          </div>
        )}
        {after}
      </div>
    </div>
  );
}
