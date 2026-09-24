'use client';

import { useState, type FormEvent } from 'react';
import { toE164 } from '@/lib/format';
import styles from './states.module.css';

// Design: project/BeautyFind States.dc.html → "אין תוצאות" (the WhatsApp alert box).
// The caller owns storage and consent: pass a server action that records the request.

export function AreaAlertForm({
  action,
  title = 'לעדכן אתכם כשתיפתח קליניקה באזור?',
  body = 'נשלח הודעה אחת בוואטסאפ כשקליניקה שמתאימה לסינון שלכם תצטרף למדריך.',
}: {
  action: (phoneE164: string) => Promise<{ ok: boolean; message?: string }>;
  title?: string;
  body?: string;
}) {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const e164 = toE164(phone);
    if (!e164) {
      setMsg({ text: 'הזינו מספר נייד תקין', bad: true });
      return;
    }
    setBusy(true);
    try {
      const res = await action(e164);
      setMsg(res.ok ? { text: res.message ?? 'נעדכן אתכם בוואטסאפ כשתצטרף קליניקה מתאימה', bad: false } : { text: res.message ?? 'לא הצלחנו לשמור את הבקשה. נסו שוב.', bad: true });
    } catch {
      setMsg({ text: 'לא הצלחנו לשמור את הבקשה. נסו שוב.', bad: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.alert} onSubmit={submit} noValidate>
      <h3>{title}</h3>
      <p>{body}</p>
      <div className={styles.alertRow}>
        <input
          value={phone} onChange={e => { setPhone(e.target.value); setMsg(null); }} dir="ltr" type="tel" inputMode="tel" autoComplete="tel"
          placeholder="052-000-0000" aria-label="טלפון להתראה" aria-invalid={msg?.bad || undefined} aria-describedby={msg ? 'area-alert-msg' : undefined}
          className={styles.alertInput}
        />
        <button type="submit" disabled={busy} className={styles.alertBtn}>{busy ? 'שומר…' : 'עדכנו אותי'}</button>
      </div>
      <p id="area-alert-msg" role="status" className={styles.alertMsg} data-bad={msg?.bad || undefined} hidden={!msg}>
        {msg?.text}
      </p>
    </form>
  );
}
