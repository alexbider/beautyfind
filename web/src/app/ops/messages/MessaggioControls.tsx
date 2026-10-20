'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Toggle } from '@/components/ops/Toggle';
import { ui } from '@/components/ops/ui';
import { messaggioTestAction, removeMessaggioKeyAction, saveMessaggioKeyAction, saveMessaggioSettingsAction, setMessaggioFlagAction } from './actions';

// The Messaggio card's controls. The API key goes to the server once and is never sent back.

type Res = { ok: true; text: string } | { ok: false; error: string };

function useRun() {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Res>, after?: () => void) => start(async () => {
    setMsg(null);
    const r = await fn();
    setMsg(r.ok ? { ok: true, text: r.text } : { ok: false, text: r.error });
    if (r.ok) { after?.(); router.refresh(); }
  });
  return { msg, pending, run };
}

export function MessaggioToggle({ name, checked, title, sub, canEdit }: { name: string; checked: boolean; title: string; sub?: string; canEdit: boolean }) {
  return <Toggle name={name} checked={checked} title={title} sub={sub} onChange={setMessaggioFlagAction} disabled={!canEdit} />;
}

export function MessaggioKeyForm({ hint, source, canEdit }: { hint: string | null; source: 'env' | 'admin' | null; canEdit: boolean }) {
  const [key, setKey] = useState('');
  const { msg, pending, run } = useRun();
  return (
    <div className={ui.stack} style={{ gap: 10 }}>
      <p className={ui.note}>{hint ? <>מפתח פעיל: <b dir="ltr">{hint}</b>{source === 'env' ? ' (משתנה הסביבה ב־Vercel, גובר על מפתח שהוזן כאן)' : ' (הוזן כאן, שמור מוצפן)'}</> : 'עוד לא הוזן מפתח API.'}</p>
      {canEdit ? (
        <>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="mg-key">מפתח API (Messaggio Login) מחשבון Messaggio</label>
            <input id="mg-key" className={ui.input} type="password" dir="ltr" autoComplete="off" spellCheck={false} value={key} onChange={e => setKey(e.target.value)} placeholder="הדביקו את המפתח" />
          </div>
          <div className={ui.actions}>
            <button type="button" className={`${ui.btn} ${ui.primary}`} disabled={pending || !key.trim()} onClick={() => run(() => saveMessaggioKeyAction(key), () => setKey(''))}>שמירת המפתח</button>
            {source === 'admin' ? <button type="button" className={ui.btn} disabled={pending} onClick={() => { if (confirm('להסיר את המפתח? קודי אימות יחזרו לספק ברירת המחדל.')) run(removeMessaggioKeyAction); }}>הסרת המפתח</button> : null}
          </div>
        </>
      ) : null}
      {msg ? <span className={msg.ok ? ui.ok : ui.error} role="status">{msg.text}</span> : null}
    </div>
  );
}

export function MessaggioSettingsForm({ values, canEdit }: { values: { smsSender: string; whatsappSender: string; whatsappTemplate: string; baseUrl: string }; canEdit: boolean }) {
  const [v, setV] = useState(values);
  const { msg, pending, run } = useRun();
  const field = (k: keyof typeof v, label: string, hint: string, ltr = true) => (
    <div className={ui.field} style={{ paddingBottom: 10 }}>
      <label className={ui.label} htmlFor={`mg-${k}`}>{label}</label>
      <input id={`mg-${k}`} className={ui.input} dir={ltr ? 'ltr' : undefined} value={v[k]} disabled={!canEdit} onChange={e => setV({ ...v, [k]: e.target.value })} />
      <span className={ui.hint}>{hint}</span>
    </div>
  );
  return (
    <form onSubmit={e => { e.preventDefault(); run(() => saveMessaggioSettingsAction(v)); }}>
      {field('smsSender', 'שם השולח ב־SMS', 'עד 11 תווים לטיניים (למשל BeautyFind), כפי שאושר בחשבון Messaggio')}
      {field('whatsappSender', 'שולח WhatsApp', 'מזהה השולח של WhatsApp כפי שמופיע ב־Messaggio')}
      {field('whatsappTemplate', 'תבנית אימות ב־WhatsApp (לא חובה)', 'שם תבנית Authentication מאושרת ב־Meta. ריק: נשלח טקסט רגיל')}
      {field('baseUrl', 'כתובת ה־API', 'ברירת מחדל: https://msg.messaggio.com/api/v1')}
      {canEdit ? <div className={ui.actions}><button type="submit" className={`${ui.btn} ${ui.small}`} disabled={pending}>שמירה</button>{msg ? <span className={msg.ok ? ui.ok : ui.error}>{msg.text}</span> : null}</div> : null}
    </form>
  );
}

export function MessaggioTestForm({ configured, canEdit }: { configured: boolean; canEdit: boolean }) {
  const [phone, setPhone] = useState('');
  const [channel, setChannel] = useState<'sms' | 'whatsapp'>('sms');
  const { msg, pending, run } = useRun();
  if (!canEdit) return null;
  return (
    <div className={ui.stack} style={{ gap: 10 }}>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="mg-phone">שליחת הודעת בדיקה אל</label>
        <input id="mg-phone" className={ui.input} dir="ltr" inputMode="tel" placeholder="050-1234567" value={phone} onChange={e => setPhone(e.target.value)} />
      </div>
      <div className={ui.actions}>
        <select className={ui.select} value={channel} onChange={e => setChannel(e.target.value as 'sms' | 'whatsapp')} aria-label="ערוץ">
          <option value="sms">SMS</option>
          <option value="whatsapp">WhatsApp</option>
        </select>
        <button type="button" className={`${ui.btn} ${ui.primary}`} disabled={pending || !configured || !phone.trim()} onClick={() => run(() => messaggioTestAction({ phone, channel }))}>{pending ? 'שולח…' : 'שליחת בדיקה'}</button>
      </div>
      {msg ? <span className={msg.ok ? ui.ok : ui.error} role="status">{msg.text}</span> : null}
    </div>
  );
}
