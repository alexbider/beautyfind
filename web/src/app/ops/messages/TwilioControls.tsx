'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Toggle } from '@/components/ops/Toggle';
import { ui } from '@/components/ops/ui';
import { removeTwilioCredsAction, saveTwilioCredsAction, saveTwilioSenderAction, saveTwilioVoiceAction, setTwilioFlagAction, twilioCheckAction, twilioTestAction, twilioTestCallAction } from './actions';

// The Twilio card's controls. The Auth Token goes to the server once and is never sent back.

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

export function TwilioToggle({ checked, canEdit }: { checked: boolean; canEdit: boolean }) {
  return <Toggle name="enabled" checked={checked} title="שליחת קודי SMS ושיחות קוליות דרך Twilio" sub="כולל גיבוי ה־SMS של קודי WhatsApp. כבוי: SMS עובר ל־Messaggio אם הוא פעיל, אחרת ללוג" onChange={setTwilioFlagAction} disabled={!canEdit} />;
}

export function TwilioCredsForm({ accountSid, source, canEdit }: { accountSid: string | null; source: 'env' | 'admin' | null; canEdit: boolean }) {
  const [sid, setSid] = useState('');
  const [token, setToken] = useState('');
  const { msg, pending, run } = useRun();
  return (
    <div className={ui.stack} style={{ gap: 10 }}>
      <p className={ui.note}>{accountSid ? <>חשבון: <b dir="ltr">{accountSid}</b>{source === 'env' ? ' (ממשתני הסביבה ב־Vercel)' : ' (הוזן כאן, ה־Auth Token שמור מוצפן)'}</> : 'עוד לא הוזנו פרטי חשבון Twilio.'}</p>
      {canEdit ? (
        <>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="tw-sid">Account SID</label>
            <input id="tw-sid" className={ui.input} dir="ltr" autoComplete="off" spellCheck={false} placeholder="AC…" value={sid} onChange={e => setSid(e.target.value)} />
          </div>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="tw-token">Auth Token</label>
            <input id="tw-token" className={ui.input} type="password" dir="ltr" autoComplete="off" spellCheck={false} value={token} onChange={e => setToken(e.target.value)} />
            <span className={ui.hint}>שניהם מופיעים ב־Twilio Console, בעמוד הראשי של החשבון (Account Info)</span>
          </div>
          <div className={ui.actions}>
            <button type="button" className={`${ui.btn} ${ui.primary}`} disabled={pending || !sid.trim() || !token.trim()} onClick={() => run(() => saveTwilioCredsAction({ accountSid: sid, authToken: token }), () => setToken(''))}>שמירה ובדיקה</button>
            {accountSid ? <button type="button" className={ui.btn} disabled={pending} onClick={() => run(twilioCheckAction)}>בדיקת חיבור</button> : null}
            {source === 'admin' ? <button type="button" className={ui.btn} disabled={pending} onClick={() => { if (confirm('להסיר את פרטי Twilio? קודי SMS יפסיקו לעבור דרכו.')) run(removeTwilioCredsAction); }}>הסרה</button> : null}
          </div>
        </>
      ) : null}
      <Msg m={msg} />
    </div>
  );
}

export function TwilioSenderForm({ from, messagingServiceSid, canEdit }: { from: string; messagingServiceSid: string; canEdit: boolean }) {
  const [v, setV] = useState({ from, messagingServiceSid });
  const { msg, pending, run } = useRun();
  return (
    <form className={ui.stack} style={{ gap: 10 }} onSubmit={e => { e.preventDefault(); run(() => saveTwilioSenderAction(v)); }}>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="tw-from">שולח (From)</label>
        <input id="tw-from" className={ui.input} dir="ltr" placeholder="+972… או BeautyFind" value={v.from} disabled={!canEdit} onChange={e => setV({ ...v, from: e.target.value })} />
        <span className={ui.hint}>מספר Twilio שלכם, או שם שולח (Alphanumeric Sender ID) של עד 11 תווים לטיניים שאושר לישראל</span>
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="tw-mg">Messaging Service SID (לא חובה)</label>
        <input id="tw-mg" className={ui.input} dir="ltr" placeholder="MG…" value={v.messagingServiceSid} disabled={!canEdit} onChange={e => setV({ ...v, messagingServiceSid: e.target.value })} />
        <span className={ui.hint}>אם מוגדר, Twilio בוחר את השולח מתוך השירות והוא גובר על From</span>
      </div>
      {canEdit ? <div className={ui.actions}><button type="submit" className={`${ui.btn} ${ui.small}`} disabled={pending}>שמירה</button><Msg m={msg} /></div> : null}
    </form>
  );
}

export function TwilioTestForm({ ready, canEdit }: { ready: boolean; canEdit: boolean }) {
  const [phone, setPhone] = useState('');
  const { msg, pending, run } = useRun();
  if (!canEdit) return null;
  return (
    <div className={ui.stack} style={{ gap: 10 }}>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="tw-phone">שליחת SMS בדיקה אל</label>
        <input id="tw-phone" className={ui.input} dir="ltr" inputMode="tel" placeholder="050-1234567" value={phone} onChange={e => setPhone(e.target.value)} />
      </div>
      <div className={ui.actions}>
        <button type="button" className={`${ui.btn} ${ui.primary}`} disabled={pending || !ready || !phone.trim()} onClick={() => run(() => twilioTestAction({ phone }))}>{pending ? 'שולח…' : 'שליחת בדיקה'}</button>
      </div>
      <Msg m={msg} />
    </div>
  );
}

/** The voice call that reads a claim code aloud: the number it calls from, the voice, and a test call. */
export function TwilioVoiceForm({ voiceFrom, voice, effectiveFrom, configured, canEdit }: { voiceFrom: string; voice: string; effectiveFrom: string | null; configured: boolean; canEdit: boolean }) {
  const [v, setV] = useState({ voiceFrom, voice });
  const [phone, setPhone] = useState('');
  const save = useRun();
  const test = useRun();
  return (
    <div className={ui.stack} style={{ gap: 10 }}>
      <p className={ui.note}>{effectiveFrom ? <>שיחות קוליות יוצאות מ־<b dir="ltr">{effectiveFrom}</b>. כך עובד אימות הבעלות בשיחה קולית.</> : 'אין מספר Twilio לשיחות, ולכן האפשרות "שיחה קולית" באימות בעלות מוסתרת.'}</p>
      <form className={ui.stack} style={{ gap: 10 }} onSubmit={e => { e.preventDefault(); save.run(() => saveTwilioVoiceAction(v)); }}>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="tw-voice-from">מספר לשיחות (לא חובה)</label>
          <input id="tw-voice-from" className={ui.input} dir="ltr" placeholder="+972…" value={v.voiceFrom} disabled={!canEdit} onChange={e => setV({ ...v, voiceFrom: e.target.value })} />
          <span className={ui.hint}>מספר Twilio עם יכולת Voice. ריק: משתמשים בשולח ה־SMS אם הוא מספר טלפון. שם שולח אלפאנומרי לא יכול להתקשר.</span>
        </div>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="tw-voice">קול</label>
          <input id="tw-voice" className={ui.input} dir="ltr" placeholder="Google.he-IL-Standard-A" value={v.voice} disabled={!canEdit} onChange={e => setV({ ...v, voice: e.target.value })} />
          <span className={ui.hint}>קול עברי של Twilio, למשל Google.he-IL-Standard-A או Google.he-IL-Wavenet-B</span>
        </div>
        {canEdit ? <div className={ui.actions}><button type="submit" className={`${ui.btn} ${ui.small}`} disabled={save.pending}>שמירה</button><Msg m={save.msg} /></div> : null}
      </form>
      {canEdit ? (
        <>
          <div className={ui.field}>
            <label className={ui.label} htmlFor="tw-call">שיחת בדיקה אל</label>
            <input id="tw-call" className={ui.input} dir="ltr" inputMode="tel" placeholder="050-1234567" value={phone} onChange={e => setPhone(e.target.value)} />
          </div>
          <div className={ui.actions}>
            <button type="button" className={ui.btn} disabled={test.pending || !configured || !effectiveFrom || !phone.trim()} onClick={() => test.run(() => twilioTestCallAction({ phone }))}>{test.pending ? 'מתקשר…' : 'שיחת בדיקה'}</button>
          </div>
          <Msg m={test.msg} />
        </>
      ) : null}
    </div>
  );
}
