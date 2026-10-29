'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ui } from '@/components/ops/ui';
import { saveAnalyticsIdAction } from './actions';

export function AnalyticsForm({ value, canEdit }: { value: string; canEdit: boolean }) {
  const router = useRouter();
  const [id, setId] = useState(value);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className={`${ui.card} ${ui.cardPad}`}
      onSubmit={e => {
        e.preventDefault();
        start(async () => {
          const r = await saveAnalyticsIdAction(id);
          setMsg(r.ok ? { ok: true, text: 'נשמר' } : { ok: false, text: r.error });
          if (r.ok) router.refresh();
        });
      }}
    >
      <div className={ui.setting}>
        <label className={ui.settingLabel} htmlFor="s-analytics">מזהה מדידה · Google Analytics 4</label>
        <span className={ui.settingInput}>
          <input id="s-analytics" className={ui.input} dir="ltr" placeholder="G-XXXXXXX" value={id} disabled={!canEdit} onChange={e => setId(e.target.value)} />
        </span>
      </div>
      <p className={ui.hint} style={{ margin: '8px 0 12px' }}>הקוד נטען רק למבקרים שאישרו קובצי מדידה מצטברת. השאירו ריק כדי לכבות.</p>
      {canEdit ? (
        <div className={ui.actions}>
          <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={pending}>שמירת מזהה המדידה</button>
          {msg ? <span className={msg.ok ? ui.ok : ui.error}>{msg.text}</span> : null}
        </div>
      ) : null}
    </form>
  );
}
