'use client';

// Recent searches for the full-screen phone search. A per-device convenience only, kept in
// localStorage `bf-recent-searches`; every read and write tolerates blocked or missing storage.

export interface RecentSearch {
  label: string;
  href: string;
}

const KEY = 'bf-recent-searches';
const MAX = 6;

export function readRecent(): RecentSearch[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter(x => x && typeof x.label === 'string' && typeof x.href === 'string' && x.href.startsWith('/')).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function pushRecent(item: RecentSearch) {
  const label = item.label.trim().slice(0, 80);
  if (!label) return;
  try {
    const next = [{ label, href: item.href }, ...readRecent().filter(r => r.label !== label)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
}

export function clearRecent() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
