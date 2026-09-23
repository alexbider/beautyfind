'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './BottomSheet.module.css';

// Bottom sheet (spec §3): replaces dropdowns, popovers and modals below 768px. 20px top radius,
// drag handle, snaps to 50% and 90%, closes on swipe down / scrim tap / Escape, traps focus and
// returns it on close. From 768px up the same component is a centred dialog.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Visually hide the title (still labels the dialog). */
  hideTitle?: boolean;
  children: React.ReactNode;
  /** Sticky footer (e.g. "הצגת 24 תוצאות"). */
  footer?: React.ReactNode;
  /** half = opens at 50% and can be dragged to 90%; full = 90% (forms); auto = fits content up to 90%. */
  size?: 'auto' | 'half' | 'full';
}

export function BottomSheet({ open, onClose, title, hideTitle, children, footer, size = 'auto' }: BottomSheetProps) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const drag = useRef<{ y0: number; t0: number; dy: number } | null>(null);
  const [dy, setDy] = useState(0);
  const [expanded, setExpanded] = useState(size === 'full');
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => setExpanded(size === 'full'), [size, open]);

  // Focus in, lock page scroll, restore focus on close.
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const root = document.documentElement;
    root.classList.add('bf-sheet-open');
    const t = requestAnimationFrame(() => {
      const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel.current)?.focus();
    });
    return () => {
      cancelAnimationFrame(t);
      root.classList.remove('bf-sheet-open');
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open]);

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  const down = (e: React.PointerEvent) => {
    // Not from the close button, and never on the desktop dialog.
    if ((e.target as Element).closest('button') || window.matchMedia('(min-width: 768px)').matches) return;
    drag.current = { y0: e.clientY, t0: performance.now(), dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const d = e.clientY - drag.current.y0;
    drag.current.dy = d;
    setDy(d > 0 ? d : Math.max(d, -120));
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    setDy(0);
    if (!d) return;
    const v = d.dy / Math.max(1, performance.now() - d.t0); // px per ms
    if (d.dy > 110 || v > 0.6) {
      if (expanded && size === 'half') setExpanded(false);
      else onClose();
    } else if (d.dy < -50 && size !== 'auto') setExpanded(true);
  };

  if (!mounted || !open) return null;

  return createPortal(
    <div className={styles.root} onKeyDown={onKey}>
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        tabIndex={-1}
        className={styles.panel}
        data-size={size}
        data-expanded={expanded || undefined}
        data-dragging={dy !== 0 || undefined}
        style={dy ? { transform: `translateY(${dy}px)` } : undefined}
      >
        <div className={styles.grab} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <span className={styles.handle} aria-hidden="true" />
          <div className={styles.head}>
            <h2 id={`${id}-t`} className={hideTitle ? 'sr-only' : styles.title}>
              {title}
            </h2>
            <button type="button" className={styles.close} onClick={onClose} aria-label="סגירה">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
