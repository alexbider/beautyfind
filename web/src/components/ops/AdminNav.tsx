'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { AREA_HREF, AREA_NAMES, type Area } from './roles';
import styles from './shell.module.css';

// The sidebar and the top bar of the master admin. Client-side only for the phone menu (open /
// close) and for marking the current item from the path; everything shown comes from the server.

export type NavItem = { area: Area; count?: number; tone?: 'bad' | 'warn' | 'ok' };
export type NavGroup = { name: string; items: NavItem[] };

const ICONS: Record<Area, ReactNode> = {
  overview: <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />,
  businesses: <path d="M3 11 12 4l9 7M5 10v10h14V10M10 20v-6h4v6" />,
  clients: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" />,
  bookings: <path d="M4 5h16v15H4zM4 10h16M8 3v4M16 3v4" />,
  disputes: <path d="M12 3 2 20h20zM12 10v4M12 17h.01" />,
  sponsored: <path d="M4 10v4h3l6 4V6L7 10zM16 9a4 4 0 0 1 0 6" />,
  moderation: <path d="m12 3 2.7 5.6 6.3.9-4.5 4.4 1 6.1L12 17l-5.5 3 1-6.1L3 9.5l6.3-.9z" />,
  verification: <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6zM9 12l2 2 4-4" />,
  import: <path d="M12 3v12M7 10l5 5 5-5M4 19h16" />,
  accounting: <path d="M5 3h14v18H5zM9 8h6M9 12h6M9 16h4" />,
  content: <path d="M4 6h16M4 10h16M4 14h10M4 18h7" />,
  magazine: <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM8 8h7M8 12h7M8 16h4" />,
  messages: <path d="M4 5h16v11H9l-5 4z" />,
  ai: <path d="M12 2v4M12 18v4M2 12h4M18 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />,
  integrations: <path d="M9 3v4M15 3v4M6 7h12v5a6 6 0 0 1-12 0zM12 18v3" />,
  team: <path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M15 20a5 5 0 0 1 6-4" />,
  audit: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />,
  settings: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4" />,
  health: <path d="M3 12h4l2-5 4 10 2-5h6" />,
};

function Icon({ area }: { area: Area }) {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[area]}
    </svg>
  );
}

function current(path: string, area: Area): boolean {
  const href = AREA_HREF[area];
  if (href === '/ops') return path === '/ops' || path === '/ops/search';
  return path === href || path.startsWith(href + '/');
}

export function AdminNav({
  groups, who, role, email, staging, children,
}: { groups: NavGroup[]; who: string; role: string; email: string; staging: boolean; children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div dir="rtl" lang="he" className={styles.root} data-open={open ? 'true' : 'false'}>
      <aside className={styles.side} aria-label="תפריט הניהול">
        <div className={styles.brand}>
          <Link href="/ops" dir="ltr" className={styles.mark} aria-label="BeautyFind, ניהול">
            beauty<span className={styles.markFind}>find.</span>
          </Link>
          <div className={styles.brandSub}>ניהול ראשי · {staging ? 'בדיקה' : 'ייצור'}</div>
        </div>
        <nav className={styles.nav}>
          {groups.map(g => (
            <div key={g.name}>
              <div className={styles.group}>{g.name}</div>
              {g.items.map(it => (
                <Link key={it.area} href={AREA_HREF[it.area]} className={styles.item} aria-current={current(path, it.area) ? 'page' : undefined}>
                  <Icon area={it.area} />
                  <span className={styles.itemName}>{AREA_NAMES[it.area]}</span>
                  {it.count ? <span className={styles.count} data-tone={it.tone ?? 'warn'}>{it.count.toLocaleString('he-IL')}</span> : null}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className={styles.user}>
          <span className={styles.avatar} aria-hidden="true">{who.trim().charAt(0) || '·'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className={styles.userName}>{who}</div>
            <div className={styles.userRole}>{role}{email ? <span dir="ltr"> · {email}</span> : null}</div>
            <form action="/logout" method="post" className={styles.out}>
              <input type="hidden" name="to" value="/ops/login" />
              <button type="submit">יציאה</button>
            </form>
          </div>
        </div>
      </aside>
      {open ? <button type="button" className={styles.scrim} aria-label="סגירת התפריט" onClick={() => setOpen(false)} /> : null}
      <div className={styles.main}>
        <header className={styles.top}>
          <button type="button" className={styles.menuBtn} aria-label="פתיחת התפריט" aria-expanded={open} onClick={() => setOpen(o => !o)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <form action="/ops/search" method="get" role="search" className={styles.search}>
            <div className={styles.searchBox}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input name="q" className={styles.searchInput} placeholder="חיפוש עסק, ע.מ., מסמך או מסך" aria-label="חיפוש בניהול" autoComplete="off" />
            </div>
          </form>
          <span className={styles.env} data-staging={staging ? 'true' : 'false'}><span className={styles.envDot} aria-hidden="true" />{staging ? 'בדיקה' : 'ייצור'}</span>
          <Link href="/ops/ai" className={styles.assist}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" /></svg>
            שאלו את העוזר
          </Link>
        </header>
        {children}
      </div>
    </div>
  );
}
