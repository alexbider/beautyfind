'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ui } from '@/components/ops/ui';
import { saveTemplateDraftAction } from './actions';

export function DraftEditor({ id, draft, canEdit }: { id: string; draft: string; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(draft);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!canEdit) return draft ? <span className={ui.note}>{draft}</span> : null;
  if (!open) return <button type="button" className={`${ui.btn} ${ui.small}`} onClick={() => setOpen(true)}>{draft ? 'עריכת טיוטה' : 'טיוטה'}</button>;
  return (
    <form
      className={ui.stack} style={{ gap: 8, minWidth: 260 }}
      onSubmit={e => {
        e.preventDefault();
        start(async () => {
          const r = await saveTemplateDraftAction({ id, text });
          setMsg(r.ok ? { ok: true, text: 'נשמר' } : { ok: false, text: r.error });
          if (r.ok) { setOpen(false); router.refresh(); }
        });
      }}
    >
      <textarea className={ui.textarea} value={text} onChange={e => setText(e.target.value)} maxLength={2000} placeholder="נוסח ההודעה עם משתנים בסוגריים מסולסלים, למשל {name}, {date}" />
      <div className={ui.actions}>
        <button type="submit" className={`${ui.btn} ${ui.small} ${ui.primary}`} disabled={pending}>שמירת טיוטה</button>
        <button type="button" className={`${ui.btn} ${ui.small}`} onClick={() => setOpen(false)}>ביטול</button>
        {msg ? <span className={msg.ok ? ui.ok : ui.error}>{msg.text}</span> : null}
      </div>
    </form>
  );
}
