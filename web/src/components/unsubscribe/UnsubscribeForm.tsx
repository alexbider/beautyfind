'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { FixedActionBar } from '@/components/review/FixedLayer';
import { haptic } from '@/components/shell/haptics';
import { Switch } from '../account/ui';
import { undoUnsubscribeAction, unsubscribeAction } from './actions';
import type { Channel } from './token';
import styles from './unsubscribe.module.css';

// Design: project/BeautyFind Unsubscribe.dc.html (from: wa | email | sms, source). Feminine singular as designed.

const NAME: Record<Channel, string> = { wa: 'וואטסאפ', sms: 'SMS', email: 'מייל' };
const IN: Record<Channel, string> = { wa: 'בוואטסאפ', sms: 'ב־SMS', email: 'במייל' };

/** "בוואטסאפ, ב־SMS ובמייל" */
function joinIn(chs: Channel[]) {
  const w = chs.map(c => IN[c]);
  return w.length < 2 ? (w[0] ?? '') : `${w.slice(0, -1).join(', ')} ו${w[w.length - 1]}`;
}

const NONE_OFF = 'כל הערוצים עדיין פעילים. כבי לפחות אחד, או חזרי מאוחר יותר.';

/** "מקליניקת נועה" / "מ־BeautyFind" */
const from = (name: string) => (/^[A-Za-z0-9]/.test(name) ? `מ־${name}` : `מ${name}`);

export function UnsubscribeForm({
  token, source, masked, channel, channels, allOnly,
}: { token: string; source: string; masked: string; channel: Channel; channels: Channel[]; allOnly: boolean }) {
  const [scope, setScope] = useState<'clinic' | 'all'>(allOnly ? 'all' : 'clinic');
  const [off, setOff] = useState<Record<Channel, boolean>>({ wa: channel === 'wa', sms: channel === 'sms', email: channel === 'email' });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ body: string; undo: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  const offList = channels.filter(c => off[c]);
  const anyOff = offList.length > 0;

  const save = async () => {
    setTried(true);
    if (!anyOff) {
      haptic('warning');
      return;
    }
    setBusy(true);
    setFailed(null);
    const r = await unsubscribeAction(token, scope, offList).catch(() => null);
    setBusy(false);
    if (!r?.ok) {
      haptic('warning');
      setFailed(r?.error === 'invalid_link' ? 'הקישור כבר לא תקף. אפשר לשלוח ״הסר״ בתשובה להודעה.' : 'לא הצלחנו לשמור. נסי שוב בעוד רגע.');
      return;
    }
    const who = scope === 'all' ? 'מכל העסקים ומ־BeautyFind' : from(source);
    haptic('success');
    setDone({ body: `הפסקנו את הדיוור ${who} ${joinIn(offList)}. הודעות על תורים ימשיכו להגיע כרגיל.`, undo: r.undo });
    requestAnimationFrame(() => doneRef.current?.focus());
  };

  const undo = async () => {
    if (!done) return;
    setBusy(true);
    const r = await undoUnsubscribeAction(done.undo).catch(() => null);
    setBusy(false);
    if (r?.ok) {
      setDone(null);
      setTried(false);
    } else setFailed('לא הצלחנו להחזיר. אפשר לעדכן העדפות בחשבון.');
  };

  if (done) {
    return (
      <div className={styles.done}>
        <span className={styles.check} aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 7.5 5.5 10.5 11.5 4" /></svg>
        </span>
        <h1 ref={doneRef} tabIndex={-1} className={styles.doneTitle}>ההעדפות נשמרו</h1>
        <p className={styles.doneBody} role="status">{done.body}</p>
        {failed && <p className={styles.err} role="alert">{failed}</p>}
        <div className={styles.doneActions}>
          <button type="button" className={styles.btnGhost} onClick={undo} disabled={busy}>טעות, להחזיר</button>
          <Link href="/account?tab=settings" className={styles.btnPrimarySm}>כל ההעדפות בחשבון</Link>
        </div>
      </div>
    );
  }

  const scopes: Array<['clinic' | 'all', string, string]> = allOnly
    ? [['all', 'מכל הקליניקות ומ־BeautyFind', 'לא תקבלי דיוור מאף עסק דרכנו']]
    : [
        ['clinic', `רק ${from(source)}`, 'הודעות שיווק מקליניקות אחרות וממגזין BeautyFind ימשיכו'],
        ['all', 'מכל הקליניקות ומ־BeautyFind', 'לא תקבלי דיוור מאף עסק דרכנו'],
      ];

  return (
    <div className={styles.form}>
      <div>
        <h1 className={styles.h1}>הסרה מדיוור</h1>
        <p className={styles.lead}>
          הגעת מהודעה של <strong>{source}</strong> אל <span className={`ltr ${styles.masked}`}>{masked}</span>. בחרי מה להפסיק לקבל.
        </p>
      </div>

      <fieldset className={styles.card}>
        <legend className={styles.cardTitle}>ממי</legend>
        <div className={styles.radios}>
          {scopes.map(([k, name, note]) => (
            <label key={k} className={styles.radio} data-on={scope === k || undefined}>
              <input type="radio" name="scope" value={k} checked={scope === k} onChange={() => setScope(k)} className="sr-only" />
              <span className={styles.radioDot} aria-hidden="true"><span /></span>
              <span className={styles.radioText}>
                <span className={styles.radioName}>{name}</span>
                <span className={styles.radioNote}>{note}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <section className={styles.card} aria-labelledby="us-ch">
        <h2 id="us-ch" className={styles.cardTitle}>באילו ערוצים</h2>
        <p className={styles.cardSub}>מבצעים, עדכונים וניוזלטר.</p>
        <ul className={styles.channels}>
          {channels.map(c => (
            <li key={c} className={styles.channel}>
              <span className={styles.chText}>
                <span className={styles.chName}>{NAME[c]}</span>
                <span className={styles.chState}>{off[c] ? 'יופסק' : 'ימשיך'}</span>
              </span>
              <Switch on={!off[c]} label={`${NAME[c]}, דיוור`} onChange={on => setOff(o => ({ ...o, [c]: !on }))} />
            </li>
          ))}
        </ul>
      </section>

      <div className={styles.service}>
        <strong>ימשיכו להגיע:</strong> אישורי תור, תזכורות, הנחיות אחרי טיפול, קבלות וחשבוניות. אלה הודעות שירות ולא דיוור.
      </div>

      {/* Desktop: in the column. Phones: the same button in the sticky action bar, within thumb reach. */}
      <div className={`${styles.deskSubmit} bf-desk-only`}>
        {tried && !anyOff && <p className={styles.err} role="alert">{NONE_OFF}</p>}
        {failed && <p className={styles.err} role="alert">{failed}</p>}
        <button type="button" className={styles.btnPrimary} onClick={save} disabled={busy} aria-busy={busy || undefined}>
          שמירת ההעדפות
        </button>
      </div>
      <FixedActionBar mobileOnly error={(tried && !anyOff ? NONE_OFF : failed) || undefined}>
        <button type="button" className={styles.btnPrimary} onClick={save} disabled={busy} aria-busy={busy || undefined}>
          שמירת ההעדפות
        </button>
      </FixedActionBar>
      <p className={styles.fine}>
        ההסרה נכנסת לתוקף מיד, ובכל מקרה תוך <span className="ltr">3</span> ימי עסקים. אפשר גם לשלוח ״הסר״ בתשובה לכל הודעה. <Link href="/privacy">מדיניות הפרטיות</Link>
      </p>
    </div>
  );
}
