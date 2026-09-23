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
  }, [branchId]);
  return null;
}
