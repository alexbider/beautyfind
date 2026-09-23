'use client';

import { useEffect, useRef, useState } from 'react';
import { PriceOption, ResultCount } from './Plural';
import { FEATURES, MAP_VIEW, SORTS, categoryName, cityName, hasPanelFilters, priceOptionName, regionName, resultsText, type SearchState, type ViewKey } from './params';
import { useSearch } from './SearchProvider';
import s from './search.module.css';

const VIEWS: Array<{ key: ViewKey; label: string; icon: string[] }> = [
  { key: 'list', label: 'רשימה', icon: ['M2.5 4h11', 'M2.5 8h11', 'M2.5 12h11'] },
  { key: 'grid', label: 'רשת', icon: ['M2.5 2.5h4.5v4.5h-4.5z', 'M9 2.5h4.5v4.5H9z', 'M2.5 9h4.5v4.5h-4.5z', 'M9 9h4.5v4.5H9z'] },
  { key: 'map', label: 'מפה', icon: ['M8 14.5s4.8-4.2 4.8-7.7A4.8 4.8 0 0 0 3.2 6.8C3.2 10.3 8 14.5 8 14.5Z', 'M8 8.6a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6'] },
];

/** Active filters as removable chips, in panel order. */
function activeChips(st: SearchState): Array<{ key: string; name: string; label: React.ReactNode; patch: Partial<SearchState> }> {
  const out: Array<{ key: string; name: string; label: React.ReactNode; patch: Partial<SearchState> }> = [];
  if (st.region) out.push({ key: 'region', name: regionName(st.region)!, label: regionName(st.region), patch: { region: null, city: null } });
  if (st.city) out.push({ key: 'city', name: cityName(st.city)!, label: cityName(st.city), patch: { city: null } });
  if (st.t) out.push({ key: 't', name: categoryName(st.t)!, label: categoryName(st.t), patch: { t: null } });
  for (const f of FEATURES) if (st.f.includes(f.key)) out.push({ key: f.key, name: f.name, label: f.name, patch: { f: st.f.filter(x => x !== f.key) } });
  if (st.price != null) out.push({ key: 'price', name: priceOptionName(st.price), label: <PriceOption max={st.price} />, patch: { price: null } });
  return out;
}

/** Results heading (count, announced), mobile filter button, sort menu, view switch, active-filter chips. */
export function ResultsToolbar() {
  const { state, total, pending, update, view, setView, panelOpen, setPanelOpen } = useSearch();
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const chips = activeChips(state);
  const filtered = hasPanelFilters(state);
  const sortLabel = SORTS.find(x => x.key === state.sort)?.short ?? 'התאמה';

  useEffect(() => {
    if (!sortOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!sortRef.current?.contains(e.target as Node)) setSortOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSortOpen(false);
        sortRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [sortOpen]);

  return (
    <>
      <div className={s.toolbar}>
        <h2 id="h-results" tabIndex={-1} className={s.resultsHeading}>
          <ResultCount n={total} />
        </h2>
        {/* Announces the new count (or the loading state) after every filter change. */}
        <p role="status" aria-live="polite" className="sr-only">
          {pending ? 'טוען תוצאות' : `נמצאו ${resultsText(total)}`}
        </p>
        <button type="button" id="open-filters" className={s.filterBtn} data-active={filtered || undefined} aria-controls="filters" aria-expanded={panelOpen} onClick={() => setPanelOpen(true)}>
          סינון
          {chips.length > 0 && <span className={`${s.badge} ltr`}>{chips.length}</span>}
        </button>
        <div className={s.toolbarEnd}>
          <div ref={sortRef} className={s.sortWrap}>
            <button type="button" className={s.sortBtn} aria-expanded={sortOpen} aria-haspopup="true" onClick={() => setSortOpen(o => !o)}>
              <span className={s.sortKey}>מיון</span>
              <span className={s.sortVal}>{sortLabel}</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: 0.6 }}>
                <path d="M2.5 4.5 6 8l3.5-3.5" />
              </svg>
            </button>
            {sortOpen && (
              <div role="group" aria-label="מיון תוצאות" className={s.sortMenu}>
                {SORTS.map(o => {
                  const on = state.sort === o.key;
                  return (
                    <button
                      key={o.key}
                      type="button"
                      className={s.sortItem}
                      aria-pressed={on}
                      onClick={() => {
                        setSortOpen(false);
                        if (!on) update({ sort: o.key });
                      }}
                    >
                      <span>{o.name}</span>
                      <span aria-hidden="true" className={s.sortTick}>{on ? '✓' : ''}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div role="group" aria-label="תצוגת תוצאות" className={s.viewSwitch}>
            {VIEWS.filter(v => v.key !== 'map' || MAP_VIEW).map(v => (
              <button key={v.key} type="button" className={s.viewBtn} aria-pressed={view === v.key} aria-label={v.label} title={v.label} onClick={() => setView(v.key)}>
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {v.icon.map(d => (
                    <path key={d} d={d} />
                  ))}
                </svg>
              </button>
            ))}
          </div>
        </div>
      </div>

      {chips.length > 0 && (
        <div role="group" aria-label="סינונים פעילים" className={s.activeRow}>
          <span className={s.activeLabel}>מסונן לפי</span>
          {chips.map(c => (
            <button key={c.key} type="button" className={s.activeChip} aria-label={`הסרת הסינון ${c.name}`} onClick={() => update(c.patch, { focus: 'results' })}>
              {c.label}
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#5B6B7B" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
              </svg>
            </button>
          ))}
          <button type="button" className={s.activeClear} onClick={() => update({ region: null, city: null, t: null, f: [], price: null }, { focus: 'results' })}>
            נקו הכול
          </button>
        </div>
      )}
    </>
  );
}
