'use client';

import { useId, useState, useTransition } from 'react';
import styles from './ui.module.css';

// A feature switch that saves on change through a server action and shows the saved state. The
// server is the source of truth: a failed save flips the switch back and shows the reason.

export function Toggle({ name, checked, title, sub, onChange, disabled }: { name: string; checked: boolean; title: string; sub?: string; onChange: (name: string, value: boolean) => Promise<{ ok: boolean; error?: string }>; disabled?: boolean }) {
  const id = useId();
  const [on, setOn] = useState(checked);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className={styles.toggleRow}>
      <label htmlFor={id} className={styles.toggleText}>
        <div className={styles.toggleTitle}>{title}</div>
        {sub ? <div className={styles.toggleSub}>{sub}</div> : null}
        {err ? <div className={styles.error}>{err}</div> : null}
      </label>
      <span className={styles.toggle}>
        <input
          id={id} type="checkbox" role="switch" checked={on} aria-checked={on} disabled={pending || disabled}
          onChange={e => {
            const v = e.target.checked;
            setOn(v);
            setErr(null);
            start(async () => {
              const r = await onChange(name, v);
              if (!r.ok) {
                setOn(!v);
                setErr(r.error ?? 'השמירה נכשלה');
              }
            });
          }}
        />
        <span className={styles.toggleTrack} aria-hidden="true" />
      </span>
    </div>
  );
}
