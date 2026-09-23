'use client';

import styles from './content.module.css';

/**
 * Event the global CookieConsent must listen for to open its preferences dialog.
 * This button never touches localStorage['bf-cookie-consent']; it only asks the banner to open.
 */
export const OPEN_COOKIE_PREFS_EVENT = 'bf-open-cookie-prefs';

export function CookiePrefsButton() {
  return (
    <button type="button" className={styles.prefsBtn} onClick={() => window.dispatchEvent(new CustomEvent(OPEN_COOKIE_PREFS_EVENT))}>
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 5.5h8M15 5.5h2M3 14.5h2M9 14.5h8" />
        <circle cx="13" cy="5.5" r="2" />
        <circle cx="7" cy="14.5" r="2" />
      </svg>
      שינוי העדפות Cookie
    </button>
  );
}
