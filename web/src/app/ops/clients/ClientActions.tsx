'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ui } from '@/components/ops/ui';
import { blockClientAction, completePrivacyRequestAction } from './actions';

export function BlockButton({ id, blocked, canEdit }: { id: string; blocked: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  if (!canEdit) return null;
  return (
    <>
      <button
        type="button" className={`${ui.btn} ${ui.small} ${blocked ? '' : ui.danger}`} disabled={pending}
        onClick={() => {
          const reason = blocked ? '' : window.prompt('סיבת החסימה (נרשמת ביומן):', '') ;
          if (!blocked && reason === null) return;
          start(async () => {
            const r = await blockClientAction({ id, block: !blocked, reason: reason ?? undefined });
            if (!r.ok) setErr(r.error === 'forbidden' ? 'אין הרשאה' : 'הפעולה נכשלה');
            else router.refresh();
          });
        }}
      >
        {blocked ? 'שחרור חסימה' : 'חסימה'}
      </button>
      {err ? <span className={ui.error}> {err}</span> : null}
    </>
  );
}

export function PrivacyButtons({ id, kind, canEdit }: { id: string; kind: 'delete' | 'access' | 'correction'; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  if (!canEdit) return null;
  const run = (outcome: 'done' | 'rejected') => {
    const warn = kind === 'delete' && outcome === 'done'
      ? 'לבצע מחיקה? השם, הטלפון, הדוא״ל וההסכמות של החשבון יימחקו לצמיתות; תורים והצהרות נשארים אצל הקליניקות כרשומה קלינית.'
      : outcome === 'rejected' ? 'לדחות את הבקשה? (הסיבה נשלחת ללקוחה בנפרד)' : 'לסמן שהבקשה בוצעה ואישור נשלח ללקוחה?';
    if (!window.confirm(warn)) return;
    const note = window.prompt('הערה ליומן (רשות):', '') ?? undefined;
    start(async () => {
      const r = await completePrivacyRequestAction({ kind, id, outcome, note });
      if (!r.ok) setErr(r.error === 'forbidden' ? 'אין הרשאה' : 'הפעולה נכשלה');
      else router.refresh();
    });
  };
  return (
    <div className={ui.actions}>
      <button type="button" className={`${ui.btn} ${ui.small} ${ui.teal}`} disabled={pending} onClick={() => run('done')}>ביצוע ושליחת אישור</button>
      {kind === 'delete' ? <button type="button" className={`${ui.btn} ${ui.small}`} disabled={pending} onClick={() => run('rejected')}>דחייה</button> : null}
      {err ? <span className={ui.error}>{err}</span> : null}
    </div>
  );
}
