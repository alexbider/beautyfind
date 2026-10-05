'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { ui } from '@/components/ops/ui';
import { needsRecheck, priceText, updatedLabel, type MarketPriceItem, type MarketPrices } from '@/lib/marketPrices';
import { saveMarketPricesAction } from './actions';

// Staff editing of the market price ranges: one category at a time, rows in display order (the order on the
// public page), add, edit, move and delete; confidence and the source year are shown read-only, and a row
// marked low or sourced before 2024 is highlighted so staff know what to re-check first.

type Row = MarketPriceItem & { key: number };
const CONFIDENCE_HE: Record<NonNullable<MarketPriceItem['confidence']>, string> = { high: 'גבוהה', medium: 'בינונית', low: 'נמוכה' };

let seq = 1;
const toRows = (items: MarketPriceItem[]): Row[] => items.map(i => ({ ...i, key: seq++ }));

export function MarketPricesForm({ data, categories, units, canEdit }: { data: MarketPrices; categories: Array<{ slug: string; name: string }>; units: string[]; canEdit: boolean }) {
  const router = useRouter();
  const [cat, setCat] = useState(categories[0]?.slug ?? '');
  const [rows, setRows] = useState<Row[]>(() => toRows(data.categories[categories[0]?.slug ?? ''] ?? []));
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const recheck = useMemo(() => rows.filter(needsRecheck).length, [rows]);

  const pick = (slug: string) => {
    if (dirty && !window.confirm('יש שינויים שלא נשמרו בתחום הנוכחי. לעבור בלי לשמור?')) return;
    setCat(slug);
    setRows(toRows(data.categories[slug] ?? []));
    setDirty(false);
    setMsg(null);
  };
  const update = (key: number, patch: Partial<MarketPriceItem>) => {
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const move = (i: number, d: -1 | 1) => {
    setRows(rs => {
      const j = i + d;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setDirty(true);
  };
  const remove = (key: number) => {
    setRows(rs => rs.filter(r => r.key !== key));
    setDirty(true);
  };
  const add = () => {
    setRows(rs => [...rs, { key: seq++, label: '', min: 0, max: null, unit: units[0] ?? 'לטיפול', medical: false }]);
    setDirty(true);
  };
  const save = () =>
    start(async () => {
      const payload = rows.map(({ key: _key, ...r }) => ({ ...r, note: r.note?.trim() || undefined }));
      const res = await saveMarketPricesAction(cat, payload);
      if (res.ok) {
        setDirty(false);
        setMsg({ ok: true, text: `נשמר. ${updatedLabel(res.updated)}.` });
        router.refresh();
      } else setMsg({ ok: false, text: res.error });
    });

  return (
    <div className={ui.stack} style={{ gap: 12, padding: '12px 20px 16px' }}>
      <div className={ui.toolbar}>
        <label className={ui.label} htmlFor="mp-cat">תחום</label>
        <select id="mp-cat" className={ui.input} value={cat} onChange={e => pick(e.target.value)} style={{ maxWidth: 280 }}>
          {categories.map(c => (
            <option key={c.slug} value={c.slug}>{c.name} ({(data.categories[c.slug] ?? []).length})</option>
          ))}
        </select>
        <span className={ui.hint}>{updatedLabel(data.meta.updated)} · גרסה {data.meta.version}{recheck ? ` · ${recheck} שורות לבדיקה חוזרת` : ''}</span>
      </div>

      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead>
            <tr>
              <th>סדר</th>
              <th>טיפול</th>
              <th>מינימום ₪</th>
              <th>מקסימום ₪</th>
              <th>יחידה</th>
              <th>הערה</th>
              <th>רפואי</th>
              <th>ביטחון</th>
              <th>שנת מקור</th>
              <th>תצוגה</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const flag = needsRecheck(r);
              return (
                <tr key={r.key} style={flag ? { background: 'var(--warn-bg)' } : undefined} title={flag ? 'לבדיקה חוזרת: ביטחון נמוך או מקור לפני 2024' : undefined}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className={`${ui.btn} ${ui.small}`} aria-label="למעלה" disabled={!canEdit || i === 0} onClick={() => move(i, -1)}>▲</button>{' '}
                    <button type="button" className={`${ui.btn} ${ui.small}`} aria-label="למטה" disabled={!canEdit || i === rows.length - 1} onClick={() => move(i, 1)}>▼</button>
                  </td>
                  <td><input className={ui.input} value={r.label} maxLength={80} disabled={!canEdit} aria-label="שם הטיפול" onChange={e => update(r.key, { label: e.target.value })} style={{ minWidth: 180 }} /></td>
                  <td><input className={ui.input} type="number" inputMode="numeric" min={0} step={1} value={r.min} required disabled={!canEdit} aria-label="מינימום" onChange={e => update(r.key, { min: Number(e.target.value) })} style={{ width: 96 }} /></td>
                  <td><input className={ui.input} type="number" inputMode="numeric" min={r.min} step={1} value={r.max ?? ''} placeholder="ריק = מ־" disabled={!canEdit} aria-label="מקסימום" onChange={e => update(r.key, { max: e.target.value === '' ? null : Number(e.target.value) })} style={{ width: 110 }} /></td>
                  <td>
                    <select className={ui.input} value={r.unit} disabled={!canEdit} aria-label="יחידה" onChange={e => update(r.key, { unit: e.target.value })}>
                      {units.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </td>
                  <td><input className={ui.input} value={r.note ?? ''} maxLength={160} disabled={!canEdit} aria-label="הערה" onChange={e => update(r.key, { note: e.target.value })} style={{ minWidth: 160 }} /></td>
                  <td style={{ textAlign: 'center' }}><input type="checkbox" checked={r.medical} disabled={!canEdit} aria-label="טיפול רפואי" onChange={e => update(r.key, { medical: e.target.checked })} /></td>
                  <td>{r.confidence ? <span className={ui.chip} data-tone={r.confidence === 'low' ? 'bad' : r.confidence === 'medium' ? 'warn' : 'ok'}>{CONFIDENCE_HE[r.confidence]}</span> : <span className={ui.hint}>חדש</span>}</td>
                  <td className="ltr tnum">{r.sourceYear ?? ''}</td>
                  <td><bdi dir="ltr" className="tnum">{priceText(r)}</bdi></td>
                  <td><button type="button" className={`${ui.btn} ${ui.small} ${ui.danger}`} disabled={!canEdit} onClick={() => remove(r.key)}>מחיקה</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canEdit ? (
        <div className={ui.actions}>
          <button type="button" className={`${ui.btn} ${ui.small}`} onClick={add}>הוספת שורה</button>
          <button type="button" className={`${ui.btn} ${ui.primary} ${ui.small}`} disabled={pending || !dirty} onClick={save}>שמירת התחום</button>
          {msg ? <span className={msg.ok ? ui.ok : ui.error}>{msg.text}</span> : dirty ? <span className={ui.hint}>שינויים שלא נשמרו</span> : null}
        </div>
      ) : null}
      <p className={ui.hint} style={{ margin: 0 }}>
        הסדר בטבלה הוא הסדר בעמוד הציבורי (מהנפוץ ביותר). מינימום חובה; מקסימום ריק מוצג כ״מ־X ₪״, ושווה למינימום כ״כ־X ₪״. הביטחון, שנת המקור והמקורות עצמם אינם מוצגים לציבור. שמירה מעדכנת את חודש העדכון ומרעננת את דפי התחומים.
      </p>
    </div>
  );
}
