import Link from 'next/link';
import type { ReactNode } from 'react';
import styles from './ui.module.css';

// Server-safe building blocks of the master admin screens (no hooks). Client pieces live in their
// own files (Toggle, forms). Formatting helpers for money, dates and relative times are here too so
// every screen shows the same numbers the same way.

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'navy' | 'neutral';

export const ui = styles;

export function PageHead({ eyebrow, title, lead, actions }: { eyebrow: ReactNode; title: string; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={styles.head}>
      <div className={styles.headText}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 className={styles.h1}>{title}</h1>
        {lead ? <p className={styles.lead}>{lead}</p> : null}
      </div>
      {actions ? <div className={styles.headActions}>{actions}</div> : null}
    </div>
  );
}

export type KpiItem = { label: string; value: ReactNode; note?: ReactNode; tone?: 'ok' | 'warn' | 'bad' };

export function Kpis({ items }: { items: KpiItem[] }) {
  return (
    <div className={styles.kpis}>
      {items.map((k, i) => (
        <div key={i} className={styles.kpi}>
          <div className={styles.kpiLabel}>{k.label}</div>
          <div className={styles.kpiValue}>{k.value}</div>
          {k.note ? <div className={styles.kpiNote} data-tone={k.tone}>{k.note}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function Card({ title, sub, aside, flush, children, className }: { title?: ReactNode; sub?: ReactNode; aside?: ReactNode; flush?: boolean; children: ReactNode; className?: string }) {
  return (
    <section className={`${styles.card} ${className ?? ''}`}>
      {title ? (
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>{title}</h2>
          {sub ? <span className={styles.cardSub}>{sub}</span> : null}
          {aside}
        </div>
      ) : null}
      <div className={flush ? styles.cardFlush : styles.cardBody}>{children}</div>
    </section>
  );
}

export function Chip({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={styles.chip} data-tone={tone}>{children}</span>;
}

export type PillItem = { key: string; name: string; count?: number; href: string };

export function Pills({ items, current }: { items: PillItem[]; current: string }) {
  return (
    <div className={styles.pills}>
      {items.map(p => (
        <Link key={p.key} href={p.href} className={styles.pill} aria-current={p.key === current ? 'page' : undefined}>
          {p.name}
          {p.count != null ? <span className={styles.pillCount}>{p.count.toLocaleString('he-IL')}</span> : null}
        </Link>
      ))}
    </div>
  );
}

export type TabItem = { key: string; name: string; href: string };

export function Tabs({ items, current, label }: { items: TabItem[]; current: string; label: string }) {
  return (
    <nav className={styles.tabs} aria-label={label}>
      {items.map(t => (
        <Link key={t.key} href={t.href} className={styles.tab} aria-current={t.key === current ? 'page' : undefined}>
          {t.name}
        </Link>
      ))}
    </nav>
  );
}

export function Table({ head, children, foot }: { head: ReactNode[]; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>{head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {foot ? <div className={styles.foot}>{foot}</div> : null}
    </div>
  );
}

export function Empty({ title, text }: { title: string; text?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyTitle}>{title}</div>
      {text ? <div>{text}</div> : null}
    </div>
  );
}

export function Band({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <div className={styles.band}>
      {items.map((it, i) => (
        <div key={i} className={styles.bandItem}>
          <div className={styles.bandLabel}>{it.label}</div>
          <div className={styles.bandValue}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}

export function Check({ tone, children }: { tone: 'ok' | 'warn' | 'bad'; children: ReactNode }) {
  const mark = tone === 'ok' ? '✓' : tone === 'bad' ? '×' : '!';
  return (
    <div className={styles.check}>
      <span className={styles.checkMark} data-tone={tone} aria-hidden="true">{mark}</span>
      <span>{children}</span>
    </div>
  );
}

export function Bars({ items }: { items: Array<{ name: ReactNode; value: number; display: string; tone?: 'bad' }> }) {
  const max = Math.max(1, ...items.map(i => Math.abs(i.value)));
  return (
    <div className={styles.bars}>
      {items.map((it, i) => (
        <div key={i} className={styles.bar}>
          <span>{it.name}</span>
          <div className={styles.barTrack}><div className={styles.barFill} data-tone={it.tone} style={{ width: `${Math.round((Math.abs(it.value) / max) * 100)}%` }} /></div>
          <span className={styles.barValue}>{it.display}</span>
        </div>
      ))}
    </div>
  );
}

export function Columns({ items }: { items: Array<{ label: string; value: number; now?: boolean; title?: string }> }) {
  const max = Math.max(1, ...items.map(i => i.value));
  return (
    <div className={styles.columns} role="img" aria-label={items.map(i => `${i.label}: ${i.title ?? i.value}`).join(', ')}>
      {items.map((it, i) => (
        <div key={i} className={styles.col}>
          <div className={styles.colBar} data-now={it.now ? 'true' : undefined} style={{ height: `${Math.max(2, Math.round((it.value / max) * 140))}px` }} title={it.title} />
          <span className={styles.colLabel} dir="ltr">{it.label}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- formatting ----------

/** ₪1,200 or ₪80.46 from integer agorot; negative amounts keep the sign in front. */
export function nisAgorot(agorot: number, opts: { cents?: boolean } = {}): string {
  const abs = Math.abs(agorot);
  const cents = opts.cents ?? abs % 100 !== 0;
  const v = (abs / 100).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
  return `${agorot < 0 ? '−' : ''}₪${v}`;
}
export const nisWhole = (nis: number) => `${nis < 0 ? '−' : ''}₪${Math.round(Math.abs(nis)).toLocaleString('en-US')}`;
export const pct = (v: number, digits = 1) => `${v.toLocaleString('en-US', { maximumFractionDigits: digits })}%`;
export const int = (v: number) => v.toLocaleString('he-IL');

const TZ = 'Asia/Jerusalem';
export const dateIL = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleDateString('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
export const dayMonthIL = (d: Date | string) => new Date(d).toLocaleDateString('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit' });
export const timeIL = (d: Date | string) => new Date(d).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const dateTimeIL = (d: Date | string | null | undefined) => (d ? `${dateIL(d)} · ${timeIL(d)}` : '—');
export const monthIL = (d: Date) => new Date(d).toLocaleDateString('he-IL', { timeZone: TZ, month: 'long', year: 'numeric' });

/** "עכשיו", "לפני 20 דק׳", "לפני 3 שעות", "אתמול", "לפני 4 ימים", else the date. */
export function relIL(d: Date | string | null | undefined, now = new Date()): string {
  if (!d) return '—';
  const diff = (now.getTime() - new Date(d).getTime()) / 1000;
  if (diff < 60) return 'עכשיו';
  if (diff < 3600) return `לפני ${Math.floor(diff / 60)} דק׳`;
  if (diff < 86_400) {
    const h = Math.floor(diff / 3600);
    return h === 1 ? 'לפני שעה' : h === 2 ? 'לפני שעתיים' : `לפני ${h} שעות`;
  }
  const days = Math.floor(diff / 86_400);
  if (days === 1) return 'אתמול';
  if (days < 30) return days === 2 ? 'לפני יומיים' : `לפני ${days} ימים`;
  return dateIL(d);
}

/** "בעוד 4 ימים", "היום", "לפני יומיים" for deadlines. */
export function dueIL(d: Date | string, now = new Date()): string {
  const days = Math.round((new Date(d).getTime() - now.getTime()) / 86_400_000);
  if (days === 0) return 'היום';
  if (days === 1) return 'מחר';
  if (days > 0) return `בעוד ${days === 2 ? 'יומיים' : `${days} ימים`}`;
  const late = -days;
  return `באיחור של ${late === 1 ? 'יום' : late === 2 ? 'יומיים' : `${late} ימים`}`;
}

/** Hebrew count phrases: 1 → singular, 2 → dual, else "N plural". */
export const count = (n: number, one: string, two: string, many: string) => (n === 1 ? one : n === 2 ? two : `${int(n)} ${many}`);

export function Btn({ href, children, kind, small, className, ...rest }: { href?: string; children: ReactNode; kind?: 'primary' | 'teal' | 'danger'; small?: boolean; className?: string } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>) {
  const cls = [styles.btn, kind ? styles[kind] : '', small ? styles.small : '', className ?? ''].join(' ');
  if (href) return <Link href={href} className={cls}>{children}</Link>;
  return <button type="button" className={cls} {...rest}>{children}</button>;
}
