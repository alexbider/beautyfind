'use client';

import { useState, useTransition } from 'react';
import styles from '@/components/waitlist/Waitlist.module.css';
import { sendReplyAction } from '@/app/r/[token]/actions';

// The client's answer to the clinic: confirm the proposed time, ask for another, or write a message.

const ERRORS: Record<string, string> = {
  invalid: 'כתבו כמה מילים לעסק.',
  closed: 'הבקשה כבר נסגרה. לשאלות אפשר להתקשר לעסק.',
  not_paid: 'אי אפשר להשיב כאן כרגע. אפשר להתקשר לעסק.',
  too_fast: 'התשובה הקודמת נשלחה לפני רגע. נסו שוב בעוד כמה שניות.',
  too_many: 'נשלחו כבר הרבה תשובות לבקשה הזו. אפשר להתקשר לעסק.',
  not_found: 'הקישור לא תקין.',
  server: 'משהו השתבש. נסו שוב בעוד רגע.',
};

export function ReplyForm({ token, proposed, business }: { token: string; proposed: string | null; business: string }) {
  const [kind, setKind] = useState<'confirm' | 'other_time' | 'message'>(proposed ? 'confirm' : 'message');
  const [text, setText] = useState('');
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const submit = () => start(async () => {
    const r = await sendReplyAction(token, kind, text);
    if (r.ok) {
      setState({ ok: true, text: `התשובה נשלחה ל${business}. הם יחזרו אליך בהקדם.` });
      setText('');
    } else setState({ ok: false, text: ERRORS[r.error] ?? ERRORS.server });
  });

  if (state?.ok) return <p className={styles.doneP} role="status">{state.text}</p>;
  const options: Array<[typeof kind, string]> = proposed
    ? [['confirm', `מאשר/ת את המועד: ${proposed}`], ['other_time', 'מבקש/ת מועד אחר'], ['message', 'הודעה אחרת']]
    : [['message', 'הודעה לעסק']];

  return (
    <form className={styles.fields} onSubmit={e => { e.preventDefault(); submit(); }} noValidate>
      {options.length > 1 ? (
        <fieldset className={styles.fields} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className={styles.pickLabel}>התשובה שלך</legend>
          {options.map(([k, label]) => (
            <label key={k} className={styles.checkLabel} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <label className={styles.field}>
        <span className={styles.pickLabel}>{kind === 'confirm' ? 'הערה לעסק (לא חובה)' : kind === 'other_time' ? 'אילו ימים ושעות נוחים לך?' : 'ההודעה'}</span>
        <textarea className={styles.input} rows={4} maxLength={1000} value={text} onChange={e => setText(e.target.value)} />
      </label>
      {state && !state.ok ? <p className={styles.alert} role="alert">{state.text}</p> : null}
      <div className={styles.actions}>
        <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={pending}>{pending ? 'שולח…' : 'שליחה לעסק'}</button>
      </div>
    </form>
  );
}
