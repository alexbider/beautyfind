'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ui } from '@/components/ops/ui';
import { decideAiActionAction } from './actions';

export function ApprovalButtons({ id }: { id: string }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const go = (decision: 'approve' | 'reject') =>
    start(async () => {
      const r = await decideAiActionAction({ id, decision, note });
      setMsg(r.ok ? { ok: true, text: decision === 'approve' ? `בוצע: ${r.result}` : 'נדחה' } : { ok: false, text: r.error });
      if (r.ok) router.refresh();
    });
  return (
    <div className={ui.stack} style={{ gap: 8, minWidth: 220 }}>
      <input className={ui.input} value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="הערה (לא חובה)" aria-label="הערה להחלטה" />
      <div className={ui.actions}>
        <button type="button" className={`${ui.btn} ${ui.small} ${ui.teal}`} disabled={pending} onClick={() => go('approve')}>אישור וביצוע</button>
        <button type="button" className={`${ui.btn} ${ui.small} ${ui.danger}`} disabled={pending} onClick={() => go('reject')}>דחייה</button>
        {msg ? <span className={msg.ok ? ui.ok : ui.error}>{msg.text}</span> : null}
      </div>
    </div>
  );
}
