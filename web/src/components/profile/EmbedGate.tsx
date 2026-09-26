'use client';

import { useEffect, useState } from 'react';
import { OPEN_PREFS_EVENT, readConsent } from '@/components/cookie-consent/CookieConsent';
import styles from './EmbedGate.module.css';

/**
 * Consent gate for third-party embeds (Google Maps, YouTube). Loads at once when the visitor allowed
 * embedded content in the cookie preferences; otherwise shows a placeholder with an activate control
 * that loads this one embed (an explicit choice for this element), plus a link to the preferences.
 * Nothing from the third party is requested before that.
 */
export function EmbedGate({ label, note, height, children, className }: { label: string; note?: string; height: number; children: React.ReactNode; className?: string }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    setAllowed(!!readConsent()?.embeds);
  }, []);
  if (allowed) return <>{children}</>;
  return (
    <div className={`${styles.gate} ${className ?? ''}`} style={{ minHeight: height }} role="group" aria-label={label}>
      <p className={styles.text}>{note ?? 'התוכן נטען משרת חיצוני רק אחרי אישור.'}</p>
      <div className={styles.row}>
        <button type="button" className={styles.activate} onClick={() => setAllowed(true)} aria-busy={allowed === null || undefined}>
          {label}
        </button>
        <button type="button" className={styles.prefs} onClick={() => window.dispatchEvent(new Event(OPEN_PREFS_EVENT))}>
          העדפות תוכן מוטמע
        </button>
      </div>
    </div>
  );
}
