'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { focusHeroSearch, useRegion } from './regionStore';

/** "מצאו עסקים" for a category: /search?t=:slug, scoped to the chosen region when there is one. */
export function FindBizLink({ category, className, children }: { category: string; className?: string; children: ReactNode }) {
  const [region] = useRegion();
  const p = new URLSearchParams({ t: category });
  if (region !== 'all') p.set('region', region);
  return (
    <Link href={`/search?${p.toString()}`} className={className}>
      {children}
    </Link>
  );
}

/** Scrolls back to the hero search and focuses it (footer CTA). */
export function BackToSearchButton({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <button type="button" className={className} onClick={() => focusHeroSearch('q')}>
      {children}
    </button>
  );
}
