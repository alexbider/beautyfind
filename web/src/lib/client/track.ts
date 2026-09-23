'use client';

import { readConsent } from '@/components/cookie-consent/CookieConsent';

export type TrackType = 'view' | 'contact_click' | 'whatsapp_click' | 'call_click' | 'waze_click' | 'booking_start' | 'form_submit';

/**
 * Records a profile event, only when the visitor allowed analytics cookies.
 * Fire and forget; uses sendBeacon so clicks that navigate away (tel:, wa.me) still count.
 */
export function track(branchId: string, type: TrackType, query?: string) {
  if (typeof window === 'undefined' || !readConsent()?.analytics) return;
  const body = JSON.stringify({ branchId, type, ...(query ? { query } : {}) });
  try {
    if (navigator.sendBeacon?.('/api/events', new Blob([body], { type: 'application/json' }))) return;
  } catch {}
  fetch('/api/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
}
