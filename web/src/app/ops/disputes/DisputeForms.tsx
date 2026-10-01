'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ui } from '@/components/ops/ui';
import { decideDisputeAction, openDisputeAction } from './actions';

export function OpenDisputeForm() {
  const router = useRouter();
  const [kind, setKind] = useState<'deposit' | 'gift_card'>('deposit');
  const [ref, setRef] = useState('');
  const [claim, setClaim] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className={ui.stack} style={{ gap: 10 }}
      onSubmit={e => {
        e.preventDefault();
        start(async () => {
          const r = await openDisputeAction({ kind, ref, claim });
          setMsg(r.ok ? { ok: true, text: `נפתחה מחלוקת ${r.ref}` } : { ok: false, text: r.error });
          if (r.ok) { setRef(''); setClaim(''); router.refresh(); }
        });
      }}
    >
      <div className={ui.pills} role="radiogroup" aria-label="סוג המחלוקת">
        <button type="button" className={ui.pill} data-on={kind === 'deposit'} onClick={() => setKind('deposit')}>מקדמה</button>
        <button type="button" className={ui.pill} data-on={kind === 'gift_card'} onClick={() => setKind('gift_card')}>שובר</button>
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="d-ref">{kind === 'deposit' ? 'מספר תור (למשל BF-4288)' : 'קוד שובר'}</label>
        <input id="d-ref" className={ui.input} value={ref} onChange={e => setRef(e.target.value)} dir="ltr" required />
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="d-claim">טענת הלקוחה</label>
        <textarea id="d-claim" className={ui.textarea} value={claim} onChange={e => setClaim(e.target.value)} maxLength={1500} required placeholder="במילים של הלקוחה, כפי שהתקבלו" />
      </div>
      <div className={ui.actions}>
        <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={pending}>פתיחת מחלוקת</button>
        {msg ? <span className={msg.ok ? ui.ok : ui.error}>{msg.text}</span> : null}
      </div>
      <p className={ui.hint}>העובדות (ביטול, שעות לפני התור, החזרים, המדיניות שהוצגה) נשלפות מהרשומה עצמה.</p>
    </form>
  );
}

export function DecideButtons({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const run = (next: 'recommended_refund' | 'closed_policy_upheld' | 'escalated_legal') => {
    const note = window.prompt('הערה להחלטה (רשות):', '');
    if (note === null) return;
    start(async () => {
      const r = await decideDisputeAction({ id, status: next, note });
      if (!r.ok) setErr(r.error);
      else router.refresh();
    });
  };
  if (status !== 'open') {
    return status === 'escalated_legal' ? null : <button type="button" className={`${ui.btn} ${ui.small}`} disabled={pending} onClick={() => run('escalated_legal')}>העברה ליועמ״ש</button>;
  }
  return (
    <div className={ui.actions}>
      <button type="button" className={`${ui.btn} ${ui.teal}`} disabled={pending} onClick={() => run('recommended_refund')}>המלצה לקליניקה: להחזיר</button>
      <button type="button" className={ui.btn} disabled={pending} onClick={() => run('closed_policy_upheld')}>המדיניות נאכפה כנדרש</button>
      <button type="button" className={`${ui.btn} ${ui.danger}`} disabled={pending} onClick={() => run('escalated_legal')}>העברה ליועמ״ש</button>
      {err ? <span className={ui.error}>{err}</span> : null}
    </div>
  );
}
