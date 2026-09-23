'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { TopBar } from '@/components/shell/TopBar';
import { Wordmark } from '@/components/Wordmark';
import { ROUTES } from '@/lib/routes';
import { WHERE_OPTIONS, cityName, regionName, resolveWhere } from './params';
import { pushRecent } from './recent';
import { useSearch } from './SearchProvider';
import s from './search.module.css';

const DEBOUNCE_MS = 450;

/**
 * Search's own compact header: wordmark, the what + where search bar, and two links on desktop.
 * In the app shell: the tab-root top bar, then one search field pinned under it (the place is a
 * filter chip there, see ResultsToolbar).
 */
export function SearchHeader() {
  const { state, update } = useSearch();
  const placeText = cityName(state.city) ?? regionName(state.region) ?? '';
  const [q, setQ] = useState(state.q);
  const [where, setWhere] = useState(placeText);
  const qRef = useRef<HTMLInputElement>(null);
  const whereRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow URL changes made elsewhere (presets, chips, clear all) unless the user is typing here.
  useEffect(() => {
    if (document.activeElement !== qRef.current && document.activeElement !== phoneRef.current) setQ(state.q);
  }, [state.q]);
  useEffect(() => {
    if (document.activeElement !== whereRef.current) setWhere(placeText);
  }, [placeText]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const schedule = (fn: () => void) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(fn, DEBOUNCE_MS);
  };

  const onQ = (v: string) => {
    setQ(v);
    schedule(() => update({ q: v.trim().slice(0, 80) }));
  };

  const onWhere = (v: string) => {
    setWhere(v);
    // A datalist pick (exact option) or an emptied box applies right away; free text waits for submit.
    if (v.trim() === '' || WHERE_OPTIONS.includes(v.trim())) {
      const loc = resolveWhere(v);
      if (loc) schedule(() => update(loc));
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (timer.current) clearTimeout(timer.current);
    const text = q.trim().slice(0, 80);
    const loc = resolveWhere(where);
    if (loc) update({ q: text, ...loc });
    // Unknown place: search it as text (names and cities both match), keeping the area filters.
    else update({ q: text || where.trim().slice(0, 80) });
    if (text) pushRecent({ label: text, href: `/search?q=${encodeURIComponent(text)}` });
  };

  const clearPhone = () => {
    if (timer.current) clearTimeout(timer.current);
    setQ('');
    update({ q: '' });
    phoneRef.current?.focus();
  };

  // Phone field: the text only; region and city stay as they are (they are filter chips there).
  const onPhoneSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (timer.current) clearTimeout(timer.current);
    const text = q.trim().slice(0, 80);
    update({ q: text });
    if (text) pushRecent({ label: text, href: `/search?q=${encodeURIComponent(text)}` });
    phoneRef.current?.blur();
  };

  return (
    <>
      <TopBar mode="root" />
      <div className={`${s.phoneBar} bf-shell-only`}>
        <form onSubmit={onPhoneSubmit} role="search" className={s.phoneForm}>
          <label htmlFor="q-phone" className="sr-only">חיפוש טיפול, שם עסק או עיר</label>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#5B6B7B" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="8" cy="8" r="5.4" />
            <path d="M12 12l3.4 3.4" />
          </svg>
          <input
            ref={phoneRef}
            id="q-phone"
            type="search"
            value={q}
            onChange={e => onQ(e.target.value)}
            placeholder="טיפול, שם עסק או עיר"
            autoComplete="off"
            enterKeyHint="search"
          />
          {q && (
            <button type="button" className={s.phoneClear} aria-label="ניקוי החיפוש" onClick={clearPhone}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
              </svg>
            </button>
          )}
        </form>
      </div>
      <header className={`${s.header} bf-desk-only`}>
        <div className={s.headerBar}>
          <Link href="/" aria-label="BeautyFind, לדף הבית" className={s.brand}>
            <Wordmark size={27} />
          </Link>

          <form onSubmit={onSubmit} role="search" className={s.searchForm}>
            <label htmlFor="q-what" className="sr-only">טיפול או שם עסק</label>
            <span className={s.field} data-what>
              <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="#8A96A3" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
                <circle cx="8" cy="8" r="5.4" />
                <path d="M12 12l3.4 3.4" />
              </svg>
              <input ref={qRef} id="q-what" type="search" value={q} onChange={e => onQ(e.target.value)} placeholder="בוטוקס, לייזר, שם מכון" autoComplete="off" enterKeyHint="search" />
            </span>
            <span aria-hidden="true" className={s.fieldSep} />
            <label htmlFor="q-where" className="sr-only">מקום</label>
            <span className={s.field}>
              <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="#8A96A3" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7 12.5S2.4 8.9 2.4 6a4.6 4.6 0 1 1 9.2 0c0 2.9-4.6 6.5-4.6 6.5Z" />
                <circle cx="7" cy="5.9" r="1.5" />
              </svg>
              <input ref={whereRef} id="q-where" type="search" list="where-options" value={where} onChange={e => onWhere(e.target.value)} placeholder="עיר או אזור" autoComplete="off" enterKeyHint="search" />
              <datalist id="where-options">
                {WHERE_OPTIONS.map(o => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            </span>
            <button type="submit" className={s.searchBtn}>חיפוש</button>
          </form>

          <nav aria-label="ראשי" className={s.headerNav}>
            <Link href="/magazine" className={s.headerLink}>מדריכים</Link>
            <Link href={ROUTES.forBusiness} className={s.headerCta}>רישום עסק</Link>
          </nav>
        </div>
      </header>
    </>
  );
}
