'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ui } from '@/components/ops/ui';
import { saveServiceConfigAction, syncStripeCatalogAction, updateMarketingOrderAction } from './actions';

type StatusOption = { key: string; name: string };

export function OrderEditForm({
  id,
  status,
  statusNote,
  internalNote,
  businessId,
  statuses,
  canEdit,
}: {
  id: string;
  status: string;
  statusNote: string;
  internalNote: string;
  businessId: string;
  statuses: StatusOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [st, setSt] = useState(status);
  const [note, setNote] = useState(statusNote);
  const [internal, setInternal] = useState(internalNote);
  const [biz, setBiz] = useState(businessId);
  const [notify, setNotify] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!canEdit) return <p className={ui.note}>לתפקיד שלך יש צפייה בלבד בשירותי השיווק.</p>;
  return (
    <form
      className={ui.stack}
      style={{ gap: 10 }}
      onSubmit={e => {
        e.preventDefault();
        start(async () => {
          const r = await updateMarketingOrderAction({ id, status: st as never, statusNote: note, internalNote: internal, notify, businessId: biz.trim() });
          setMsg(r.ok ? { ok: true, text: 'נשמר' } : { ok: false, text: r.error });
          if (r.ok) router.refresh();
        });
      }}
    >
      <div className={ui.field}>
        <label className={ui.label} htmlFor="mk-status">סטטוס</label>
        <select id="mk-status" className={ui.input} value={st} onChange={e => setSt(e.target.value)}>
          {statuses.map(s => (
            <option key={s.key} value={s.key}>{s.name}</option>
          ))}
        </select>
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="mk-note">שורת סטטוס ללקוח</label>
        <textarea id="mk-note" className={ui.textarea} rows={3} value={note} maxLength={600} placeholder="מה קורה עכשיו ומה השלב הבא, במשפט או שניים" onChange={e => setNote(e.target.value)} />
      </div>
      <label className={ui.toggleRow} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} />
        <span>לשלוח ללקוח מייל עם העדכון</span>
      </label>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="mk-internal">הערות פנימיות</label>
        <textarea id="mk-internal" className={ui.textarea} rows={4} value={internal} maxLength={4000} onChange={e => setInternal(e.target.value)} />
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="mk-biz">מזהה העסק ב־BeautyFind</label>
        <input id="mk-biz" className={ui.input} dir="ltr" value={biz} placeholder="uuid, כדי שההזמנה תופיע בלוח הניהול של העסק" onChange={e => setBiz(e.target.value)} />
      </div>
      <div className={ui.actions}>
        <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={pending}>{pending ? 'שומרים…' : 'שמירה'}</button>
        {msg ? <span className={msg.ok ? ui.ok : ui.error}>{msg.text}</span> : null}
      </div>
    </form>
  );
}

type PkgRow = { key: string; name: string; cycle: string; defaultPrice: number; defaultSetup: number; priceNis?: number; setupNis?: number; hidden?: boolean };

export function ServiceConfigForm({ slug, enabled, mode, packages, canEdit }: { slug: string; enabled: boolean; mode: string; packages: PkgRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [m, setM] = useState(mode);
  const [rows, setRows] = useState(packages);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const patch = (key: string, p: Partial<PkgRow>) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...p } : r)));
  return (
    <form
      className={ui.stack}
      style={{ gap: 10 }}
      onSubmit={e => {
        e.preventDefault();
        start(async () => {
          const pk = Object.fromEntries(
            rows.map(r => [
              r.key,
              {
                ...(r.priceNis && r.priceNis !== r.defaultPrice ? { priceNis: r.priceNis } : {}),
                ...(r.setupNis !== undefined && r.setupNis !== r.defaultSetup ? { setupNis: r.setupNis } : {}),
                ...(r.hidden ? { hidden: true } : {}),
              },
            ]),
          );
          const res = await saveServiceConfigAction({ slug, enabled: on, mode: m as 'buy' | 'quote' | 'both', packages: pk });
          setMsg(res.ok ? { ok: true, text: 'נשמר ופורסם' } : { ok: false, text: res.error });
          if (res.ok) router.refresh();
        });
      }}
    >
      <div className={ui.formGrid}>
        <label className={ui.field}>
          <span className={ui.label}>מצב</span>
          <select className={ui.input} value={on ? 'on' : 'off'} disabled={!canEdit} onChange={e => setOn(e.target.value === 'on')}>
            <option value="on">פעיל באתר</option>
            <option value="off">מוסתר מהזמנה</option>
          </select>
        </label>
        <label className={ui.field}>
          <span className={ui.label}>אופן הזמנה</span>
          <select className={ui.input} value={m} disabled={!canEdit} onChange={e => setM(e.target.value)}>
            <option value="both">רכישה אונליין והצעת מחיר</option>
            <option value="buy">רכישה אונליין בלבד</option>
            <option value="quote">הצעת מחיר בלבד</option>
          </select>
        </label>
      </div>
      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead>
            <tr>
              <th>חבילה</th>
              <th>מחיר (₪)</th>
              <th>הקמה (₪)</th>
              <th>מוסתרת</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key}>
                <td>
                  {r.name}
                  <div className={ui.note}>{r.cycle === 'monthly' ? 'חודשי' : 'חד־פעמי'} · ברירת מחדל {r.defaultPrice.toLocaleString('en-US')}</div>
                </td>
                <td>
                  <input className={ui.input} type="number" min={0} step={10} dir="ltr" disabled={!canEdit} value={r.priceNis ?? r.defaultPrice} onChange={e => patch(r.key, { priceNis: Number(e.target.value) })} style={{ maxWidth: 120 }} />
                </td>
                <td>
                  <input className={ui.input} type="number" min={0} step={10} dir="ltr" disabled={!canEdit} value={r.setupNis ?? r.defaultSetup} onChange={e => patch(r.key, { setupNis: Number(e.target.value) })} style={{ maxWidth: 110 }} />
                </td>
                <td>
                  <input type="checkbox" disabled={!canEdit} checked={!!r.hidden} onChange={e => patch(r.key, { hidden: e.target.checked })} aria-label={`הסתרת ${r.name}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <div className={ui.actions}>
          <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={pending}>{pending ? 'שומרים…' : 'שמירה ופרסום'}</button>
          {msg ? <span className={msg.ok ? ui.ok : ui.error}>{msg.text}</span> : null}
        </div>
      ) : (
        <p className={ui.note}>שינוי מחירים דורש הרשאה מלאה בשירותי שיווק.</p>
      )}
    </form>
  );
}

export function StripeSyncButton({ canEdit }: { canEdit: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!canEdit) return null;
  return (
    <div className={ui.actions}>
      <button type="button" className={ui.btn} disabled={pending} onClick={() => start(async () => {
        const r = await syncStripeCatalogAction();
        setMsg(r.ok ? { ok: true, text: r.text } : { ok: false, text: r.error });
        router.refresh();
      })}>{pending ? 'מסנכרן…' : 'סנכרון השירותים והמחירים ל־Stripe'}</button>
      {msg && <span className={msg.ok ? ui.ok : ui.error} role="status">{msg.text}</span>}
    </div>
  );
}
