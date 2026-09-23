'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { REGIONS, type RegionSlug } from '@/lib/catalog';

// The homepage's chosen region, shared by the header picker, the hero search and the
// business carousel (three separate client islands). Persisted in localStorage `bf-region`
// as a convenience only: every read tolerates a missing or blocked storage.

export type RegionChoice = 'all' | RegionSlug;

/** Design prop `defaultRegion`. The production homepage always starts nationwide. */
export const DEFAULT_REGION: RegionChoice = 'all';

const KEY = 'bf-region';
const EVENT = 'bf-region-change';

let current: RegionChoice | null = null;

const isChoice = (v: unknown): v is RegionChoice => v === 'all' || REGIONS.some(r => r.slug === v);

function snapshot(): RegionChoice {
  if (current) return current;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {}
  current = isChoice(stored) ? stored : DEFAULT_REGION;
  return current;
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    current = isChoice(e.newValue) ? e.newValue : DEFAULT_REGION;
    cb();
  };
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', onStorage);
  };
}

export function setRegion(r: RegionChoice) {
  current = r;
  try {
    localStorage.setItem(KEY, r);
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

/** [region, setRegion]. Server render and hydration use the default; the stored choice applies right after. */
export function useRegion(): [RegionChoice, (r: RegionChoice) => void] {
  const region = useSyncExternalStore(subscribe, snapshot, () => DEFAULT_REGION);
  return [region, useCallback((r: RegionChoice) => setRegion(r), [])];
}

export const regionName = (r: RegionChoice) => (r === 'all' ? 'כל הארץ' : REGIONS.find(x => x.slug === r)!.name);

/** Scroll back to the hero search and focus one of its fields (header compact search, footer CTA). */
export function focusHeroSearch(field: 'q' | 'loc' = 'q') {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  document.getElementById(field === 'q' ? 'bf-q' : 'bf-loc')?.focus({ preventScroll: true });
}
