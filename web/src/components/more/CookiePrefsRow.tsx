'use client';

import { OPEN_PREFS_EVENT } from '../cookie-consent/CookieConsent';

export function CookiePrefsRow({ className, labelClass }: { className: string; labelClass: string }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(OPEN_PREFS_EVENT))}>
      <span className={labelClass}>העדפות עוגיות</span>
    </button>
  );
}
