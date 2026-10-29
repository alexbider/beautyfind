'use client';

import { useEffect } from 'react';
import { CONSENT_CHANGED_EVENT, readConsent } from '@/components/cookie-consent/CookieConsent';

// Google Analytics 4 tag. Loads only when the visitor allows measurement cookies (consent.analytics),
// and only when a measurement ID is saved on /ops/settings. Reacts at once when consent changes.
export function GoogleAnalytics({ id }: { id: string }) {
  useEffect(() => {
    if (!id) return;
    let loaded = false;
    const load = () => {
      if (loaded || !readConsent()?.analytics) return;
      loaded = true;
      const w = window as unknown as { dataLayer: unknown[]; gtag?: (...args: unknown[]) => void };
      w.dataLayer = w.dataLayer || [];
      // gtag.js needs the Arguments object pushed, as in Google's own snippet.
      w.gtag = function gtag() {
        // eslint-disable-next-line prefer-rest-params
        w.dataLayer.push(arguments);
      };
      w.gtag('js', new Date());
      w.gtag('config', id);
      const s = document.createElement('script');
      s.async = true;
      s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
      document.head.appendChild(s);
    };
    load();
    window.addEventListener(CONSENT_CHANGED_EVENT, load);
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, load);
  }, [id]);
  return null;
}
