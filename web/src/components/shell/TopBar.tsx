'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Wordmark } from '../Wordmark';
import { goBack } from './nav';
import styles from './TopBar.module.css';

// Mobile top bar of the app shell (spec §2.1). Rendered only inside the shell media query; pages keep
// their desktop header for wider screens.
//  - root:   wordmark on the right, up to two icon actions on the left, optional large title below.
//  - pushed: back (→) on the right, centred title, one action on the left.
//  - flow:   back on the right (from step 2), centred title, close (×) on the left, progress under the bar.

export interface TopBarAction {
  label: string;
  href?: string;
  onClick?: () => void;
  icon: React.ReactNode;
}

export interface TopBarProps {
  mode?: 'root' | 'pushed' | 'flow';
  title?: string;
  /** Large 28px title under the bar that collapses into the bar on scroll (root screens). */
  largeTitle?: string;
  /** Where back goes when there is no in-app history (deep link). */
  backHref?: string;
  onBack?: () => void;
  /** Flow close target; defaults to backHref or home. */
  closeHref?: string;
  onClose?: () => void;
  actions?: TopBarAction[];
  progress?: { step: number; total: number };
  /** Hide the back button in a flow (first step). */
  noBack?: boolean;
}

export function TopBar({ mode = 'pushed', title, largeTitle, backHref = '/', onBack, closeHref, onClose, actions = [], progress, noBack }: TopBarProps) {
  const router = useRouter();
  const sentinel = useRef<HTMLDivElement>(null);
  const large = useRef<HTMLHeadingElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [collapsed, setCollapsed] = useState(!largeTitle);

  useEffect(() => {
    const s = sentinel.current;
    if (!s) return;
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting));
    io.observe(s);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const l = large.current;
    if (!l) return;
    const io = new IntersectionObserver(([e]) => setCollapsed(!e.isIntersecting), { rootMargin: '-56px 0px 0px 0px' });
    io.observe(l);
    return () => io.disconnect();
  }, [largeTitle]);

  const back = () => (onBack ? onBack() : goBack(router, backHref));
  const close = () => (onClose ? onClose() : router.push(closeHref ?? backHref));
  const barTitle = mode === 'root' ? (collapsed && largeTitle ? largeTitle : null) : title;
  const pct = progress ? Math.round((progress.step / progress.total) * 100) : 0;

  return (
    <div className={styles.shell}>
      <div ref={sentinel} className={styles.sentinel} aria-hidden="true" />
      <div className={styles.bar} data-scrolled={scrolled || undefined} data-mode={mode}>
        <div className={styles.start}>
          {mode === 'root' ? (
            <Link href="/" aria-label="BeautyFind, לדף הבית" className={styles.brand}>
              <Wordmark size={22} />
            </Link>
          ) : !(mode === 'flow' && noBack) ? (
            <button type="button" className={styles.iconBtn} onClick={back} aria-label="חזרה">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ) : (
            <span className={styles.iconSpacer} />
          )}
        </div>

        <div className={styles.title} data-root={mode === 'root' || undefined}>
          {barTitle && <span className={styles.titleText}>{barTitle}</span>}
        </div>

        <div className={styles.end}>
          {mode === 'flow' ? (
            <button type="button" className={styles.iconBtn} onClick={close} aria-label="סגירה">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          ) : (
            actions.slice(0, mode === 'root' ? 2 : 1).map(a =>
              a.href ? (
                <Link key={a.label} href={a.href} className={styles.iconBtn} aria-label={a.label}>
                  {a.icon}
                </Link>
              ) : (
                <button key={a.label} type="button" className={styles.iconBtn} onClick={a.onClick} aria-label={a.label}>
                  {a.icon}
                </button>
              ),
            )
          )}
          {mode !== 'flow' && actions.length === 0 && <span className={styles.iconSpacer} />}
        </div>

        {progress && (
          <div className={styles.progress} role="progressbar" aria-valuemin={1} aria-valuemax={progress.total} aria-valuenow={progress.step} aria-label={`שלב ${progress.step} מתוך ${progress.total}`}>
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      {progress && (
        <p className={styles.stepText}>
          שלב <span className="ltr tnum">{progress.step}</span> מתוך <span className="ltr tnum">{progress.total}</span>
        </p>
      )}
      {mode === 'root' && largeTitle && (
        <h1 ref={large} className={styles.large}>
          {largeTitle}
        </h1>
      )}
    </div>
  );
}

/** Common icon for the search action. */
export const SearchIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m20 20-4.8-4.8" />
  </svg>
);
