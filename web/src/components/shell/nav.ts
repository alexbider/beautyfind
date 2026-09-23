'use client';

import type { useRouter } from 'next/navigation';

// In-app history depth, so "back" returns to the previous screen when there is one and otherwise
// (a deep link from WhatsApp) goes to a sensible parent instead of leaving the site.
const KEY = 'bf-nav-depth';

export function bumpDepth() {
  try {
    const n = Number(sessionStorage.getItem(KEY) ?? '-1') + 1;
    sessionStorage.setItem(KEY, String(n));
  } catch {
    /* private mode */
  }
}

export function canGoBack() {
  try {
    return Number(sessionStorage.getItem(KEY) ?? '0') > 0;
  } catch {
    return false;
  }
}

export function goBack(router: ReturnType<typeof useRouter>, fallback: string) {
  if (canGoBack()) {
    try {
      sessionStorage.setItem(KEY, String(Math.max(0, Number(sessionStorage.getItem(KEY)) - 2)));
    } catch {
      /* ignore */
    }
    router.back();
  } else {
    router.push(fallback);
  }
}
