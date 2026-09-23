'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowForward } from '@/components/icons';
import { nis } from '@/lib/format';
import { fmtInt } from './format';
import shared from './shared.module.css';
import styles from './TreatmentsBrowser.module.css';

export interface TreatmentRow {
  slug: string;
  name: string;
  group: string;
  isMedical: boolean;
  blurb: string;
  tags: string[];
  img: string;
  freq: string;
  median: number | null;
  count: number;
}

type Resp = 'medical' | 'professional' | null;
type Layout = 'group' | 'popular';

const GROUP_ID: Record<string, string> = {
  'רפואה ואסתטיקה': 'g-medical',
  'פנים ועור': 'g-skin',
  שיער: 'g-hair',
  'יופי ואיפור': 'g-beauty',
  'גוף ורוגע': 'g-body',
};

const RESP_TABS: Array<{ name: string; val: Resp }> = [
  { name: 'הכול', val: null },
  { name: 'רפואי', val: 'medical' },
  { name: 'מקצועי', val: 'professional' },
];
const LAYOUTS: Array<{ name: string; val: Layout }> = [
  { name: 'לפי קבוצה', val: 'group' },
  { name: 'לפי פופולריות', val: 'popular' },
];

const lc = (s: string) => s.toLocaleLowerCase('he');

/**
 * Rail + filterable category list on /treatments.
 * Filters (responsibility, layout, text) are client state mirrored to the URL
 * (?resp=medical|professional&layout=popular&q=…) so a filtered view can be shared.
 */
export function TreatmentsBrowser({ rows, groupOrder }: { rows: TreatmentRow[]; groupOrder: string[] }) {
  const [q, setQ] = useState('');
  const [resp, setResp] = useState<Resp>(null);
  const [layout, setLayout] = useState<Layout>('group');
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  const [fromUrl, setFromUrl] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const r = p.get('resp');
    if (r === 'medical' || r === 'professional') setResp(r);
    if (p.get('layout') === 'popular') setLayout('popular');
    const qq = p.get('q');
    if (qq) setQ(qq);
    setFromUrl(true);
  }, []);

  useEffect(() => {
    if (!fromUrl) return; // don't overwrite the incoming URL before it has been read
    const url = new URL(window.location.href);
    const set = (k: string, v: string | null) => (v ? url.searchParams.set(k, v) : url.searchParams.delete(k));
    set('resp', resp);
    set('layout', layout === 'popular' ? 'popular' : null);
    set('q', q.trim() || null);
    const next = url.pathname + url.search + url.hash;
    if (next !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState(window.history.state, '', next);
    }
  }, [fromUrl, q, resp, layout]);

  useEffect(() => {
    if (!pendingAnchor) return;
    document.getElementById(pendingAnchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setPendingAnchor(null);
  }, [pendingAnchor, layout]);

  const term = lc(q.trim());
  const hits = useMemo(
    () =>
      rows.filter(c => {
        if (resp === 'medical' && !c.isMedical) return false;
        if (resp === 'professional' && c.isMedical) return false;
        if (!term) return true;
        return lc([c.name, c.blurb, c.group, ...c.tags].join(' ')).includes(term);
      }),
    [rows, resp, term],
  );
  const filtered = !!term || !!resp;
  const reset = () => {
    setQ('');
    setResp(null);
  };

  const groups =
    layout === 'popular'
      ? hits.length
        ? [{ id: 'g-all', name: 'לפי מספר עסקים', items: [...hits].sort((a, b) => b.count - a.count) }]
        : []
      : groupOrder
          .map(g => ({ id: GROUP_ID[g] ?? g, name: g, items: hits.filter(c => c.group === g) }))
          .filter(g => g.items.length > 0);

  let rowIndex = 0;

  return (
    <div className={styles.layout}>
      <aside aria-label="ניווט בתחומים" className={styles.rail}>
        <nav aria-label="משפחות טיפולים" className={styles.groupNav}>
          <div className={styles.railHead}>משפחות טיפולים</div>
          {groupOrder.map(g => {
            const id = GROUP_ID[g] ?? g;
            const live = hits.some(c => c.group === g);
            const total = rows.filter(c => c.group === g).reduce((n, c) => n + c.count, 0);
            return (
              <a
                key={g}
                href={`#${id}`}
                className={styles.groupLink}
                data-live={live || undefined}
                onClick={e => {
                  if (layout === 'popular') {
                    e.preventDefault();
                    setLayout('group');
                    setPendingAnchor(id);
                  }
                }}
              >
                <span>{g}</span>
                <span className={`${styles.groupCount} ltr tnum`}>{fmtInt(total)}</span>
              </a>
            );
          })}
        </nav>

        <div className={styles.legend}>
          <div className={styles.legendHead}>מי אחראי על הטיפול</div>
          <div className={styles.legendRows}>
            <div className={styles.legendRow}>
              <span className={styles.legendTag} data-kind="medical">רפואי</span>
              <span>פעולה חודרנית או הזרקה: מחייבת רופא או רופא שיניים, או אחות באחריות רופא. בעסק מוצגת אחריות רפואית.</span>
            </div>
            <div className={styles.legendRow}>
              <span className={styles.legendTag} data-kind="professional">מקצועי</span>
              <span>קוסמטיקאית, ספרית, מעצבת ציפורניים או מעסה, עם הכשרה מקצועית. בעסק מוצג איש מקצוע אחראי.</span>
            </div>
          </div>
        </div>

        <Link href="/search" className={styles.railCta}>
          <span>חיפוש עסקים לפי עיר</span>
          <ArrowForward size={14} />
        </Link>
      </aside>

      <div className={styles.content}>
        <div role="search" className={styles.filters}>
          <label className={styles.searchBox}>
            <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="#8A96A3" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
              <circle cx="8" cy="8" r="5.4" />
              <path d="m12.2 12.2 3 3" />
            </svg>
            <span className="sr-only">חיפוש תחום או טיפול</span>
            <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש תחום או טיפול: בוטוקס, לק ג׳ל, עיסוי" />
          </label>
          <div role="group" aria-label="אחריות מקצועית" className={styles.segment}>
            {RESP_TABS.map(t => (
              <button key={t.name} type="button" aria-pressed={resp === t.val} className={styles.segBtn} onClick={() => setResp(t.val)}>
                {t.name}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.resultBar}>
          <span className={styles.resultLine} aria-live="polite">
            {filtered ? (
              <>
                <span className="ltr tnum">{hits.length}</span> מתוך <span className="ltr tnum">{rows.length}</span> תחומים תואמים
              </>
            ) : layout === 'popular' ? (
              `כל ${rows.length} התחומים לפי מספר העסקים`
            ) : (
              `כל ${rows.length} התחומים לפי משפחת טיפולים`
            )}
          </span>
          {filtered && (
            <button type="button" className={styles.resetBtn} onClick={reset}>
              נקו סינון
            </button>
          )}
          <div role="group" aria-label="סדר התצוגה" className={styles.layoutSwitch}>
            {LAYOUTS.map(l => (
              <button key={l.val} type="button" aria-pressed={layout === l.val} className={styles.layoutBtn} onClick={() => setLayout(l.val)}>
                {l.name}
              </button>
            ))}
          </div>
        </div>

        {groups.map(g => (
          <section key={g.id} id={g.id} aria-labelledby={`${g.id}-h`} className={styles.group}>
            <div className={styles.groupHead}>
              <h2 id={`${g.id}-h`} className={styles.groupTitle}>{g.name}</h2>
              <span className={styles.groupMeta}>
                {g.items.length === 1 ? 'תחום אחד' : <><span className="ltr tnum">{g.items.length}</span> תחומים</>} ·{' '}
                <span className="ltr tnum">{fmtInt(g.items.reduce((n, c) => n + c.count, 0))}</span> עסקים
              </span>
            </div>
            <div aria-hidden="true" className={styles.colHead}>
              <span className={styles.cImg} />
              <span className={styles.cName}>תחום</span>
              <span className={styles.cResp}>אחריות</span>
              <span className={styles.cMedian}>מחיר חציוני</span>
              <span className={styles.cFreq}>תדירות</span>
              <span className={styles.cCount}>עסקים</span>
              <span className={styles.cArrow} />
            </div>
            <ul className={styles.list}>
              {g.items.map(c => {
                const i = rowIndex++;
                return (
                  <li key={c.slug} style={{ animationDelay: `${Math.min(i, 9) * 35}ms` }}>
                    <Link href={`/treatments/${c.slug}`} className={styles.row}>
                      <span className={`${styles.cImg} ${styles.thumb}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- small static thumbnail */}
                        <img src={c.img} alt="" loading="lazy" decoding="async" />
                      </span>
                      <span className={styles.cName}>
                        <span className={styles.name}>{c.name}</span>
                        <span className={styles.blurb}>{c.blurb}</span>
                      </span>
                      <span className={styles.cResp}>
                        <span className={shared.badge} data-kind={c.isMedical ? 'medical' : 'professional'}>
                          {c.isMedical ? 'רפואי' : 'מקצועי'}
                        </span>
                      </span>
                      <span className={styles.cMedian}>
                        {c.median != null ? (
                          <span className={`${styles.median} ltr tnum`}>{nis(c.median)}</span>
                        ) : (
                          <span className={styles.na}>אין מספיק מחירים</span>
                        )}
                      </span>
                      <span className={`${styles.cFreq} ${styles.freq}`}>{c.freq}</span>
                      <span className={`${styles.cCount} ${styles.count}`}>
                        <span className="ltr tnum">{fmtInt(c.count)}</span>
                        <span className="sr-only"> עסקים</span>
                      </span>
                      <span aria-hidden="true" className={`${styles.cArrow} ${styles.arrow}`}>
                        <ArrowForward size={14} />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {hits.length === 0 && (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>אין תחום שתואם את החיפוש</p>
            <p className={styles.emptyBody}>נסו מונח רחב יותר, או דלגו לחיפוש עסקים לפי עיר.</p>
            <button type="button" className={styles.emptyBtn} onClick={reset}>
              הצגת כל {rows.length} התחומים
            </button>
          </div>
        )}

        <p className={styles.footnote}>
          המחירים הם חציון בשקלים, לא כולל מע״מ, מתוך התפריטים שהעסקים מפרסמים, ומוצגים רק כשיש לפחות שלושה מחירים בתחום. הם אינם הצעת מחיר ואינם מחייבים אף עסק. טיפולים אסתטיים אלקטיביים אינם בסל הבריאות.
        </p>
      </div>
    </div>
  );
}
