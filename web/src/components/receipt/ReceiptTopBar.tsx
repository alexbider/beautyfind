'use client';

import { useEffect, useState } from 'react';
import { BottomSheet } from '@/components/shell/BottomSheet';
import { TopBar } from '@/components/shell/TopBar';
import styles from './receipt.module.css';

// App shell top bar of the receipt (spec §6 Receipt): back on the right, the title, and one action on
// the left that opens a sheet with share (when the device can) and print / save as PDF.

const ShareIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" />
    <path d="M5 12v6.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V12" />
  </svg>
);

export function ReceiptTopBar({ title, backHref }: { title: string; backHref: string }) {
  const [open, setOpen] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function'), []);

  const share = async () => {
    try {
      await navigator.share({ title: document.title, url: window.location.href });
      setOpen(false);
    } catch {
      /* dismissed */
    }
  };
  const print = () => {
    setOpen(false);
    // Let the sheet close before the print dialog snapshots the page.
    setTimeout(() => window.print(), 300);
  };

  return (
    <div className={styles.barHost} data-noprint>
      <TopBar mode="pushed" title={title} backHref={backHref} actions={[{ label: 'שיתוף והדפסה', icon: ShareIcon, onClick: () => setOpen(true) }]} />
      <BottomSheet open={open} onClose={() => setOpen(false)} title="שיתוף ושמירה">
        <div className={styles.sheetList}>
          {canShare && (
            <button type="button" className={styles.sheetBtn} onClick={share}>
              שיתוף הקישור
              <span className={styles.sheetNote}>למייל, לוואטסאפ או להנהלת החשבונות</span>
            </button>
          )}
          <button type="button" className={styles.sheetBtn} onClick={print}>
            הדפסה או שמירה כ־PDF
            <span className={styles.sheetNote}>המסמך בלבד, בלי מעקב ההחזר</span>
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}
