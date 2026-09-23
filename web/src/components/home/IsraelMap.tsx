'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RegionSlug } from '@/lib/catalog';
import { bizCountText } from './content';
import { LAND } from './israel-land';
import styles from './IsraelMap.module.css';

// Port of project/israel-map.js. The prototype drew OpenStreetMap tiles through Leaflet; here the
// same tilted card, pins, halos, label and region tour sit on an inline SVG (no tiles, no third
// party requests). The geometry uses the prototype's projection: Web Mercator, fitted so the
// country's bounds (29.49..33.34N, 34.27..35.90E) fill 54.8% of the plane's height, centred.
// Plane viewBox 800x900 matches the plane's aspect (inset -40% -14% of a 5:4 shell).
// Coastlines come from Natural Earth 1:10m land (israel-land.ts). No political borders are drawn.
// Lakes and the Jordan below are simplified hand traces.

const LAKES = 'M455.2 260.8L460.7 266L461.8 273.8L456.3 282.9L449.7 279L447.6 269.9L449.7 263.4ZM445.4 404.4L453 408.3L454.1 426.3L450.8 436.5L442.1 435.3L438.8 422.4L441 410.9ZM438.8 472.4L444.3 477.5L441 490.3L435.5 495.4L433.3 486.5Z';
const RIVER = 'M453 282.9L451.9 303.7L450.8 323.1L449.7 349L447.6 374.8L450.8 404.4';

/** Region centres (x/y in viewBox units) and halo radius, projected from the prototype's lat/lon/metres. */
const PINS: Array<{ slug: RegionSlug; name: string; x: number; y: number; r: number }> = [
  { slug: 'north', name: 'צפון', x: 436.6, y: 250.4, r: 39.8 },
  { slug: 'haifa', name: 'חיפה', x: 392.9, y: 279, r: 25.7 },
  { slug: 'sharon', name: 'שרון', x: 382, y: 336.1, r: 22.1 },
  { slug: 'dan', name: 'גוש דן', x: 374.3, y: 368.4, r: 20.9 },
  { slug: 'shfela', name: 'שפלה', x: 374.3, y: 392.9, r: 22 },
  { slug: 'jerusalem', name: 'ירושלים', x: 410.4, y: 403.1, r: 19.6 },
  { slug: 'south', name: 'דרום', x: 379.8, y: 503, r: 59.6 },
];
const VB_W = 800;
const VB_H = 900;
const START = 3; // גוש דן, as in the prototype
const TOUR_MS = 2900;
const IDLE_MS = 7000;

export function IsraelMap({ counts }: { counts: Partial<Record<RegionSlug, number>> }) {
  const [active, setActive] = useState(START);
  const [touring, setTouring] = useState(false);
  const [visible, setVisible] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reduced = useRef(true);

  // Start the tour only with motion allowed, and only while the map is on screen.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced.current = mq.matches;
    setTouring(!mq.matches);
    const onChange = () => {
      reduced.current = mq.matches;
      setTouring(!mq.matches);
    };
    mq.addEventListener('change', onChange);
    const el = rootRef.current;
    const io = el ? new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '80px' }) : null;
    if (el && io) io.observe(el);
    return () => {
      mq.removeEventListener('change', onChange);
      io?.disconnect();
      clearTimeout(idle.current);
    };
  }, []);

  useEffect(() => {
    if (!touring || !visible) return;
    const t = setInterval(() => {
      if (!document.hidden) setActive(n => (n + 1) % PINS.length);
    }, TOUR_MS);
    return () => clearInterval(t);
  }, [touring, visible]);

  const hold = useCallback((i: number) => {
    setActive(i);
    setTouring(false);
    clearTimeout(idle.current);
    if (!reduced.current) idle.current = setTimeout(() => setTouring(true), IDLE_MS);
  }, []);

  const pin = PINS[active];
  const px = (pin.x / VB_W) * 100;
  const py = (pin.y / VB_H) * 100;
  const inward = px < 50; // label grows away from the country's centre line, as in the prototype
  const n = counts[pin.slug] ?? 0;

  return (
    <div className={styles.frame} ref={rootRef}>
      <div className={styles.card}>
        <div className={styles.shell}>
          <div className={styles.plane}>
            <svg className={styles.svg} viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
              <defs>
                <linearGradient id="bfm-land" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#EAF0E4" />
                  <stop offset=".45" stopColor="#F1EFE7" />
                  <stop offset=".75" stopColor="#F4ECDC" />
                  <stop offset="1" stopColor="#F1E6D2" />
                </linearGradient>
              </defs>
              <rect x="-400" y="-400" width="1600" height="1800" className={styles.sea} />
              <path d={LAND} fill="url(#bfm-land)" fillRule="evenodd" />
              <path d={LAKES} className={styles.sea} />
              <path d={RIVER} className={styles.river} />
              {PINS.map((p, i) => (
                <circle key={p.slug} cx={p.x} cy={p.y} r={p.r} className={styles.halo} data-on={i === active || undefined} />
              ))}
            </svg>
            <div className={styles.veil} aria-hidden="true" />
            {PINS.map((p, i) => (
              <Link
                key={p.slug}
                href={`/${p.slug}`}
                className={styles.pin}
                data-on={i === active || undefined}
                style={{ left: `${(p.x / VB_W) * 100}%`, top: `${(p.y / VB_H) * 100}%` }}
                aria-label={`אזור ${p.name}, ${bizCountText(counts[p.slug] ?? 0)}`}
                onMouseEnter={() => hold(i)}
                onFocus={() => hold(i)}
              >
                <i />
              </Link>
            ))}
            <div
              className={styles.label}
              data-inward={inward || undefined}
              style={{ left: `${px}%`, top: `${py}%` }}
              aria-hidden="true"
            >
              <b />
              <span key={pin.slug}>{pin.name}</span>
            </div>
          </div>
        </div>
      </div>
      <p className={styles.readout}>
        <strong>אזור {pin.name}</strong>
        <em>{n === 1 ? 'עסק אחד באינדקס' : <><span className="ltr">{n}</span> עסקים באינדקס</>}</em>
      </p>
    </div>
  );
}
