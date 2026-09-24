'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { haptic } from './haptics';
import styles from './Lists.module.css';

// Pull to refresh (spec §3.1) for touch screens: pull down from the top of the page past 70px.
// Default action re-fetches the server components of the current route.
export function PullToRefresh({ children, onRefresh }: { children: React.ReactNode; onRefresh?: () => Promise<void> | void }) {
  const router = useRouter();
  const start = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const THRESHOLD = 70;

  const onStart = (e: React.TouchEvent) => {
    start.current = window.scrollY <= 0 && !busy ? e.touches[0].clientY : null;
  };
  const onMove = (e: React.TouchEvent) => {
    if (start.current === null) return;
    const d = e.touches[0].clientY - start.current;
    setPull(d > 0 ? Math.min(110, d * 0.55) : 0);
  };
  const onEnd = async () => {
    const go = pull >= THRESHOLD * 0.85;
    start.current = null;
    if (!go) {
      setPull(0);
      return;
    }
    haptic('light');
    setBusy(true);
    setPull(48);
    try {
      await (onRefresh ? onRefresh() : Promise.resolve(router.refresh()));
    } finally {
      setTimeout(() => {
        setBusy(false);
        setPull(0);
      }, 400);
    }
  };

  return (
    <div onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onEnd}>
      <div className={styles.ptr} style={{ height: pull }} aria-hidden={!busy}>
        <span className={styles.ptrSpin} data-busy={busy || undefined} style={{ transform: `rotate(${pull * 3}deg)` }} />
        {busy && <span className="sr-only" role="status">מרעננים…</span>}
      </div>
      {children}
    </div>
  );
}
