'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowBack, ArrowForward } from '@/components/icons';
import { CloseGlyph } from './icons';
import styles from './Gallery.module.css';

export interface Photo {
  url: string;
  alt: string;
}

/** Hook: which photo is open, and where focus returns on close. */
function useLightbox() {
  const [index, setIndex] = useState(-1);
  const opener = useRef<HTMLElement | null>(null);
  const open = (i: number) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setIndex(i);
  };
  const close = useCallback(() => {
    setIndex(-1);
    const el = opener.current;
    requestAnimationFrame(() => el?.focus());
  }, []);
  return { index, setIndex, open, close };
}

/**
 * Photo grid: the cover spans two rows, up to four tiles beside it; the last tile opens "all photos".
 * Layout adapts to how many photos exist (0, 1, 2 or 4 tiles) so no empty bordered cell is left.
 * In the app shell (phones) the same tiles become a full-bleed swipeable strip with a counter pill;
 * photos beyond the desktop grid are rendered as extra slides that the grid hides.
 */
export function Gallery({ photos }: { photos: Photo[] }) {
  const lb = useLightbox();
  const strip = useRef<HTMLDivElement>(null);
  const [cur, setCur] = useState(0);

  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // RTL scrollLeft is 0 at the start and negative towards the end.
        if (!el.clientWidth) return;
        setCur(Math.round(Math.abs(el.scrollLeft) / el.clientWidth));
      });
    };
    el.addEventListener('scroll', on, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', on);
    };
  }, []);

  if (photos.length === 0) return null;
  const rest = photos.slice(1);
  const tiles = rest.length >= 4 ? 4 : rest.length >= 2 ? 2 : rest.length;
  const n = photos.length;
  return (
    <div className={styles.frame}>
      <div ref={strip} className={styles.grid} data-tiles={tiles}>
        <button type="button" className={`${styles.tile} ${styles.primary}`} onClick={() => lb.open(0)} aria-label={`פתיחת גלריית התמונות, ${photos[0].alt}`}>
          <img src={photos[0].url} alt={photos[0].alt} fetchPriority="high" />
        </button>
        {rest.map((p, j) => {
          const i = j + 1;
          const extra = j >= tiles;
          const isLast = j === tiles - 1 && tiles >= 2;
          return (
            <button
              key={p.url + i}
              type="button"
              className={styles.tile}
              data-extra={extra || undefined}
              onClick={() => lb.open(i)}
              aria-label={isLast ? `כל ${n} התמונות` : `פתיחת הגלריה, ${p.alt}`}
            >
              <img src={p.url} alt={p.alt} loading="lazy" />
              {isLast && <span className={styles.more}>כל {n} התמונות</span>}
            </button>
          );
        })}
      </div>
      {n > 1 && (
        <>
          <span className={styles.counter} aria-hidden="true">
            <span className="ltr tnum">
              {Math.min(cur, n - 1) + 1} / {n}
            </span>
          </span>
          {/* Phones: opens the viewer at the slide in view. */}
          <button type="button" className={styles.allPill} onClick={() => lb.open(Math.min(cur, n - 1))}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <rect x="2" y="2" width="5" height="5" rx="1.2" /><rect x="9" y="2" width="5" height="5" rx="1.2" />
              <rect x="2" y="9" width="5" height="5" rx="1.2" /><rect x="9" y="9" width="5" height="5" rx="1.2" />
            </svg>
            כל {n} התמונות
          </button>
        </>
      )}
      {lb.index >= 0 && <Lightbox photos={photos} index={lb.index} onIndex={lb.setIndex} onClose={lb.close} label="גלריית תמונות" />}
    </div>
  );
}

/** Before/after photos published by the business (gallery items tagged 'לפני/אחרי'). */
export function BeforeAfter({ photos }: { photos: Photo[] }) {
  const lb = useLightbox();
  return (
    <>
      <div className={styles.ba}>
        {photos.map((p, i) => (
          <button key={p.url + i} type="button" className={styles.baCard} onClick={() => lb.open(i)}>
            <span className={styles.baImg}>
              <img src={p.url} alt={p.alt} loading="lazy" />
            </span>
            <span className={styles.baCap}>{p.alt}</span>
          </button>
        ))}
      </div>
      {lb.index >= 0 && <Lightbox photos={photos} index={lb.index} onIndex={lb.setIndex} onClose={lb.close} label="תמונות לפני ואחרי" />}
    </>
  );
}

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** Keyboard operable: ← next, → previous (RTL), Esc closes, Tab stays inside, focus returns to the opener. */
function Lightbox({ photos, index, onIndex, onClose, label }: { photos: Photo[]; index: number; onIndex: (i: number) => void; onClose: () => void; label: string }) {
  const root = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const thumbs = useRef<HTMLDivElement>(null);
  const n = photos.length;
  const step = useCallback((d: number) => onIndex((index + d + n) % n), [index, n, onIndex]);

  useEffect(() => {
    closeBtn.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') step(-1);
      else if (e.key === 'ArrowLeft') step(1);
      else if (e.key === 'Tab' && root.current) {
        const items = Array.from(root.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        const a = items[0];
        const z = items[items.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, step]);

  useEffect(() => {
    thumbs.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [index]);

  // Swipe between photos on touch screens. RTL: the next photo sits to the left, so a drag to the right brings it in.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touch.current = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const t = touch.current;
    touch.current = null;
    if (!t || n < 2) return;
    const dx = e.changedTouches[0].clientX - t.x;
    const dy = e.changedTouches[0].clientY - t.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx > 0 ? 1 : -1);
  };

  const p = photos[index];
  return (
    <div ref={root} role="dialog" aria-modal="true" aria-label={label} className={styles.lb} onClick={onClose}>
      <div className={styles.lbTop}>
        <span dir="ltr" className={styles.lbCount} aria-live="polite">
          {index + 1} / {n}
        </span>
        <button ref={closeBtn} type="button" className={`${styles.lbRound} ${styles.lbClose}`} onClick={onClose} aria-label="סגירת הגלריה">
          <CloseGlyph size={16} />
        </button>
      </div>
      <div className={styles.lbMid}>
        {n > 1 && (
          <button type="button" className={`${styles.lbRound} ${styles.lbStep}`} onClick={e => { e.stopPropagation(); step(-1); }} aria-label="התמונה הקודמת">
            <ArrowBack size={18} />
          </button>
        )}
        <div key={index} className={styles.lbStage} onClick={e => e.stopPropagation()} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <img src={p.url} alt={p.alt} />
        </div>
        {n > 1 && (
          <button type="button" className={`${styles.lbRound} ${styles.lbStep}`} onClick={e => { e.stopPropagation(); step(1); }} aria-label="התמונה הבאה">
            <ArrowForward size={18} />
          </button>
        )}
      </div>
      <div className={styles.lbFoot} onClick={e => e.stopPropagation()}>
        <span className={styles.lbCap}>{p.alt}</span>
        {n > 1 && (
          <div ref={thumbs} className={styles.lbThumbs}>
            {photos.map((t, i) => (
              <button key={t.url + i} type="button" className={styles.lbThumb} aria-current={i === index} aria-label={t.alt} onClick={() => onIndex(i)}>
                <img src={t.url} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        )}
        <span className={`${styles.lbHint} bf-desk-only`}>חיצים למעבר · Esc ליציאה</span>
        {n > 1 && <span className={`${styles.lbHintTouch} bf-shell-only`}>החליקו למעבר בין התמונות</span>}
      </div>
    </div>
  );
}
