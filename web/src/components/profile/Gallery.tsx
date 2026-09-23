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
 */
export function Gallery({ photos }: { photos: Photo[] }) {
  const lb = useLightbox();
  if (photos.length === 0) return null;
  const rest = photos.slice(1);
  const tiles = rest.length >= 4 ? 4 : rest.length >= 2 ? 2 : rest.length;
  const shown = rest.slice(0, tiles);
  return (
    <>
      <div className={styles.grid} data-tiles={tiles}>
        <button type="button" className={`${styles.tile} ${styles.primary}`} onClick={() => lb.open(0)} aria-label={`פתיחת גלריית התמונות, ${photos[0].alt}`}>
          <img src={photos[0].url} alt={photos[0].alt} fetchPriority="high" />
        </button>
        {shown.map((p, i) => {
          const isLast = i === shown.length - 1 && tiles >= 2;
          return (
            <button key={p.url + i} type="button" className={styles.tile} onClick={() => lb.open(i + 1)} aria-label={isLast ? `כל ${photos.length} התמונות` : `פתיחת הגלריה, ${p.alt}`}>
              <img src={p.url} alt={p.alt} loading="lazy" />
              {isLast && <span className={styles.more}>כל {photos.length} התמונות</span>}
            </button>
          );
        })}
      </div>
      {lb.index >= 0 && <Lightbox photos={photos} index={lb.index} onIndex={lb.setIndex} onClose={lb.close} label="גלריית תמונות" />}
    </>
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
        <div key={index} className={styles.lbStage} onClick={e => e.stopPropagation()}>
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
        <span className={styles.lbHint}>חיצים למעבר · Esc ליציאה</span>
      </div>
    </div>
  );
}
