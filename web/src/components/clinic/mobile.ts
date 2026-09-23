'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { SHELL_MQ } from '@/lib/ui/shell';

// Phone helpers for the clinic and staff screens (responsive spec §2, §6).

function subscribe(cb: () => void) {
  const mq = window.matchMedia(SHELL_MQ);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

/**
 * True inside the app shell (phones, touch tablets). False on the server and on the first client
 * render, so use it for behaviour (sheet or inline), never for layout that must match the HTML.
 */
export function useShell() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(SHELL_MQ).matches, () => false);
}

/**
 * List → detail on phones with the id in the URL (`?r=…`), so the browser back and the top bar back
 * both return to the list. Opening pushes a history entry without a server round trip; the list
 * scroll position comes back on return. On a deep link (no entry of ours to pop) back goes to the list.
 */
// Shared by every component using the same param (a list and a lookup field can both open a detail).
const pushedParams = new Set<string>();
const listScroll = new Map<string, number>();

export function useDetailParam(param: string) {
  const sp = useSearchParams();
  const router = useRouter();
  const id = sp.get(param);

  const open = useCallback(
    (value: string) => {
      listScroll.set(param, window.scrollY);
      const u = new URL(window.location.href);
      u.searchParams.set(param, value);
      window.history.pushState(null, '', u.toString());
      pushedParams.add(param);
      window.scrollTo(0, 0);
    },
    [param],
  );

  /** Desktop selection: keep the id in the URL for reloads without adding history entries. */
  const replace = useCallback(
    (value: string | null) => {
      const u = new URL(window.location.href);
      if (value) u.searchParams.set(param, value);
      else u.searchParams.delete(param);
      window.history.replaceState(null, '', u.toString());
    },
    [param],
  );

  const close = useCallback(() => {
    if (pushedParams.has(param)) {
      window.history.back();
      return;
    }
    const u = new URL(window.location.href);
    u.searchParams.delete(param);
    router.replace(u.pathname + u.search, { scroll: false });
  }, [param, router]);

  useEffect(() => {
    if (id || !pushedParams.has(param)) return;
    pushedParams.delete(param);
    const y = listScroll.get(param) ?? 0;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }, [id, param]);

  return { id, open, replace, close };
}
