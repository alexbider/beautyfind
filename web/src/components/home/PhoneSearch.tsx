'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { clearRecent, pushRecent, readRecent, type RecentSearch } from '@/components/search/recent';
import { CATEGORIES, CITIES, REGIONS, type Category } from '@/lib/catalog';
import { PathIcon } from '../icons';
import { CATEGORY_TEASER } from './content';
import styles from './PhoneSearch.module.css';

// Homepage search on phones (responsive spec §6 Homepage): a search field under the large title
// that opens a full-screen search with recent searches and the treatment categories. The top
// bar's search action opens the same screen (openPhoneSearch).

const OPEN_EVENT = 'bf-open-phone-search';
const rName = (slug: string) => REGIONS.find(r => r.slug === slug)?.name ?? '';

export function openPhoneSearch() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

const Glass = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <circle cx="8" cy="8" r="5.5" />
    <path d="m12.5 12.5 3.5 3.5" />
  </svg>
);

/** The field under the large title. Looks like an input; opens the full-screen search. */
export function PhoneSearchField() {
  return (
    <>
      <button type="button" className={styles.field} onClick={openPhoneSearch} aria-haspopup="dialog">
        <Glass />
        <span>טיפול, שם עסק או עיר</span>
      </button>
      <SearchScreen />
    </>
  );
}

function SearchScreen() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [recent, setRecent] = useState<RecentSearch[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);
  const screen = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const on = () => {
      opener.current = document.activeElement;
      setRecent(readRecent());
      setQ('');
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, on);
    return () => window.removeEventListener(OPEN_EVENT, on);
  }, []);

  // Lock the page behind, focus the field, give focus back on close.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.classList.add('bf-sheet-open');
    const t = requestAnimationFrame(() => input.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return setOpen(false);
      // Keep Tab inside the screen while it is open.
      if (e.key !== 'Tab' || !screen.current) return;
      const els = [...screen.current.querySelectorAll<HTMLElement>('a[href], button, input')];
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(t);
      root.classList.remove('bf-sheet-open');
      window.removeEventListener('keydown', onKey);
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const go = (item: RecentSearch) => {
    pushRecent(item);
    setOpen(false);
    router.push(item.href);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = q.trim().slice(0, 80);
    if (!text) return input.current?.focus();
    const cat = CATEGORIES.find(c => c.name === text);
    go(cat ? catItem(cat) : { label: text, href: `/search?q=${encodeURIComponent(text)}` });
  };
  const catItem = (c: Category): RecentSearch => ({ label: c.name, href: `/search?t=${c.slug}` });

  const qt = q.trim();
  const cats = qt ? CATEGORIES.filter(c => c.name.includes(qt)).slice(0, 5) : [];
  const cities = qt ? CITIES.filter(c => c.name.includes(qt)).slice(0, 4) : [];

  // Portalled to <body>: the hero is its own stacking context, and the screen must cover the bars.
  return createPortal(
    <div ref={screen} role="dialog" aria-modal="true" aria-label="חיפוש" className={styles.screen}>
      <form role="search" className={styles.bar} onSubmit={submit}>
        <label htmlFor="ps-q" className="sr-only">חיפוש טיפול, שם עסק או עיר</label>
        <span className={styles.input}>
          <Glass />
          <input
            ref={input}
            id="ps-q"
            type="search"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="טיפול, שם עסק או עיר"
            autoComplete="off"
            enterKeyHint="search"
          />
        </span>
        <button type="button" className={styles.cancel} onClick={() => setOpen(false)}>ביטול</button>
      </form>

      <div className={styles.body}>
        {qt ? (
          <ul className={styles.rows}>
            <li>
              <button type="button" className={styles.row} onClick={() => go({ label: qt, href: `/search?q=${encodeURIComponent(qt)}` })}>
                <span className={styles.rowIcon}><Glass size={16} /></span>
                <span className={styles.rowText}>חיפוש ״{qt}״</span>
              </button>
            </li>
            {cats.map(c => (
              <li key={c.slug}>
                <button type="button" className={styles.row} onClick={() => go(catItem(c))}>
                  <span className={styles.rowIcon}><PathIcon paths={CATEGORY_TEASER[c.slug]?.icon ?? []} size={18} /></span>
                  <span className={styles.rowText}>{c.name}</span>
                  <span className={styles.rowMeta}>{c.group}</span>
                </button>
              </li>
            ))}
            {cities.map(c => (
              <li key={c.slug}>
                <button type="button" className={styles.row} onClick={() => go({ label: c.name, href: `/search?region=${c.region}&city=${c.slug}` })}>
                  <span className={styles.rowIcon}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                      <path d="M8 14.5s5-4.2 5-8A5 5 0 0 0 3 6.5c0 3.8 5 8 5 8Z" />
                      <circle cx="8" cy="6.4" r="1.9" />
                    </svg>
                  </span>
                  <span className={styles.rowText}>{c.name}</span>
                  <span className={styles.rowMeta}>{rName(c.region)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <>
            {recent.length > 0 && (
              <section aria-labelledby="ps-recent">
                <div className={styles.head}>
                  <h2 id="ps-recent" className={styles.h}>חיפושים אחרונים</h2>
                  <button
                    type="button"
                    className={styles.clear}
                    onClick={() => {
                      clearRecent();
                      setRecent([]);
                      input.current?.focus();
                    }}
                  >
                    ניקוי
                  </button>
                </div>
                <ul className={styles.rows}>
                  {recent.map(r => (
                    <li key={r.href}>
                      <button type="button" className={styles.row} onClick={() => go(r)}>
                        <span className={styles.rowIcon}>
                          <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <circle cx="9" cy="9" r="6.6" />
                            <path d="M9 5.2V9l2.6 1.6" />
                          </svg>
                        </span>
                        <span className={styles.rowText}>{r.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section aria-labelledby="ps-cats">
              <div className={styles.head}>
                <h2 id="ps-cats" className={styles.h}>תחומי טיפול</h2>
                <Link href="/treatments" className={styles.clear} onClick={() => setOpen(false)}>הכול</Link>
              </div>
              <ul className={styles.rows}>
                {CATEGORIES.map(c => (
                  <li key={c.slug}>
                    <button type="button" className={styles.row} onClick={() => go(catItem(c))}>
                      <span className={styles.rowIcon}><PathIcon paths={CATEGORY_TEASER[c.slug]?.icon ?? []} size={18} /></span>
                      <span className={styles.rowText}>{c.name}</span>
                      <span className={styles.rowMeta}>{c.group}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
