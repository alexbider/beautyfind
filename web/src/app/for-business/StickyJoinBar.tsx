'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ActionBar } from '@/components/shell/ActionBar';
import { ROUTES } from '@/lib/routes';
import styles from './page.module.css';

/**
 * Get Listed on phones (spec §6): a sticky "רישום העסק" bar once the hero has scrolled away,
 * hidden again while the closing call to action is on screen. Watches elements, not scroll events.
 */
export function StickyJoinBar({ heroEndId, ctaId }: { heroEndId: string; ctaId: string }) {
  const [pastHero, setPastHero] = useState(false);
  const [atCta, setAtCta] = useState(false);

  useEffect(() => {
    const hero = document.getElementById(heroEndId);
    const cta = document.getElementById(ctaId);
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.target === hero) setPastHero(!e.isIntersecting && e.boundingClientRect.top < 0);
        if (e.target === cta) setAtCta(e.isIntersecting);
      }
    });
    if (hero) io.observe(hero);
    if (cta) io.observe(cta);
    return () => io.disconnect();
  }, [heroEndId, ctaId]);

  if (!pastHero || atCta) return null;
  return (
    <ActionBar mobileOnly hint="האימות תוך עד 2 ימי עסקים, בלי התחייבות">
      <Link href={ROUTES.join} className={styles.barCta}>
        רישום העסק
      </Link>
    </ActionBar>
  );
}
