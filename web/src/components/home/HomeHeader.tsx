'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CITIES, GROUP_ORDER, categoriesInGroup, categoryHref, type RegionSlug } from '@/lib/catalog';
import { ROUTES } from '@/lib/routes';
import { ArrowForward, Check, ChevronDown } from '../icons';
import { Wordmark } from '../Wordmark';
import { focusHeroSearch, regionName, useRegion, type RegionChoice } from './regionStore';
import styles from './HomeHeader.module.css';

// Homepage header (design: BeautyFind Homepage.dc.html). Links to the same routes as the public
// SiteHeader: /, /:region, /:region/:city, /treatments(/:category), /magazine, /about, /for-business.
// Desktop from 760px (CSS only): "find" mega (regions with cities), treatments mega, region picker,
// and a compact search button once the hero search has scrolled away. Below 760px: region button + sheet.

export interface HeaderRegion {
  slug: RegionSlug;
  name: string;
  count: number;
  cities: Array<{ name: string; href: string }>;
}

type Menu = 'find' | 'treat' | null;

const TREAT_GROUPS = GROUP_ORDER.map(g => ({ name: g, items: categoriesInGroup(g).map(c => ({ name: c.name, href: categoryHref(c) })) }));
const SCROLLED_AT = 560;

function SearchIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" />
      <path d="m12.5 12.5 3.5 3.5" />
    </svg>
  );
}

export function PinIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M8 14.5s5-4.2 5-8A5 5 0 0 0 3 6.5c0 3.8 5 8 5 8Z" />
      <circle cx="8" cy="6.4" r="1.9" />
    </svg>
  );
}

export function HomeHeader({ regions, total }: { regions: HeaderRegion[]; total: number }) {
  const [region, setRegion] = useRegion();
  const [menu, setMenu] = useState<Menu>(null);
  const [regionOpen, setRegionOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileSection, setMobileSection] = useState<Menu>(null);
  const [scrolled, setScrolled] = useState(false);
  const findBtn = useRef<HTMLButtonElement>(null);
  const treatBtn = useRef<HTMLButtonElement>(null);
  const regionBtn = useRef<HTMLButtonElement>(null);
  const mobileRegionBtn = useRef<HTMLButtonElement>(null);
  const burger = useRef<HTMLButtonElement>(null);

  const closeAll = () => {
    setMenu(null);
    setRegionOpen(false);
    setMobileOpen(false);
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > SCROLLED_AT);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Escape closes whatever is open and returns focus to its trigger; a click outside closes too.
  const openRef = useRef({ menu, regionOpen, mobileOpen });
  openRef.current = { menu, regionOpen, mobileOpen };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const o = openRef.current;
      if (!o.menu && !o.regionOpen && !o.mobileOpen) return;
      const desk = window.matchMedia('(min-width: 768px)').matches;
      const back = o.menu === 'find' ? findBtn : o.menu === 'treat' ? treatBtn : o.regionOpen ? (desk ? regionBtn : mobileRegionBtn) : burger;
      closeAll();
      back.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const o = openRef.current;
      const inside = e.target instanceof Element && e.target.closest('[data-home-layer]');
      if ((o.menu || o.regionOpen) && !inside) {
        setMenu(null);
        setRegionOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, []);

  const toggleMenu = (m: Exclude<Menu, null>) => {
    setMenu(cur => (cur === m ? null : m));
    setRegionOpen(false);
  };
  const pick = (r: RegionChoice) => {
    setRegion(r);
    setRegionOpen(false);
    setMobileOpen(false);
  };
  const search = (field: 'q' | 'loc') => {
    closeAll();
    focusHeroSearch(field);
  };

  const options: Array<{ slug: RegionChoice; name: string; count: number }> = [
    { slug: 'all', name: 'כל הארץ', count: total },
    ...regions.map(r => ({ slug: r.slug, name: r.name, count: r.count })),
  ];
  const name = regionName(region);

  return (
    <>
      <header data-home-layer className={styles.header} data-scrolled={scrolled || undefined}>
        <div className={styles.bar}>
          <Link href="/" aria-label="BeautyFind, לדף הבית" className={styles.brand} onClick={closeAll}>
            <Wordmark size={28} />
          </Link>

          <nav aria-label="ראשי" className={styles.nav}>
            {scrolled && (
              <button type="button" className={styles.compact} onClick={() => search('q')}>
                <SearchIcon />
                חיפוש עסקים
              </button>
            )}
            <button
              ref={findBtn}
              type="button"
              className={styles.navBtn}
              data-on={menu === 'find' || undefined}
              aria-expanded={menu === 'find'}
              aria-controls="home-mega-find"
              onClick={() => toggleMenu('find')}
            >
              איתור עסק<ChevronDown />
            </button>
            <button
              ref={treatBtn}
              type="button"
              className={styles.navBtn}
              data-on={menu === 'treat' || undefined}
              aria-expanded={menu === 'treat'}
              aria-controls="home-mega-treat"
              onClick={() => toggleMenu('treat')}
            >
              תחומי טיפול<ChevronDown />
            </button>
            <Link href="/magazine" className={styles.navLink}>מדריכים</Link>
            <Link href="/about" className={styles.navLink}>אודות</Link>
          </nav>

          <div className={styles.actions}>
            <div className={styles.pickerWrap}>
              <button
                ref={regionBtn}
                type="button"
                className={styles.picker}
                aria-expanded={regionOpen}
                aria-controls="home-region-list"
                aria-label={`אזור נבחר: ${name}. שינוי אזור`}
                onClick={() => {
                  setRegionOpen(o => !o);
                  setMenu(null);
                }}
              >
                <PinIcon />
                {name}
                <ChevronDown />
              </button>
              {regionOpen && (
                <ul id="home-region-list" className={styles.regionList} aria-label="בחרו אזור">
                  {options.map(o => {
                    const on = o.slug === region;
                    return (
                      <li key={o.slug}>
                        <button type="button" className={styles.regionOpt} aria-pressed={on} data-on={on || undefined} onClick={() => pick(o.slug)}>
                          <span className={styles.optName}>{o.name}</span>
                          <span className={`${styles.optCount} ltr`}>{o.count}</span>
                          <span className={styles.optCheck}>{on && <Check size={13} />}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <Link href={ROUTES.forBusiness} className={styles.biz}>לעסקים</Link>
          </div>

          <div className={styles.mobileActions}>
            <button
              ref={mobileRegionBtn}
              type="button"
              className={styles.mobileRegion}
              aria-expanded={regionOpen}
              aria-controls="home-region-sheet"
              aria-label={`אזור נבחר: ${name}. שינוי אזור`}
              onClick={() => {
                setRegionOpen(o => !o);
                setMobileOpen(false);
              }}
            >
              <PinIcon size={15} />
              {name}
            </button>
            <button
              ref={burger}
              type="button"
              className={styles.burger}
              aria-label={mobileOpen ? 'סגירת התפריט' : 'פתיחת התפריט'}
              aria-expanded={mobileOpen}
              aria-controls="home-mobile-menu"
              onClick={() => {
                setMobileOpen(o => !o);
                setRegionOpen(false);
              }}
            >
              <span />
              <span />
            </button>
          </div>
        </div>

        {menu === 'find' && (
          <div id="home-mega-find" className={styles.mega} onMouseLeave={() => setMenu(null)}>
            <div className={styles.findGrid}>
              {regions.map(r => (
                <div key={r.slug} className={styles.megaCol}>
                  <Link href={`/${r.slug}`} className={styles.megaRegion} onClick={closeAll}>
                    <span className={styles.megaRegionName}>{r.name}</span>
                    <span className={styles.megaRegionCta}>לאזור<ArrowForward size={14} /></span>
                  </Link>
                  {r.cities.map(ct => (
                    <Link key={ct.href} href={ct.href} className={styles.megaLink} onClick={closeAll}>{ct.name}</Link>
                  ))}
                </div>
              ))}
              <div className={styles.megaHelp}>
                <div className={styles.megaHelpLabel}>לא מצאתם את העיר שלכם?</div>
                <p>
                  האינדקס מכסה <span className="ltr">{CITIES.length}</span> ערים בכל שבעת האזורים. חפשו כל עיר או יישוב, או עברו לדף אזור לרשימה המלאה.
                </p>
                <button type="button" className={styles.megaHelpBtn} onClick={() => search('loc')}>חיפוש לפי מקום</button>
              </div>
            </div>
          </div>
        )}

        {menu === 'treat' && (
          <div id="home-mega-treat" className={styles.mega} onMouseLeave={() => setMenu(null)}>
            <div className={styles.treatGrid}>
              {TREAT_GROUPS.map(g => (
                <div key={g.name} className={styles.megaCol}>
                  <div className={styles.megaGroup}>{g.name}</div>
                  {g.items.map(t => (
                    <Link key={t.href} href={t.href} className={`${styles.megaLink} ${styles.megaLinkTall}`} onClick={closeAll}>{t.name}</Link>
                  ))}
                </div>
              ))}
            </div>
            <div className={styles.megaFoot}>
              <div className={styles.megaFootInner}>
                <span>דפי הטיפולים הם מידע כללי בלבד. התאמת טיפול לגופכם צריכה להיבחן מול איש מקצוע מוסמך.</span>
                <Link href="/treatments" className={styles.megaFootLink} onClick={closeAll}>כל תחומי הטיפול<ArrowForward size={14} /></Link>
              </div>
            </div>
          </div>
        )}
      </header>

      {mobileOpen && (
        <div id="home-mobile-menu" role="dialog" aria-label="תפריט" className={styles.sheet}>
          <div className={styles.sheetList}>
            {(['find', 'treat'] as const).map(key => {
              const open = mobileSection === key;
              const groups =
                key === 'find'
                  ? regions.map(r => ({ name: r.name, href: `/${r.slug}`, cta: 'לאזור', items: r.cities.slice(0, 3) }))
                  : TREAT_GROUPS.map(g => ({ name: g.name, href: '/treatments', cta: '', items: g.items }));
              return (
                <div key={key} className={styles.sheetSection}>
                  <button
                    type="button"
                    className={styles.sheetToggle}
                    aria-expanded={open}
                    aria-controls={`home-sheet-${key}`}
                    onClick={() => setMobileSection(s => (s === key ? null : key))}
                  >
                    {key === 'find' ? 'איתור עסק' : 'תחומי טיפול'}
                    <span aria-hidden="true" className={styles.sheetPlus}>+</span>
                  </button>
                  {open && (
                    <div id={`home-sheet-${key}`} className={styles.sheetBody}>
                      {groups.map(g => (
                        <div key={g.name}>
                          <Link href={g.href} className={styles.sheetGroup} onClick={closeAll}>
                            {g.name}
                            {g.cta && <span className={styles.sheetGroupCta}>{g.cta}</span>}
                          </Link>
                          <div className={styles.sheetChips}>
                            {g.items.map(it => (
                              <Link key={it.href} href={it.href} className={styles.sheetChip} onClick={closeAll}>{it.name}</Link>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <Link href="/magazine" className={styles.sheetPlain} onClick={closeAll}>מדריכים</Link>
            <Link href="/about" className={styles.sheetPlain} onClick={closeAll}>אודות</Link>
          </div>
          <div className={styles.sheetRegions}>
            <div className={styles.sheetLabel}>אזור</div>
            <div className={styles.sheetRegionGrid}>
              {options.map(o => {
                const on = o.slug === region;
                return (
                  <button key={o.slug} type="button" className={styles.sheetRegion} aria-pressed={on} data-on={on || undefined} onClick={() => pick(o.slug)}>
                    <span>{o.name}</span>
                    <span className={`${styles.sheetRegionCount} ltr`}>{o.count}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <Link href={ROUTES.forBusiness} className={styles.sheetBiz} onClick={closeAll}>לעסקים</Link>
        </div>
      )}

      {regionOpen && (
        <div id="home-region-sheet" data-home-layer role="dialog" aria-label="בחרו אזור" className={styles.regionSheet}>
          <div className={styles.sheetLabel}>חיפוש עסקים באזור</div>
          <div className={styles.regionSheetList}>
            {options.map(o => {
              const on = o.slug === region;
              return (
                <button key={o.slug} type="button" className={styles.regionSheetOpt} aria-pressed={on} data-on={on || undefined} onClick={() => pick(o.slug)}>
                  <span className={styles.optName}>{o.name}</span>
                  <span className={`${styles.optCount} ltr`}>{o.count}</span>
                  <span className={styles.optCheck}>{on && <Check size={13} />}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
