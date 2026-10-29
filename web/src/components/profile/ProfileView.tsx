'use client';

import { useEffect, useRef } from 'react';
import { track } from '@/lib/client/track';

/** Sends one `view` event per profile load (no-op without analytics consent). */
export function ProfileView({ branchId }: { branchId: string }) {
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (sent.current === branchId) return;
    sent.current = branchId;
    track(branchId, 'view');
    // Google Analytics gets the same view with the profile ID, so GA4 reports can split traffic by profile.
    // A no-op when no measurement ID is set. Google records it only when analytics consent is granted.
    const w = window as unknown as { gtag?: (...args: unknown[]) => void };
    w.gtag?.('event', 'profile_view', { profile_id: branchId, profile_path: window.location.pathname });
  }, [branchId]);
  return null;
}
