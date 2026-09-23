'use client';

import { useEffect, useState } from 'react';

/**
 * True while `query` matches. For behaviour only (auto-loading, which popover to open); layout
 * stays in CSS so the server markup is right at any width. False on the server and first paint.
 */
export function useMedia(query: string) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setOn(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [query]);
  return on;
}
