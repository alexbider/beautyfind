'use client';

import { useEffect, useRef, useState } from 'react';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import styles from './ProfileMobile.module.css';

// App-shell pieces of the Business Profile (mobile v2 handoff): the top bar that picks up the clinic
// name once the title scrolls away, and the sticky section chips.

/** Site header whose phone top bar shows `name` only after the element `#watchId` has scrolled under it. */
export function ProfileHeader({ name, watchId, backHref }: { name: string; watchId: string; backHref: string }) {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const el = document.getElementById(watchId);
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setPast(!e.isIntersecting && e.boundingClientRect.top < 0), { rootMargin: '-56px 0px 0px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [watchId]);
  return <SiteHeader variant="public" title={past ? name : undefined} backHref={backHref} />;
}

/** Height of the sticky top bar + section tabs, read from the live layout (handoff: ~124px). */
function stickyOffset() {
  const bar = document.querySelector<HTMLElement>('[data-mode="pushed"]');
  const tabs = document.querySelector<HTMLElement>('[data-profile-tabs]');
  return (bar?.getBoundingClientRect().height ?? 56) + (tabs?.getBoundingClientRect().height ?? 58) + 10;
}

/**
 * Sticky section chips under the top bar (Business Profile mobile v2, §4). Tap scrolls to the section;
 * the active chip is the last section whose top has passed the sticky band.
 */
export function SectionTabs({ items }: { items: Array<{ key: string; label: string; target: string }> }) {
  const [on, setOn] = useState(items[0]?.key ?? '');
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const band = stickyOffset() + 26;
        let cur = items[0]?.key ?? '';
        for (const it of items) {
          const el = document.getElementById(it.target);
          if (el && el.getBoundingClientRect().top < band) cur = it.key;
        }
        setOn(cur);
      });
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [items]);

  // Keep the active chip in view inside the horizontal rail.
  useEffect(() => {
    const chip = bar.current?.querySelector<HTMLElement>('[aria-current="true"]');
    const rail = bar.current?.firstElementChild as HTMLElement | null;
    if (!chip || !rail) return;
    const c = chip.getBoundingClientRect();
    const r = rail.getBoundingClientRect();
    if (c.left < r.left + 16 || c.right > r.right - 16) rail.scrollBy({ left: c.left - r.left - (r.width - c.width) / 2, behavior: 'smooth' });
  }, [on]);

  const go = (it: { key: string; target: string }) => {
    const el = document.getElementById(it.target);
    if (!el) return;
    setOn(it.key);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - stickyOffset(), behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <div ref={bar} data-profile-tabs className={`${styles.tabs} bf-shell-only`}>
      <nav aria-label="מדורי העמוד" className={styles.tabRail}>
        {items.map(it => (
          <a
            key={it.key}
            href={`#${it.target}`}
            className={styles.tab}
            aria-current={on === it.key ? 'true' : undefined}
            onClick={e => {
              e.preventDefault();
              go(it);
            }}
          >
            {it.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
