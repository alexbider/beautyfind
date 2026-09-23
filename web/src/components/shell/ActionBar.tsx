'use client';

import { useEffect, useState } from 'react';
import styles from './ActionBar.module.css';

// Sticky action bar (spec §2.3). Sits above the tab bar, or at the very bottom when the tab bar is
// hidden (focused flows), and rises with the on-screen keyboard so the primary button stays visible.
// Outside the app shell it renders inline (desktop layouts place it where they want) unless
// `mobileOnly`, in which case it is hidden on desktop.

export function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const on = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    vv.addEventListener('resize', on);
    vv.addEventListener('scroll', on);
    return () => {
      vv.removeEventListener('resize', on);
      vv.removeEventListener('scroll', on);
    };
  }, []);
  return inset;
}

export function ActionBar({
  children,
  hint,
  error,
  mobileOnly = false,
  className,
}: {
  children: React.ReactNode;
  /** Step hint above the primary button, 12.5px muted ("בחרו שעה כדי להמשיך"). */
  hint?: React.ReactNode;
  /** Validation summary above the button. */
  error?: React.ReactNode;
  mobileOnly?: boolean;
  className?: string;
}) {
  const kb = useKeyboardInset();
  return (
    <div
      className={`${styles.bar} ${className ?? ''}`}
      data-bottom-bar
      data-mobile-only={mobileOnly || undefined}
      data-kb={kb > 80 || undefined}
      style={kb > 80 ? ({ '--kb': `${kb}px` } as React.CSSProperties) : undefined}
    >
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {hint && <p className={styles.hint}>{hint}</p>}
      <div className={styles.row}>{children}</div>
    </div>
  );
}
