'use client';

import { useEffect, useState } from 'react';
import { ActionBar } from '@/components/shell/ActionBar';
import styles from '@/app/for-business/marketing/marketing.module.css';

/** Phones: a sticky bar once the hero is gone, hidden while the packages or the quote form are on screen. */
export function MarketingStickyBar({ heroEndId, hideIds, primary, secondary, hint }: { heroEndId: string; hideIds: string[]; primary: { href: string; label: string }; secondary?: { href: string; label: string }; hint?: string }) {
  const [past, setPast] = useState(false);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const hero = document.getElementById(heroEndId);
    const targets = hideIds.map(id => document.getElementById(id)).filter((x): x is HTMLElement => !!x);
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.target === hero) setPast(!e.isIntersecting && e.boundingClientRect.top < 0);
        else setHidden(h => ({ ...h, [e.target.id]: e.isIntersecting }));
      }
    });
    if (hero) io.observe(hero);
    targets.forEach(t => io.observe(t));
    return () => io.disconnect();
  }, [heroEndId, hideIds]);
  if (!past || Object.values(hidden).some(Boolean)) return null;
  return (
    <ActionBar mobileOnly hint={hint}>
      <div style={{ display: 'flex', gap: 10, width: '100%' }}>
        <a href={primary.href} className={styles.barCta}>
          {primary.label}
        </a>
        {secondary && (
          <a href={secondary.href} className={styles.barGhost}>
            {secondary.label}
          </a>
        )}
      </div>
    </ActionBar>
  );
}
