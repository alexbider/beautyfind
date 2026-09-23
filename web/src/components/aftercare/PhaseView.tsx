'use client';

import { useId, useRef, useState } from 'react';
import type { AftercarePhase } from './content';
import styles from './Aftercare.module.css';

/** Title, phase tabs and the do / don't lists. Opens on the phase that applies now. */
export function PhaseView({ kicker, meta, phases, nowIdx }: {
  kicker: string; meta: React.ReactNode; phases: Array<Omit<AftercarePhase, 'untilHours'>>; nowIdx: number;
}) {
  const [idx, setIdx] = useState(nowIdx);
  const ids = useId();
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const ph = phases[idx];

  const onKey = (e: React.KeyboardEvent) => {
    // RTL: the right arrow moves to the previous tab.
    const d = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (idx + d + phases.length) % phases.length;
    setIdx(n);
    tabs.current[n]?.focus();
  };

  return (
    <>
      <div className={styles.fade}>
        <span className={styles.kicker}>{kicker}</span>
        <h1 className={styles.h1}>{idx === nowIdx ? `עכשיו: ${ph.name}` : ph.name}</h1>
        <p className={styles.meta}>{meta}</p>
      </div>

      <div role="tablist" aria-label="שלב" className={styles.tabs} onKeyDown={onKey}>
        {phases.map((p, i) => (
          <button
            key={p.key}
            ref={el => { tabs.current[i] = el; }}
            type="button"
            role="tab"
            id={`${ids}-t${i}`}
            aria-selected={i === idx}
            aria-controls={`${ids}-panel`}
            tabIndex={i === idx ? 0 : -1}
            onClick={() => setIdx(i)}
            className={styles.tab}
            data-on={i === idx || undefined}
          >
            {p.name}
            {i === nowIdx && <span className={styles.now}>· עכשיו</span>}
          </button>
        ))}
      </div>

      <div id={`${ids}-panel`} role="tabpanel" aria-labelledby={`${ids}-t${idx}`} className={styles.dd}>
        <section aria-labelledby={`${ids}-do`} className={styles.card}>
          <h2 id={`${ids}-do`} className={styles.h2} data-tone="ok">כן</h2>
          <ul className={styles.items}>
            {ph.dos.map(t => <li key={t}><span aria-hidden="true" data-tone="ok">✓</span><span>{t}</span></li>)}
          </ul>
        </section>
        <section aria-labelledby={`${ids}-dont`} className={styles.card}>
          <h2 id={`${ids}-dont`} className={styles.h2} data-tone="bad">להימנע</h2>
          <ul className={styles.items}>
            {ph.donts.map(t => <li key={t}><span aria-hidden="true" data-tone="bad">×</span><span>{t}</span></li>)}
          </ul>
        </section>
      </div>
    </>
  );
}
