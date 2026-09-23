'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { TABS, isFocused, tabFor, variantFor, type ShellTab } from '@/lib/ui/shell';
import { haptic } from './haptics';
import { TabIcon } from './TabIcon';
import styles from './TabBar.module.css';

// Bottom tab bar of the app shell (spec §2.2). Shown by CSS only in the shell media query.
// Each tab remembers its last screen and scroll position (sessionStorage), so switching tabs feels
// like switching stacks. Tapping the active tab scrolls to top; tapping it again resets the stack.

const store = {
  get(k: string) {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};
const lastKey = (variant: string, tab: string) => `bf-tab:${variant}:${tab}`;
const scrollKey = (url: string) => `bf-scroll:${url}`;
const here = () => window.location.pathname + window.location.search;

type Badges = Partial<Record<NonNullable<ShellTab['badge']>, number>>;

export function TabBar() {
  const path = usePathname() ?? '/';
  const router = useRouter();
  const variant = variantFor(path);
  const tabs = variant === 'staff' ? null : TABS[variant];
  const active = tabs ? tabFor(tabs, path) : undefined;
  const hidden = !tabs || isFocused(path);
  const [badges, setBadges] = useState<Badges>({});
  const restoring = useRef<string | null>(null);

  // Remember where each tab was, and the scroll position of every screen.
  useEffect(() => {
    if (!tabs || !active) return;
    store.set(lastKey(variant, active.key), here());
    const url = here();
    if (restoring.current === url) {
      const y = Number(store.get(scrollKey(url)) ?? 0);
      requestAnimationFrame(() => window.scrollTo({ top: y }));
      restoring.current = null;
    }
    let t = 0;
    const onScroll = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => store.set(scrollKey(url), String(Math.round(window.scrollY))), 120);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.clearTimeout(t);
    };
  }, [path, tabs, active, variant]);

  // Badge counts (new leads, consult requests, waitlist offers). Refreshed when the app comes back.
  useEffect(() => {
    if (hidden) return;
    let alive = true;
    const load = () =>
      fetch(`/api/shell/badges?v=${variant}`, { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : {}))
        .then(b => alive && setBadges(b as Badges))
        .catch(() => {});
    load();
    const onVis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [variant, hidden]);

  if (hidden || !tabs) return null;

  const go = (tab: ShellTab) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    haptic('light');
    if (active?.key === tab.key) {
      if (window.scrollY > 4) window.scrollTo({ top: 0, behavior: 'smooth' });
      else if (here() !== tab.href) router.push(tab.href);
      return;
    }
    const target = store.get(lastKey(variant, tab.key)) ?? tab.href;
    restoring.current = target;
    router.push(target, { scroll: false });
  };

  return (
    <nav aria-label="ניווט ראשי" className={styles.bar} data-tabbar>
      {tabs.map(tab => {
        const on = active?.key === tab.key;
        const n = tab.badge ? badges[tab.badge] ?? 0 : 0;
        return (
          <a key={tab.key} href={tab.href} onClick={go(tab)} className={styles.tab} aria-current={on ? 'page' : undefined} data-on={on || undefined}>
            <span className={styles.icon}>
              <TabIcon name={tab.icon} active={on} />
              {n > 0 && (
                <span className={styles.badge} aria-hidden="true">
                  <span className="ltr">{n > 9 ? '9+' : n}</span>
                </span>
              )}
            </span>
            <span className={styles.label}>{tab.label}</span>
            {n > 0 && <span className="sr-only">{`, ${n} חדשים`}</span>}
          </a>
        );
      })}
    </nav>
  );
}
