'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { GROUP_ORDER, MENU_REGION_ORDER, categoriesInGroup, citiesOf, cityHref, regionBySlug } from '@/lib/catalog';
import { ROUTES } from '@/lib/routes';
import { TABS, isTabRoot } from '@/lib/ui/shell';
import { ChevronDown } from '../icons';
import { SearchIcon, TopBar } from '../shell/TopBar';
import { Wordmark } from '../Wordmark';
import styles from './SiteHeader.module.css';

type Menu = 'loc' | 'svc' | null;

const BIZ_LINKS = { login: ROUTES.bizLogin, join: ROUTES.join };

export type HeaderVariant = 'business' | 'public';

const MENU_REGIONS = MENU_REGION_ORDER.map(slug => regionBySlug(slug)!);
const MEGA_CITY_LIMIT = 9;

/**
 * Site header.
 * - business: Get Listed and the /for-business funnel (tag next to the logo, regions + services mega, login + register).
 * - public: every interior client page (regions mega, treatments link, one "לעסקים" button, 1320px wide).
 * Desktop ≥760px: nav + mega menu. Below: hamburger opening a full-screen sheet.
 * Breakpoints are CSS media queries only, so SSR markup is correct at any width.
 */
export function SiteHeader({
  variant = 'business',
  title,
  backHref,
  largeTitle,
}: {
  variant?: HeaderVariant;
  /** App shell (phones): title of a pushed screen, shown centred in the top bar. */
  title?: string;
  /** App shell: where back goes on a deep link. */
  backHref?: string;
  /** App shell: large title for a root screen. */
  largeTitle?: string;
}) {
  const pub = variant === 'public';
  const path = usePathname() ?? '';
  const root = isTabRoot(TABS.client, path);
  const cur = (prefix: string) => (path === prefix || path.startsWith(prefix + '/') ? ('page' as const) : undefined);
  const [menu, setMenu] = useState<Menu>(null);
  const [megaIndex, setMegaIndex] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenu(null);
        setMobileOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const locOpen = menu === 'loc';
  const toggle = (m: Exclude<Menu, null>) => {
    setMenu(cur => (cur === m ? null : m));
    setMegaIndex(0);
  };
  const toggleMobile = () => {
    setMobileOpen(o => !o);
    setMenu(mobileOpen ? null : 'loc');
    setMegaIndex(0);
  };
  const close = () => {
    setMenu(null);
    setMobileOpen(false);
  };

  const leftNames = locOpen ? MENU_REGIONS.map(r => r.name) : GROUP_ORDER;
  const mi = Math.min(megaIndex, leftNames.length - 1);
  const region = MENU_REGIONS[mi];
  const group = GROUP_ORDER[mi];
  const rightTitle = locOpen ? `ערים באזור ${region.name}` : group;
  const rightAll = locOpen ? { href: `/${region.slug}`, label: 'כל האזור' } : { href: '/treatments', label: 'כל התחומים' };
  const rightLinks = locOpen
    ? citiesOf(region.slug).slice(0, MEGA_CITY_LIMIT).map(ct => ({ name: ct.name, href: cityHref(ct) }))
    : categoriesInGroup(group).map(ct => ({ name: ct.name, href: `/treatments/${ct.slug}` }));

  const leftList = (variant: 'mega' | 'chip') =>
    leftNames.map((name, i) => {
      const on = i === mi;
      return (
        <button
          key={name}
          type="button"
          className={variant === 'mega' ? styles.megaItem : styles.chip}
          data-on={on || undefined}
          onClick={() => setMegaIndex(i)}
          onMouseEnter={variant === 'mega' ? () => setMegaIndex(i) : undefined}
        >
          {name}
        </button>
      );
    });

  return (
    <>
      <TopBar
        mode={root ? 'root' : 'pushed'}
        title={title}
        largeTitle={largeTitle}
        backHref={backHref ?? '/'}
        actions={path === '/search' ? [] : [{ label: 'חיפוש', href: '/search', icon: SearchIcon }]}
      />
      <header className={`${styles.header} bf-desk-only`}>
        <div className={styles.bar} data-wide={pub || undefined}>
          <Link href="/" aria-label="BeautyFind, לדף הבית" className={styles.brand} onClick={close}>
            <Wordmark size={28} />
            {!pub && <span className={styles.brandTag}>לעסקים</span>}
          </Link>

          <nav aria-label="ראשי" className={styles.nav}>
            <button type="button" className={styles.navBtn} data-on={locOpen || undefined} aria-expanded={locOpen} onClick={() => toggle('loc')}>
              אזורים<ChevronDown />
            </button>
            {pub ? (
              <>
                <Link href="/treatments" className={styles.navLink} aria-current={cur('/treatments')}>תחומי טיפול</Link>
                <Link href="/magazine" className={styles.navLink} aria-current={cur('/magazine')}>מדריכים</Link>
                <Link href="/about" className={styles.navLink} aria-current={cur('/about')}>אודות</Link>
              </>
            ) : (
              <>
                <button type="button" className={styles.navBtn} data-on={menu === 'svc' || undefined} aria-expanded={menu === 'svc'} onClick={() => toggle('svc')}>
                  תחומי טיפול<ChevronDown />
                </button>
                <Link href="/about" className={styles.navLink}>אודות</Link>
                <Link href="/magazine" className={styles.navLink}>מדריכים</Link>
              </>
            )}
          </nav>
          <div className={styles.actions}>
            {pub ? (
              <Link href={ROUTES.forBusiness} className={styles.cta}>לעסקים</Link>
            ) : (
              <>
                <Link href={BIZ_LINKS.login} className={styles.login}>כניסת בעלי עסקים</Link>
                <Link href={BIZ_LINKS.join} className={styles.cta}>רישום העסק</Link>
              </>
            )}
          </div>

          <button type="button" className={styles.burger} aria-label="תפריט" aria-expanded={mobileOpen} onClick={toggleMobile}>
            <span />
            <span />
          </button>
        </div>

        {menu && (
          <div className={styles.mega}>
            <div className={styles.megaInner} data-wide={pub || undefined}>
              <div className={styles.megaLeft}>
                <div className={styles.label}>{locOpen ? 'אזורים' : 'קטגוריות'}</div>
                {leftList('mega')}
              </div>
              <div>
                <div className={styles.megaHead}>
                  <div className={styles.megaTitle}>{rightTitle}</div>
                  <Link href={rightAll.href} className={styles.megaAll} onClick={close}>{rightAll.label}</Link>
                </div>
                <div className={styles.megaGrid}>
                  {rightLinks.map(l => (
                    <Link key={l.href} href={l.href} className={styles.megaLink} onClick={close}>
                      <span className={styles.megaLinkName}>{l.name}</span>
                      <span dir="ltr" className={styles.megaLinkHref}>{l.href}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </header>

      {mobileOpen && (
        <div role="dialog" aria-label="תפריט" className={`${styles.sheet} bf-desk-only`}>
          {!pub && (
            <div className={styles.sheetTabs}>
              <button type="button" className={styles.sheetTab} data-on={locOpen || undefined} onClick={() => toggle('loc')}>אזורים</button>
              <button type="button" className={styles.sheetTab} data-on={menu === 'svc' || undefined} onClick={() => toggle('svc')}>תחומי טיפול</button>
            </div>
          )}
          {menu && (
            <>
              <div className={styles.label}>{locOpen ? 'אזורים' : 'קטגוריות'}</div>
              <div className={styles.chips}>{leftList('chip')}</div>
              <div className={styles.sheetLinks}>
                {rightLinks.map(l => (
                  <Link key={l.href} href={l.href} className={styles.sheetLink} onClick={close}>
                    {l.name}
                    <span dir="ltr" className={styles.megaLinkHref}>{l.href}</span>
                  </Link>
                ))}
              </div>
            </>
          )}
          <div className={styles.sheetFoot}>
            {pub && <Link href="/treatments" className={styles.sheetPlain} onClick={close}>תחומי טיפול</Link>}
            <Link href="/about" className={styles.sheetPlain} onClick={close}>אודות</Link>
            <Link href="/magazine" className={styles.sheetPlain} onClick={close}>מדריכים</Link>
            {pub ? (
              <Link href={ROUTES.forBusiness} className={styles.sheetCta} onClick={close}>לעסקים</Link>
            ) : (
              <>
                <Link href={BIZ_LINKS.join} className={styles.sheetCta} onClick={close}>רישום העסק</Link>
                <Link href={BIZ_LINKS.login} className={styles.sheetLogin} onClick={close}>כבר רשומים? כניסה לחשבון</Link>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

