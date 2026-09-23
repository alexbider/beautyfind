'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { CATEGORIES, CITIES, REGIONS, categoryBySlug, type Category, type RegionSlug } from '@/lib/catalog';
import { SHORTCUT_SLUGS, bizCountText } from './content';
import { regionName, setRegion, useRegion } from './regionStore';
import styles from './HeroSearch.module.css';

// Hero search (design: BeautyFind Homepage.dc.html, "איתור עסקים"). Two comboboxes with the
// design's own suggestion lists (categories and places from the catalog), submitting to
// /search?q=&t=&region=&city=. Without JavaScript the form still GETs /search with q and region.

type Place = { kind: 'region'; name: string; region: RegionSlug } | { kind: 'city'; name: string; region: RegionSlug; slug: string };
type Opt = { key: string; label: string; meta?: string; pick: () => void; accent?: boolean };
type Group = { name?: string; items: Opt[] };

const SHORTCUTS = SHORTCUT_SLUGS.map(s => categoryBySlug(s)!);
const rName = (r: RegionSlug) => REGIONS.find(x => x.slug === r)!.name;

/** Region centres (from the region map), used to turn a device location into the nearest region. */
const CENTRES: Array<[RegionSlug, number, number]> = [
  ['north', 32.96, 35.42], ['haifa', 32.74, 35.02], ['sharon', 32.3, 34.92], ['dan', 32.05, 34.85],
  ['shfela', 31.86, 34.85], ['jerusalem', 31.78, 35.18], ['south', 31.0, 34.9],
];

function placeFromText(t: string): Place | null {
  const city = CITIES.find(c => c.name === t);
  if (city) return { kind: 'city', name: city.name, region: city.region, slug: city.slug };
  const reg = REGIONS.find(r => r.name === t || `אזור ${r.name}` === t);
  return reg ? { kind: 'region', name: reg.name, region: reg.slug } : null;
}

function Combo(props: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  open: boolean;
  groups: Group[];
  empty: ReactNode;
  note?: ReactNode;
  clearLabel: string;
  onOpen: (open: boolean) => void;
  onChange: (v: string) => void;
  onClear: () => void;
}) {
  const { id, open, groups } = props;
  const listId = `${id}-list`;
  const flat = groups.flatMap(g => g.items);
  const [active, setActive] = useState(-1);
  useEffect(() => setActive(-1), [props.value, open]);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return props.onOpen(true);
      if (!flat.length) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive(a => (a + d + flat.length) % flat.length);
    } else if (e.key === 'Enter' && open && active >= 0 && flat[active]) {
      e.preventDefault();
      flat[active].pick();
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      props.onOpen(false);
    }
  };

  let n = -1;
  return (
    <div className={styles.field} data-focus={open || undefined}>
      <label htmlFor={id} className={styles.label}>{props.label}</label>
      <div className={styles.inputRow}>
        <input
          id={id}
          name={id === 'bf-q' ? 'q' : undefined}
          type="text"
          role="combobox"
          autoComplete="off"
          className={styles.input}
          value={props.value}
          placeholder={props.placeholder}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          onChange={e => props.onChange(e.target.value)}
          onFocus={() => props.onOpen(true)}
          onClick={() => props.onOpen(true)}
          onBlur={() => props.onOpen(false)}
          onKeyDown={onKey}
        />
        {props.value && (
          <button type="button" className={styles.clear} aria-label={props.clearLabel} onClick={props.onClear}>×</button>
        )}
      </div>
      {open && (
        // Mouse down on the list keeps focus in the input, so a pick lands before blur closes it.
        <div id={listId} role="listbox" aria-label={props.label} className={styles.list} onMouseDown={e => e.preventDefault()}>
          {props.note}
          {flat.length === 0 && props.empty}
          {groups.map((g, gi) =>
            g.items.length ? (
              <div key={g.name ?? gi} role="group" aria-label={g.name}>
                {g.name && <div className={styles.groupName} aria-hidden="true">{g.name}</div>}
                {g.items.map(it => {
                  n += 1;
                  const i = n;
                  return (
                    <div
                      key={it.key}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={i === active}
                      className={styles.opt}
                      data-active={i === active || undefined}
                      data-accent={it.accent || undefined}
                      onClick={it.pick}
                      onMouseEnter={() => setActive(i)}
                    >
                      <span>{it.label}</span>
                      {it.meta && <span className={styles.optMeta}>{it.meta}</span>}
                    </div>
                  );
                })}
              </div>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

export function HeroSearch({ regionCounts, cityCounts }: { regionCounts: Partial<Record<RegionSlug, number>>; cityCounts: Record<string, number> }) {
  const router = useRouter();
  const [region] = useRegion();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Category | null>(null);
  const [loc, setLoc] = useState('');
  const [place, setPlace] = useState<Place | null>(null);
  const [focus, setFocus] = useState<'q' | 'loc' | null>(null);
  const [geo, setGeo] = useState<'asking' | 'ok' | 'denied' | null>(null);
  const [result, setResult] = useState<'hint' | 'none' | null>(null);
  const [busy, setBusy] = useState(false);
  const statusId = useId();

  // A region picked elsewhere (header, chips) drops a chosen place from another region.
  useEffect(() => {
    if (place && region !== 'all' && place.region !== region) {
      setPlace(null);
      setLoc('');
    }
  }, [region]);

  const choosePlace = (p: Place) => {
    setPlace(p);
    setLoc(p.name);
    setGeo(null);
    setResult(null);
    setFocus(null);
    setRegion(p.region);
  };
  const chooseCat = (c: Category) => {
    setCat(c);
    setQ(c.name);
    setResult(null);
    setFocus(null);
  };

  // Treatment / name suggestions
  const qt = q.trim();
  const catMatch = qt ? CATEGORIES.filter(c => c.name.includes(qt)).slice(0, 5) : SHORTCUTS;
  const cityMatch = qt ? CITIES.filter(c => c.name.includes(qt)).slice(0, 3) : [];
  const qGroups: Group[] = [
    { name: qt ? 'תחומי טיפול' : 'תחומים מבוקשים', items: catMatch.map(c => ({ key: c.slug, label: c.name, meta: c.group, pick: () => chooseCat(c) })) },
    {
      name: 'מקומות',
      items: cityMatch.map(c => ({
        key: c.slug,
        label: c.name,
        meta: rName(c.region),
        pick: () => {
          choosePlace({ kind: 'city', name: c.name, region: c.region, slug: c.slug });
          setQ('');
          setCat(null);
        },
      })),
    },
  ];

  // Place suggestions
  const lt = loc.trim();
  const byCount = (a: { slug: string }, b: { slug: string }) => (cityCounts[b.slug] ?? 0) - (cityCounts[a.slug] ?? 0);
  const inScope = CITIES.filter(c => region === 'all' || c.region === region);
  const locCities = lt ? CITIES.filter(c => c.name.includes(lt)) : [...inScope].sort(byCount);
  const locRegions = REGIONS.filter(r => !lt || r.name.includes(lt));
  const geoLabel = geo === 'asking' ? 'מבקשים את המיקום שלכם…' : geo === 'ok' ? 'משתמשים במיקום הנוכחי שלכם' : 'השתמשו במיקום שלי';
  const locGroups: Group[] = [
    { items: [{ key: 'geo', label: geoLabel, accent: true, pick: () => locateMe() }] },
    { name: 'אזורים', items: locRegions.map(r => ({ key: r.slug, label: r.name, meta: bizCountText(regionCounts[r.slug] ?? 0), pick: () => choosePlace({ kind: 'region', name: r.name, region: r.slug }) })) },
    {
      name: lt ? 'ערים' : region === 'all' ? 'ערים מבוקשות' : `ערים באזור ${regionName(region)}`,
      items: locCities.slice(0, 8).map(c => ({ key: c.slug, label: c.name, meta: rName(c.region), pick: () => choosePlace({ kind: 'city', name: c.name, region: c.region, slug: c.slug }) })),
    },
  ];
  const locEmpty = !!lt && locRegions.length === 0 && locCities.length === 0;

  function locateMe() {
    if (!('geolocation' in navigator)) return setGeo('denied');
    setGeo('asking');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude: la, longitude: lo } = pos.coords;
        const [slug] = CENTRES.reduce((best, c) => (Math.hypot(c[1] - la, c[2] - lo) < Math.hypot(best[1] - la, best[2] - lo) ? c : best));
        choosePlace({ kind: 'region', name: rName(slug), region: slug });
        setGeo('ok');
      },
      () => setGeo('denied'),
      { timeout: 8000, maximumAge: 600000 },
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const chosenCat = cat ?? CATEGORIES.find(c => c.name === qt) ?? null;
    const chosenPlace = place ?? (lt ? placeFromText(lt) : null);
    if (!qt && !lt) return setResult('hint');
    if (lt && !chosenPlace) return setResult('none');
    const p = new URLSearchParams();
    if (chosenCat) p.set('t', chosenCat.slug);
    else if (qt) p.set('q', qt);
    const r = chosenPlace?.region ?? (region !== 'all' ? region : null);
    if (r) p.set('region', r);
    if (chosenPlace?.kind === 'city') p.set('city', chosenPlace.slug);
    setResult(null);
    setFocus(null);
    setBusy(true);
    router.push(`/search?${p.toString()}`);
  };

  const locPlaceholder = region === 'all' ? 'תל אביב, חיפה, באר שבע…' : `כל עיר באזור ${regionName(region)}`;

  return (
    <div className={styles.wrap}>
      <form action="/search" method="get" role="search" aria-label="איתור עסקים" className={styles.form} onSubmit={submit} aria-describedby={result ? statusId : undefined}>
        <Combo
          id="bf-q"
          label="טיפול או שם עסק"
          value={q}
          placeholder="בוטוקס, הסרת שיער בלייזר, שם מכון"
          open={focus === 'q'}
          groups={qGroups}
          clearLabel="נקו את שדה הטיפול"
          empty={
            <div className={styles.empty}>
              לא נמצאו הצעות ל״<strong>{qt}</strong>״. אפשר עדיין לחפש לפי שם העסק, או לנסות תחום טיפול כמו קוסמטיקה או הסרת שיער.
            </div>
          }
          onOpen={o => setFocus(f => (o ? 'q' : f === 'q' ? null : f))}
          onChange={v => {
            setQ(v);
            setCat(null);
            setResult(null);
            setFocus('q');
          }}
          onClear={() => {
            setQ('');
            setCat(null);
            setResult(null);
          }}
        />
        <Combo
          id="bf-loc"
          label="עיר או אזור"
          value={loc}
          placeholder={locPlaceholder}
          open={focus === 'loc'}
          groups={locGroups}
          clearLabel="נקו את שדה המקום"
          note={
            locEmpty ? (
              <div className={styles.empty}>
                לא נמצא מקום בשם ״<strong>{lt}</strong>״. האינדקס מכסה שבעה אזורים ו־<span className="ltr">{CITIES.length}</span> ערים בישראל.
              </div>
            ) : geo === 'denied' ? (
              <div className={styles.note}>לא התקבלה הרשאת מיקום. הקלידו עיר במקום.</div>
            ) : geo === 'ok' ? (
              <div className={styles.note}>המיקום משמש רק לבחירת האזור הקרוב; לא נשמר שום מידע.</div>
            ) : null
          }
          empty={null}
          onOpen={o => setFocus(f => (o ? 'loc' : f === 'loc' ? null : f))}
          onChange={v => {
            setLoc(v);
            setPlace(null);
            setResult(null);
            setFocus('loc');
          }}
          onClear={() => {
            setLoc('');
            setPlace(null);
            setGeo(null);
            setResult(null);
          }}
        />
        {region !== 'all' && <input type="hidden" name="region" value={region} />}
        <button type="submit" className={styles.submit} aria-busy={busy || undefined}>
          {busy ? (
            <span className={styles.spinner} aria-hidden="true" />
          ) : (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <circle cx="8" cy="8" r="5.5" />
              <path d="m12.5 12.5 3.5 3.5" />
            </svg>
          )}
          חפשו עסקים
        </button>
      </form>

      <div id={statusId} role="status" aria-live="polite" className={styles.statusSlot}>
        {result && (
          <div className={styles.result}>
            {result === 'hint' ? (
              <p>הזינו תחום טיפול, שם עסק או מקום כדי להתחיל.</p>
            ) : (
              <>
                <p>
                  <strong>לא מצאנו את המקום ״{lt}״.</strong> נסו אחת מהערים באינדקס, או עברו לעיון לפי אזור.
                </p>
                <div className={styles.resultChips}>
                  {SHORTCUTS.map(c => (
                    <button key={c.slug} type="button" className={styles.resultChip} onClick={() => chooseCat(c)}>{c.name}</button>
                  ))}
                  {REGIONS.slice(0, 3).map(r => (
                    <Link key={r.slug} href={`/${r.slug}`} className={styles.resultChip}>לעיון ב{r.name}</Link>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className={styles.shortcuts}>
        <span className={styles.shortcutsLabel}>הטיפולים המבוקשים</span>
        {SHORTCUTS.map(c => (
          <button
            key={c.slug}
            type="button"
            className={styles.shortcut}
            onClick={() => {
              chooseCat(c);
              if (!place) document.getElementById('bf-loc')?.focus();
            }}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className={styles.regions} role="group" aria-label="אזור">
        {REGIONS.map(r => {
          const on = region === r.slug;
          return (
            <button key={r.slug} type="button" className={styles.regionChip} aria-pressed={on} data-on={on || undefined} onClick={() => setRegion(r.slug)}>
              <span className={styles.regionDot} aria-hidden="true" />
              {r.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
