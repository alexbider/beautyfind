'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { bookingOp, cancelOp, finishOp, type BookingOp } from '@/app/clinic/booking/[id]/actions';
import { ActionBar } from '../shell/ActionBar';
import { BottomSheet } from '../shell/BottomSheet';
import { haptic } from '../shell/haptics';
import { useShell } from './mobile';
import styles from './ClinicBooking.module.css';

// Interactive parts of the Clinic Booking card. The server decides what is allowed and
// re-checks it on every action; these components only render and submit.
// Phones (spec §6 Clinic Booking): the current primary action sits in the sticky action bar, the
// clinical finish form opens in a full-screen sheet, and "לא הגיעה" / cancel ask in a sheet first.

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

/** Short labels for the phone action bar. */
const BAR_CTA: Record<string, string> = {
  checkin: 'צ׳ק־אין · המטופלת הגיעה',
  finish: 'סיום טיפול',
};

export function ActionPanel({ bookingId, act, clientFirst, children }: { bookingId: string; act: ActView; clientFirst: string; children?: React.ReactNode }) {
  const ids = useId();
  const shell = useShell();
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');
  const [batch, setBatch] = useState('');
  const [units, setUnits] = useState('');
  const [notes, setNotes] = useState('');
  const [sheet, setSheet] = useState<'finish' | 'noshow' | null>(null);
  const { flash, node } = useToast();

  const go = () => start(async () => {
    setErr('');
    if (act.kind === 'finish') {
      const r = await finishOp(bookingId, { productBatch: batch, units, notes });
      if (r.ok) {
        haptic('success');
        setSheet(null);
        flash('הנחיות אחרי הטיפול נשלחו בוואטסאפ');
      } else {
        haptic('warning');
        setErr(r.error);
      }
      return;
    }
    haptic('light');
    const r = await bookingOp(bookingId, act.kind === 'checkin' ? 'check_in' : 'start');
    if (r.ok) flash(DONE_MSG[act.kind] ?? 'עודכן');
    else {
      haptic('warning');
      setErr(r.error);
    }
  });

  const runOp = (op: BookingOp, done: string) => start(async () => {
    setErr('');
    const r = await bookingOp(bookingId, op);
    setSheet(null);
    if (r.ok) flash(done);
    else {
      haptic('warning');
      setErr(r.error);
    }
  });

  const hasBtn = !!act.cta;
  const finishFields = (
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
  );

  // What the phone action bar offers for this state.
  const bar = hasBtn || act.canUndo;

  return (
    <section aria-labelledby={`${ids}-act`} className={styles.card}>
      <h2 id={`${ids}-act`} className={styles.h2} style={{ marginBottom: 4 }}>{act.title}</h2>
      <p className={styles.actBody}>{act.body}</p>

      {act.kind === 'finish' && !act.blocked && <div className="bf-desk-only">{finishFields}</div>}

      {hasBtn && (
        <div className={`${styles.row} bf-desk-only`}>
          <button type="button" className={styles.primary} onClick={go} disabled={act.blocked || pending} aria-busy={pending || undefined}>{act.cta}</button>
          {act.showNoShow && (
            <OpButton bookingId={bookingId} op="no_show" label="לא הגיעה" done="סומן: לא הגיעה" variant="danger" disabled={!!act.noShowHint} />
          )}
        </div>
      )}
      {act.showNoShow && act.noShowHint && <p className={styles.hint}>{act.noShowHint}</p>}
      {act.blocked && act.blockMsg && <p role="alert" className={`${styles.blockMsg} bf-desk-only`}>{act.blockMsg}</p>}
      {err && !sheet && <p role="alert" className={styles.inlineErr}>{err}</p>}

      {act.canUndo && (
        <div className={`${styles.row} bf-desk-only`}>
          <OpButton bookingId={bookingId} op="undo_no_show" label="ביטול הסימון" done="הסימון בוטל. התור חזר למצב מאושר" variant="secondary" />
        </div>
      )}

      {children}

      {act.canCancel && <CancelBox bookingId={bookingId} sheet={shell} />}

      {bar && (
        <ActionBar mobileOnly hint={act.blocked ? act.blockMsg : undefined} className={styles.bar}>
          {act.canUndo && (
            <button type="button" className={styles.primary} disabled={pending} onClick={() => runOp('undo_no_show', 'הסימון בוטל. התור חזר למצב מאושר')}>
              ביטול הסימון ״לא הגיעה״
            </button>
          )}
          {hasBtn && act.showNoShow && (
            <button type="button" className={styles.danger} disabled={pending || !!act.noShowHint} onClick={() => setSheet('noshow')}>
              לא הגיעה
            </button>
          )}
          {hasBtn && (
            <button
              type="button"
              className={styles.primary}
              disabled={act.blocked || pending}
              aria-busy={pending || undefined}
              onClick={() => (act.kind === 'finish' ? setSheet('finish') : go())}
            >
              {BAR_CTA[act.kind] ?? act.cta}
            </button>
          )}
        </ActionBar>
      )}

      {act.kind === 'finish' && !act.blocked && (
        <BottomSheet
          open={sheet === 'finish'}
          onClose={() => setSheet(null)}
          title="סיום טיפול ורישום קליני"
          size="full"
          footer={
            <>
              {err && <p role="alert" className={styles.sheetErr}>{err}</p>}
              <button type="button" className={`${styles.primary} ${styles.block}`} onClick={go} disabled={pending} aria-busy={pending || undefined}>
                {act.cta}
              </button>
            </>
          }
        >
          <p className={styles.actBody}>{act.body}</p>
          {finishFields}
        </BottomSheet>
      )}

      {act.showNoShow && (
        <BottomSheet
          open={sheet === 'noshow'}
          onClose={() => setSheet(null)}
          title={`לסמן ש${clientFirst} לא הגיעה?`}
          footer={
            <div className={styles.sheetBtns}>
              <button type="button" className={styles.secondary} onClick={() => setSheet(null)}>חזרה</button>
              <button type="button" className={styles.dangerSolid} disabled={pending} onClick={() => runOp('no_show', 'סומן: לא הגיעה')}>
                סימון ״לא הגיעה״
              </button>
            </div>
          }
        >
          <p className={styles.actBody} style={{ margin: 0 }}>
            התור ייסגר, ומקדמה ששולמה תישמר לפי מדיניות הביטול. אפשר לבטל את הסימון בתוך 24 שעות.
          </p>
        </BottomSheet>
      )}
      {node}
    </section>
  );
}

function CancelBox({ bookingId, sheet }: { bookingId: string; sheet: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const ids = useId();
  const submit = () => start(async () => {
    setErr('');
    const r = await cancelOp(bookingId, reason);
    if (!r.ok) {
      haptic('warning');
      setErr(r.error);
    } else setOpen(false);
  });
  const fields = (
    <>
      <p className={styles.hint} style={{ margin: 0 }}>המקדמה, אם שולמה, תוחזר במלואה, והמטופלת תקבל הודעה עם הסיבה.</p>
      <label className={styles.field}>
        <span>סיבת הביטול</span>
        <textarea value={reason} maxLength={300} rows={2} onChange={e => setReason(e.target.value)} placeholder="למשל: הרופאה חולה, נציע מועד חלופי" className={styles.textarea} />
      </label>
      {err && <p role="alert" className={styles.inlineErr}>{err}</p>}
    </>
  );
  return (
    <div className={styles.cancel}>
      <button type="button" className={styles.linkBtn} aria-expanded={open} aria-controls={sheet ? undefined : `${ids}-c`} onClick={() => setOpen(o => !o)}>
        ביטול התור על ידי הקליניקה
      </button>
      {sheet ? (
        <BottomSheet
          open={open}
          onClose={() => setOpen(false)}
          title="ביטול התור על ידי הקליניקה"
          footer={
            <div className={styles.sheetBtns}>
              <button type="button" className={styles.secondary} onClick={() => setOpen(false)}>חזרה</button>
              <button type="button" className={styles.dangerSolid} onClick={submit} disabled={pending}>ביטול התור</button>
            </div>
          }
        >
          <div className={styles.cancelBody}>{fields}</div>
        </BottomSheet>
      ) : (
        open && (
          <div id={`${ids}-c`} className={styles.cancelBody}>
            {fields}
            <div className={styles.row}>
              <button type="button" className={styles.danger} onClick={submit} disabled={pending}>ביטול התור</button>
              <button type="button" className={styles.secondary} onClick={() => setOpen(false)}>חזרה</button>
            </div>
          </div>
        )
      )}
    </div>
  );
}
