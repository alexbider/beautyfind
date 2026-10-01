'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Toggle } from '@/components/ops/Toggle';
import { ui } from '@/components/ops/ui';
import { saveMaintenanceMessageAction, saveNumbersAction, setFlagAction, type FlagKey, type NumberKey } from './actions';

export interface NumberField { key: NumberKey; label: string; unit: string; step?: number }
export interface NumberGroup { title: string; fields: NumberField[] }

export function NumbersForm({ groups, values, canEdit }: { groups: NumberGroup[]; values: Record<NumberKey, number>; canEdit: boolean }) {
  const router = useRouter();
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(Object.entries(values).map(([k, n]) => [k, String(n)])));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className={ui.grid2}
      onSubmit={e => {
        e.preventDefault();
        start(async () => {
          const r = await saveNumbersAction(v);
          setMsg(r.ok ? { ok: true, text: 'נשמר' } : { ok: false, text: r.error });
          if (r.ok) router.refresh();
        });
      }}
    >
      {groups.map(g => (
        <div key={g.title} className={`${ui.card} ${ui.cardPad}`}>
          <h2 className={ui.cardTitle} style={{ marginBottom: 8 }}>{g.title}</h2>
          {g.fields.map(f => (
            <div key={f.key} className={ui.setting}>
              <label className={ui.settingLabel} htmlFor={`s-${f.key}`}>{f.label}</label>
              <span className={ui.settingInput}>
                <input id={`s-${f.key}`} className={ui.input} type="number" inputMode="decimal" step={f.step ?? 1} min={0} value={v[f.key] ?? ''} disabled={!canEdit} onChange={e => setV({ ...v, [f.key]: e.target.value })} />
                <span className={ui.unit}>{f.unit}</span>
              </span>
            </div>
          ))}
        </div>
      ))}
      {canEdit ? (
        <div className={ui.actions} style={{ gridColumn: '1 / -1' }}>
          <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={pending}>שמירת ההגדרות</button>
          {msg ? <span className={msg.ok ? ui.ok : ui.error}>{msg.text}</span> : null}
        </div>
      ) : null}
    </form>
  );
}

export function FlagToggle({ name, checked, title, sub }: { name: FlagKey; checked: boolean; title: string; sub: string }) {
  return <Toggle name={name} checked={checked} title={title} sub={sub} onChange={setFlagAction} />;
}

export function MaintenanceMessage({ message, canEdit }: { message: string; canEdit: boolean }) {
  const router = useRouter();
  const [text, setText] = useState(message);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form className={ui.stack} style={{ gap: 8, padding: '12px 20px 16px' }} onSubmit={e => { e.preventDefault(); start(async () => { const r = await saveMaintenanceMessageAction(text); setMsg(r.ok ? { ok: true, text: 'נשמר' } : { ok: false, text: r.error }); if (r.ok) router.refresh(); }); }}>
      <label className={ui.label} htmlFor="s-maint">הודעת התחזוקה שמוצגת באתר</label>
      <textarea id="s-maint" className={ui.textarea} value={text} onChange={e => setText(e.target.value)} maxLength={300} disabled={!canEdit} style={{ minHeight: 70 }} />
      {canEdit ? <div className={ui.actions}><button type="submit" className={`${ui.btn} ${ui.small}`} disabled={pending}>שמירת ההודעה</button>{msg ? <span className={msg.ok ? ui.ok : ui.error}>{msg.text}</span> : null}</div> : null}
    </form>
  );
}
