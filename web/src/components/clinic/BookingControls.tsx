'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { bookingOp, cancelOp, finishOp, type BookingOp } from '@/app/clinic/booking/[id]/actions';
import styles from './ClinicBooking.module.css';

// Interactive parts of the Clinic Booking card. The server decides what is allowed and
// re-checks it on every action; these components only render and submit.

function useToast() {
  const [text, setText] = useState('');
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(t.current), []);
  const flash = (s: string) => {
    clearTimeout(t.current);
    setText(s);
    t.current = setTimeout(() => setText(''), 3200);
  };
  const node = text ? <div role="status" className={styles.toast}>{text}</div> : null;
  return { flash, node };
}

/** One button that runs one booking operation, with an inline error and a success toast. */
export function OpButton({ bookingId, op, label, done, variant = 'primary', disabled }: {
  bookingId: string; op: BookingOp; label: string; done: string; variant?: 'primary' | 'secondary' | 'danger' | 'small'; disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');
  const { flash, node } = useToast();
  const run = () => start(async () => {
    setErr('');
    const r = await bookingOp(bookingId, op);
    if (r.ok) flash(done);
    else setErr(r.error);
  });
  return (
    <>
      <button type="button" className={styles[variant]} onClick={run} disabled={pending || disabled} aria-busy={pending || undefined}>{label}</button>
      {err && <p role="alert" className={styles.inlineErr}>{err}</p>}
      {node}
    </>
  );
}

export interface ActView {
  kind: 'checkin' | 'start' | 'finish' | 'done' | 'noshow' | 'cancelled' | 'waiting';
  title: string;
  body: string;
  cta?: string;
  blocked?: boolean;
  blockMsg?: string;
  showNoShow?: boolean;
  noShowHint?: string;
  canUndo?: boolean;
  medical?: boolean;
  canCancel?: boolean;
}

const DONE_MSG: Record<string, string> = {
  checkin: 'צ׳ק־אין נרשם',
  start: 'הטיפול התחיל',
};

export function ActionPanel({ bookingId, act, children }: { bookingId: string; act: ActView; children?: React.ReactNode }) {
  const ids = useId();
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');
  const [batch, setBatch] = useState('');
  const [units, setUnits] = useState('');
  const [notes, setNotes] = useState('');
  const { flash, node } = useToast();

  const go = () => start(async () => {
    setErr('');
    if (act.kind === 'finish') {
      const r = await finishOp(bookingId, { productBatch: batch, units, notes });
      if (r.ok) flash('הנחיות אחרי הטיפול נשלחו בוואטסאפ');
      else setErr(r.error);
      return;
    }
    const r = await bookingOp(bookingId, act.kind === 'checkin' ? 'check_in' : 'start');
    if (r.ok) flash(DONE_MSG[act.kind] ?? 'עודכן');
    else setErr(r.error);
  });

  const hasBtn = !!act.cta;
  return (
    <section aria-labelledby={`${ids}-act`} className={styles.card}>
      <h2 id={`${ids}-act`} className={styles.h2} style={{ marginBottom: 4 }}>{act.title}</h2>
      <p className={styles.actBody}>{act.body}</p>

      {act.kind === 'finish' && !act.blocked && (
        <div className={styles.notes}>
          <label className={styles.field}>
            <span>חומר ואצווה{act.medical ? '' : <span className={styles.optional}> (לא חובה)</span>}</span>
            <input value={batch} maxLength={200} onChange={e => setBatch(e.target.value)} placeholder={act.medical ? 'שם החומר · אצווה · תוקף' : 'מוצרים שנעשה בהם שימוש'} className={styles.input} />
          </label>
          {act.medical && (
            <label className={styles.field}>
              <span>יחידות שהוזרקו</span>
              <input dir="ltr" inputMode="numeric" value={units} onChange={e => setUnits(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="20" className={`${styles.input} ${styles.units} tnum`} />
            </label>
          )}
          <label className={styles.field}>
            <span>רישום קליני</span>
            <textarea value={notes} maxLength={2000} onChange={e => setNotes(e.target.value)} rows={3} placeholder={act.medical ? 'מצח 10 יח׳, גלבלה 10 יח׳. ללא תופעות מיידיות.' : 'מה בוצע, תגובת העור, המלצות להמשך'} className={styles.textarea} />
          </label>
        </div>
      )}

      {hasBtn && (
        <div className={styles.row}>
          <button type="button" className={styles.primary} onClick={go} disabled={act.blocked || pending} aria-busy={pending || undefined}>{act.cta}</button>
          {act.showNoShow && (
            <OpButton bookingId={bookingId} op="no_show" label="לא הגיעה" done="סומן: לא הגיעה" variant="danger" disabled={!!act.noShowHint} />
          )}
        </div>
      )}
      {act.showNoShow && act.noShowHint && <p className={styles.hint}>{act.noShowHint}</p>}
      {act.blocked && act.blockMsg && <p role="alert" className={styles.blockMsg}>{act.blockMsg}</p>}
      {err && <p role="alert" className={styles.inlineErr}>{err}</p>}

      {act.canUndo && (
        <div className={styles.row}>
          <OpButton bookingId={bookingId} op="undo_no_show" label="ביטול הסימון" done="הסימון בוטל. התור חזר למצב מאושר" variant="secondary" />
        </div>
      )}

      {children}

      {act.canCancel && <CancelBox bookingId={bookingId} />}
      {node}
    </section>
  );
}

function CancelBox({ bookingId }: { bookingId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const ids = useId();
  const submit = () => start(async () => {
    setErr('');
    const r = await cancelOp(bookingId, reason);
    if (!r.ok) setErr(r.error);
  });
  return (
    <div className={styles.cancel}>
      <button type="button" className={styles.linkBtn} aria-expanded={open} aria-controls={`${ids}-c`} onClick={() => setOpen(o => !o)}>
        ביטול התור על ידי הקליניקה
      </button>
      {open && (
        <div id={`${ids}-c`} className={styles.cancelBody}>
          <p className={styles.hint} style={{ margin: 0 }}>המקדמה, אם שולמה, תוחזר במלואה, והמטופלת תקבל הודעה עם הסיבה.</p>
          <label className={styles.field}>
            <span>סיבת הביטול</span>
            <textarea value={reason} maxLength={300} rows={2} onChange={e => setReason(e.target.value)} placeholder="למשל: הרופאה חולה, נציע מועד חלופי" className={styles.textarea} />
          </label>
          {err && <p role="alert" className={styles.inlineErr}>{err}</p>}
          <div className={styles.row}>
            <button type="button" className={styles.danger} onClick={submit} disabled={pending}>ביטול התור</button>
            <button type="button" className={styles.secondary} onClick={() => setOpen(false)}>חזרה</button>
          </div>
        </div>
      )}
    </div>
  );
}
