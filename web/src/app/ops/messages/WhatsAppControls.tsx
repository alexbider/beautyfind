'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Toggle } from '@/components/ops/Toggle';
import { Chip, ui } from '@/components/ops/ui';
import { saveWhatsAppFromAction, setWhatsAppFlagAction, syncWhatsAppTemplatesAction, whatsappSendersAction, whatsappTestAction } from './actions';

// The WhatsApp card: sender number (picked from the Twilio account), switches, templates and a test send.

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

export function WhatsAppToggles({ enabled, forSms, canEdit }: { enabled: boolean; forSms: boolean; canEdit: boolean }) {
  return (
    <>
      <Toggle name="whatsappEnabled" checked={enabled} title="הודעות שירות ב־WhatsApp דרך Twilio" sub="רק הודעות שיש להן תבנית מאושרת. כשהמספר לא ב־WhatsApp או שההודעה לא נמסרה, אותו טקסט נשלח ב־SMS" onChange={setWhatsAppFlagAction} disabled={!canEdit} />
      <Toggle name="whatsappForSms" checked={forSms} title="WhatsApp קודם גם להודעות SMS" sub="אישורי תור, ביטולים ותזכורות שנשלחים היום ב־SMS יוצאים ב־WhatsApp, שזול בהרבה, ועוברים ל־SMS רק כשאין ברירה. קודי אימות לא משתנים" onChange={setWhatsAppFlagAction} disabled={!canEdit} />
    </>
  );
}

export function WhatsAppSenderForm({ from, canEdit }: { from: string; canEdit: boolean }) {
  const [v, setV] = useState(from);
  const [senders, setSenders] = useState<Array<{ phone: string; status: string; name: string | null }> | null>(null);
  const { msg, pending, run } = useRun();
  const [loading, startLoad] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className={ui.stack} style={{ gap: 10 }}>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="wa-from">מספר השולח ב־WhatsApp</label>
        <input id="wa-from" className={ui.input} dir="ltr" placeholder="+97253…" value={v} disabled={!canEdit} onChange={e => setV(e.target.value)} />
        <span className={ui.hint}>המספר שנרשם ב־Twilio, Messaging, Senders, WhatsApp senders</span>
      </div>
      {canEdit && (
        <div className={ui.actions}>
          <button type="button" className={`${ui.btn} ${ui.primary}`} disabled={pending} onClick={() => run(() => saveWhatsAppFromAction({ from: v }))}>שמירה</button>
          <button type="button" className={ui.btn} disabled={loading} onClick={() => startLoad(async () => { setErr(null); const r = await whatsappSendersAction(); if (r.ok) setSenders(r.senders); else setErr(r.error); })}>{loading ? 'קורא…' : 'מספרי WhatsApp בחשבון'}</button>
        </div>
      )}
      {senders && (senders.length ? (
        <ul className={ui.list}>
          {senders.map(s => (
            <li key={s.phone} className={ui.listItem}>
              <span className="ltr">{s.phone}</span>{s.name ? ` · ${s.name}` : ''} <Chip tone={s.status.toUpperCase() === 'ONLINE' ? 'ok' : 'warn'}>{s.status}</Chip>
              {canEdit && <button type="button" className={`${ui.btn} ${ui.small}`} onClick={() => run(() => saveWhatsAppFromAction({ from: s.phone }), () => setV(s.phone))}>בחירה</button>}
            </li>
          ))}
        </ul>
      ) : <p className={ui.note}>אין עדיין מספרי WhatsApp בחשבון. רושמים מספר ב־Twilio Console, Messaging, Senders, WhatsApp senders, Create new sender.</p>)}
      {err && <span className={ui.error}>{err}</span>}
      <Msg m={msg} />
    </div>
  );
}

export function WhatsAppTemplatesSync({ canEdit, hasCreds }: { canEdit: boolean; hasCreds: boolean }) {
  const { msg, pending, run } = useRun();
  if (!canEdit) return null;
  return (
    <div className={ui.actions}>
      <button type="button" className={`${ui.btn} ${ui.primary}`} disabled={pending || !hasCreds} onClick={() => run(syncWhatsAppTemplatesAction)}>{pending ? 'מעדכן…' : 'יצירה ושליחה לאישור, ועדכון סטטוס'}</button>
      <Msg m={msg} />
    </div>
  );
}

export function WhatsAppTestForm({ templates, canEdit }: { templates: Array<{ id: string; label: string }>; canEdit: boolean }) {
  const [phone, setPhone] = useState('');
  const [tpl, setTpl] = useState(templates[0]?.id ?? '');
  const { msg, pending, run } = useRun();
  if (!canEdit) return null;
  return (
    <div className={ui.stack} style={{ gap: 10 }}>
      <div className={ui.inlineForm}>
        <input className={ui.input} dir="ltr" placeholder="050…" value={phone} onChange={e => setPhone(e.target.value)} aria-label="טלפון לבדיקה" />
        <select className={ui.input} value={tpl} onChange={e => setTpl(e.target.value)} aria-label="תבנית">
          {templates.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <button type="button" className={ui.btn} disabled={pending || !phone.trim() || !templates.length} onClick={() => run(() => whatsappTestAction({ phone, template: tpl }))}>שליחת בדיקה</button>
      </div>
      {!templates.length && <span className={ui.hint}>שליחת בדיקה אפשרית אחרי שתבנית אחת לפחות מאושרת</span>}
      <Msg m={msg} />
    </div>
  );
}
