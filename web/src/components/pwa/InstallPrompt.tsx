'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { BottomSheet } from '../shell/BottomSheet';
import styles from './InstallPrompt.module.css';

// Install prompt (spec §5): a custom bottom sheet shown only after a confirmed booking or on a
// second-day visit, never on the first page load. Android/Chrome use the deferred native prompt;
// iOS Safari gets the "Share → Add to Home Screen" steps. Dismissal is remembered for 30 days.

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const K = { visits: 'bf-visit-days', dismissed: 'bf-install-dismissed' };
const DAY = 86_400_000;

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

function standalone() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
}

function Inner() {
  const path = usePathname() ?? '/';
  const params = useSearchParams();
  const deferred = useRef<BIPEvent | null>(null);
  const [open, setOpen] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault();
      deferred.current = e as BIPEvent;
    };
    window.addEventListener('beforeinstallprompt', onBip);
    // Count distinct visit days.
    const today = new Date().toISOString().slice(0, 10);
    const days = new Set((read(K.visits) ?? '').split(',').filter(Boolean));
    days.add(today);
    write(K.visits, [...days].slice(-5).join(','));
    return () => window.removeEventListener('beforeinstallprompt', onBip);
  }, []);

  useEffect(() => {
    if (standalone()) return;
    const dismissed = Number(read(K.dismissed) ?? 0);
    if (Date.now() - dismissed < 30 * DAY) return;
    const booked = path.startsWith('/b/') && params.get('paid') === '1';
    const secondDay = (read(K.visits) ?? '').split(',').filter(Boolean).length >= 2;
    if (!booked && !secondDay) return;
    const t = window.setTimeout(() => {
      if (deferred.current) setOpen(true);
      else if (isIos()) {
        setIos(true);
        setOpen(true);
      }
    }, booked ? 1800 : 6000);
    return () => window.clearTimeout(t);
  }, [path, params]);

  const close = () => {
    write(K.dismissed, String(Date.now()));
    setOpen(false);
  };
  const install = async () => {
    const e = deferred.current;
    if (!e) return close();
    await e.prompt();
    await e.userChoice.catch(() => null);
    deferred.current = null;
    close();
  };

  return (
    <BottomSheet
      open={open}
      onClose={close}
      title="BeautyFind במסך הבית"
      footer={
        ios ? (
          <button type="button" className={styles.primary} onClick={close}>
            הבנתי
          </button>
        ) : (
          <div className={styles.row}>
            <button type="button" className={styles.ghost} onClick={close}>
              לא עכשיו
            </button>
            <button type="button" className={styles.primary} onClick={install}>
              הוספה למסך הבית
            </button>
          </div>
        )
      }
    >
      <p className={styles.lead}>פתיחה בנגיעה אחת, התורים שלך במקום אחד, וקישורים מוואטסאפ נפתחים ישר באפליקציה.</p>
      {ios && (
        <ol className={styles.steps}>
          <li>
            לוחצים על כפתור השיתוף <span aria-hidden="true">⎋</span> בתחתית Safari
          </li>
          <li>בוחרים ״הוספה למסך הבית״</li>
          <li>מאשרים ב״הוספה״</li>
        </ol>
      )}
    </BottomSheet>
  );
}

export function InstallPrompt() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
