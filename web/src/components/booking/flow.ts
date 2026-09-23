'use client';

import { SHELL_MQ } from '@/lib/ui/shell';

// Step-flow helpers shared by Booking, Consult Request and Health Declaration (responsive spec §3.3, §3.4).

/** True inside the app shell (phones, and touch tablets below 1024px). Behaviour only, never layout. */
export const inShell = () => typeof window !== 'undefined' && window.matchMedia(SHELL_MQ).matches;

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Brings a field into view below the sticky top bar (and the step line under it). Scrolls the page's
 * scroll container with scrollTo, never scrollIntoView (which also moves ancestors and the action bar).
 */
export function scrollToField(el: Element | null | undefined) {
  if (!el) return;
  const shell = inShell();
  const offset = shell ? 120 : 24;
  const r = el.getBoundingClientRect();
  // Already in view, clear of the top bar and the action bar: leave the page where it is.
  if (r.top >= (shell ? 72 : 0) && r.bottom <= window.innerHeight - (shell ? 150 : 0)) return;
  const top = r.top + window.scrollY - offset;
  window.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? 'auto' : 'smooth' });
}

/**
 * Whether the page has had a user gesture yet. Browsers block (and log) vibration before one, e.g.
 * right after returning from the payment page.
 */
export function hadGesture() {
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return ua ? ua.hasBeenActive : false;
}

/** Top of the page for a new step screen. */
export function scrollTop() {
  window.scrollTo({ top: 0, behavior: 'auto' });
}

// ---------- Drafts (this device only; storage may be unavailable in private mode) ----------

interface Stored<T> {
  v: T;
  at: number;
}

export function readDraft<T>(key: string, maxAgeMs: number): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Stored<T>;
    if (!d || typeof d !== 'object' || typeof d.at !== 'number' || Date.now() - d.at > maxAgeMs) {
      localStorage.removeItem(key);
      return null;
    }
    return d.v;
  } catch {
    return null;
  }
}

export function writeDraft<T>(key: string, v: T) {
  try {
    localStorage.setItem(key, JSON.stringify({ v, at: Date.now() } satisfies Stored<T>));
  } catch {
    /* storage unavailable */
  }
}

export function clearDraft(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

export const DRAFT_DAYS = 7;
export const DRAFT_MAX_AGE = DRAFT_DAYS * 24 * 60 * 60 * 1000;
