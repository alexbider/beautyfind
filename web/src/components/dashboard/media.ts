'use client';

import { useSyncExternalStore } from 'react';
import { SHEET_MQ, SHELL_MQ } from '@/lib/ui/shell';

// Behaviour (not layout) that differs inside the app shell: sheets instead of inline panels,
// list rows that open a detail sheet. Layout itself stays in CSS (.bf-desk-only / .bf-shell-only).

function useMedia(query: string) {
  return useSyncExternalStore(
    cb => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Phones and touch tablets: top bar, tab bar, sheets. */
export const useShell = () => useMedia(SHELL_MQ);
/** Below 768px: popovers and confirmations become bottom sheets. */
export const useSheetMode = () => useMedia(SHEET_MQ);

/**
 * Scroll the first invalid field into view and focus it (spec §3.3): scrollTo on the scroll
 * container (the page here), never scrollIntoView, leaving room for the sticky top bar.
 */
export function revealFirstInvalid(root: ParentNode | null | undefined, selector = '[aria-invalid="true"], [data-bad]') {
  requestAnimationFrame(() => {
    // Skip the copy that is hidden at this width (desktop table vs. phone list).
    const el = [...(root?.querySelectorAll<HTMLElement>(selector) ?? [])].find(x => x.getClientRects().length > 0);
    if (!el) return;
    const scroller = scrollParent(el);
    // Top bar (56px) plus room for the field's label above it.
    const topBar = 56 + 48;
    if (scroller) {
      const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 24;
      scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    } else {
      const top = el.getBoundingClientRect().top + window.scrollY - topBar;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
    el.focus({ preventScroll: true });
  });
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}
