'use client';

import { useEffect } from 'react';
import { CONSENT_CHANGED_EVENT, readConsent } from '@/components/cookie-consent/CookieConsent';

// Keeps Google Consent Mode in step with the visitor's choice on the cookie banner. The tag itself is
// in the page HTML from the server (GoogleTagScripts), set to "denied" until the visitor allows
// measurement cookies. Granting it here lets Google set cookies and measure the visit.
type GtagFn = (...args: unknown[]) => void;

export function GoogleAnalytics({ id }: { id: string }) {
  useEffect(() => {
    if (!id) return;
    const sync = () => {
      const w = window as unknown as { gtag?: GtagFn };
      if (!w.gtag) return;
      const granted = !!readConsent()?.analytics;
      w.gtag('consent', 'update', { analytics_storage: granted ? 'granted' : 'denied' });
    };
    sync();
    window.addEventListener(CONSENT_CHANGED_EVENT, sync);
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, sync);
  }, [id]);
  return null;
}

// The tag as Google's own snippet has it, rendered in the page HTML so tag checks can find it.
export function GoogleTagScripts({ id }: { id: string }) {
  if (!id) return null;
  const init = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',wait_for_update:500});gtag('js',new Date());gtag('config','${id}');`;
  return (
    <>
      <script async src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`} />
      <script dangerouslySetInnerHTML={{ __html: init }} />
    </>
  );
}
