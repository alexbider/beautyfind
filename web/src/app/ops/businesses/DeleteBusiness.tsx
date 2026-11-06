'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { ui } from '@/components/ops/ui';
import { deleteBusinessAction, restoreBusinessAction } from './actions';

// Delete and restore of a business. Rendered only for the master admin (the page checks the role, and
// the server actions check it again on every call). Delete asks for a reason and for the business name
// typed exactly; while a blocker exists (an active subscription, a sponsored placement, an open marketing
// order) the dialog shows why and the button stays off.

const MIN_REASON = 5;

const dialogStyle: React.CSSProperties = { maxWidth: 520, width: 'calc(100% - 32px)', border: '1px solid var(--line, #ddd)', borderRadius: 12, padding: 20 };

export function DeleteBusiness({ id, name, blockers }: { id: string; name: string; blockers: string[] }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [serverBlockers, setServerBlockers] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const all = blockers.length ? blockers : serverBlockers;
  const ready = !all.length && typed === name && reason.trim().length >= MIN_REASON && !pending;

  const close = () => { ref.current?.close(); setTyped(''); setMsg(null); };

  return (
    <div>
      <p className={ui.note}>מחיקה מסירה את העסק וכל סניפיו מהאתר. אפשר לשחזר אותו מכאן בכל עת.</p>
      <div className={ui.actions} style={{ marginTop: 10 }}>
        <button type="button" className={`${ui.btn} ${ui.danger}`} onClick={() => ref.current?.showModal()}>מחיקת העסק</button>
      </div>
      <dialog ref={ref} style={dialogStyle} aria-labelledby="del-title" onClose={() => setTyped('')}>
        <h2 id="del-title" style={{ margin: '0 0 8px', fontSize: 18 }}>מחיקת {name}</h2>
        <p style={{ margin: '0 0 6px' }}>מה יקרה אחרי המחיקה:</p>
        <ul style={{ margin: '0 0 12px', paddingInlineStart: 20, lineHeight: 1.6 }}>
          <li>העסק וכל סניפיו ייעלמו מהאתר, מהחיפוש, מדפי הערים ומהסייטמאפ.</li>
          <li>כתובות הפרופילים יחזירו 404, וגוגל יסיר אותן מהאינדקס בסריקה הבאה.</li>
          <li>שום דבר לא נמחק מהמערכת: הזמנות, ביקורות, תשלומים וחשבוניות נשמרים.</li>
          <li>אפשר לשחזר את העסק מהניהול, והוא יחזור למצב שהיה בו לפני המחיקה.</li>
        </ul>
        {all.length ? (
          <div className={`${ui.msg} ${ui.error}`} role="alert" style={{ marginBottom: 12 }}>
            <strong>אי אפשר למחוק כרגע:</strong>
            <ul style={{ margin: '6px 0 0', paddingInlineStart: 20 }}>{all.map(b => <li key={b}>{b}</li>)}</ul>
          </div>
        ) : null}
        <label className={ui.label} htmlFor="del-reason">סיבת המחיקה (חובה, נרשמת ביומן)</label>
        <textarea id="del-reason" className={ui.input} rows={2} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} placeholder="למשל: העסק נסגר, בקשת הבעלים, רשומה כפולה" />
        <label className={ui.label} htmlFor="del-name" style={{ marginTop: 10 }}>לאישור, יש להקליד את שם העסק: <strong>{name}</strong></label>
        <input id="del-name" className={ui.input} value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" />
        <div className={ui.actions} style={{ marginTop: 14 }}>
          <button
            type="button" className={`${ui.btn} ${ui.danger}`} disabled={!ready}
            onClick={() => start(async () => {
              const r = await deleteBusinessAction({ id, reason, confirmName: typed });
              if (r.ok) { close(); router.refresh(); return; }
              setServerBlockers(r.blockers ?? []);
              setMsg(r.error);
            })}
          >
            {pending ? 'מוחק…' : 'מחיקה'}
          </button>
          <button type="button" className={ui.btn} onClick={close}>ביטול</button>
        </div>
        {msg ? <p className={`${ui.msg} ${ui.error}`}>{msg}</p> : null}
      </dialog>
    </div>
  );
}

export function RestoreBusiness({ id, deletedAt, reason: deletedReason, fromStatus }: { id: string; deletedAt: string; reason: string | null; fromStatus: string }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <p className={ui.note}>העסק נמחק ב־{deletedAt}{deletedReason ? `. סיבה: ${deletedReason}` : ''}. שחזור יחזיר אותו למצב ״{fromStatus}״.</p>
      <label className={ui.label} htmlFor="restore-reason">סיבת השחזור (חובה, נרשמת ביומן)</label>
      <input id="restore-reason" className={ui.input} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} placeholder="למשל: נמחק בטעות, העסק חזר לפעילות" />
      <div className={ui.actions} style={{ marginTop: 10 }}>
        <button
          type="button" className={`${ui.btn} ${ui.primary}`} disabled={pending || reason.trim().length < MIN_REASON}
          onClick={() => start(async () => {
            const r = await restoreBusinessAction({ id, reason });
            setMsg(r.ok ? 'העסק שוחזר' : r.error);
            if (r.ok) router.refresh();
          })}
        >
          שחזור העסק
        </button>
      </div>
      {msg ? <p className={`${ui.msg} ${msg === 'העסק שוחזר' ? ui.ok : ui.error}`}>{msg}</p> : null}
    </div>
  );
}
