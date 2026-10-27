'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Toggle } from '@/components/ops/Toggle';
import { ui } from '@/components/ops/ui';
import { cancelMessageAction, queueClaimInvitesAction, retryMessageAction, runNowAction, setAutomationAction } from './actions';

type Res = { ok: true; text: string } | { ok: false; error: string };

function useRun() {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Res>) => start(async () => {
    setMsg(null);
    const r = await fn();
    setMsg(r.ok ? { ok: true, text: r.text } : { ok: false, text: r.error });
    router.refresh();
  });
  return { msg, pending, run };
}

const Msg = ({ m }: { m: { ok: boolean; text: string } | null }) => (m ? <span className={m.ok ? ui.ok : ui.error} role="status">{m.text}</span> : null);

export function AutomationToggle({ name, checked, title, sub, canEdit }: { name: string; checked: boolean; title: string; sub: string; canEdit: boolean }) {
  return <Toggle name={name} checked={checked} title={title} sub={sub} onChange={setAutomationAction} disabled={!canEdit} />;
}

export function RunNow({ canEdit }: { canEdit: boolean }) {
  const { msg, pending, run } = useRun();
  if (!canEdit) return null;
  return (
    <div className={ui.actions}>
      <button type="button" className={ui.btn} disabled={pending} onClick={() => run(runNowAction)}>{pending ? 'מריץ…' : 'הרצה עכשיו'}</button>
      <Msg m={msg} />
    </div>
  );
}

export function ClaimBatch({ available, canEdit }: { available: number; canEdit: boolean }) {
  const [count, setCount] = useState(Math.min(50, available) || 1);
  const { msg, pending, run } = useRun();
  if (!canEdit) return null;
  return (
    <div className={ui.stack} style={{ gap: 10 }}>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="claim-count">כמה עסקים להזמין עכשיו</label>
        <input id="claim-count" className={ui.input} type="number" min={1} max={300} dir="ltr" value={count} onChange={e => setCount(Number(e.target.value))} style={{ maxWidth: 140 }} />
        <span className={ui.hint}>מומלץ להתחיל ב־50 ולראות כמה מאשרים בעלות לפני הקבוצה הבאה.</span>
      </div>
      <div className={ui.actions}>
        <button type="button" className={`${ui.btn} ${ui.primary}`} disabled={pending || !available || count < 1} onClick={() => { if (confirm(`להכניס ${count} הזמנות לתור? כל עסק מקבל הזמנה אחת בלבד.`)) run(() => queueClaimInvitesAction({ count })); }}>הכנסה לתור</button>
      </div>
      <Msg m={msg} />
    </div>
  );
}

export function RowActions({ id, status, canEdit }: { id: string; status: string; canEdit: boolean }) {
  const { msg, pending, run } = useRun();
  if (!canEdit) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      {status === 'pending' ? <button type="button" className={`${ui.btn} ${ui.small}`} disabled={pending} onClick={() => run(() => cancelMessageAction({ id }))}>ביטול</button> : null}
      {['failed', 'skipped', 'expired', 'cancelled'].includes(status) ? <button type="button" className={`${ui.btn} ${ui.small}`} disabled={pending} onClick={() => run(() => retryMessageAction({ id }))}>החזרה לתור</button> : null}
      {msg && !msg.ok ? <Msg m={msg} /> : null}
    </span>
  );
}
