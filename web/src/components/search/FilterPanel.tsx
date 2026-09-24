'use client';

import { useState } from 'react';
import { BottomSheet } from '@/components/shell/BottomSheet';
import { CATEGORIES, REGIONS, citiesOf } from '@/lib/catalog';
import { BizCount, PriceOption, ResultCount } from './Plural';
import { FEATURES, PRICE_TIERS, hasPanelFilters, type FeatureKey } from './params';
import { useSearch } from './SearchProvider';
import s from './search.module.css';

export interface FacetCounts {
  total: number;
  region: Record<string, number | undefined>;
  city: Record<string, number | undefined>;
  category: Record<string, number | undefined>;
}

type GroupKey = 'treat' | 'feat' | 'price';

// Languages (design group "שפות") are not in the data model, so that group is left out.
// "פתוח כרגע" is left out too: listBranches cannot filter by opening hours yet.

/**
 * Filter panel: a sticky sidebar from 1024px; below it the same controls open in a bottom sheet
 * (a centred dialog from 768px) with a sticky "הצגת N תוצאות" button (responsive spec §3).
 * Counts are live listing counts per region, city and category across the whole index.
 */
export function FilterPanel({ counts }: { counts: FacetCounts }) {
  const { state, total, pending, update, panelOpen, setPanelOpen } = useSearch();
  const filtered = hasPanelFilters(state);
  const clearAll = (focus?: 'results') => update({ region: null, city: null, t: null, f: [], price: null }, { focus });

  return (
    <>
      <aside id="filters" aria-label="סינון" className={s.panel}>
        <div className={s.panelHead}>
          <span className={s.panelTitle}>סינון</span>
          {filtered && (
            <button type="button" className={s.linkBtn} onClick={() => clearAll('results')}>
              איפוס הכול
            </button>
          )}
        </div>
        <FilterFields counts={counts} idPrefix="fp" />
        <p className={s.fsHint} data-foot>לפי המחיר ההתחלתי שהעסק פרסם, לא כולל מע״מ.</p>
      </aside>

      <BottomSheet
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title="סינון"
        size="full"
        footer={
          <div className={s.sheetFoot}>
            {filtered && (
              <button type="button" className={s.sheetReset} onClick={() => clearAll()}>
                איפוס
              </button>
            )}
            <button type="button" className={s.showBtn} aria-busy={pending || undefined} onClick={() => setPanelOpen(false)}>
              {pending ? 'מעדכנים את התוצאות…' : total === 0 ? 'אין תוצאות, חזרה לרשימה' : <>הצגת <ResultCount n={total} /></>}
            </button>
          </div>
        }
      >
        <FilterFields counts={counts} idPrefix="fs" />
        <p className={s.fsHint} data-foot>לפי המחיר ההתחלתי שהעסק פרסם, לא כולל מע״מ.</p>
      </BottomSheet>
    </>
  );
}

/** Region, city, treatment, features and price. Rendered in the sidebar and in the sheet. */
function FilterFields({ counts, idPrefix }: { counts: FacetCounts; idPrefix: string }) {
  const { state, update } = useSearch();
  const [open, setOpen] = useState<Record<GroupKey, boolean>>({ treat: true, feat: true, price: true });

  const toggleFeature = (k: FeatureKey) => update({ f: state.f.includes(k) ? state.f.filter(x => x !== k) : [...state.f, k] });
  const cities = state.region ? citiesOf(state.region) : [];

  const group = (key: GroupKey, name: string, picks: number, body: React.ReactNode) => (
    <fieldset className={s.group}>
      <legend className={s.groupLegend}>
        <button type="button" className={s.groupToggle} aria-expanded={open[key]} aria-controls={`${idPrefix}-${key}`} onClick={() => setOpen(o => ({ ...o, [key]: !o[key] }))}>
          <span className={s.fsLabel}>{name}</span>
          <span className={s.groupMeta}>
            {picks > 0 && <span className={`${s.badge} ltr`}>{picks}</span>}
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#5B6B7B" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={s.groupChevron} data-open={open[key] || undefined}>
              <path d="M2.5 4.5 6 8l3.5-3.5" />
            </svg>
          </span>
        </button>
      </legend>
      {open[key] && (
        <div id={`${idPrefix}-${key}`} className={s.options}>
          {body}
        </div>
      )}
    </fieldset>
  );

  const option = (p: { key: string; name: React.ReactNode; on: boolean; round?: boolean; count?: number; onClick: () => void }) => (
    <button key={p.key} type="button" className={s.option} aria-pressed={p.on} data-dim={p.count === 0 && !p.on ? '' : undefined} onClick={p.onClick}>
      <span aria-hidden="true" className={s.box} data-on={p.on || undefined} data-round={p.round || undefined}>
        {p.on ? '✓' : ''}
      </span>
      <span className={s.optionName}>{p.name}</span>
      {p.count != null && <span className={`${s.optionCount} ltr`}>{p.count}</span>}
    </button>
  );

  return (
    <>
      <fieldset className={s.fs}>
        <legend className={s.fsLabel}>אזור</legend>
        <div className={s.regionGrid}>
          {[{ slug: null, name: 'כל הארץ' }, ...REGIONS].map(r => {
            const on = state.region === r.slug;
            const n = r.slug ? counts.region[r.slug] ?? 0 : counts.total;
            return (
              <button key={r.slug ?? 'all'} type="button" className={s.regionBtn} aria-pressed={on} onClick={() => update({ region: r.slug, city: null })}>
                {r.name}
                <span className={s.regionCount}>
                  <BizCount n={n} />
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className={s.fs}>
        <legend className={s.fsLabel}>עיר</legend>
        {cities.length ? (
          <div className={s.cityRow}>
            {cities.map(c => {
              const on = state.city === c.slug;
              return (
                <button key={c.slug} type="button" className={s.cityChip} aria-pressed={on} onClick={() => update({ city: on ? null : c.slug })}>
                  {c.name}
                  <span className={`${s.cityCount} ltr`}>{counts.city[c.slug] ?? 0}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className={s.fsHint}>בחרו אזור כדי לראות את הערים בו, או הקלידו עיר בשורת החיפוש.</p>
        )}
      </fieldset>

      {group(
        'treat',
        'תחום טיפול',
        state.t ? 1 : 0,
        CATEGORIES.map(c =>
          option({ key: c.slug, name: c.name, on: state.t === c.slug, round: true, count: counts.category[c.slug] ?? 0, onClick: () => update({ t: state.t === c.slug ? null : c.slug }) }),
        ),
      )}

      {group(
        'feat',
        'מאפיינים',
        state.f.length,
        FEATURES.map(f => option({ key: f.key, name: f.name, on: state.f.includes(f.key), onClick: () => toggleFeature(f.key) })),
      )}

      {group(
        'price',
        'טווח מחירים',
        state.price != null ? 1 : 0,
        PRICE_TIERS.map(t =>
          option({ key: String(t.max), name: <PriceOption max={t.max} />, on: state.price === t.max, round: true, onClick: () => update({ price: state.price === t.max ? null : t.max }) }),
        ),
      )}
    </>
  );
}
