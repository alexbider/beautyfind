'use client';

import { readConsent } from '@/components/cookie-consent/CookieConsent';

export type TrackType = 'view' | 'contact_click' | 'whatsapp_click' | 'call_click' | 'waze_click' | 'booking_start' | 'form_submit';

/**
 * Records a profile event, only when the visitor allowed analytics cookies.
 * Fire and forget; uses sendBeacon so clicks that navigate away (tel:, wa.me) still count.
 */
export function track(branchId: string, type: TrackType, query?: string) {
  if (typeof window === 'undefined' || !readConsent()?.analytics) return;
  const campaignId = type === 'view' ? null : sponsoredSource(branchId);
  const body = JSON.stringify({ branchId, type, ...(query ? { query } : {}), ...(campaignId ? { campaignId } : {}) });
  try {
    if (navigator.sendBeacon?.('/api/events', new Blob([body], { type: 'application/json' }))) return;
  } catch {}
  fetch('/api/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
}

/**
 * The sponsored card that brought the visitor to this profile in the last hour (SponsoredSlider stores it,
 * only with analytics consent). Used once: the first contact on the profile is credited to the card.
 */
function sponsoredSource(branchId: string): string | null {
  try {
    const raw = sessionStorage.getItem('bf-sp-from');
    if (!raw) return null;
    const v = JSON.parse(raw) as { campaignId?: string; branchId?: string; at?: number };
    if (v.branchId !== branchId || !v.campaignId || !v.at || Date.now() - v.at > 3_600_000) return null;
    sessionStorage.removeItem('bf-sp-from');
    return v.campaignId;
  } catch {
    return null;
  }
}
