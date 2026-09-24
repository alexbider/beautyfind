'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { REGIONS, type RegionSlug } from '@/lib/catalog';
import { PLAN_MONTHLY_NIS } from '@/lib/pricing';
import { ROUTES } from '@/lib/routes';
import { SaveHeart, useSavedIds } from '../../save-heart/SaveHeart';
import { haptic } from '../../shell/haptics';
import { ARTICLES } from '../content';
import { setRegion as storeRegion, useRegion } from '../regionStore';
import s from './PhoneHome.module.css';

// Phone homepage (app shell only). Design: BeautyFind_Homepage_Mobile.html, 430px column.
// Cards, reviews and counts come from the page (live listings only); the rest is static copy.
// TODO(people): the design's medical board and guide reviewers use placeholder names and license
// numbers, so they are left out until real reviewers are named.

export interface PhoneCard {
  id: string;
  name: string;
  href: string;
  tag: string;
  city: string;
  img: string;
  bf: { rating: number; count: number } | null;
  g: { rating: number; count: number } | null;
  from: number | null;
  openNow: boolean;
  whatsapp: string | null;
  phone: string | null;
  verified: boolean;
}

export interface PhoneReview {
  id: string;
  initial: string;
  name: string;
  date: string;
  rating: number;
  text: string;
  treat: string | null;
  biz: string;
  href: string;
  verified: boolean;
}

export interface PhoneHomeProps {
  lists: Record<RegionSlug, PhoneCard[]>;
  reviews: PhoneReview[];
  regionCities: Record<RegionSlug, Array<{ name: string; href: string }>>;
  catCount: number;
}

// The design opens on גוש דן; a region picked anywhere on the site (header, map) wins.
export const FALLBACK_REGION: RegionSlug = 'dan';
export const REGION_ORDER: RegionSlug[] = ['north', 'haifa', 'sharon', 'dan', 'jerusalem', 'shfela', 'south'];
export const rName = (r: RegionSlug) => REGIONS.find(x => x.slug === r)!.name;

// Rough region centres, enough to turn a GPS fix into a region.
const CENTRES: Record<RegionSlug, [number, number]> = {
  north: [32.95, 35.45], haifa: [32.79, 35.02], sharon: [32.27, 34.87], dan: [32.07, 34.8],
  jerusalem: [31.77, 35.2], shfela: [31.87, 34.8], south: [30.9, 34.8],
};
export const nearestRegion = (lat: number, lng: number) =>
  REGION_ORDER.reduce((best, r) => {
    const d = (x: RegionSlug) => (CENTRES[x][0] - lat) ** 2 + (CENTRES[x][1] - lng) ** 2;
    return d(r) < d(best) ? r : best;
  }, FALLBACK_REGION);

export const WA_PATH = 'M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.2 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-3.3-.8-2.8-1.2-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2.1 1-2.4c.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.7-.1l1.9.9c.3.1.5.2.5.3.1.2.1.7-.1 1.2Z';
export const STAR_PATH = 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8L12 2.5Z';

export const Arrow = ({ size = 14, stroke = 'currentColor', width = 1.6, className }: { size?: number; stroke?: string; width?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
    <path d="M12 7H2M6 3 2 7l4 4" />
  </svg>
);
export const Chevron = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 4.5 6 8l3.5-3.5" />
  </svg>
);
export const Pin = ({ size = 15, width = 1.4 }: { size?: number; width?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={width} aria-hidden="true">
    <path d="M8 14.5s5-4.2 5-8A5 5 0 0 0 3 6.5c0 3.8 5 8 5 8Z" />
    <circle cx="8" cy="6.4" r="1.9" />
  </svg>
);
export const Glass = ({ size = 17 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <circle cx="8" cy="8" r="5.5" />
    <path d="m12.5 12.5 3.5 3.5" />
  </svg>
);
export const WhatsApp = ({ size = 19, fill = 'currentColor' }: { size?: number; fill?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} aria-hidden="true"><path d={WA_PATH} /></svg>
);
export const Mail = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#14B3C6" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
    <rect x="1.5" y="3" width="13" height="10" rx="2" />
    <path d="m2 4 6 5 6-5" />
  </svg>
);

/** Section eyebrow: teal hairline + label. */
const Kicker = ({ children, tone }: { children: ReactNode; tone?: 'teal' }) => (
  <div className={s.kicker} data-tone={tone}>
    <span className={s.kickerLine} aria-hidden="true" />
    {children}
  </div>
);
const Dot = ({ ch = '.' }: { ch?: string }) => <span className={s.dot}>{ch}</span>;

/** Three rotating rings (hero decoration). */
export function Rings({ size, className }: { size: number; className: string }) {
  return (
    <div aria-hidden="true" className={className} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 200 200" fill="none" className={s.spinA}>
        <circle cx="100" cy="100" r="96" stroke="#14B3C6" strokeOpacity=".45" strokeWidth="1" strokeDasharray="120 60 4 60" />
        <circle cx="100" cy="4" r="3.5" fill="#14B3C6" />
      </svg>
      <svg width={size} height={size} viewBox="0 0 200 200" fill="none" className={s.spinB}>
        <circle cx="100" cy="100" r="72" stroke="#0B7A87" strokeOpacity=".35" strokeWidth="1" strokeDasharray="2 8" />
      </svg>
      <svg width={size} height={size} viewBox="0 0 200 200" fill="none" className={s.breath}>
        <circle cx="100" cy="100" r="48" stroke="#7ED7E1" strokeOpacity=".7" strokeWidth="1.2" />
      </svg>
    </div>
  );
}

export const QUICK = ['בוטוקס', 'הסרת שיער', 'טיפול פנים', 'לק ג׳ל'];

export const TRUST_STRIP = [
  { title: 'רישיונות נבדקים', d: 'M8 1.5 3 3.5v3.8c0 3.1 2.2 5.4 5 6.5 2.8-1.1 5-3.4 5-6.5V3.5L8 1.5ZM5.8 8l1.6 1.6L10.4 6.4' },
  { title: 'ביקורות מאומתות', d: 'M8 2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.2 4.4 13.1l.7-4-2.9-2.8 4-.6L8 2Z' },
  { title: 'ממומן מסומן', d: 'M8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13ZM8 7v4M8 5h.01' },
];

const CATS = [
  { label: 'אסתטיקה רפואית', slug: 'medical-aesthetics', img: '/assets/biz-medical.jpg', tall: true },
  { label: 'קוסמטיקה', slug: 'facials', img: '/assets/biz-facial.jpg' },
  { label: 'הסרת שיער', slug: 'hair-removal', img: '/assets/biz-laser.jpg' },
  { label: 'מספרות', slug: 'hair-salons', img: '/assets/biz-hair.jpg' },
  { label: 'ספא ועיסויים', slug: 'spa-massage', img: '/assets/biz-spa.jpg' },
];
const MORE_CATS = [
  { label: 'ציפורניים', href: '/treatments/nails' },
  { label: 'גבות וריסים', href: '/treatments/brows-lashes' },
  { label: 'איפור קבוע', href: '/treatments/permanent-makeup' },
  { label: 'עיצוב הגוף', href: '/treatments/body-contouring' },
  { label: 'שיזוף', href: '/treatments/tanning' },
  { label: 'כל התחומים', href: ROUTES.treatments },
];
const MENU_CATS = [
  { label: 'אסתטיקה רפואית', slug: 'medical-aesthetics', img: '/assets/biz-medical.jpg' },
  { label: 'קוסמטיקה', slug: 'facials', img: '/assets/biz-facial.jpg' },
  { label: 'הסרת שיער', slug: 'hair-removal', img: '/assets/biz-laser.jpg' },
  { label: 'מספרות', slug: 'hair-salons', img: '/assets/biz-hair.jpg' },
  { label: 'ציפורניים', slug: 'nails', img: '/assets/biz-nails.jpg' },
  { label: 'ספא ועיסויים', slug: 'spa-massage', img: '/assets/biz-spa.jpg' },
];

export const READ_TIME = ['6 דקות קריאה', '5 דקות קריאה', '4 דקות קריאה'];

export const TRUST = [
  { n: '01', title: 'אימות לפני עלייה לאוויר', desc: 'בודקים רישיון רופא או אחות מול משרד הבריאות, ותעודת מקצוע לקוסמטיקאיות. בעלות על העסק מאומתת בנפרד.' },
  { n: '02', title: 'אחריות רפואית מסומנת', desc: 'הזרקות הן פעולה רפואית. בכל פרופיל מופיע מי הרופא האחראי, וטיפול רפואי עובר קודם לפגישת ייעוץ.' },
  { n: '03', title: 'ביקורות ממי שהגיעה בפועל', desc: 'ביקורת BeautyFind אפשרית רק אחרי תור שהתקיים. דירוג Google מוצג לצידה, בלי למזג.' },
  { n: '04', title: 'תוכן שנבדק רפואית', desc: 'כל מדריך נכתב על ידי המערכת ונבדק על ידי איש מקצוע מוסמך, עם תאריך עדכון גלוי.' },
];

const STEPS = [
  { label: 'פרטי העסק', text: 'ממלאים שם, עיר ותחומי טיפול. אפשר גם לתבוע פרופיל שכבר קיים באינדקס.' },
  { label: 'אימות', text: 'בודקים רישיון ותעודות. טיפול רפואי מסומן באחריות רפואית של רופא.' },
  { label: 'פרופיל חי', text: 'הפרופיל עולה עם טיפולים, מחירים, שעות וביקורות Google ו־BeautyFind בנפרד.' },
  { label: 'תורים', text: 'לקוחות קובעות תור, האישור יוצא בוואטסאפ, SMS ומייל, והתור נכנס ליומן שלכם.' },
];

export const FAQS = [
  { q: 'האם השימוש ב־BeautyFind עולה כסף?', a: 'לא. החיפוש, ההשוואה וקביעת התור חינם. התשלום על הטיפול מתבצע מול העסק, שמנפיק חשבונית מס.' },
  { q: 'עסק יכול לשלם כדי לדרג גבוה יותר?', a: 'לא. מודעה ממומנת מסומנת תמיד, מוגבלת לשתיים בכל רשימה, ולא משנה את הדירוג או את הביקורות.' },
  { q: 'טיפולים אסתטיים כלולים בסל?', a: 'לא. טיפולים אסתטיים אינם בסל הבריאות. המחירים המוצגים לא כוללים מע״מ.' },
  { q: 'מי רשאי לבצע הזרקות?', a: 'הזרקות הן פעולה רפואית המחייבת רופא. קוסמטיקאיות אינן רשאיות להזריק, בכל פרופיל מסומן מי נושא באחריות הרפואית.' },
];

const FOOT_GROUPS = [
  { name: 'BeautyFind', links: [['מי אנחנו', '/about'], ['הסטנדרטים שלנו', ROUTES.listingStandards], ['מדיניות עריכה', '/about/editorial'], ['איך מדרגים', `${ROUTES.methodology}#ranking`], ['מדריכים', '/magazine'], ['תחומי טיפול', ROUTES.treatments]] },
  { name: 'לעסקים', links: [['הצטרפות לאינדקס', ROUTES.join], ['תביעת פרופיל', ROUTES.claim], ['מחירים', ROUTES.pricing], ['כניסה לעסקים', ROUTES.bizLogin]] },
  { name: 'עזרה ומשפטי', links: [['מרכז עזרה', ROUTES.help], ['צור קשר', ROUTES.contact], ['תנאי שימוש', ROUTES.terms], ['מדיניות פרטיות', ROUTES.privacy], ['הצהרת נגישות', ROUTES.accessibility]] },
] as const;

const SUPPORT_EMAIL = 'hello@beautyfind.co.il';

function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduce(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduce;
}

/* ---------------------------------------------------------------- Menu */

function Menu({ open, section, setSection, onClose, region, pickRegion }: {
  open: boolean;
  section: 'cat' | 'reg' | '';
  setSection: (v: 'cat' | 'reg' | '') => void;
  onClose: () => void;
  region: RegionSlug;
  pickRegion: (r: RegionSlug) => void;
}) {
  const saved = useSavedIds();
  const panel = useRef<HTMLElement>(null);
  const savedCount = saved.ready ? saved.ids.length : 0;

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.classList.add('bf-sheet-open');
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>('button, a')?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab' || !panel.current) return;
      const els = [...panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      root.classList.remove('bf-sheet-open');
      window.removeEventListener('keydown', onKey);
      opener?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);

  // Every row fades in from the side, 35ms after the previous one.
  const d = (i: number) => ({ '--d': `${80 + i * 35}ms` }) as React.CSSProperties;

  return (
    <div className={s.menu} data-open={open || undefined} role="dialog" aria-modal="true" aria-label="תפריט" aria-hidden={!open} inert={!open}>
      <div className={s.menuFrame}>
        <div className={s.menuScrim} onClick={onClose} />
        <nav ref={panel} aria-label="תפריט ראשי" className={s.menuPanel}>
          <div className={s.menuTop}>
            <span dir="ltr" className={s.wordmark} style={{ fontSize: 24 }}>beauty<span className={s.accent}>find</span><span className={s.accentDot}>.</span></span>
            <button type="button" onClick={onClose} aria-label="סגירת התפריט" className={s.menuClose}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#0C243E" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></svg>
            </button>
          </div>
          <div className={s.menuBody}>
            <Link href={ROUTES.search} className={`${s.menuSearch} ${s.stagger}`} style={d(0)} onClick={onClose}>
              <span className={s.tealInk}><Glass size={18} /></span>טיפול, עסק או עיר
            </Link>
            <div className={`${s.menuHello} ${s.stagger}`} style={d(1)}>
              <span className={s.helloAvatar} aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 7.5c.6-3 3-4.5 6-4.5s5.4 1.5 6 4.5" /></svg>
              </span>
              <span className={s.helloText}>
                <span className={s.helloTitle}>שלום!</span>
                <span className={s.helloSub}>התחברו לניהול התורים והמועדפים</span>
              </span>
              <Link href={ROUTES.login} className={s.helloBtn} onClick={onClose}>כניסה</Link>
            </div>
            <div className={s.menuList}>
              <div className={`${s.menuRow} ${s.stagger}`} style={d(2)}>
                <button type="button" aria-expanded={section === 'cat'} onClick={() => setSection(section === 'cat' ? '' : 'cat')} className={s.menuItem}>
                  <span className={s.menuIcon}><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 2.5c2 3 5 4.4 5 8a5 5 0 0 1-10 0c0-3.6 3-5 5-8Z" /></svg></span>
                  <span className={s.menuLabel}>תחומי טיפול</span>
                  <span className={s.menuChev} data-open={section === 'cat' || undefined}><Chevron /></span>
                </button>
                {section === 'cat' && (
                  <div className={s.menuDrop}>
                    <div className={s.menuCats}>
                      {MENU_CATS.map(c => (
                        <Link key={c.slug} href={`/treatments/${c.slug}`} className={s.menuCat} onClick={onClose}>
                          <span className={s.menuCatImg}><Image src={c.img} alt="" fill sizes="110px" className={s.cover} /></span>
                          <span className={s.menuCatName}>{c.label}</span>
                        </Link>
                      ))}
                    </div>
                    <Link href={ROUTES.treatments} className={s.menuAll} onClick={onClose}>כל 14 תחומי הטיפול<Arrow size={13} width={1.7} /></Link>
                  </div>
                )}
              </div>
              <div className={`${s.menuRow} ${s.stagger}`} style={d(3)}>
                <button type="button" aria-expanded={section === 'reg'} onClick={() => setSection(section === 'reg' ? '' : 'reg')} className={s.menuItem}>
                  <span className={s.menuIcon}><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 17.5s6-5 6-9.5a6 6 0 0 0-12 0c0 4.5 6 9.5 6 9.5Zm0-7.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" /></svg></span>
                  <span className={s.menuLabel}>אזור: {rName(region)}</span>
                  <span className={s.menuChev} data-open={section === 'reg' || undefined}><Chevron /></span>
                </button>
                {section === 'reg' && (
                  <div className={s.menuDrop}>
                    <div className={s.menuRegions}>
                      {REGION_ORDER.map(r => (
                        <button key={r} type="button" aria-pressed={r === region} data-on={r === region || undefined} className={s.menuRegion} onClick={() => pickRegion(r)}>
                          <span className={s.menuRegionDot} aria-hidden="true" />
                          <span className={s.menuRegionName}>{rName(r)}</span>
                          <span className={s.menuRegionCheck} aria-hidden="true">{r === region ? '✓' : ''}</span>
                        </button>
                      ))}
                    </div>
                    <div className={s.menuNote}>האזור שנבחר משפיע על ההמלצות בדף הבית.</div>
                  </div>
                )}
              </div>
              {[
                { href: '/magazine', label: 'מדריכים', d: 'M4 3.5h9a3 3 0 0 1 3 3v10H7a3 3 0 0 1-3-3v-10ZM4 13.5a3 3 0 0 1 3-3h9' },
                { href: ROUTES.saved, label: 'מועדפים', d: 'M10 16.5s-6.5-3.9-6.5-8.6A3.6 3.6 0 0 1 10 5.6a3.6 3.6 0 0 1 6.5 2.3c0 4.7-6.5 8.6-6.5 8.6Z', badge: savedCount },
                { href: ROUTES.account, label: 'התורים שלי', d: 'M3.5 5.5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-10ZM3.5 8h13M7 2v3m6-3v3' },
                { href: ROUTES.listingStandards, label: 'הסטנדרטים שלנו', d: 'M10 2 4 4.5v4.8c0 3.9 2.6 6.7 6 8.2 3.4-1.5 6-4.3 6-8.2V4.5L10 2Zm-2.6 8 1.9 1.9 3.5-3.6' },
                { href: ROUTES.help, label: 'מרכז עזרה', d: 'M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM7.8 7.6a2.3 2.3 0 0 1 4.4.8c0 1.6-2.2 2-2.2 3.3M10 14.2h.01' },
              ].map((l, i) => (
                <Link key={l.href} href={l.href} className={`${s.menuItem} ${s.menuLink} ${s.stagger}`} style={d(4 + i)} onClick={onClose}>
                  <span className={s.menuIcon}><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={l.d} /></svg></span>
                  <span className={s.menuLabel}>{l.label}</span>
                  {l.badge ? <span dir="ltr" className={s.menuBadge}>{l.badge}</span> : null}
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#8A96A3" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8.5 3 4.5 7l4 4" /></svg>
                </Link>
              ))}
            </div>
            <div className={`${s.menuBiz} ${s.stagger}`} style={d(9)}>
              <span aria-hidden="true" className={s.menuBizRing1} />
              <span aria-hidden="true" className={s.menuBizRing2} />
              <div className={s.menuBizKicker}>לבעלי עסקים</div>
              <div className={s.menuBizTitle}>יש לכם מכון או קליניקה?</div>
              <div className={s.two}>
                <Link href={ROUTES.forBusiness} className={s.menuBizJoin} onClick={onClose}>הצטרפות</Link>
                <Link href={ROUTES.bizLogin} className={s.menuBizLogin} onClick={onClose}>כניסה לעסקים</Link>
              </div>
            </div>
            <div className={`${s.two} ${s.stagger}`} style={{ ...d(10), marginTop: 14 }}>
              <Link href={ROUTES.contact} className={s.btnWa} onClick={onClose}><WhatsApp size={16} fill="#1DA851" />צ׳אט תמיכה</Link>
              <a href={`mailto:${SUPPORT_EMAIL}`} className={s.btnMail}><Mail />מייל</a>
            </div>
            <div className={`${s.menuLegal} ${s.stagger}`} style={d(11)}>
              <Link href={ROUTES.accessibility} onClick={onClose}>הצהרת נגישות</Link>
              <Link href={ROUTES.privacy} onClick={onClose}>פרטיות</Link>
              <Link href={ROUTES.terms} onClick={onClose}>תנאי שימוש</Link>
            </div>
          </div>
        </nav>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Business card */

function BizCard({ c }: { c: PhoneCard }) {
  return (
    <article className={s.card}>
      <div className={s.cardMedia}>
        <Link href={c.href} tabIndex={-1} aria-hidden="true" className={s.fill}>
          <Image src={c.img} alt="" fill sizes="290px" className={s.cover} />
        </Link>
        <SaveHeart id={c.id} name={c.name} className={s.heart} />
      </div>
      <div className={s.cardBody}>
        <div className={s.cardTop}>
          <span className={s.tealInk}>{c.tag}</span>
          {c.openNow && <span className={s.open}><span className={s.openDot} aria-hidden="true" />פתוח עכשיו</span>}
        </div>
        <h3 className={s.cardName}><Link href={c.href}>{c.name}</Link></h3>
        <div className={s.cardCity}>{c.city}</div>
        {/* BeautyFind and Google side by side, never merged (decision A4). */}
        <div className={s.cardRatings}>
          {c.bf && c.bf.count > 0 && (
            <span>BeautyFind <strong dir="ltr" className={s.iso}>★ {c.bf.rating.toFixed(1)}</strong> <span dir="ltr" className={s.iso}>({c.bf.count})</span></span>
          )}
          {c.g && c.g.count > 0 && (
            <span>Google <strong dir="ltr" className={s.iso}>★ {c.g.rating.toFixed(1)}</strong> <span dir="ltr" className={s.iso}>({c.g.count})</span></span>
          )}
          {!(c.bf && c.bf.count > 0) && !(c.g && c.g.count > 0) && <span>אין עדיין חוות דעת</span>}
        </div>
        {c.from != null && (
          <div className={s.cardPrice}>
            החל מ־<strong dir="ltr" className={s.iso}>₪{Math.round(c.from)}</strong>
            <span className={s.vat}>לא כולל מע״מ</span>
          </div>
        )}
        <div className={s.cardActions} data-n={1 + (c.whatsapp ? 1 : 0) + (c.phone ? 1 : 0)}>
          <Link href={c.href} className={s.cardCta}>לפרופיל העסק<Arrow /></Link>
          {c.whatsapp && (
            <a href={`https://wa.me/${c.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" aria-label={`וואטסאפ ל${c.name}`} className={s.cardWa}><WhatsApp /></a>
          )}
          {c.phone && (
            <a href={`tel:${c.phone}`} aria-label={`חיוג ל${c.name}`} className={s.cardTel}>
              <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><path d="M4 2.5h2.5l1.2 3.2-1.6 1a8 8 0 0 0 5.2 5.2l1-1.6 3.2 1.2V14a1.5 1.5 0 0 1-1.6 1.5A12.5 12.5 0 0 1 2.5 4.1 1.5 1.5 0 0 1 4 2.5Z" /></svg>
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

/* ---------------------------------------------------------------- Listing stepper */

export function ListingSteps({ variant }: { variant?: 'desk' }) {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const [tick, setTick] = useState(0);
  const [visible, setVisible] = useState(false);
  const paused = useRef(false);
  const resume = useRef<ReturnType<typeof setTimeout> | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Half-second ticks; the step advances every 3s. Stops off screen and for reduced motion.
  useEffect(() => {
    if (reduce || !visible) return;
    const id = setInterval(() => {
      setTick(t => {
        const n = t + 1;
        if (!paused.current && n % 6 === 0) setStep(k => (k + 1) % 4);
        return n;
      });
    }, 500);
    return () => clearInterval(id);
  }, [reduce, visible]);
  useEffect(() => () => { if (resume.current) clearTimeout(resume.current); }, []);

  const pick = (i: number) => {
    paused.current = true;
    if (resume.current) clearTimeout(resume.current);
    resume.current = setTimeout(() => { paused.current = false; }, 8000);
    haptic('light');
    setStep(i);
    setTick(1);
  };

  const sub = reduce ? 3 : tick % 6;
  const pane = (i: number) => ({
    opacity: i === step ? 1 : 0,
    transform: i === step ? 'none' : i < step ? 'translateX(24px)' : 'translateX(-24px)',
  });
  const ringOn = step === 1 && sub >= 1;
  const noteOn = step === 3 && sub >= 1;

  return (
    <div ref={box} className={s.stepBox} data-variant={variant} data-screen-label="Listing animation">
      <div className={s.progress}><span style={{ width: `${((step + 1) / 4) * 100}%` }} /></div>
      <div role="tablist" aria-label="שלבי הרישום" className={s.steps}>
        {STEPS.map((st, i) => (
          <button key={st.label} type="button" role="tab" aria-selected={i === step} onClick={() => pick(i)} className={s.stepBtn} data-state={i < step ? 'done' : i === step ? 'on' : 'next'}>
            <span dir="ltr" className={s.stepNum}>{i + 1}</span>
            <span className={s.stepLabel}>{st.label}</span>
          </button>
        ))}
      </div>
      <div className={s.stage} aria-hidden="true">
        <div className={s.pane} style={pane(0)}>
          <div className={s.paneHead}>פרטי העסק</div>
          <div className={s.field}><span className={s.fieldLabel}>שם העסק</span><span className={s.fieldValue}>סטודיו ליה לטיפוח<span className={s.caret} style={{ opacity: sub % 2 ? 0 : 1 }} /></span></div>
          <div className={s.field}><span className={s.fieldLabel}>עיר</span><span className={s.fieldValue}>רמת גן</span></div>
          <div className={s.chips}><span className={s.chipOn}>קוסמטיקה</span><span className={s.chipOn}>טיפולי פנים</span><span className={s.chipAdd}>+ תחום</span></div>
        </div>
        <div className={`${s.pane} ${s.paneCenter}`} style={pane(1)}>
          <div className={s.shield}>
            <span className={s.shieldRing} style={{ opacity: ringOn ? 0 : 1, transform: `scale(${ringOn ? 1.25 : 1})` }} />
            <svg width="32" height="32" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M7 1.5 2.5 3.3v3.4c0 2.8 2 4.8 4.5 5.8 2.5-1 4.5-3 4.5-5.8V3.3L7 1.5Z" /><path d="m5 7 1.5 1.5L9.3 5.6" /></svg>
          </div>
          <div className={s.paneTitle}>רישיון ותעודות אומתו</div>
          <div className={s.paneText}>צוות BeautyFind בודק רישיון רופא, אחות או תעודת קוסמטיקאית לפני שהפרופיל עולה.</div>
        </div>
        <div className={`${s.pane} ${s.paneProfile}`} style={pane(2)}>
          <span className={s.profileImg}><Image src="/assets/biz-facial.jpg" alt="" fill sizes="96px" className={s.cover} /></span>
          <span className={s.profileText}>
            <span className={s.livePill}><span className={s.openDot} />הפרופיל באוויר</span>
            <span className={s.profileName}>סטודיו ליה לטיפוח</span>
            <span className={s.profileMeta}>קוסמטיקה · רמת גן</span>
            <span className={s.profileMeta}>החל מ־<strong dir="ltr" className={s.iso}>₪280</strong></span>
          </span>
        </div>
        <div className={`${s.pane} ${s.paneNotes}`} style={pane(3)}>
          <div className={s.note} style={{ transform: `translateY(${noteOn ? 0 : 10}px)`, opacity: noteOn ? 1 : 0 }}>
            <span className={s.noteIcon}><WhatsApp size={18} /></span>
            <span className={s.noteText}><span className={s.noteKicker}>תור חדש נקבע</span><span className={s.noteTitle}>טיפול פנים · יום ג׳ <span dir="ltr" className={s.iso}>10:30</span></span></span>
          </div>
          <div className={s.note2} style={{ opacity: noteOn ? 1 : 0 }}><span className={s.openDot} />נוסף ליומן Google של הסניף</div>
        </div>
      </div>
      <div className={s.stepText} aria-live="polite">{STEPS[step].text}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- Page */

export function PhoneHome({ lists, reviews, regionCities, catCount }: PhoneHomeProps) {
  const router = useRouter();
  const [stored, setStored] = useRegion();
  const region: RegionSlug = stored === 'all' ? FALLBACK_REGION : stored;
  const [menu, setMenu] = useState(false);
  const [section, setSection] = useState<'cat' | 'reg' | ''>('cat');
  const [q, setQ] = useState('');
  const [located, setLocated] = useState<RegionSlug | null>(null);
  const [locating, setLocating] = useState(false);
  const [faq, setFaq] = useState(0);
  const [foot, setFoot] = useState(-1);
  const rail = useRef<HTMLDivElement>(null);

  const openMenu = (sec?: 'cat' | 'reg') => {
    if (sec) setSection(sec);
    haptic('light');
    setMenu(true);
  };
  const closeMenu = useRef(() => setMenu(false)).current;

  const pickRegion = (r: RegionSlug) => {
    setStored(r);
    rail.current?.scrollTo({ left: 0 });
  };

  const locate = () => {
    if (!('geolocation' in navigator)) return openMenu('reg');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      p => {
        const r = nearestRegion(p.coords.latitude, p.coords.longitude);
        setLocating(false);
        setLocated(r);
        storeRegion(r);
      },
      () => {
        setLocating(false);
        openMenu('reg');
      },
      { maximumAge: 600_000, timeout: 8000 },
    );
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (located) p.set('region', located);
    const qs = p.toString();
    router.push(qs ? `${ROUTES.search}?${qs}` : ROUTES.search);
  };

  const cards = lists[region] ?? [];

  return (
    <div className={s.root} dir="rtl">
      <header className={s.header} data-screen-label="Top bar">
        <Link href="/" aria-label="BeautyFind, לדף הבית" dir="ltr" className={s.wordmark}>
          beauty<span className={s.accent}>find</span><span className={s.accentDot}>.</span>
        </Link>
        <div className={s.headActions}>
          <button type="button" className={s.regionBtn} aria-label={`אזור נבחר: ${rName(region)}`} onClick={() => openMenu('reg')}>
            <Pin />{rName(region)}
          </button>
          <button type="button" className={s.burger} aria-label="פתיחת תפריט" aria-expanded={menu} onClick={() => openMenu()}>
            <span /><span />
          </button>
        </div>
      </header>

      <Menu open={menu} section={section} setSection={setSection} onClose={closeMenu} region={region} pickRegion={pickRegion} />

      <main id="main-phone">
        {/* ---------- Hero ---------- */}
        <section className={s.hero} aria-labelledby="h1-phone">
          <div className={s.heroArt}>
            <Image src="/assets/biz-facial.jpg" alt="טיפול פנים במכון קוסמטיקה" fill loading="eager" fetchPriority="high" sizes="(max-width: 1023px) 430px, 1px" className={s.heroImg} />
            <div className={s.heroWash1} />
            <div className={s.heroWash2} />
            <Rings size={200} className={s.ringsA} />
            <Rings size={150} className={s.ringsB} />
            <Kicker>אינדקס היופי והאסתטיקה של ישראל</Kicker>
            <h1 id="h1-phone" className={s.h1}>
              מצאו את מיטב<br />
              <span className={s.nowrap}>מכוני היופי שלידכם<Dot /></span>
            </h1>
            <p className={s.lede}>אסתטיקה רפואית, קוסמטיקה, מספרות, ספא ועיצוב הגוף, מקריית שמונה ועד אילת. השוו בין עסקים וקבעו את הפגישה הבאה.</p>
          </div>
          <form role="search" className={s.search} onSubmit={submit}>
            <label className={s.searchRow}>
              <span className={s.searchIcon}><Glass /></span>
              <span className={s.searchCol}>
                <span className={s.searchLabel}>מה מחפשים?</span>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="טיפול או שם עסק" enterKeyHint="search" className={s.searchInput} name="q" autoComplete="off" />
              </span>
            </label>
            <div className={s.searchSep} />
            <button type="button" className={s.searchRow} onClick={locate} aria-busy={locating || undefined}>
              <span className={s.searchIcon}><Pin size={17} width={1.5} /></span>
              <span className={s.searchCol}>
                <span className={s.searchLabel}>איפה?</span>
                <span className={s.locValue} data-set={located ? '' : undefined}>{located ? `המיקום שלך, ${rName(located)}` : 'עיר או אזור'}</span>
              </span>
              <span className={s.useLoc}>{locating ? 'מאתרים...' : 'שימוש במיקום'}</span>
            </button>
            <button type="submit" className={s.go}>
              <span aria-hidden="true" className={s.sheen} />
              <span className={s.rel}>חיפוש עסקים</span>
              <Arrow width={1.8} className={s.nudge} />
            </button>
          </form>
          <div className={s.quick}>
            {QUICK.map(t => <Link key={t} href={`${ROUTES.search}?q=${encodeURIComponent(t)}`} className={s.quickChip}>{t}</Link>)}
          </div>
        </section>

        {/* ---------- Trust strip ---------- */}
        <section aria-label="למה אפשר לסמוך" className={s.trustWrap}>
          <div className={s.trustStrip}>
            {TRUST_STRIP.map(t => (
              <Link key={t.title} href={ROUTES.listingStandards} className={s.trustItem}>
                <span className={s.trustIcon}><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={t.d} /></svg></span>
                <span className={s.trustTitle}>{t.title}</span>
              </Link>
            ))}
          </div>
        </section>

        {/* ---------- Categories ---------- */}
        <section className={s.pad40} aria-labelledby="h-cats-m">
          <Kicker>תחומי טיפול</Kicker>
          <div className={s.headRow}>
            <h2 id="h-cats-m" className={s.h2}>מה מחפשים היום<Dot ch="?" /></h2>
            <Link href={ROUTES.treatments} className={s.headLink}>כל <span dir="ltr">{catCount}</span> התחומים</Link>
          </div>
          <div className={s.bento}>
            {CATS.map(c => (
              <Link key={c.slug} href={`/treatments/${c.slug}`} className={s.bentoTile} data-tall={c.tall || undefined}>
                <Image src={c.img} alt={c.label} fill sizes="(max-width: 1023px) 50vw, 1px" className={s.cover} />
                <span className={s.bentoLabel}>{c.label}<Arrow size={12} stroke="#0B7A87" width={1.8} /></span>
              </Link>
            ))}
          </div>
          <div className={s.moreCats}>
            {MORE_CATS.map(c => <Link key={c.label} href={c.href} className={s.moreCat}>{c.label}</Link>)}
          </div>
        </section>

        {/* ---------- Businesses by region ---------- */}
        <section className={s.featured} aria-labelledby="h-feat-m">
          <div className={s.px20}>
            <Kicker>מכונים לפי אזור</Kicker>
            <h2 id="h-feat-m" className={`${s.h2} ${s.mt8}`}>מכוני יופי באזור שלכם<Dot /></h2>
          </div>
          <div role="tablist" aria-label="אזור" className={s.tabs}>
            {REGION_ORDER.map(r => (
              <button key={r} type="button" role="tab" aria-selected={r === region} aria-controls="rail-m" onClick={() => pickRegion(r)} className={s.tab}>
                {rName(r)}
              </button>
            ))}
          </div>
          <div id="rail-m" role="tabpanel" aria-label={`עסקים ב${rName(region)}`} ref={rail} className={s.rail} key={region}>
            {cards.map(c => <BizCard key={c.id} c={c} />)}
            {cards.length === 0 && (
              <div className={s.railEmpty}>
                <strong>עדיין אין עסקים באינדקס ב{rName(region)}.</strong>
                <span>בקרוב יתווספו כאן מכונים. בינתיים אפשר לחפש בכל הארץ.</span>
                <Link href={ROUTES.search} className={s.headLink}>לחיפוש בכל הארץ</Link>
              </div>
            )}
          </div>
          <div className={s.disclosure}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#8A96A3" strokeWidth="1.5" aria-hidden="true"><circle cx="8" cy="8" r="6.5" /><path d="M8 7v4M8 5h.01" /></svg>
            <span>סדר ההצגה לפי אימות ודירוג. עסק ממומן מסומן תמיד ולא משפיע על הדירוג. <Link href={`${ROUTES.methodology}#ranking`} className={s.strongLink}>איך מדרגים</Link></span>
          </div>
          <div className={s.allLinkWrap}>
            <Link href={`/${region}`} className={s.textLink}>
              כל העסקים ב{rName(region)}<Arrow />
            </Link>
          </div>
        </section>

        {/* ---------- Reviews (only when there are published reviews) ---------- */}
        {reviews.length > 0 && (
          <section className={s.pad40} aria-labelledby="h-rev-m">
            <Kicker>ביקורות מאומתות</Kicker>
            <h2 id="h-rev-m" className={`${s.h2} ${s.mt8}`}>מה מספרות מי שהגיעו<Dot /></h2>
            <p className={s.sectionLede}>רק מי שקבעה תור דרך BeautyFind והגיעה אליו יכולה לכתוב ביקורת. לא עורכים, לא מוחקים ביקורות שליליות.</p>
            <div className={s.reviews}>
              {reviews.map((r, i) => (
                <article key={r.id} className={s.review}>
                  <div className={s.revHead}>
                    <span className={s.avatar} style={{ background: ['#0B7A87', '#0C243E', '#14B3C6'][i % 3] }} aria-hidden="true">{r.initial}</span>
                    <span className={s.revWho}>
                      <span className={s.revName}>{r.name}</span>
                      <span className={s.revMeta}>{[r.treat, r.biz].filter(Boolean).join(' · ')}</span>
                    </span>
                  </div>
                  <div className={s.revStars}>
                    <span dir="ltr" role="img" aria-label={`דירוג ${r.rating} מתוך 5`} className={s.stars}>
                      {[1, 2, 3, 4, 5].map(n => (
                        <svg key={n} width="16" height="16" viewBox="0 0 24 24" fill={n <= r.rating ? '#FBBC04' : '#DADCE0'} aria-hidden="true"><path d={STAR_PATH} /></svg>
                      ))}
                    </span>
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
                    <Link href={r.href} className={s.revLink}>לפרופיל<Arrow size={12} width={1.8} /></Link>
                  </div>
                </article>
              ))}
            </div>
            <Link href={`${ROUTES.terms}#reviews`} className={`${s.textLink} ${s.mt10}`}>מדיניות הביקורות<Arrow /></Link>
          </section>
        )}

        {/* ---------- Guides (TODO(cms): /magazine until articles exist) ---------- */}
        <section className={s.pad40} aria-labelledby="h-guides-m">
          <Kicker>מדריכים</Kicker>
          <h2 id="h-guides-m" className={`${s.h2} ${s.mt8} ${s.mb18}`}>קצת ידע. החלטה טובה יותר<Dot /></h2>
          <Link href={ARTICLES[0].href} className={s.leadGuide}>
            <figure className={s.leadFig}>
              <span className={s.leadImg}><Image src={ARTICLES[0].img} alt="" fill sizes="(max-width: 1023px) 400px, 1px" className={s.cover} /></span>
            </figure>
            <div className={s.guideKind}>{ARTICLES[0].kind} · {READ_TIME[0]}</div>
            <div className={s.leadTitle}>{ARTICLES[0].title}</div>
            <div className={s.leadDesc}>{ARTICLES[0].desc}</div>
          </Link>
          <div className={s.guideList}>
            {ARTICLES.slice(1).map((a, i) => (
              <Link key={a.title} href={a.href} className={s.guideRow}>
                <span className={s.guideThumb}><Image src={a.img} alt="" fill sizes="84px" className={s.cover} /></span>
                <span className={s.guideText}>
                  <span className={s.guideKind}>{a.kind}</span>
                  <span className={s.guideTitle}>{a.title}</span>
                  <span className={s.guideMeta}>{READ_TIME[i + 1]}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* ---------- Standards ---------- */}
        <section className={s.pad44} aria-labelledby="h-std-m">
          <Kicker>הסטנדרטים שלנו</Kicker>
          <h2 id="h-std-m" className={`${s.h2} ${s.mt8}`}>איך אנחנו בודקים<Dot /></h2>
          <p className={s.stdLede}>BeautyFind הוא אינדקס עצמאי. אנחנו לא מבצעים טיפולים ולא ממליצים על טיפול מסוים. זה מה שכן עושים לפני שעסק עולה לאתר:</p>
          <div className={s.stdList}>
            {TRUST.map(t => (
              <div key={t.n} className={s.stdRow}>
                <span dir="ltr" className={s.stdNum}>{t.n}</span>
                <div>
                  <h3 className={s.stdTitle}>{t.title}</h3>
                  <div className={s.stdDesc}>{t.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div className={s.stdLinks}>
            <Link href={ROUTES.listingStandards}>הסטנדרטים המלאים</Link>
            <Link href="/about/editorial">מדיניות עריכה</Link>
            <Link href="/about">מי אנחנו</Link>
          </div>
        </section>

        {/* ---------- Regions ---------- */}
        <section className={s.pad44} aria-labelledby="h-reg-m">
          <Kicker>לפי אזור</Kicker>
          <h2 id="h-reg-m" className={`${s.h2} ${s.mt8} ${s.mb18}`}>מהצפון ועד אילת<Dot /></h2>
          <div className={s.regionGrid}>
            {(['dan', 'north', 'haifa', 'sharon', 'jerusalem', 'shfela', 'south'] as RegionSlug[]).map(r => (
              <div key={r} className={s.regionCard} data-wide={r === 'dan' || undefined}>
                <Link href={`/${r}`} className={s.regionLink}>
                  <span className={s.regionImg}><Image src={`/assets/landmark-${r}.jpg`} alt={rName(r)} fill sizes={r === 'dan' ? '(max-width: 1023px) 400px, 1px' : '(max-width: 1023px) 200px, 1px'} className={s.cover} /></span>
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
        <section className={s.biz} aria-labelledby="h-biz-m">
          <Kicker tone="teal">לבעלי עסקים</Kicker>
          <h2 id="h-biz-m" className={`${s.h2} ${s.mt8}`}>איך הרישום באינדקס עובד<Dot /></h2>
          <ListingSteps />
          <div className={`${s.two} ${s.mt16}`}>
            <Link href={ROUTES.join} className={s.bizJoin}>הצטרפות לאינדקס<Arrow /></Link>
            <Link href={ROUTES.claim} className={s.bizClaim}>העסק כבר כאן?</Link>
          </div>
          <div className={s.bizPrice}>מ־<span dir="ltr" className={s.bizPriceN}>₪{PLAN_MONTHLY_NIS.basic}</span> לסניף בחודש, ללא מע״מ ישראלי.</div>
        </section>

        {/* ---------- FAQ ---------- */}
        <section className={s.pad40} aria-labelledby="h-faq-m">
          <Kicker>שאלות נפוצות</Kicker>
          <h2 id="h-faq-m" className={`${s.h2} ${s.mt8} ${s.mb16}`}>מה שואלים אותנו<Dot /></h2>
          <div className={s.faqs}>
            {FAQS.map((f, i) => {
              const open = faq === i;
              return (
                <div key={f.q} className={s.faq} data-open={open || undefined}>
                  <button type="button" aria-expanded={open} aria-controls={`faq-m-${i}`} onClick={() => setFaq(open ? -1 : i)} className={s.faqQ}>
                    <span className={s.flex1}>{f.q}</span>
                    <span className={s.faqPlus} aria-hidden="true">+</span>
                  </button>
                  <div id={`faq-m-${i}`} className={s.faqA} hidden={!open}>{f.a}</div>
                </div>
              );
            })}
          </div>
          <Link href={ROUTES.help} className={`${s.textLink} ${s.mt14}`}>לכל השאלות<Arrow /></Link>
        </section>
      </main>

      {/* ---------- Footer ---------- */}
      <footer className={s.footer}>
        <div className={s.footTop}>
          <div dir="ltr" className={s.footMark}>beauty<span className={s.accent}>find</span><span className={s.accentDot}>.</span></div>
          <p className={s.footLede}>אינדקס עצמאי של מכוני יופי ואסתטיקה בישראל. רישיונות נבדקים, ביקורות מאומתות, מחירים שקופים.</p>
          <div className={`${s.two} ${s.mt18}`}>
            <a href={`mailto:${SUPPORT_EMAIL}`} className={s.btnMail}><Mail />שליחת מייל</a>
            <Link href={ROUTES.contact} className={s.btnWa}><WhatsApp size={16} fill="#1DA851" />צ׳אט תמיכה</Link>
          </div>
        </div>
        <div className={s.footGroups}>
          {FOOT_GROUPS.map((g, i) => {
            const open = foot === i;
            return (
              <div key={g.name} className={s.footGroup}>
                <button type="button" aria-expanded={open} aria-controls={`foot-m-${i}`} onClick={() => setFoot(open ? -1 : i)} className={s.footBtn}>
                  {g.name}
                  <span className={s.footChev} data-open={open || undefined}><Chevron size={14} /></span>
                </button>
                <div id={`foot-m-${i}`} className={s.footLinks} hidden={!open}>
                  {g.links.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
                </div>
              </div>
            );
          })}
        </div>
        <div className={s.footBottom}>
          <p className={s.disclaimer}>המידע באתר כללי בלבד ואינו תחליף לייעוץ רפואי. התאמת טיפול נבחנת מול איש מקצוע מוסמך. טיפולים אסתטיים אינם בסל הבריאות.</p>
          <div className={s.footMeta}>
            <span dir="ltr" className={s.iso}>© {new Date().getFullYear()} BeautyFind</span>
            <Link href={ROUTES.accessibility} className={s.a11y}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><circle cx="8" cy="3" r="1.3" /><path d="M3 6h10M8 6v4l-2.5 4M8 10l2.5 4" /></svg>
              הצהרת נגישות
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
