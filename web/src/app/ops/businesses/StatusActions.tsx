'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ui } from '@/components/ops/ui';
import { setBusinessStatusAction } from './actions';

type Status = 'pending' | 'live' | 'past_due' | 'hidden' | 'hold_payment';
const OPTIONS: Array<{ status: Status; label: string; kind?: 'primary' | 'danger' }> = [
  { status: 'live', label: 'הפעלה · פרסום בפומבי', kind: 'primary' },
  { status: 'hold_payment', label: 'הסתרה עד תשלום ושליחת בקשת תשלום' },
  { status: 'hidden', label: 'הסתרה מהאתר', kind: 'danger' },
  { status: 'past_due', label: 'סימון חוב פתוח' },
  { status: 'pending', label: 'החזרה להמתנה לאימות' },
];

export function StatusActions({ id, current, canEdit, awaitingPayment = false }: { id: string; current: Status; canEdit: boolean; awaitingPayment?: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!canEdit) return <p className={ui.note}>לתפקיד שלך יש צפייה בלבד בעסקים. שינוי מצב דורש הרשאת עריכה.</p>;
  return (
    <div>
      <label className={ui.label} htmlFor="biz-reason">סיבה (נרשמת ביומן ובהחלטות)</label>
      <input id="biz-reason" className={ui.input} value={reason} onChange={e => setReason(e.target.value)} maxLength={300} placeholder="למשל: רישיון פג תוקף, בקשת הבעלים, חוב מעל 14 יום" />
      <div className={ui.actions} style={{ marginTop: 10 }}>
        {awaitingPayment ? <p className={ui.note} style={{ width: '100%' }}>מוסתר עד התשלום הראשון. הבעלים קיבלו בקשת תשלום, והפרופיל יעלה לאוויר אוטומטית כשהחיוב יעבור.</p> : null}
        {OPTIONS.filter(o => o.status !== current && !(o.status === 'hold_payment' && awaitingPayment)).map(o => (
          <button
            key={o.status} type="button" className={`${ui.btn} ${o.kind ? ui[o.kind] : ''}`} disabled={pending}
            onClick={() => {
              if (o.status === 'hidden' && !window.confirm('להסתיר את העסק וכל סניפיו מהאתר הציבורי?')) return;
              if (o.status === 'hold_payment' && !window.confirm('להסתיר את העסק עד התשלום הראשון ולשלוח לבעלים בקשת תשלום באימייל וב־SMS?')) return;
              start(async () => {
                const r = await setBusinessStatusAction({ id, status: o.status, reason });
                setMsg(r.ok ? 'נשמר' : r.error === 'forbidden' ? 'אין הרשאה' : 'הפעולה נכשלה');
                if (r.ok) router.refresh();
              });
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      {msg ? <p className={`${ui.msg} ${msg === 'נשמר' ? ui.ok : ui.error}`}>{msg}</p> : null}
    </div>
  );
}
