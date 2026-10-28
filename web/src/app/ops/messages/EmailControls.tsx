'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Toggle } from '@/components/ops/Toggle';
import { ui } from '@/components/ops/ui';
import { SAMPLES } from '@/lib/messages/samples';
import { emailDomainCheckAction, emailTestAction, removeEmailKeyAction, saveEmailHookAction, saveEmailKeyAction, saveEmailSenderAction, setEmailFlagAction } from './actions';

// The email (Resend) card's controls. The API key goes to the server once and is never sent back.

type Res = { ok: true; text: string } | { ok: false; error: string };

function useRun() {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Res>, after?: () => void) => start(async () => {
    setMsg(null);
    const r = await fn();
    setMsg(r.ok ? { ok: true, text: r.text } : { ok: false, text: r.error });
    after?.();
    router.refresh();
  });
  return { msg, pending, run };
}

const Msg = ({ m }: { m: { ok: boolean; text: string } | null }) => (m ? <span className={m.ok ? ui.ok : ui.error} role="status">{m.text}</span> : null);

export function EmailToggle({ checked, canEdit }: { checked: boolean; canEdit: boolean }) {
  return <Toggle name="enabled" checked={checked} title="שליחת אימיילים דרך Resend" sub="איפוס סיסמה, אישורי תור, קבלות, הזמנות צוות וקודים במייל. כבוי: האימיילים נרשמים ללוג בלבד" onChange={setEmailFlagAction} disabled={!canEdit} />;
}

export function EmailKeyForm({ hint, source, canEdit }: { hint: string | null; source: 'env' | 'admin' | null; canEdit: boolean }) {
  const [key, setKey] = useState('');
  const { msg, pending, run } = useRun();
  return (
    <div className={ui.stack} style={{ gap: 10 }}>
      <p className={ui.note}>{hint ? <>מפתח: <b dir="ltr">{hint}</b>{source === 'env' ? ' (ממשתני הסביבה ב־Vercel)' : ' (הוזן כאן, שמור מוצפן)'}</> : 'עוד לא הוזן מפתח API של Resend.'}</p>
      {canEdit ? (
        <>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="rs-key">API Key</label>
            <input id="rs-key" className={ui.input} type="password" dir="ltr" autoComplete="off" spellCheck={false} placeholder="re_…" value={key} onChange={e => setKey(e.target.value)} />
            <span className={ui.hint}>ב־Resend: API Keys, Create API Key, הרשאה Full access (כדי שאפשר יהיה גם לבדוק את הדומיין)</span>
          </div>
          <div className={ui.actions}>
            <button type="button" className={`${ui.btn} ${ui.primary}`} disabled={pending || !key.trim()} onClick={() => run(() => saveEmailKeyAction({ key }), () => setKey(''))}>שמירה ובדיקה</button>
            {hint ? <button type="button" className={ui.btn} disabled={pending} onClick={() => run(emailDomainCheckAction)}>בדיקת דומיין</button> : null}
            {source === 'admin' ? <button type="button" className={ui.btn} disabled={pending} onClick={() => { if (confirm('להסיר את מפתח Resend? אימיילים יפסיקו להישלח.')) run(removeEmailKeyAction); }}>הסרה</button> : null}
          </div>
        </>
      ) : null}
      <Msg m={msg} />
    </div>
  );
}

export function EmailSenderForm({ from, replyTo, canEdit }: { from: string; replyTo: string; canEdit: boolean }) {
  const [v, setV] = useState({ from, replyTo });
  const { msg, pending, run } = useRun();
  return (
    <form className={ui.stack} style={{ gap: 10 }} onSubmit={e => { e.preventDefault(); run(() => saveEmailSenderAction(v)); }}>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="rs-from">שולח (From)</label>
        <input id="rs-from" className={ui.input} dir="ltr" value={v.from} disabled={!canEdit} onChange={e => setV({ ...v, from: e.target.value })} />
        <span className={ui.hint}>הכתובת חייבת להיות בדומיין שאומת ב־Resend</span>
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="rs-reply">כתובת לתשובות (לא חובה)</label>
        <input id="rs-reply" className={ui.input} dir="ltr" placeholder="hello@beautyfind.co.il" value={v.replyTo} disabled={!canEdit} onChange={e => setV({ ...v, replyTo: e.target.value })} />
        <span className={ui.hint}>לשם יגיעו תשובות של לקוחות למיילים</span>
      </div>
      {canEdit ? <div className={ui.actions}><button type="submit" className={`${ui.btn} ${ui.small}`} disabled={pending}>שמירה</button><Msg m={msg} /></div> : null}
    </form>
  );
}

export function EmailTestForm({ ready, canEdit }: { ready: boolean; canEdit: boolean }) {
  const [email, setEmail] = useState('');
  const [template, setTemplate] = useState('email_test');
  const { msg, pending, run } = useRun();
  if (!canEdit) return null;
  const groups = [...new Set(SAMPLES.map(s => s.group))];
  return (
    <div className={ui.stack} style={{ gap: 10 }}>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="rs-test">שליחת מייל בדיקה אל</label>
        <input id="rs-test" className={ui.input} dir="ltr" inputMode="email" placeholder="name@example.com" value={email} onChange={e => setEmail(e.target.value)} />
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="rs-template">מה לשלוח</label>
        <select id="rs-template" className={ui.input} value={template} onChange={e => setTemplate(e.target.value)}>
          <option value="email_test">הודעת בדיקה קצרה</option>
          <option value="all">כל התבניות עם נתוני דוגמה ({SAMPLES.length} מיילים)</option>
          {groups.map(g => (
            <optgroup key={g} label={g}>
              {SAMPLES.filter(s => s.group === g).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </optgroup>
          ))}
        </select>
        <span className={ui.hint}>תבניות נשלחות עם נתוני דוגמה, והנושא מתחיל ב־[דוגמה].</span>
      </div>
      <div className={ui.actions}>
        <button type="button" className={`${ui.btn} ${ui.primary}`} disabled={pending || !ready || !email.trim()} onClick={() => run(() => emailTestAction({ email, template }))}>{pending ? 'שולח…' : 'שליחת בדיקה'}</button>
      </div>
      <Msg m={msg} />
    </div>
  );
}

/** Delivery tracking: the webhook address to give Resend, and its signing secret. */
export function EmailHookForm({ url, configured, canEdit }: { url: string | null; configured: boolean; canEdit: boolean }) {
  const [secret, setSecret] = useState('');
  const { msg, pending, run } = useRun();
  return (
    <div className={ui.stack} style={{ gap: 10 }}>
      <p className={ui.note}>{configured ? 'מעקב מסירה פעיל: Resend מדווח על כל מייל אם נמסר, חזר (bounce) או סומן כספאם.' : 'מעקב מסירה כבוי. כדי להפעיל: ב־Resend, Webhooks, Add Endpoint, הדביקו את הכתובת, סמנו את כל אירועי email והדביקו כאן את ה־Signing secret.'}</p>
      {url ? <p className={ui.hint}>כתובת ל־Resend: <span dir="ltr" className={ui.mono}>{url}</span></p> : <p className={ui.hint}>מעקב מסירה עובד רק באתר החי (כתובת https ציבורית).</p>}
      {canEdit ? (
        <>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="rs-hook">Signing secret</label>
            <input id="rs-hook" className={ui.input} type="password" dir="ltr" autoComplete="off" spellCheck={false} placeholder="whsec_…" value={secret} onChange={e => setSecret(e.target.value)} />
          </div>
          <div className={ui.actions}>
            <button type="button" className={`${ui.btn} ${ui.small}`} disabled={pending || !secret.trim()} onClick={() => run(() => saveEmailHookAction({ secret }), () => setSecret(''))}>שמירה</button>
          </div>
        </>
      ) : null}
      <Msg m={msg} />
    </div>
  );
}
