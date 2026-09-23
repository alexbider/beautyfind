'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ListingCard } from '@/lib/server/public';
import { REGIONS } from '@/lib/catalog';
import { nis } from '@/lib/format';
import { ArrowBack, ArrowForward, Check } from '../icons';
import { SaveHeart } from '../save-heart/SaveHeart';
import { CardActions, CompactRating } from '../search/PhoneCard';
import { CATEGORY_IMAGE } from './content';
import { useRegion, type RegionChoice } from './regionStore';
import styles from './ClinicRail.module.css';

// "מכוני יופי באזור שלכם" carousel. One tab per region plus כל הארץ; the header region picker
// and the hero chips move the tab. Cards come from listBranches (live listings only).
// TODO(sponsored): no campaigns table yet, so no card carries the ממומן tag and no ad disclosure
// is shown here. When campaigns land, max 2 sponsored per list, tagged on the image.

const TABS: Array<{ slug: RegionChoice; name: string }> = [{ slug: 'all', name: 'כל הארץ' }, ...REGIONS];
const STAR = 'M8 1.3l2.06 4.3 4.69.62-3.43 3.24.87 4.66L8 11.9 3.81 14.12l.87-4.66L1.25 6.22l4.69-.62z';

function StarRow({ rating }: { rating: number }) {
  const pct = `${Math.round((rating / 5) * 100)}%`;
  const row = (fill: string) => (
    <svg width="85" height="16" viewBox="0 0 85 16" fill={fill} aria-hidden="true" style={{ display: 'block', maxWidth: 'none' }}>
      {[0, 17, 34, 51, 68].map(x => <path key={x} transform={x ? `translate(${x},0)` : undefined} d={STAR} />)}
    </svg>
  );
  return (
    <span dir="ltr" className={styles.stars} aria-hidden="true">
      {row('#DADCE0')}
      <span className={styles.starsOn} style={{ width: pct }}>{row('#FBBC04')}</span>
    </span>
  );
}

type Contact = { whatsapp: string | null; phone: string | null };

function Card({ c, index, contact }: { c: ListingCard; index: number; contact?: Contact }) {
  const cover = c.coverUrl ?? CATEGORY_IMAGE[c.categories[0]?.slug ?? ''] ?? '/assets/biz-facial.jpg';
  const g = c.google;
  const bf = c.beautyfind;
  return (
    <article className={styles.card} style={{ animationDelay: `${index * 60}ms` }}>
      <div className={styles.media}>
        <Link href={c.href} tabIndex={-1} aria-hidden="true" className={styles.mediaLink}>
          <Image
            src={cover}
            alt=""
            fill
            sizes="(min-width: 1024px) 270px, (min-width: 760px) 38vw, 78vw"
            className={styles.img}
          />
        </Link>
        <SaveHeart id={c.id} name={c.name} className={styles.heart} />
      </div>
      <div className={styles.body}>
        <div>
          <div className={styles.nameRow}>
            <h3 className={styles.name}>
              <Link href={c.href} className={styles.nameLink}>{c.name}</Link>
            </h3>
            <CompactRating google={g} beautyfind={bf} className="bf-shell-only" />
          </div>
          <p className={`${styles.phoneMeta} bf-shell-only`}>{[c.categories[0]?.name, c.cityName].filter(Boolean).join(' · ')}</p>
          <div className={styles.place}>
            {c.cityName}, אזור {REGIONS.find(r => r.slug === c.regionSlug)?.name}
            {c.verified && (
              <span className={styles.verified}>
                <Check size={11} />
                מאומת
              </span>
            )}
          </div>
          {/* Google and BeautyFind ratings side by side, never merged (decision A4). */}
          <div className={styles.ratings}>
            {g && g.count > 0 && (
              <span className={styles.rating} role="img" aria-label={`דירוג גוגל ${g.rating} מתוך 5, ${g.count} חוות דעת`}>
                <StarRow rating={g.rating} />
                <span className={`${styles.score} ltr`}>{g.rating.toFixed(1)}</span>
                <span className={`${styles.count} ltr`}>({g.count})</span>
                <span className={styles.src}>Google</span>
              </span>
            )}
            {bf && bf.count > 0 && (
              <span className={styles.rating} role="img" aria-label={`דירוג BeautyFind ${bf.rating} מתוך 5, ${bf.count} חוות דעת מאומתות`}>
                <span className={styles.bfMark} aria-hidden="true">★</span>
                <span className={`${styles.score} ltr`}>{bf.rating.toFixed(1)}</span>
                <span className={`${styles.count} ltr`}>({bf.count})</span>
                <span className={styles.src}>BeautyFind</span>
              </span>
            )}
            {!(g && g.count > 0) && !(bf && bf.count > 0) && <span className={styles.noReview}>אין עדיין חוות דעת</span>}
          </div>
        </div>
        <div className={styles.tags}>
          {c.categories.slice(0, 2).map(t => (
            <span key={t.slug} className={styles.tag}>{t.name}</span>
          ))}
        </div>
        <div className={styles.foot}>
          {c.priceFromShekels != null ? (
            <span className={styles.price}>
              החל מ־<span className="ltr">{nis(c.priceFromShekels)}</span>
              <span className={styles.vat}>לא כולל מע״מ</span>
            </span>
          ) : (
            <span />
          )}
          <Link href={c.href} className={`${styles.go} bf-desk-only`} aria-label={`לצפייה בעסק ${c.name}`}>
            <span>לעסק</span>
            <ArrowForward size={14} />
          </Link>
        </div>
        <CardActions branchId={c.id} name={c.name} href={c.href} whatsapp={contact?.whatsapp} phone={contact?.phone} className="bf-shell-only" />
      </div>
    </article>
  );
}

export function ClinicRail({
  heading,
  lists,
  totals,
  contacts = {},
}: {
  heading: ReactNode;
  lists: Record<RegionChoice, ListingCard[]>;
  totals: Record<RegionChoice, number>;
  contacts?: Record<string, Contact>;
}) {
  const [region] = useRegion();
  const [tab, setTab] = useState<RegionChoice>('all');
  const [progress, setProgress] = useState(0);
  const railRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // The region picker drives the tab; tabs can still be browsed on their own.
  useEffect(() => {
    setTab(region);
  }, [region]);

  useEffect(() => {
    const el = railRef.current;
    if (el) el.scrollTo({ left: 0 });
    setProgress(0);
  }, [tab]);

  const onScroll = () => {
    const el = railRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setProgress(max > 0 ? Math.round((Math.abs(el.scrollLeft) / max) * 100) : 0);
  };

  // dir: 1 = forward (leftwards in RTL). Steps one card, two from 1000px (design).
  const scrollBy = (dir: 1 | -1) => {
    const el = railRef.current;
    const card = el?.firstElementChild as HTMLElement | null;
    if (!el || !card) return;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 20;
    const step = (card.offsetWidth + gap) * (window.matchMedia('(min-width: 1024px)').matches ? 2 : 1);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: -dir * step, behavior: reduce ? 'auto' : 'smooth' });
  };

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    // RTL: ArrowLeft moves to the next tab.
    const d = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : d ? (i + d + TABS.length) % TABS.length : -1;
    if (to < 0) return;
    e.preventDefault();
    setTab(TABS[to].slug);
    tabRefs.current[to]?.focus();
  };

  const items = lists[tab] ?? [];
  const current = TABS.find(t => t.slug === tab)!;
  const allHref = tab === 'all' ? '/search' : `/${tab}`;

  return (
    <>
      <div className={styles.head}>
        {heading}
        <div className={`${styles.arrows} bf-desk-only`}>
          <button type="button" className={styles.arrow} aria-label="גלילה אחורה" aria-controls="clinic-panel" onClick={() => scrollBy(-1)} disabled={items.length < 2}>
            <ArrowBack size={16} />
          </button>
          <button type="button" className={styles.arrow} aria-label="גלילה קדימה" aria-controls="clinic-panel" onClick={() => scrollBy(1)} disabled={items.length < 2}>
            <ArrowForward size={16} />
          </button>
        </div>
      </div>
      <div className={styles.bar}>
        <div role="tablist" aria-label="אזור" className={styles.tabs}>
          {TABS.map((t, i) => {
            const on = t.slug === tab;
            return (
              <button
                key={t.slug}
                ref={el => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`clinic-tab-${t.slug}`}
                aria-selected={on}
                aria-controls="clinic-panel"
                tabIndex={on ? 0 : -1}
                className={styles.tab}
                data-on={on || undefined}
                onClick={() => setTab(t.slug)}
                onKeyDown={e => onTabKey(e, i)}
              >
                {t.name}
              </button>
            );
          })}
        </div>
        <Link href={allHref} className={styles.all}>
          <span>
            {tab === 'all' ? 'כל העסקים באינדקס' : `כל העסקים ב${current.name}`} (<span className="ltr">{totals[tab] ?? 0}</span>)
          </span>
          <ArrowForward size={14} />
        </Link>
      </div>

      <div className={styles.railWrap}>
        <span className={styles.fade} aria-hidden="true" />
        <div
          ref={railRef}
          id="clinic-panel"
          role="tabpanel"
          aria-labelledby={`clinic-tab-${tab}`}
          className={styles.rail}
          onScroll={onScroll}
          key={tab}
        >
          {items.map((c, i) => (
            <Card key={c.id} c={c} index={i} contact={contacts[c.id]} />
          ))}
          {items.length === 0 && (
            <div className={styles.empty}>
              <strong>עדיין אין עסקים מפורסמים באזור {current.name}.</strong>
              <span>עסקים חדשים מצטרפים לאינדקס כל הזמן. בינתיים אפשר לעיין באזורים הסמוכים, או לרשום את העסק שלכם.</span>
              <Link href="/for-business" className={styles.emptyLink}>
                לרישום עסק
                <ArrowForward size={14} />
              </Link>
            </div>
          )}
        </div>
      </div>

      <div className={styles.controls}>
        <div className={styles.progress} aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>
    </>
  );
}
