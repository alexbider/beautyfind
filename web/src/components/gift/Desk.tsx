'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { deskCancel, deskFind, deskRedeem } from '@/app/clinic/gift-cards/actions';
import type { DeskCard } from './server';
import { STATUS, money } from './shared';
import s from './gift.module.css';

/** Design: Gift Cards → view "clinic" (desk row). Redeem and cancel only with `manage`. */
export function Desk({ canManage, invoicing }: { canManage: boolean; invoicing: boolean }) {
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState('');
  const [bookingRef, setBookingRef] = useState('');
  const [card, setCard] = useState<DeskCard | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [toast, setToast] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = (t: string) => {
    clearTimeout(timer.current);
    setToast(t);
    timer.current = setTimeout(() => setToast(''), 4200);
  };

  const find = () => {
    setErr('');
    setNote('');
    setConfirmCancel(false);
    if (!code.trim()) return setErr('הקלידי קוד שובר.');
    start(async () => {
      const r = await deskFind(code);
      if (r.ok) setCard(r.card);
      else {
        setCard(null);
        setErr(r.error);
      }
    });
  };

  const doRedeem = () => {
    setErr('');
    setNote('');
    setConfirmCancel(false);
    if (!code.trim()) return setErr('הקלידי קוד שובר.');
    if (!amount.trim()) return setErr('הכניסי סכום למימוש.');
    start(async () => {
      const r = await deskRedeem({ code, amount, bookingRef: bookingRef.trim() || undefined });
      if (r.ok) {
        setCard(r.card);
        setAmount('');
        setBookingRef('');
        setNote(r.invoiceNote ?? '');
        flash(r.message);
      } else setErr(r.error);
    });
  };

  const doCancel = () => {
    if (!card) return;
    setErr('');
    start(async () => {
      const r = await deskCancel(card.id);
      setConfirmCancel(false);
      if (r.ok) {
        setCard(r.card);
        flash(r.message);
      } else setErr(r.error);
    });
  };

  const st = card ? STATUS[card.status] : null;

  return (
    <section aria-label="מימוש בקבלה" className={s.desk}>
      <form className={s.deskRow} onSubmit={e => { e.preventDefault(); if (canManage && amount.trim()) doRedeem(); else find(); }}>
        <span className={s.deskTitle}>מימוש בקבלה</span>
        <input
          dir="ltr" value={code} onChange={e => { setCode(e.target.value.toUpperCase()); setCard(null); setErr(''); }} aria-label="קוד שובר" placeholder="NOA-XXXX-XXXX"
          autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={20} className={s.deskCode}
        />
        <button type="button" onClick={find} disabled={busy} className={s.deskBtnGhost}>בדיקה</button>
        {canManage ? (
          <>
            <span className={`${s.inputWrap} ${s.deskAmt}`}>
              <input
                dir="ltr" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, '').slice(0, 9))} aria-label="סכום למימוש בשקלים"
                placeholder="סכום" className={s.input} style={{ minHeight: 44 }}
              />
              <span aria-hidden="true" className={s.shekel}>₪</span>
            </span>
            <input dir="ltr" value={bookingRef} onChange={e => setBookingRef(e.target.value.toUpperCase())} aria-label="מספר תור (לא חובה)" placeholder="תור BF-0000" autoComplete="off" maxLength={20} className={s.deskRef} />
            <button type="submit" disabled={busy} className={s.deskBtn}>{invoicing ? 'מימוש והפקת חשבונית' : 'מימוש'}</button>
          </>
        ) : null}
      </form>
      {!canManage ? <p className={s.small}>בהרשאה שלך אפשר לבדוק שוברים. מימוש וביטול אפשריים בהרשאת ניהול.</p> : null}
      {err ? <p role="alert" className={s.errorInline}>{err}</p> : null}
      {note ? <p className={`${s.note} ${s.noteWarn}`}>{note}</p> : null}

      {card && st ? (
        <div className={`${s.deskCard} ${s.pop}`} aria-live="polite">
          <dl className={s.deskGrid}>
            <div><dt>קוד</dt><dd><span className={s.code}>{card.code}</span></dd></div>
            <div><dt>יתרה</dt><dd><span className="ltr">{money(card.balanceAgorot)}</span> <span className={s.tdSub} style={{ display: 'inline' }}>מתוך <span className="ltr">{money(card.valueAgorot)}</span></span></dd></div>
            <div><dt>מצב</dt><dd><span className={s.pill} style={{ background: st.bg, color: st.color }}>{st.name}</span></dd></div>
            <div><dt>בתוקף עד</dt><dd><span className="ltr">{card.expires}</span></dd></div>
            <div><dt>מקבל/ת</dt><dd>{card.recipient}</dd></div>
            <div><dt>נקנה על ידי</dt><dd>{card.buyer} · <span className="ltr">{card.purchased}</span></dd></div>
            <div><dt>סוג</dt><dd>{card.treatment ?? 'לפי סכום'}</dd></div>
          </dl>
          {card.medical ? (
            <p className={`${s.note} ${s.noteWarn}`}>שובר לטיפול רפואי: המימוש רק אחרי ייעוץ שבו הרופא/ה אישר/ה את הטיפול. יש לקשר את מספר התור שנקבע מהייעוץ.</p>
          ) : null}
          {card.redemptions.length ? (
            <ul className={s.redList} aria-label="מימושים קודמים">
              {card.redemptions.map((r, i) => (
                <li key={i}>
                  <span className="ltr">{r.date}</span> · <span className="ltr">{money(r.amountAgorot)}</span>
                  {r.doc ? <> · חשבונית <span className="ltr">{r.doc}</span></> : ' · ללא חשבונית אוטומטית'}
                </li>
              ))}
            </ul>
          ) : null}
          {canManage && card.cancellable ? (
            confirmCancel ? (
              <div className={`${s.note} ${s.noteBad}`} role="alertdialog" aria-label="אישור ביטול">
                <p style={{ margin: '0 0 9px' }}>לבטל את השובר ולהחזיר <span className="ltr">{money(card.valueAgorot)}</span> לכרטיס של הקונה? אי אפשר לבטל את הביטול.</p>
                <div className={s.actions}>
                  <button type="button" onClick={doCancel} disabled={busy} className={s.btnDanger}>ביטול והחזר</button>
                  <button type="button" onClick={() => setConfirmCancel(false)} className={s.btnGhost}>השאר פעיל</button>
                </div>
              </div>
            ) : (
              <div className={s.actions}>
                <button type="button" onClick={() => setConfirmCancel(true)} className={s.btnDanger}>ביטול השובר והחזר כספי</button>
                <span className={s.small} style={{ alignSelf: 'center' }}>אפשרי תוך 14 ימים מהקנייה, כל עוד השובר לא מומש.</span>
              </div>
            )
          ) : null}
        </div>
      ) : null}

      {toast ? <div role="status" className={s.toast}>{toast}</div> : null}
    </section>
  );
}
