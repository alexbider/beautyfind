'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { readConsent } from '@/components/cookie-consent/CookieConsent';
import { shuffled, type SponsoredCardData } from '@/lib/sponsored';
import s from './SponsoredSlider.module.css';

// The sponsored slider (docs/sponsored.md). Up to 10 cards per page, each one a paid monthly placement,
// always tagged "ממומן" and kept apart from the ranked list below it.
// - The order is shuffled once per page load, so every advertiser gets the first position about equally.
// - Desktop shows three cards, phones one with the next one peeking. Native swipe and scroll snap; arrows and
//   dots on wide screens. Auto-advance every 6 seconds, paused on hover, focus, touch, when off screen, and
//   never for visitors who asked their device for reduced motion.
// - One to three cards sit as a static row (nothing to slide); none renders nothing.
// - A view is counted only when a card was at least 60% on screen, once per card per page load, and a click
//   to the profile is counted on the way there (anonymous daily counters, nothing stored on the device).
//   When the visitor accepted analytics cookies, contacts made on that profile are credited to the card.

const AUTO_MS = 6000;
const STATIC_MAX = 3;
const FROM_KEY = 'bf-sp-from';

function send(type: 'impression' | 'click', ids: string[]) {
  if (!ids.length) return;
  const body = JSON.stringify({ type, ids });
  try {
    if (navigator.sendBeacon?.('/api/sponsored/event', new Blob([body], { type: 'application/json' }))) return;
  } catch {}
  fetch('/api/sponsored/event', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
}

function rememberSource(c: SponsoredCardData) {
  try {
    if (!readConsent()?.analytics) return;
    sessionStorage.setItem(FROM_KEY, JSON.stringify({ campaignId: c.campaignId, branchId: c.branchId, at: Date.now() }));
  } catch {}
}

const STAR = 'M8 1.3l2.06 4.3 4.69.62-3.43 3.24.87 4.66L8 11.9 3.81 14.12l.87-4.66L1.25 6.22l4.69-.62z';

export interface SponsoredSliderProps {
  cards: SponsoredCardData[];
  /** The heading, e.g. "ממומן בציפורניים בתל אביב-יפו". */
  title?: string;
  /** Where the slider sits, for the accessible name and the analytics of the page. */
  context?: string;
  /** "light" on white pages, "tint" on the soft background. */
  tone?: 'light' | 'tint';
  className?: string;
}

export function SponsoredSlider({ cards: input, title = 'מקומות ממומנים', context, tone = 'light', className }: SponsoredSliderProps) {
  const uid = useId().replace(/:/g, '');
  const [cards, setCards] = useState(input);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [info, setInfo] = useState(false);
  const trackRef = useRef<HTMLUListElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const seen = useRef(new Set<string>());
  const pending = useRef<string[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visible = useRef(false);
  const reduced = useRef(false);
  const slider = cards.length > STATIC_MAX;

  // Shuffle once on the client (the server renders a stable order, the cached page stays the same for everyone).
  useEffect(() => {
    setCards(shuffled(input));
    setReady(true);
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, [input]);

  // Scroll snapping keeps the card it was snapped to in view when the order changes, which after the shuffle
  // would leave the track scrolled to the middle. Start from the first card.
  useLayoutEffect(() => {
    if (!ready) return;
    trackRef.current?.scrollTo({ left: 0, behavior: 'auto' });
    setActive(0);
  }, [ready, cards]);

  // On-screen views, at most once per card per page load, sent in small batches.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || !ready) return;
    const flush = () => {
      const ids = pending.current.splice(0);
      send('impression', ids);
    };
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.campaign;
        if (e.isIntersecting && e.intersectionRatio >= 0.6) {
          if (id && !seen.current.has(id)) {
            seen.current.add(id);
            pending.current.push(id);
            if (flushTimer.current) clearTimeout(flushTimer.current);
            flushTimer.current = setTimeout(flush, 1500);
          }
        }
      }
    }, { threshold: [0, 0.6] });
    track.querySelectorAll<HTMLElement>('[data-campaign]').forEach(el => io.observe(el));
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', onHide);
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flush();
    };
  }, [ready, cards]);

  // Whether the slider itself is on screen (auto-advance waits until it is).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const io = new IntersectionObserver(([e]) => { visible.current = e.isIntersecting; }, { threshold: 0.25 });
    io.observe(root);
    return () => io.disconnect();
  }, []);

  const goTo = useCallback((i: number, smooth = true) => {
    const track = trackRef.current;
    if (!track) return;
    const n = cards.length;
    const target = ((i % n) + n) % n;
    const el = track.querySelector<HTMLElement>(`[data-index="${target}"]`);
    if (!el) return;
    // Scroll the track only (never the page). Works in RTL: the card's start edge goes to the track's start edge.
    const trackBox = track.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const delta = box.right - trackBox.right; // RTL: start = right edge
    track.scrollBy({ left: delta, behavior: smooth && !reduced.current ? 'smooth' : 'auto' });
    setActive(target);
  }, [cards.length]);

  // Auto-advance.
  useEffect(() => {
    if (!slider || paused || !ready) return;
    const t = setInterval(() => {
      if (reduced.current || !visible.current || document.visibilityState !== 'visible') return;
      const track = trackRef.current;
      if (!track) return;
      const atEnd = isAtEnd(track);
      goTo(atEnd ? 0 : firstVisible(track) + 1);
    }, AUTO_MS);
    return () => clearInterval(t);
  }, [slider, paused, ready, goTo]);

  // The "what is sponsored" popover closes on outside click and Escape.
  useEffect(() => {
    if (!info) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.querySelector(`#${uid}-info`)?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.(`[data-info-btn="${uid}"]`)) setInfo(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setInfo(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [info, uid]);

  // The active dot follows the swipe.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || !slider) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setActive(firstVisible(track)));
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => { track.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, [slider, ready]);

  const dots = useMemo(() => cards.map((c, i) => ({ id: c.campaignId, i })), [cards]);

  if (!input.length) return null;

  return (
    <section
      ref={rootRef}
      className={`${s.root} ${tone === 'tint' ? s.tint : ''} ${className ?? ''}`}
      aria-roledescription="carousel"
      aria-label={context ? `${title} · ${context}` : title}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      data-ready={ready || undefined}
    >
      <div className={s.head}>
        <div className={s.titleWrap}>
          <span className={s.badge}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d={STAR} /></svg>
            ממומן
          </span>
          <h2 className={s.title}>{title}</h2>
          <span className={s.infoWrap}>
            <button type="button" className={s.infoBtn} data-info-btn={uid} aria-expanded={info} aria-controls={`${uid}-info`} onClick={() => setInfo(v => !v)}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="8" cy="8" r="6.5" /><path d="M8 7v4M8 5h.01" strokeLinecap="round" /></svg>
              מה זה?
            </button>
            {info && (
              <span id={`${uid}-info`} role="dialog" aria-label="מה זה ממומן" className={s.pop}>
                <span className={s.popTitle}>מה זה ממומן?</span>
                <span className={s.popText}>עסקים יכולים לשלם כדי להופיע בסליידר הזה, וכל כרטיס בו מסומן ״ממומן״. התשלום לא משנה את הדירוג, את הביקורות או את האימות, והרשימה שמתחת מסודרת בלי קשר אליו. הסדר בסליידר מתחלף בכל כניסה.</span>
                <Link href="/listing-standards/sponsorship" className={s.popLink}>מדיניות הפרסום</Link>
              </span>
            )}
          </span>
        </div>
        {slider && (
          <div className={s.nav}>
            <button type="button" className={s.arrow} aria-label="הקודם" aria-controls={`${uid}-track`} onClick={() => goTo(active - 1)}>
              <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 7h10M8 3l4 4-4 4" /></svg>
            </button>
            <button type="button" className={s.arrow} aria-label="הבא" aria-controls={`${uid}-track`} onClick={() => goTo(active + 1)}>
              <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 7H2M6 3 2 7l4 4" /></svg>
            </button>
          </div>
        )}
      </div>

      <ul id={`${uid}-track`} ref={trackRef} className={`${s.track} ${slider ? "" : s.static}`} data-count={Math.min(cards.length, STATIC_MAX)}>
        {cards.map((c, i) => (
          <li key={c.campaignId} className={s.slot} data-campaign={c.campaignId} data-index={i} aria-roledescription="slide" aria-label={`${i + 1} מתוך ${cards.length}`}>
            <SponsoredCard c={c} onOpen={() => { send('click', [c.campaignId]); rememberSource(c); }} />
          </li>
        ))}
      </ul>

      {slider && (
        <div className={s.dots} role="tablist" aria-label="בחירת כרטיס">
          {dots.map(d => (
            <button key={d.id} type="button" role="tab" aria-selected={d.i === active} aria-label={`כרטיס ${d.i + 1}`} className={s.dot} onClick={() => goTo(d.i)} />
          ))}
        </div>
      )}
    </section>
  );
}

function firstVisible(track: HTMLElement): number {
  const tb = track.getBoundingClientRect();
  let best = 0;
  let bestGap = Infinity;
  track.querySelectorAll<HTMLElement>('[data-index]').forEach(el => {
    const gap = Math.abs(el.getBoundingClientRect().right - tb.right);
    if (gap < bestGap) { bestGap = gap; best = Number(el.dataset.index); }
  });
  return best;
}

function isAtEnd(track: HTMLElement): boolean {
  // RTL scrollLeft runs from 0 to -(scrollWidth - clientWidth).
  return Math.abs(track.scrollLeft) + track.clientWidth >= track.scrollWidth - 4;
}

export function SponsoredCard({ c, onOpen }: { c: SponsoredCardData; onOpen: () => void }) {
  const meta = [c.categoryName, c.cityName].filter(Boolean).join(' · ');
  return (
    <article className={s.card}>
      <Link href={c.href} className={s.cover} onClick={onOpen} tabIndex={-1} aria-hidden="true">
        {c.coverUrl ? (
          <img src={c.coverUrl} alt="" width={640} height={420} loading="lazy" decoding="async" />
        ) : (
          <span className={s.coverEmpty}>
            <span className={s.monogram}>{c.name.trim().charAt(0)}</span>
          </span>
        )}
        <span className={s.shade} />
        <span className={s.tag}>ממומן</span>
        {c.featured && <span className={s.featured}>{c.featured}</span>}
      </Link>
      <div className={s.body}>
        <div className={s.nameRow}>
          <h3 className={s.name}>
            <Link href={c.href} onClick={onOpen}>{c.name}</Link>
          </h3>
          {c.verified && (
            <span className={s.verified} title="הבעלות על העסק אומתה">
              <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 7.5 2.5 2.5L11 4.5" /></svg>
              מאומת
            </span>
          )}
        </div>
        {meta && <p className={s.meta}>{meta}</p>}
        <p className={s.line}>{c.line}</p>
        <div className={s.foot}>
          <span className={s.ratings}>
            {c.google && (
              <span className={s.rating} role="img" aria-label={`דירוג בגוגל ${c.google.rating.toFixed(1)} מתוך 5, ${c.google.count} ביקורות`}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="#FBBC04" aria-hidden="true"><path d={STAR} /></svg>
                <span className="ltr" aria-hidden="true">{c.google.rating.toFixed(1)}</span>
                <span className={s.src} aria-hidden="true">Google</span>
              </span>
            )}
            {c.beautyfind && (
              <span className={s.rating} role="img" aria-label={`ביקורות BeautyFind מאומתות: ${c.beautyfind.rating.toFixed(1)} מתוך 5`}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="#14B3C6" aria-hidden="true"><path d={STAR} /></svg>
                <span className="ltr" aria-hidden="true">{c.beautyfind.rating.toFixed(1)}</span>
                <span className={s.src} aria-hidden="true">BeautyFind</span>
              </span>
            )}
          </span>
          <Link href={c.href} className={s.cta} onClick={onOpen} aria-label={`לפרופיל של ${c.name}`}>
            לפרופיל
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 7H2M6 3 2 7l4 4" /></svg>
          </Link>
        </div>
      </div>
    </article>
  );
}
