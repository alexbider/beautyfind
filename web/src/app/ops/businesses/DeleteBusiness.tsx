'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { ui } from '@/components/ops/ui';
import { deleteBusinessAction } from './actions';

// Permanent delete of a business. Rendered only for the master admin (the page checks the role, and the
// server action checks it again on every call). It asks for a reason and for the business name typed
// exactly; while a blocker exists (an active subscription, a sponsored placement, an open marketing order,
// gift cards with value, upcoming bookings) the dialog shows why and the button stays off.

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
      <p className={ui.note}>מחיקה לצמיתות של העסק, כל סניפיו וכל הנתונים שלו. אי אפשר לבטל את הפעולה.</p>
      <div className={ui.actions} style={{ marginTop: 10 }}>
        <button type="button" className={`${ui.btn} ${ui.danger}`} onClick={() => ref.current?.showModal()}>מחיקת העסק</button>
      </div>
      <dialog ref={ref} style={dialogStyle} aria-labelledby="del-title" onClose={() => setTyped('')}>
        <h2 id="del-title" style={{ margin: '0 0 8px', fontSize: 18 }}>מחיקת {name}</h2>
        <p style={{ margin: '0 0 6px' }}>מה יקרה אחרי המחיקה:</p>
        <ul style={{ margin: '0 0 12px', paddingInlineStart: 20, lineHeight: 1.6 }}>
          <li>העסק וכל סניפיו יימחקו מהמערכת לצמיתות: פרופילים, טיפולים, ביקורות, תמונות, צוות, הזמנות, פניות ולידים.</li>
          <li>הפרופילים ייעלמו מהאתר, מהחיפוש ומהסייטמאפ, והכתובות שלהם יחזירו 404.</li>
          <li>תשלומים, חשבוניות, החזרים ומחלוקות נשמרים לצורכי הנהלת חשבונות.</li>
          <li><strong>אי אפשר לשחזר את העסק אחרי המחיקה.</strong></li>
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
              if (r.ok) { close(); router.push('/ops/businesses'); return; }
              setServerBlockers(r.blockers ?? []);
              setMsg(r.error);
            })}
          >
            {pending ? 'מוחק…' : 'מחיקה לצמיתות'}
          </button>
          <button type="button" className={ui.btn} onClick={close}>ביטול</button>
        </div>
        {msg ? <p className={`${ui.msg} ${ui.error}`}>{msg}</p> : null}
      </dialog>
    </div>
  );
}
