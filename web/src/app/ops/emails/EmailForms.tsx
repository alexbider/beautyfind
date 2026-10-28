'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Chip, ui } from '@/components/ops/ui';
import type { SetupResult } from '@/lib/server/emailTracking';
import { runTrackingSetupAction, saveReplySettingsAction, setReplyStatusAction } from './actions';

export function ReplyStatusButton({ id, status, canEdit }: { id: string; status: string; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  if (!canEdit) return null;
  const next = status === 'handled' ? 'new' : 'handled';
  return (
    <span>
      <button
        type="button"
        className={`${ui.btn} ${status === 'handled' ? '' : ui.primary}`}
        disabled={pending}
        onClick={() => start(async () => {
          const r = await setReplyStatusAction({ id, status: next });
          if (r.ok) router.refresh();
          else setErr(r.error);
        })}
      >
        {status === 'handled' ? 'החזרה לטיפול' : 'סימון כטופל'}
      </button>
      {err && <span className={ui.note}> {err}</span>}
    </span>
  );
}

export function TrackingSetup({ canRun }: { canRun: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<SetupResult | null>(null);
  return (
    <div className={ui.stack} style={{ gap: 12 }}>
      <p className={ui.note}>
        ההגדרה מפעילה ב־Resend מעקב פתיחות והקלקות על דומיין השליחה, פותחת תת־דומיין לקבלת תשובות ומעדכנת את ה־Webhook לכל האירועים. אפשר להריץ שוב בכל זמן, היא לא משנה מה שכבר מוגדר.
      </p>
      {canRun ? (
        <div>
          <button type="button" className={`${ui.btn} ${ui.primary}`} disabled={pending} onClick={() => start(async () => { setRes(await runTrackingSetupAction()); router.refresh(); })}>
            {pending ? 'מגדיר…' : 'הפעלה ובדיקה של המעקב'}
          </button>
        </div>
      ) : (
        <p className={ui.note}>הפעלת המעקב דורשת הרשאה מלאה באזור הזה.</p>
      )}
      {res && (
        <div className={ui.stack} style={{ gap: 8 }}>
          {res.error && <p className={ui.note}><Chip tone="bad">שגיאה</Chip> {res.error}</p>}
          {res.steps.map(s => (
            <div key={s.key}>
              <Chip tone={s.ok ? 'ok' : 'warn'}>{s.ok ? 'פעיל' : 'ממתין'}</Chip> {s.label}{s.note ? <span className={ui.note}> · {s.note}</span> : null}
            </div>
          ))}
          {res.dns.length > 0 && (
            <div className={ui.tableWrap}>
              <table className={ui.table}>
                <thead><tr><th>סוג</th><th>שם</th><th>ערך</th><th>עדיפות</th><th>מטרה</th><th>מצב</th></tr></thead>
                <tbody>
                  {res.dns.map((r, i) => (
                    <tr key={i}>
                      <td className="ltr">{r.type}</td>
                      <td className="ltr">{r.name} <span className={ui.note}>({r.domain})</span></td>
                      <td className="ltr" style={{ wordBreak: 'break-all', maxWidth: 320 }}>{r.value}</td>
                      <td className="ltr">{r.priority ?? ''}</td>
                      <td>{r.purpose}</td>
                      <td><Chip tone={r.status === 'verified' ? 'ok' : 'warn'}>{r.status === 'verified' ? 'מאומת' : r.status}</Chip></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ReplySettingsForm({ forwardTo, replyDomain, canEdit }: { forwardTo: string; replyDomain: string; canEdit: boolean }) {
  const router = useRouter();
  const [fwd, setFwd] = useState(forwardTo);
  const [dom, setDom] = useState(replyDomain);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className={ui.stack}
      style={{ gap: 10 }}
      onSubmit={e => {
        e.preventDefault();
        start(async () => {
          const r = await saveReplySettingsAction({ forwardTo: fwd, replyDomain: dom });
          setMsg(r.ok ? { ok: true, text: 'נשמר' } : { ok: false, text: r.error });
          if (r.ok) router.refresh();
        });
      }}
    >
      <div className={ui.field}>
        <label className={ui.label} htmlFor="em-fwd">לאן להעביר תשובות</label>
        <input id="em-fwd" className={ui.input} dir="ltr" value={fwd} disabled={!canEdit} onChange={e => setFwd(e.target.value)} />
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="em-dom">תת־דומיין לתשובות</label>
        <input id="em-dom" className={ui.input} dir="ltr" placeholder="reply.beautyfind.co.il" value={dom} disabled={!canEdit} onChange={e => setDom(e.target.value)} />
        <span className={ui.note}>ריק: התשובות הולכות לכתובת ה־Reply-To הרגילה ולא נמדדות. ההגדרה האוטומטית ממלאת את השדה כשהרשומות מאומתות.</span>
      </div>
      {canEdit && (
        <div>
          <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={pending}>שמירה</button>
          {msg && <span className={ui.note}> {msg.text}</span>}
        </div>
      )}
    </form>
  );
}
