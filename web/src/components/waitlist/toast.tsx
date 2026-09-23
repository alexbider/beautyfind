'use client';

import { useEffect, useRef, useState } from 'react';
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

/** The live region stays mounted so screen readers announce each new message. */
export function Toast({ text }: { text: string }) {
  return (
    <div role="status" aria-live="polite">
      {text && <div className={styles.toast}>{text}</div>}
    </div>
  );
}
