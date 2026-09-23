'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { RegionSlug } from '@/lib/catalog';
import { PLAN_MONTHLY_NIS } from '@/lib/pricing';
import { ROUTES } from '@/lib/routes';
import { SaveHeart } from '../../save-heart/SaveHeart';
import { ARTICLES } from '../content';
import {
  Arrow, FALLBACK_REGION, FAQS, Glass, ListingSteps, Pin, QUICK, READ_TIME, REGION_ORDER, Rings, STAR_PATH, TRUST,
  TRUST_STRIP, WhatsApp, nearestRegion, rName, type PhoneCard, type PhoneReview,
} from '../phone/PhoneHome';
import { setRegion as storeRegion, useRegion } from '../regionStore';
import s from './DeskHome.module.css';

// Desktop homepage body (outside the app shell). Design: BeautyFind_Homepage_Desktop_new.html.
// The site header and footer stay as they are (HomeHeader, HomeFooter on the page).
// Cards, reviews and counts are live data from the page. Ratings stay split into BeautyFind and
// Google (decision A4), so the design's merged score is shown as two separate figures.
// TODO(people): the design's medical board and guide reviewers use placeholder names, so the
// board card links to the editorial policy until real reviewers are named.

export interface DeskHomeProps {
  lists: Record<RegionSlug, PhoneCard[]>;
  regionCounts: Record<RegionSlug, number>;
  reviews: PhoneReview[];
  regionCities: Record<RegionSlug, Array<{ name: string; href: string }>>;
}

const CATS = [
  { label: 'אסתטיקה רפואית', slug: 'medical-aesthetics', img: '/assets/biz-medical.jpg', wide: true },
  { label: 'קוסמטיקה וטיפולי פנים', slug: 'facials', img: '/assets/biz-facial.jpg' },
  { label: 'הסרת שיער', slug: 'hair-removal', img: '/assets/biz-laser.jpg' },
  { label: 'מספרות ועיצוב שיער', slug: 'hair-salons', img: '/assets/biz-hair.jpg' },
  { label: 'ציפורניים', slug: 'nails', img: '/assets/biz-nails.jpg' },
  { label: 'גבות וריסים', slug: 'brows-lashes', img: '/assets/cat-lashes.jpg' },
  { label: 'ספא ועיסויים', slug: 'spa-massage', img: '/assets/biz-spa.jpg' },
];
const MORE_CATS = [
  { label: 'כירורגיה פלסטית', slug: 'plastic-surgery', img: '/assets/cat-plastic.jpg' },
  { label: 'השתלות שיער', slug: 'hair-restoration', img: '/assets/cat-hairrest.jpg' },
  { label: 'אסתטיקה דנטלית', slug: 'dental-aesthetics', img: '/assets/cat-dental.jpg' },
  { label: 'איפור מקצועי', slug: 'makeup', img: '/assets/cat-makeup.jpg' },
  { label: 'איפור קבוע', slug: 'permanent-makeup', img: '/assets/cat-pmu.jpg' },
  { label: 'עיצוב וחיטוב הגוף', slug: 'body-contouring', img: '/assets/cat-body.jpg' },
];
const TRUST_SUB = ['רופא, אחות או תעודת קוסמטיקאית', 'Google ו־BeautyFind בנפרד, בלי ממוצע', 'תשלום לא משפיע על הדירוג'];
const REGION_CARDS: RegionSlug[] = ['dan', 'north', 'haifa', 'sharon', 'jerusalem', 'shfela', 'south'];
const HAND = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0B7A87" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 11.5V5.5a1.5 1.5 0 0 1 3 0v5" /><path d="M12 10V4.5a1.5 1.5 0 0 1 3 0V10" />
    <path d="M15 10V6.5a1.5 1.5 0 0 1 3 0v6.5a7 7 0 0 1-7 7h-.6a6 6 0 0 1-4.7-2.3L3.4 14.8a1.6 1.6 0 0 1 2.4-2.1L9 15.5" />
  </svg>
);

const Kicker = ({ children, tone }: { children: ReactNode; tone?: 'teal' }) => (
  <div className={s.kicker} data-tone={tone}><span className={s.kickerLine} aria-hidden="true" />{children}</div>
);
const Dot = () => <span className={s.dot}>.</span>;

function Stars({ rating, size = 16 }: { rating: number; size?: number }) {
  return (
    <span dir="ltr" className={s.stars} aria-hidden="true">
      {[0, 1, 2, 3, 4].map(k => (
        <span key={k} className={s.star} style={{ width: size, height: size }}>
          <svg width={size} height={size} viewBox="0 0 24 24" fill="#DADCE0"><path d={STAR_PATH} /></svg>
          <span className={s.starOn} style={{ width: `${Math.max(0, Math.min(1, rating - k)) * 100}%` }}>
            <svg width={size} height={size} viewBox="0 0 24 24" fill="#FBBC04"><path d={STAR_PATH} /></svg>
          </span>
        </span>
      ))}
    </span>
  );
}

function BizCard({ c, last }: { c: PhoneCard; last: boolean }) {
  const bf = c.bf && c.bf.count > 0 ? c.bf : null;
  const g = c.g && c.g.count > 0 ? c.g : null;
  return (
    <article className={s.card} style={{ scrollSnapAlign: last ? 'end' : 'start' }}>
      <div className={s.cardMedia}>
        <Link href={c.href} tabIndex={-1} aria-hidden="true" className={s.fill} draggable={false}>
          <Image src={c.img} alt="" fill sizes="(min-width: 1280px) 340px, 30vw" className={s.cover} draggable={false} />
        </Link>
        {c.verified && (
          <span className={s.verifiedBadge}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 1.5 2.5 3.3v3.4c0 2.8 2 4.8 4.5 5.8 2.5-1 4.5-3 4.5-5.8V3.3L7 1.5Z" /><path d="m5 7 1.5 1.5L9.3 5.6" /></svg>
            עסק מאומת
          </span>
        )}
        <SaveHeart id={c.id} name={c.name} className={s.heart} />
      </div>
      <div className={s.cardBody}>
        <div className={s.cardTop}>
          <span className={s.teal}>{c.tag}</span>
          {c.openNow && <span className={s.open}><span className={s.openDot} aria-hidden="true" />פתוח עכשיו</span>}
        </div>
        <h3 className={s.cardName}><Link href={c.href} draggable={false}>{c.name}</Link></h3>
        <div className={s.cardCity}>{c.city}</div>
        <div className={s.cardRatings}>
          {bf && (
            <span className={s.rating} role="img" aria-label={`דירוג BeautyFind ${bf.rating.toFixed(1)} מתוך 5, ${bf.count} ביקורות`}>
              <strong dir="ltr">{bf.rating.toFixed(1)}</strong><Stars rating={bf.rating} size={14} /><span dir="ltr" className={s.iso}>({bf.count})</span>
              <span className={s.src}>BeautyFind</span>
            </span>
          )}
          {g && (
            <span className={s.rating} role="img" aria-label={`דירוג Google ${g.rating.toFixed(1)} מתוך 5, ${g.count} ביקורות`}>
              <strong dir="ltr">{g.rating.toFixed(1)}</strong>{!bf && <Stars rating={g.rating} size={14} />}<span dir="ltr" className={s.iso}>({g.count})</span>
              <span className={s.src}>Google</span>
            </span>
          )}
          {!bf && !g && <span>אין עדיין חוות דעת</span>}
        </div>
        {c.from != null && (
          <div className={s.cardPrice}>החל מ־<strong dir="ltr" className={s.iso}>₪{Math.round(c.from)}</strong><span className={s.vat}>לא כולל מע״מ</span></div>
        )}
        <div className={s.cardActions} data-n={1 + (c.whatsapp ? 1 : 0) + (c.phone ? 1 : 0)}>
          <Link href={c.href} className={s.cardCta} draggable={false}>לפרופיל העסק<Arrow width={1.7} /></Link>
          {c.whatsapp && (
            <a href={`https://wa.me/${c.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" aria-label={`וואטסאפ ל${c.name}`} className={s.cardWa} draggable={false}><WhatsApp /></a>
          )}
          {c.phone && (
            <a href={`tel:${c.phone}`} aria-label={`חיוג ל${c.name}`} className={s.cardTel} draggable={false}>
              <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><path d="M4 2.5h2.5l1.2 3.2-1.6 1a8 8 0 0 0 5.2 5.2l1-1.6 3.2 1.2V14a1.5 1.5 0 0 1-1.6 1.5A12.5 12.5 0 0 1 2.5 4.1 1.5 1.5 0 0 1 4 2.5Z" /></svg>
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

/** Region carousel: mouse drag with snap back, edge fade and a progress rail (design "Featured"). */
function Carousel({ cards, region }: { cards: PhoneCard[]; region: RegionSlug }) {
  const track = useRef<HTMLDivElement>(null);
  const [p, setP] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [perView, setPerView] = useState(3.5);

  const update = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const v = max > 0 ? Math.abs(el.scrollLeft) / max : 0;
    setP(v > 0.995 ? 1 : v);
    const card = el.querySelector('article');
    if (card) setPerView(el.clientWidth / (card.getBoundingClientRect().width + 14));
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    el.scrollTo({ left: 0 });
    update();
  }, [region, update]);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let sx = 0, sl = 0, moved = false, id: number | null = null;
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      id = e.pointerId; sx = e.clientX; sl = el.scrollLeft; moved = false;
    };
    const move = (e: PointerEvent) => {
      if (id !== e.pointerId) return;
      const dx = e.clientX - sx;
      if (!moved && Math.abs(dx) > 5) { moved = true; setDragging(true); }
      if (moved) el.scrollLeft = sl - dx;
    };
    const end = (e: PointerEvent) => {
      if (id !== e.pointerId) return;
      id = null;
      if (!moved) return;
      setDragging(false);
      const card = el.querySelector('article');
      if (!card) return;
      const w = card.getBoundingClientRect().width + 14;
      const max = el.scrollWidth - el.clientWidth;
      const tgt = Math.round(el.scrollLeft / w) * w;
      el.scrollTo({ left: Math.abs(tgt) > max - w / 2 ? -max : tgt, behavior: 'smooth' });
    };
    const click = (e: MouseEvent) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } };
    const onScroll = () => requestAnimationFrame(update);
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    el.addEventListener('click', click, true);
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      el.removeEventListener('click', click, true);
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', update);
    };
  }, [update]);

  // RTL: the start edge is on the right, so the right fade appears once scrolled and the left one fades out at the end.
  const l = Math.min(1, (1 - p) / 0.15), r = Math.min(1, p / 0.15);
  const mask = cards.length > perView
    ? `linear-gradient(to right,rgba(0,0,0,${(1 - l).toFixed(2)}) 0,#000 10%,#000 90%,rgba(0,0,0,${(1 - r).toFixed(2)}) 100%)`
    : 'none';
  const bar = Math.min(100, (100 * perView) / Math.max(perView, cards.length));

  return (
    <>
      <div className={s.trackWrap}>
        <div
          ref={track}
          id="rail-d"
          role="tabpanel"
          aria-label={`עסקים ב${rName(region)}`}
          className={s.track}
          data-dragging={dragging || undefined}
          style={{ WebkitMaskImage: mask, maskImage: mask }}
        >
          {cards.map((c, i) => <BizCard key={c.id} c={c} last={i === cards.length - 1} />)}
          {cards.length === 0 && (
            <div className={s.railEmpty}>
              <strong>עדיין אין עסקים באינדקס ב{rName(region)}.</strong>
              <span>בקרוב יתווספו כאן מכונים. בינתיים אפשר לחפש בכל הארץ.</span>
              <Link href={ROUTES.search} className={s.textLink}>לחיפוש בכל הארץ<Arrow width={1.7} /></Link>
            </div>
          )}
        </div>
      </div>
      <div className={s.railFoot}>
        <div className={s.progress} aria-hidden="true">
          <span style={{ width: `${bar.toFixed(1)}%`, marginRight: `${(p * (100 - bar)).toFixed(1)}%` }} />
        </div>
        <Link href={`/${region}`} className={s.textLink}>כל העסקים ב{rName(region)}<Arrow width={1.7} /></Link>
      </div>
    </>
  );
}

export function DeskHome({ lists, regionCounts, reviews, regionCities }: DeskHomeProps) {
  const router = useRouter();
  const [stored, setStored] = useRegion();
  const region: RegionSlug = stored === 'all' ? FALLBACK_REGION : stored;
  const [q, setQ] = useState('');
  const [located, setLocated] = useState<RegionSlug | null>(null);
  const [locating, setLocating] = useState(false);
  const [adInfo, setAdInfo] = useState(false);
  const [faq, setFaq] = useState(0);
  const adRef = useRef<HTMLSpanElement>(null);

  // The ad popover closes on outside click and Escape.
  useEffect(() => {
    if (!adInfo) return;
    const onDown = (e: MouseEvent) => { if (!adRef.current?.contains(e.target as Node)) setAdInfo(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAdInfo(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [adInfo]);

  const locate = () => {
    if (!('geolocation' in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => { const r = nearestRegion(pos.coords.latitude, pos.coords.longitude); setLocating(false); setLocated(r); storeRegion(r); },
      () => setLocating(false),
      { maximumAge: 600_000, timeout: 8000 },
    );
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (located) params.set('region', located);
    const qs = params.toString();
    router.push(qs ? `${ROUTES.search}?${qs}` : ROUTES.search);
  };

  const cards = lists[region] ?? [];
  const lead = ARTICLES[0];

  return (
    <div className={s.root}>
      {/* ---------- Hero ---------- */}
      <section className={s.hero} aria-labelledby="hero-h1">
        <Image src="/assets/hero-facial.jpg" alt="טיפול פנים במכון קוסמטיקה" fill loading="eager" fetchPriority="high" sizes="(max-width: 767px) 1px, 100vw" className={s.heroImg} />
        <div className={s.heroWash1} />
        <div className={s.heroWash2} />
        <Rings size={300} className={s.ringsA} />
        <Rings size={180} className={s.ringsB} />
        <div className={s.heroInner}>
          <div className={s.heroCopy}>
            <Kicker>אינדקס היופי והאסתטיקה של ישראל</Kicker>
            <h1 id="hero-h1" className={s.h1}>מצאו את מיטב<br /><span className={s.nowrap}>מכוני היופי שלידכם<Dot /></span></h1>
            <p className={s.lede}>אסתטיקה רפואית, קוסמטיקה, מספרות, ספא ועיצוב הגוף, מקריית שמונה ועד אילת. השוו בין עסקים וקבעו את הפגישה הבאה.</p>
          </div>
          <form role="search" className={s.search} onSubmit={submit}>
            <label className={s.field}>
              <span className={s.fieldIcon}><Glass size={18} /></span>
              <span className={s.fieldCol}>
                <span className={s.fieldLabel}>מה מחפשים?</span>
                <input id="bf-q" name="q" value={q} onChange={e => setQ(e.target.value)} placeholder="טיפול או שם עסק" autoComplete="off" className={s.input} />
              </span>
            </label>
            <button id="bf-loc" type="button" className={`${s.field} ${s.fieldLoc}`} onClick={locate} aria-busy={locating || undefined}>
              <span className={s.fieldIcon}><Pin size={18} width={1.5} /></span>
              <span className={s.fieldCol}>
                <span className={s.fieldLabel}>איפה?</span>
                <span className={s.locValue} data-set={located ? '' : undefined}>
                  {locating ? 'מאתרים את המיקום...' : located ? `המיקום שלך, ${rName(located)}` : 'עיר או אזור'}
                </span>
              </span>
            </button>
            <button type="submit" className={s.go}>
              <span aria-hidden="true" className={s.sheen} />
              <span className={s.rel}>חיפוש עסקים</span>
              <Arrow width={1.8} className={s.nudge} />
            </button>
          </form>
          <div className={s.quick}>
            <span className={s.quickLabel}>מבוקשים:</span>
            {QUICK.map(t => <Link key={t} href={`${ROUTES.search}?q=${encodeURIComponent(t)}`} className={s.quickChip}>{t}</Link>)}
          </div>
        </div>
      </section>

      {/* ---------- Trust strip ---------- */}
      <section aria-label="למה אפשר לסמוך" className={`${s.wrap} ${s.trustWrap}`}>
        <div className={s.trustStrip}>
          {TRUST_STRIP.map((t, i) => (
            <Link key={t.title} href={ROUTES.listingStandards} className={s.trustItem}>
              <span className={s.trustIcon}><svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={t.d} /></svg></span>
              <span className={s.trustText}><span className={s.trustTitle}>{t.title}</span><span className={s.trustSub}>{TRUST_SUB[i]}</span></span>
            </Link>
          ))}
        </div>
      </section>

      {/* ---------- Categories ---------- */}
      <section aria-labelledby="h-cats" className={`${s.wrap} ${s.pt88}`}>
        <div className={s.head}>
          <div>
            <Kicker>תחומי טיפול</Kicker>
            <div className={s.titleRow}>
              <h2 id="h-cats" className={s.h2}>מה מחפשים היום<Dot /></h2>
              <span aria-hidden="true" className={s.tapHint}>
                <span className={s.tapIcon}><span className={s.tapRing} /><span className={s.tapHand}>{HAND}</span></span>
                בחרו טיפול
              </span>
            </div>
          </div>
          <Link href={ROUTES.treatments} className={s.headLink}>לעמוד תחומי הטיפול<Arrow width={1.7} /></Link>
        </div>
        <div className={s.bento}>
          {CATS.map(c => (
            <Link key={c.slug} href={`/treatments/${c.slug}`} className={s.tile} data-wide={c.wide || undefined}>
              <Image src={c.img} alt={c.label} fill sizes={c.wide ? '(min-width: 1280px) 610px, 50vw' : '(min-width: 1280px) 300px, 25vw'} className={s.cover} />
              <span className={s.tileLabel}>{c.label}<Arrow size={12} stroke="#0B7A87" width={1.8} /></span>
            </Link>
          ))}
        </div>
        <div className={s.moreCats}>
          {MORE_CATS.map(c => (
            <Link key={c.slug} href={`/treatments/${c.slug}`} className={s.moreCat}>
              <span className={s.moreImg}><Image src={c.img} alt="" fill sizes="200px" className={s.cover} /></span>
              <span className={s.moreRow}><span className={s.moreName}>{c.label}</span><Arrow size={12} stroke="#0B7A87" width={1.8} /></span>
            </Link>
          ))}
        </div>
      </section>

      {/* ---------- Businesses by region ---------- */}
      <section aria-labelledby="h-clinics" className={s.pt88}>
        <div className={s.wrap}>
          <Kicker>מכונים לפי אזור</Kicker>
          <div className={s.titleRow}>
            <h2 id="h-clinics" className={s.h2}>מכוני יופי באזור שלכם<Dot /></h2>
            <span ref={adRef} className={s.adWrap}>
              <button type="button" onClick={() => setAdInfo(v => !v)} aria-expanded={adInfo} aria-controls="ad-info" className={s.adBtn}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="8" cy="8" r="6.5" /><path d="M8 7v4M8 5h.01" strokeLinecap="round" /></svg>
                ממומן
              </button>
              {adInfo && (
                <span id="ad-info" role="dialog" aria-label="מה זה ממומן" className={s.adPop}>
                  <span className={s.adPopHead}>
                    מה זה ממומן?
                    <button type="button" onClick={() => setAdInfo(false)} aria-label="סגירה" className={s.adClose}>
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="#0C243E" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></svg>
                    </button>
                  </span>
                  <span className={s.adPopText}>עסקים יכולים לשלם על קידום באזור ובתחום הטיפול. עסק מקודם מסומן תמיד בתג ״ממומן״, והקידום משפיע רק על ההופעה ברשימה, לא על הדירוג, על הביקורות או על אימות העסק. מוצגים לכל היותר שני עסקים ממומנים בכל רשימה.</span>
                  <Link href={`${ROUTES.methodology}#ranking`} className={s.textLink}>איך מדרגים<Arrow width={1.7} /></Link>
                </span>
              )}
            </span>
          </div>
          <div className={s.tabsRow}>
            <div role="tablist" aria-label="אזורים" className={s.tabs}>
              {REGION_ORDER.map(r => (
                <button key={r} type="button" role="tab" aria-selected={r === region} aria-controls="rail-d" onClick={() => setStored(r)} className={s.tab}>
                  {rName(r)}<span dir="ltr" className={s.tabCount}>{regionCounts[r] ?? 0}</span>
                </button>
              ))}
            </div>
            {cards.length > 3 && (
              <div aria-hidden="true" className={s.dragHint}>
                <span className={s.dragHand}><span className={s.swipe}>{HAND}</span></span>
                גררו לצפייה בעוד
              </div>
            )}
          </div>
          <Carousel cards={cards} region={region} />
        </div>
      </section>

      {/* ---------- Reviews (only when there are published reviews) ---------- */}
      {reviews.length > 0 && (
        <section aria-labelledby="h-rev" className={`${s.wrap} ${s.pt88}`}>
          <div className={s.headGrid}>
            <div>
              <Kicker>ביקורות מאומתות</Kicker>
              <h2 id="h-rev" className={`${s.h2} ${s.mt10}`}>מה מספרות מי שהגיעו<Dot /></h2>
              <p className={s.lead62}>רק מי שקבעה תור דרך BeautyFind והגיעה אליו יכולה לכתוב ביקורת. לא עורכים, לא מוחקים ביקורות שליליות.</p>
            </div>
            <Link href={`${ROUTES.terms}#reviews`} className={s.headLink}>מדיניות הביקורות<Arrow width={1.7} /></Link>
          </div>
          <div className={s.reviews}>
            {reviews.slice(0, 3).map((r, i) => (
              <article key={r.id} className={s.review}>
                <div className={s.revHead}>
                  <span className={s.avatar} style={{ background: ['#0B7A87', '#0C243E', '#14B3C6'][i % 3] }} aria-hidden="true">{r.initial}</span>
                  <span className={s.revWho}><span className={s.revName}>{r.name}</span><span className={s.revMeta}>{[r.treat, r.biz].filter(Boolean).join(' · ')}</span></span>
                </div>
                <div className={s.revStars}>
                  <span role="img" aria-label={`דירוג ${r.rating} מתוך 5`}><Stars rating={r.rating} size={18} /></span>
                  <span className={s.revDate}>{r.date}</span>
                </div>
                <p className={s.revText}>{r.text}</p>
                <div className={s.revFoot}>
                  {r.verified && (
                    <span className={s.verified}>
                      <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 7.5 2.5 2.5L11 4.5" /></svg>
                      ביקור מאומת
                    </span>
                  )}
                  <Link href={r.href} className={s.revLink}>לפרופיל<Arrow width={1.7} /></Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* ---------- Guides (TODO(cms): /magazine until articles exist) ---------- */}
      <section aria-labelledby="h-guides" className={`${s.wrap} ${s.pt88}`}>
        <Kicker>מדריכים</Kicker>
        <h2 id="h-guides" className={`${s.h2} ${s.mt10}`}>קצת ידע. החלטה טובה יותר<Dot /></h2>
        <div className={s.guides}>
          <Link href={lead.href} className={s.leadGuide}>
            <figure className={s.leadFig}><span className={s.leadImg}><Image src={lead.img} alt={lead.title} fill sizes="(min-width: 1280px) 680px, 55vw" className={s.cover} /></span></figure>
            <div className={s.guideKind}>{lead.kind} · {READ_TIME[0]}</div>
            <div className={s.leadTitle}>{lead.title}</div>
            <div className={s.leadDesc}>{lead.desc}</div>
          </Link>
          <div className={s.guideList}>
            {ARTICLES.slice(1).map((a, i) => (
              <Link key={a.title} href={a.href} className={s.guideRow}>
                <span className={s.guideThumb}><Image src={a.img} alt={a.title} fill sizes="132px" className={s.cover} /></span>
                <span className={s.guideText}>
                  <span className={s.guideKind}>{a.kind}</span>
                  <span className={s.guideTitle}>{a.title}</span>
                  <span className={s.guideMeta}>{READ_TIME[i + 1]}</span>
                </span>
              </Link>
            ))}
            <Link href="/magazine" className={`${s.textLink} ${s.mt18}`}>לכל המדריכים<Arrow width={1.7} /></Link>
          </div>
        </div>
      </section>

      {/* ---------- Standards ---------- */}
      <section aria-labelledby="h-std" className={`${s.wrap} ${s.pt88}`}>
        <div className={s.headGrid}>
          <div>
            <Kicker>הסטנדרטים שלנו</Kicker>
            <h2 id="h-std" className={`${s.h2} ${s.mt10}`}>איך אנחנו בודקים<Dot /></h2>
            <p className={s.lead64}>BeautyFind הוא אינדקס עצמאי. אנחנו לא מבצעים טיפולים ולא ממליצים על טיפול מסוים. זה מה שכן עושים לפני שעסק עולה לאתר:</p>
          </div>
          <div className={s.stdLinks}>
            <Link href={ROUTES.listingStandards}>הסטנדרטים המלאים</Link>
            <Link href="/about/editorial">מדיניות עריכה</Link>
            <Link href="/about">מי אנחנו</Link>
          </div>
        </div>
        <div className={s.stdGrid}>
          {TRUST.map(t => (
            <div key={t.n} className={s.stdCard}>
              <span dir="ltr" className={s.stdNum}>{t.n}</span>
              <h3 className={s.stdTitle}>{t.title}</h3>
              <div className={s.stdDesc}>{t.desc}</div>
            </div>
          ))}
          <div className={s.board}>
            <div className={s.boardKicker}>הצוות המקצועי</div>
            <div className={s.boardTitle}>מי עומד מאחורי התוכן הרפואי</div>
            <div className={s.boardLinks}>
              {[
                { href: '/about/editorial', title: 'מדיניות עריכה', sub: 'מי כותב, מי בודק ואיך מתקנים טעויות' },
                { href: `${ROUTES.methodology}#verification`, title: 'איך מאמתים עסקים', sub: 'רישיונות, תעודות ובעלות על העסק' },
                { href: '/about#team', title: 'הצוות שלנו', sub: 'האנשים שמאחורי BeautyFind' },
              ].map(b => (
                <Link key={b.href} href={b.href} className={s.boardLink}>
                  <span className={s.boardLinkText}><span className={s.boardLinkTitle}>{b.title}</span><span className={s.boardLinkSub}>{b.sub}</span></span>
                  <Arrow width={1.7} stroke="#0B7A87" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Regions ---------- */}
      <section aria-labelledby="h-reg" className={`${s.wrap} ${s.pt88}`}>
        <div className={s.head}>
          <div>
            <Kicker>לפי אזור</Kicker>
            <h2 id="h-reg" className={`${s.h2} ${s.mt10}`}>מהצפון ועד אילת<Dot /></h2>
          </div>
          <Link href="/regions" className={s.headLink}>כל הערים<Arrow width={1.7} /></Link>
        </div>
        <div className={s.regionGrid}>
          {REGION_CARDS.map(r => (
            <div key={r} className={s.regionCard} data-wide={r === 'dan' || undefined}>
              <Link href={`/${r}`} className={s.regionLink}>
                <span className={s.regionImg}><Image src={`/assets/landmark-${r}.jpg`} alt={rName(r)} fill sizes={r === 'dan' ? '(min-width: 1280px) 610px, 50vw' : '(min-width: 1280px) 300px, 25vw'} className={s.cover} /></span>
                <span className={s.regionName}>{rName(r)}</span>
              </Link>
              <span className={s.regionCities}>
                {regionCities[r].map((c, i) => (
                  <span key={c.href} className={s.cityWrap}>
                    {i > 0 && <span className={s.citySep} aria-hidden="true">·</span>}
                    <Link href={c.href} className={s.cityLink}>{c.name}</Link>
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- For businesses ---------- */}
      <section aria-labelledby="h-biz" className={s.biz}>
        <div className={`${s.wrap} ${s.bizGrid}`}>
          <div>
            <Kicker tone="teal">לבעלי עסקים</Kicker>
            <h2 id="h-biz" className={`${s.h2} ${s.mt10}`}>איך הרישום באינדקס עובד<Dot /></h2>
            <p className={s.bizLede}>פרופיל מאומת, יומן מסונכרן עם Google, Outlook או מערכת הקליניקה, ואישורי תור בוואטסאפ, SMS ומייל.</p>
            <div className={s.bizCtas}>
              <Link href={ROUTES.join} className={s.bizJoin}>הצטרפות לאינדקס<Arrow width={1.7} /></Link>
              <Link href={ROUTES.claim} className={s.bizClaim}>העסק כבר כאן?</Link>
            </div>
            <div className={s.bizPrice}>מ־<span dir="ltr" className={s.bizPriceN}>₪{PLAN_MONTHLY_NIS.basic}</span> לסניף בחודש, ללא מע״מ ישראלי.</div>
          </div>
          <ListingSteps variant="desk" />
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section aria-labelledby="h-faq" className={`${s.wrap} ${s.pt88}`}>
        <div className={s.faqGrid}>
          <div className={s.faqAside}>
            <Kicker>שאלות נפוצות</Kicker>
            <h2 id="h-faq" className={`${s.h2} ${s.mt10}`}>מה שואלים אותנו<Dot /></h2>
            <p className={s.faqLede}>לא מצאתם תשובה? צוות התמיכה זמין בוואטסאפ ובמייל.</p>
            <Link href={ROUTES.help} className={`${s.textLink} ${s.mt16}`}>לכל השאלות<Arrow width={1.7} /></Link>
          </div>
          <div className={s.faqs}>
            {FAQS.map((f, i) => {
              const open = faq === i;
              return (
                <div key={f.q} className={s.faq} data-open={open || undefined}>
                  <button type="button" aria-expanded={open} aria-controls={`faq-d-${i}`} onClick={() => setFaq(open ? -1 : i)} className={s.faqQ}>
                    <span className={s.flex1}>{f.q}</span>
                    <span className={s.faqPlus} aria-hidden="true">+</span>
                  </button>
                  <div id={`faq-d-${i}`} className={s.faqA} hidden={!open}>{f.a}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
      <div aria-hidden="true" className={s.footGap} />
    </div>
  );
}
