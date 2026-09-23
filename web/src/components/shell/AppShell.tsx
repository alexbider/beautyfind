'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { TABS, isFocused, isTabRoot, variantFor } from '@/lib/ui/shell';
import { InstallPrompt } from '../pwa/InstallPrompt';
import { bumpDepth, goBack } from './nav';
import { TabBar } from './TabBar';
import styles from './AppShell.module.css';

// Mounted once in the root layout. Everything here is inert outside the app shell media query.
export function AppShell() {
  const path = usePathname() ?? '/';
  const router = useRouter();

  // In-app history depth, for back buttons on deep-linked screens.
  useEffect(() => {
    bumpDepth();
  }, [path]);

  // Service worker (production only): app shell cache and offline page.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }, []);

  return (
    <>
      <TabBar />
      <EdgeSwipeBack path={path} onBack={() => goBack(router, parentOf(path))} />
      <InstallPrompt />
    </>
  );
}

/** Deep-link fallback for back: the tab root the screen belongs to, else home. */
function parentOf(path: string) {
  const v = variantFor(path);
  if (v === 'business') return '/biz';
  if (v === 'clinic') return '/clinic';
  const parts = path.split('/').filter(Boolean);
  return parts.length > 1 ? `/${parts.slice(0, -1).join('/')}` : '/';
}

/**
 * Back gesture (spec §4): a swipe from the RIGHT edge (RTL) on pushed screens, touch only.
 * Not in focused flows (they own back) and not on tab roots (nothing to go back to).
 */
function EdgeSwipeBack({ path, onBack }: { path: string; onBack: () => void }) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const v = variantFor(path);
  const enabled = v !== 'staff' && !isFocused(path) && !isTabRoot(TABS[v], path);
  const dxRef = useRef(0);
  dxRef.current = dx;
  const backRef = useRef(onBack);
  backRef.current = onBack;

  useEffect(() => {
    if (!enabled) return;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      start.current = t.clientX > window.innerWidth - 22 && !document.documentElement.classList.contains('bf-sheet-open') ? { x: t.clientX, y: t.clientY } : null;
    };
    const onMove = (e: TouchEvent) => {
      const s = start.current;
      if (!s) return;
      const t = e.touches[0];
      const d = s.x - t.clientX; // moving left, into the screen
      if (Math.abs(t.clientY - s.y) > Math.abs(d) * 1.2 && d < 30) {
        start.current = null;
        setDx(0);
        return;
      }
      setDx(Math.max(0, Math.min(d, 120)));
    };
    const onEnd = () => {
      const go = start.current && dxRef.current > 80;
      start.current = null;
      setDx(0);
      if (go) backRef.current();
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled]);

  if (!enabled || dx <= 0) return null;
  return (
    <div className={styles.edge} style={{ transform: `translateX(${-Math.min(dx, 90) / 2}px)`, opacity: Math.min(1, dx / 80) }} aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 5l7 7-7 7" />
      </svg>
    </div>
  );
}
