'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, CloseGlyph, SmallStars } from './icons';
import styles from './Reviews.module.css';

export interface ReviewView {
  id: string;
  author: string;
  rating: number;
  iso: string;
  rel: string;
  title: string;
  body: string;
  treatment: string | null;
  reply: string | null;
}

const TRUST = [
  'דירוג Google מגיע מפרופיל Google Business של העסק ומתעדכן מדי שבוע. BeautyFind לא עורך אותו.',
  'ביקורות BeautyFind נכתבות רק אחרי ביקור מאומת ומתפרסמות אחרי בדיקה, גם כשהן שליליות.',
  'שני הדירוגים מוצגים זה לצד זה ואף פעם לא מתמזגים לציון אחד.',
  'עסקים אינם יכולים למחוק ביקורת דרך BeautyFind. פנייה על ביקורת פוגענית מטופלת מול מקור הביקורת.',
];

/** The "i" disclosure with how the reviews work. Escape and outside click close it. */
export function ReviewsInfo() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);
  return (
    <div ref={wrap}>
      <button ref={btn} type="button" className={styles.info} aria-expanded={open} aria-controls="rv-info" aria-label="איך הביקורות האלה עובדות" onClick={() => setOpen(o => !o)}>
        <span aria-hidden="true">i</span>
      </button>
      {open && (
        <div id="rv-info" role="dialog" aria-label="איך הביקורות עובדות" className={styles.pop}>
          <div className={styles.popHead}>
            <span className={styles.popTitle}>איך הביקורות עובדות</span>
            <button type="button" className={styles.popClose} aria-label="סגירה" onClick={() => { setOpen(false); btn.current?.focus(); }}>
              <CloseGlyph />
            </button>
          </div>
          <ul className={styles.popList}>
            {TRUST.map(t => <li key={t}>{t}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

const AVATAR_BG = ['#F0FAFB', '#F4F2EC', '#EEF2F7', '#F6F0F2', '#EFF4EF', '#F2F0F6'];
type SortKey = 'recent' | 'high' | 'low';
const SORTS: Array<[SortKey, string]> = [['recent', 'החדשות'], ['high', 'הגבוהות'], ['low', 'הנמוכות']];

/**
 * BeautyFind verified reviews as a slider of about 2.5 cards, with sort and prev/next.
 * scrollLeft is animated by hand: scrollBy({behavior:'smooth'}) is cancelled by scroll-snap (design note).
 */
export function ReviewsRail({ reviews, total }: { reviews: ReviewView[]; total: number }) {
  const [sort, setSort] = useState<SortKey>('recent');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const rail = useRef<HTMLDivElement>(null);
  const anim = useRef<number | null>(null);

  const sorted = useMemo(() => {
    if (sort === 'recent') return reviews;
    return [...reviews].sort((a, b) => (sort === 'high' ? b.rating - a.rating : a.rating - b.rating) || b.iso.localeCompare(a.iso));
  }, [reviews, sort]);

  useEffect(() => () => {
    if (anim.current) cancelAnimationFrame(anim.current);
  }, []);

  const scrollRail = (dir: 1 | -1) => {
    const el = rail.current;
    if (!el) return;
    const card = el.firstElementChild;
    const step = (card ? card.getBoundingClientRect().width + 14 : 320) * (window.matchMedia('(min-width:900px)').matches ? 2 : 1);
    const span = el.scrollWidth - el.clientWidth;
    const rtl = el.scrollLeft <= 0; // RTL browsers report 0 → -span
    const min = rtl ? -span : 0;
    const max = rtl ? 0 : span;
    const from = el.scrollLeft;
    const to = Math.max(min, Math.min(max, from + dir * step));
    if (Math.abs(to - from) < 1) return;
    if (anim.current) cancelAnimationFrame(anim.current);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      el.scrollLeft = to;
      return;
    }
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 340);
      el.scrollLeft = from + (to - from) * (1 - Math.pow(1 - p, 3));
      anim.current = p < 1 ? requestAnimationFrame(tick) : null;
    };
    anim.current = requestAnimationFrame(tick);
  };

  return (
    <>
      <div className={styles.controls}>
        <div role="group" aria-label="מיון ביקורות" className={styles.sorts}>
          {SORTS.map(([k, name]) => (
            <button key={k} type="button" className={styles.sort} aria-pressed={sort === k} onClick={() => setSort(k)}>
              {name}
            </button>
          ))}
        </div>
        <span className={styles.showing}>
          <span className="ltr">{reviews.length}</span> מתוך <span className="ltr">{total}</span>
        </span>
        {reviews.length > 1 && (
          <div role="group" aria-label="גלילת ביקורות" className={styles.arrows}>
            <button type="button" className={styles.arrow} onClick={() => scrollRail(1)} aria-label="ביקורות קודמות">
              <ChevronRight />
            </button>
            <button type="button" className={styles.arrow} onClick={() => scrollRail(-1)} aria-label="ביקורות נוספות">
              <ChevronLeft />
            </button>
          </div>
        )}
      </div>

      <div ref={rail} className={styles.rail} tabIndex={0} aria-label="ביקורות מאומתות">
        {sorted.map((r, i) => {
          const long = r.body.length > 180;
          const isOpen = !!open[r.id];
          return (
            <article key={r.id} className={styles.card} style={{ animationDelay: `${i * 60}ms` }}>
              <div className={styles.who}>
                <span aria-hidden="true" className={styles.avatar} style={{ background: AVATAR_BG[i % AVATAR_BG.length] }}>
                  {r.author.charAt(0)}
                </span>
                <span className={styles.whoText}>
                  <span className={styles.author}>{r.author}</span>
                  <span className={styles.meta}>ביקור מאומת</span>
                </span>
                <span className={styles.whoSide}>
                  <SmallStars rating={r.rating} />
                  <time dateTime={r.iso} className={styles.time}>{r.rel}</time>
                </span>
              </div>
              <h4 className={styles.title}>{r.title}</h4>
              <div className={styles.clip} style={{ maxHeight: !long || isOpen ? 2400 : 104 }} data-clipped={(long && !isOpen) || undefined}>
                <p className={styles.text}>{r.body}</p>
              </div>
              {long && (
                <button type="button" className={styles.more} aria-expanded={isOpen} onClick={() => setOpen(o => ({ ...o, [r.id]: !o[r.id] }))}>
                  {isOpen ? 'הצג פחות' : 'קראו את כל הביקורת'}
                </button>
              )}
              {r.reply && (
                <div className={styles.reply}>
                  <span className={styles.replyLabel}>תגובת העסק</span>
                  <p className={styles.replyText}>{r.reply}</p>
                </div>
              )}
              <div className={styles.foot}>
                {r.treatment && <span className={styles.tx}>{r.treatment}</span>}
                <span className={styles.source}>BeautyFind</span>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
