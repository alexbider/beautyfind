'use client';

import { useEffect, useRef, useState } from 'react';
import { BodyLayer } from '@/components/review/FixedLayer';
import styles from './Waitlist.module.css';

export function useToast() {
  const [toast, setToast] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = (t: string) => {
    clearTimeout(timer.current);
    setToast(t);
    timer.current = setTimeout(() => setToast(''), 3200);
  };
  return [toast, flash] as const;
}

/**
 * The live region stays mounted so screen readers announce each new message. It lives in <body> so
 * `position: fixed` is relative to the screen (above the tab bar and any action bar).
 */
export function Toast({ text }: { text: string }) {
  return (
    <BodyLayer>
      <div role="status" aria-live="polite" dir="rtl">
        {text && <div className={styles.toast}>{text}</div>}
      </div>
    </BodyLayer>
  );
}
