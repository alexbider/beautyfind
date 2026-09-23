import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { Segmented } from '../../shell/Segmented';
import { nf } from './format';
import c from './charts.module.css';
import ui from './ui.module.css';

// Server-rendered chart pieces shared by the overview, analytics and billing tabs.
// Every chart is inline SVG or CSS bars, with role="img" + an aria-label that states the data.

/* ---------- Range switch (30 / 90 / 365 days) ---------- */

export const RANGES = [
  { key: 30, name: '30 יום' },
  { key: 90, name: '90 יום' },
  { key: 365, name: 'שנה' },
] as const;

export function RangeSwitch({ base, current }: { base: string; current: number }) {
  const href = (key: number) => (key === 30 ? base : `${base}?range=${key}`);
  return (
    <>
      {/* App shell: the shared segmented control, full width under the heading. */}
      <div className={`${ui.rangeShell} bf-shell-only`}>
        <Segmented label="טווח זמן" value={String(current)} items={RANGES.map(r => ({ key: String(r.key), label: r.name, href: href(r.key) }))} />
      </div>
      <nav aria-label="טווח זמן" className={`${ui.range} bf-desk-only`}>
        {RANGES.map(r => (
          <Link key={r.key} href={href(r.key)} scroll={false} aria-current={r.key === current ? 'true' : undefined} className={ui.rangeBtn}>
            {r.name}
          </Link>
        ))}
      </nav>
    </>
  );
}

/* ---------- KPI tiles ---------- */

export type Kpi = { label: string; value: string; delta: string; tone: 'up' | 'down' | 'none'; note?: string };

export function KpiGrid({ items }: { items: Kpi[] }) {
  return (
    <dl className={ui.kpis}>
      {items.map((k, i) => (
        <div key={k.label} className={ui.kpi} style={{ animationDelay: `${i * 45}ms` }}>
          <dt>{k.label}</dt>
          <dd className={ui.kpiValue}>{k.value}</dd>
          <dd className={ui.kpiFoot}>
            <span className={ui.delta} data-tone={k.tone}>{k.delta}</span>
            {k.note ? <span className={ui.kpiNote}>{k.note}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------- Horizontal bar list ---------- */

export type BarItem = { name: ReactNode; key: string; value: number; display?: string; fill?: string; share?: string };

export function BarList({
  items, max, nameWidth = 96, valueWidth = 48, track = false, regularName = false, label,
}: {
  items: BarItem[]; max?: number; nameWidth?: number; valueWidth?: number; track?: boolean; regularName?: boolean; label: string;
}) {
  const top = max ?? Math.max(1, ...items.map(i => i.value));
  return (
    <ul className={ui.bars} aria-label={label}>
      {items.map(it => (
        <li key={it.key} className={ui.barRow}>
          <span className={ui.barName} style={{ width: nameWidth }} data-weight={regularName ? 'regular' : undefined}>{it.name}</span>
          <span aria-hidden="true" className={ui.barTrack} data-track={track || undefined}>
            <span className={ui.barFill} style={{ width: `${Math.round((it.value / top) * 100)}%`, background: it.fill ?? 'var(--teal)' }} />
          </span>
          <span className={ui.barValue} style={{ width: valueWidth }}>{it.display ?? nf(it.value)}</span>
          {it.share !== undefined ? <span className={ui.barShare}>{it.share}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/* ---------- Empty chart frame ---------- */

export function EmptyChart({ children, height = 150 }: { children: ReactNode; height?: number }) {
  return (
    <div className={ui.emptyFrame} style={{ minHeight: height }}>
      <svg viewBox="0 0 720 150" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1="30" x2="720" y2="30" stroke="#EDEFF2" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1="80" x2="720" y2="80" stroke="#EDEFF2" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1="130" x2="720" y2="130" stroke="#D4D4D4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </svg>
      <p className={ui.emptyText}>{children}</p>
    </div>
  );
}

/* ---------- Traffic line chart (views vs contacts, separate scales) ---------- */

const W = 720;
const H = 180;
const TOP = 8;

/** Oldest point on the right: time runs right to left, like the rest of the RTL page. */
function poly(arr: number[], max: number) {
  const n = Math.max(1, arr.length - 1);
  return arr.map((v, i) => `${(W - (i / n) * W).toFixed(1)},${(H - (v / max) * (H - TOP)).toFixed(1)}`).join(' ');
}

export function TrafficChart({ views, contacts, ticks, summary }: { views: number[]; contacts: number[]; ticks: string[]; summary: string }) {
  const vMax = Math.max(1, ...views) * 1.14;
  const cMax = Math.max(1, ...contacts) * 1.34;
  const viewsLine = poly(views, vMax);
  const contactsLine = poly(contacts, cMax);
  const area = `M${W},${H} L${viewsLine.split(' ').join(' L')} L0,${H} Z`;
  return (
    <>
      <div className={c.plot}>
        <div aria-hidden="true" className={c.yAxis}>
          <span style={{ top: 8 }}>{nf(vMax)}</span>
          <span style={{ top: 94 }}>{nf(vMax / 2)}</span>
          <span style={{ top: 180 }}>0</span>
        </div>
        <div className={c.plotArea}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} role="img" aria-label={summary}>
            <line x1="0" y1="8" x2={W} y2="8" stroke="#EDEFF2" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <line x1="0" y1="94" x2={W} y2="94" stroke="#EDEFF2" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <line x1="0" y1="179.5" x2={W} y2="179.5" stroke="#D4D4D4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <path d={area} fill="rgba(12,36,62,.07)" />
            <polyline points={viewsLine} fill="none" stroke="#0C243E" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <polyline points={contactsLine} fill="none" stroke="#14B3C6" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
      </div>
      <div aria-hidden="true" className={c.ticks}>
        {ticks.map((t, i) => <span key={i}>{t}</span>)}
      </div>
      <p className={c.summary}>
        {summary} הציר הימני מתאר צפיות, הקו התכלת מתאר פניות בקנה מידה נפרד עד <span className="ltr" style={{ fontWeight: 700 }}>{nf(cMax)}</span>.
      </p>
    </>
  );
}

export function TrafficLegend() {
  return (
    <div className={c.legend}>
      <span className={c.legendItem}><span aria-hidden="true" style={{ background: '#0C243E' }} />צפיות</span>
      <span className={c.legendItem}><span aria-hidden="true" style={{ background: '#14B3C6' }} />פניות</span>
    </div>
  );
}

/* ---------- Column chart ---------- */

export type Column = { label: string; value: number; display?: string; fill: string };

export function ColumnChart({
  cols, height, gap, dir = 'ltr', label, radius, valueStyle, labelNode,
}: {
  cols: Column[]; height: number; gap: string; dir?: 'ltr' | 'rtl'; label: string; radius?: string;
  valueStyle?: CSSProperties; labelNode?: (col: Column, i: number) => ReactNode;
}) {
  const max = Math.max(1, ...cols.map(x => x.value));
  const grid = { gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))`, gap };
  return (
    <div role="img" aria-label={label}>
      <div dir={dir} className={c.cols} style={{ ...grid, height, paddingTop: 18 }} aria-hidden="true">
        {cols.map((x, i) => (
          <div key={i} className={c.col} style={{ height: `${Math.round((x.value / max) * 100)}%`, background: x.fill, borderRadius: radius }}>
            <span style={valueStyle}>{x.display ?? nf(x.value)}</span>
          </div>
        ))}
      </div>
      <div dir={dir} className={c.colLabels} style={grid} aria-hidden="true">
        {cols.map((x, i) => (labelNode ? <span key={i}>{labelNode(x, i)}</span> : <span key={i}>{x.label}</span>))}
      </div>
    </div>
  );
}

/** Design shading: the peak is navy, anything above 60% of it teal, the rest light teal. */
export function shade(v: number, max: number, hi = 0.6) {
  if (max > 0 && v === max) return '#0C243E';
  return v > max * hi ? '#14B3C6' : '#CDEFF3';
}

/* ---------- Funnel ---------- */

const FUNNEL_FILLS = ['#0C243E', '#0B7A87', '#14B3C6', '#4FC6D6', '#7ED7E1'];

export function Funnel({ steps }: { steps: Array<{ name: string; value: number }> }) {
  const first = Math.max(1, steps[0]?.value ?? 0);
  const label = steps.map(s => `${s.name}: ${nf(s.value)}`).join(', ');
  return (
    <ul className={c.funnel} aria-label={label}>
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : 0;
        return (
          <li key={s.name} className={c.funnelRow}>
            <span className={c.funnelName}>{s.name}</span>
            <span className={c.funnelTrack}>
              <span className={c.funnelBar} style={{ width: `${Math.max(9, Math.min(100, Math.round((s.value / first) * 100)))}%`, background: FUNNEL_FILLS[i] }}>
                <span>{nf(s.value)}</span>
              </span>
            </span>
            {i > 0 ? (
              <span className={c.funnelStep}>
                {prev > 0 ? <><span className="ltr">{Math.round((s.value / prev) * 100)}%</span> מהשלב הקודם</> : 'אין נתון בשלב הקודם'}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
