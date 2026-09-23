'use client';

import { useState, useTransition } from 'react';
import { connectProvider, disconnectProvider } from '@/app/biz/payments/actions';
import { verifyErrorText, type ProviderDTO } from './shared';
import s from './payments.module.css';

/** One provider (payments or invoicing): status, fields, docs, connect form and disconnect. */
export function ProviderCard({ p, otherConnected }: { p: ProviderDTO; otherConnected: string | null }) {
  const c = p.connection;
  const state = !p.available && c?.status !== 'connected' ? 'soon' : c?.status === 'connected' ? 'connected' : c?.status === 'error' ? 'error' : 'off';
  const [open, setOpen] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, start] = useTransition();
  const sandbox = p.key === 'sandbox';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setMsg('');
    const missing = p.fields.find(f => !values[f.key]?.trim());
    if (missing) return setErr(`חסר: ${missing.label}.`);
    start(async () => {
      const r = await connectProvider(p.kind, p.key, values);
      setValues({}); // never keep credentials around in the browser
      if (r.ok) {
        setOpen(false);
        setMsg(r.message);
      } else setErr(r.error);
    });
  };

  const disconnect = () =>
    start(async () => {
      setErr('');
      const r = await disconnectProvider(p.kind, p.key);
      setConfirmOff(false);
      if (r.ok) setMsg(r.message);
      else setErr(r.error);
    });

  const kindWord = p.kind === 'payments' ? 'הסליקה' : 'החשבוניות';

  return (
    <article className={s.provider} data-state={state} aria-labelledby={`pv-${p.kind}-${p.key}`}>
      <div className={s.provTop}>
        <h3 id={`pv-${p.kind}-${p.key}`} className={s.provName} style={{ margin: 0 }}>{p.name}</h3>
        {c?.testMode && c.status === 'connected' ? <span className={`${s.pill} ${s.pillTest}`}>מצב בדיקה</span> : null}
        {state === 'connected' ? <span className={`${s.pill} ${s.pillOn}`}>מחובר</span>
          : state === 'error' ? <span className={`${s.pill} ${s.pillErr}`}>שגיאה</span>
            : state === 'soon' ? <span className={`${s.pill} ${s.pillSoon}`}>בקרוב</span>
              : <span className={`${s.pill} ${s.pillOff}`}>לא מחובר</span>}
      </div>

      {sandbox ? (
        <p className={`${s.callout} ${s.warn}`}>
          סביבת בדיקה: לקוחות רואים דף תשלום לדוגמה ואין חיוב אמיתי{p.kind === 'invoicing' ? ', והמסמכים ממוספרים מקומית בלי תוקף מס' : ''}. לשימוש בהדגמות ובבדיקות בלבד, לא לקליניקה פעילה.
        </p>
      ) : (
        <p className={s.provFields}>
          {p.fields.length ? <>פרטים לחיבור: {p.fields.map(f => f.label).join(' · ')}</> : 'אין צורך בפרטים נוספים.'}
        </p>
      )}
      {p.docsUrl ? (
        <a href={p.docsUrl} target="_blank" rel="noopener noreferrer" className={s.docs}>
          תיעוד החיבור אצל {p.name}
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 3H3v8h8V9M8 2h4v4M12 2 6.5 7.5" />
          </svg>
        </a>
      ) : null}
      {c?.checked && state !== 'soon' ? <p className={s.provMeta}>בדיקה אחרונה: <span className="ltr">{c.checked}</span></p> : null}
      {state === 'error' ? <p className={`${s.callout} ${s.bad}`}>{verifyErrorText(c?.lastError ?? null)}</p> : null}
      {msg ? <p role="status" className={s.okMsg}>{msg}</p> : null}
      {err && !open ? <p role="alert" className={s.error}>{err}</p> : null}

      {state === 'soon' ? null : open ? (
        <form className={s.form} onSubmit={submit} autoComplete="off" noValidate>
          {otherConnected && state !== 'connected' ? (
            <p className={`${s.callout} ${s.info}`}>חיבור {p.name} יחליף את {otherConnected} כספק {kindWord} הפעיל.</p>
          ) : null}
          {p.fields.map(f => (
            <label key={f.key} className={s.field}>
              <span>{f.label}</span>
              <input
                type={f.secret ? 'password' : 'text'} dir="ltr" autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true"
                value={values[f.key] ?? ''} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} className={s.input} maxLength={500}
              />
              {f.help ? <span className={s.fieldHelp}>{f.help}</span> : null}
            </label>
          ))}
          {p.fields.some(f => f.secret) ? (
            <p className={s.provMeta}>הפרטים נשמרים מוצפנים ולא מוצגים שוב. כדי לעדכן, מזינים אותם מחדש.</p>
          ) : null}
          {err ? <p role="alert" className={s.error}>{err}</p> : null}
          <div className={s.provActions}>
            <button type="submit" className={s.primary} disabled={busy}>{busy ? 'בודקים את החיבור…' : sandbox ? 'הפעלת סביבת הבדיקה' : 'בדיקה ושמירה'}</button>
            <button type="button" className={s.ghost} onClick={() => { setOpen(false); setValues({}); setErr(''); }}>ביטול</button>
          </div>
        </form>
      ) : confirmOff ? (
        <div className={`${s.callout} ${s.bad}`} role="alertdialog" aria-label={`ניתוק ${p.name}`}>
          <p style={{ margin: '0 0 9px' }}>
            {p.kind === 'payments'
              ? 'בלי חברת סליקה מחוברת, מקדמות, שוברי מתנה וייעוץ בתשלום ייכבו מיד. תשלומים שכבר התקבלו לא נפגעים, והחזרים עליהם ימשיכו לעבור דרך החשבון הזה.'
              : 'בלי מערכת חשבוניות מחוברת, חשבוניות מס לא יופקו אוטומטית, והקליניקה תפיק אותן במערכת שלה.'}
          </p>
          <div className={s.provActions}>
            <button type="button" className={s.danger} onClick={disconnect} disabled={busy}>ניתוק</button>
            <button type="button" className={s.ghost} onClick={() => setConfirmOff(false)}>השאר מחובר</button>
          </div>
        </div>
      ) : (
        <div className={s.provActions}>
          {state === 'connected' ? (
            <>
              {p.fields.length ? <button type="button" className={s.outline} onClick={() => { setOpen(true); setMsg(''); }}>עדכון פרטים</button> : null}
              <button type="button" className={s.danger} onClick={() => { setConfirmOff(true); setMsg(''); }}>ניתוק</button>
            </>
          ) : (
            <button type="button" className={s.primary} onClick={() => { setOpen(true); setMsg(''); setErr(''); }}>{state === 'error' ? 'חיבור מחדש' : 'חיבור'}</button>
          )}
        </div>
      )}
    </article>
  );
}
