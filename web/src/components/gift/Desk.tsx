'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { deskCancel, deskFind, deskRedeem } from '@/app/clinic/gift-cards/actions';
import { useDetailParam } from '../clinic/mobile';
import { ActionBar } from '../shell/ActionBar';
import { BottomSheet } from '../shell/BottomSheet';
import { haptic } from '../shell/haptics';
import { PullToRefresh } from '../shell/PullToRefresh';
import { TopBar } from '../shell/TopBar';
import type { DeskCard, LedgerRow } from './server';
import { STATUS, money } from './shared';
import s from './gift.module.css';
import d from './Desk.module.css';

// Phones (spec §6 Gift card desk): the ledger is a list of cards, a card (or a code typed at the
// desk) opens its own screen with the code in the URL (?c=…, so back returns to the list), and
// redeem / cancel sit in the sticky action bar, cancel behind a confirmation sheet.
// Desktop keeps the reception desk row and the ledger table.

function useFlash(ms = 4200) {
  const [toast, setToast] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = (t: string) => {
    clearTimeout(timer.current);
    setToast(t);
    timer.current = setTimeout(() => setToast(''), ms);
  };
  return [toast, flash] as const;
}

function Toast({ text }: { text: string }) {
  return (
    <div role="status" aria-live="polite">
      {text ? <div className={d.toast}>{text}</div> : null}
    </div>
  );
}

/** Design: Gift Cards → view "clinic" (desk row). Redeem and cancel only with `manage`. */
export function Desk({ canManage, invoicing }: { canManage: boolean; invoicing: boolean }) {
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState('');
  const [bookingRef, setBookingRef] = useState('');
  const [card, setCard] = useState<DeskCard | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [toast, flash] = useFlash();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, start] = useTransition();

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
    <section aria-label="מימוש בקבלה" className={`${s.desk} bf-desk-only`}>
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
          <CardFacts card={card} />
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

      <Toast text={toast} />
    </section>
  );
}

/** Card facts, medical note and past redemptions: shared by the desk row and the phone screen. */
function CardFacts({ card }: { card: DeskCard }) {
  const st = STATUS[card.status];
  return (
    <>
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
    </>
  );
}

// ---------- Phones ----------

/** Cards looked up at the desk this session, so the detail screen opens without a second fetch. */
const seen = new Map<string, DeskCard>();

/**
 * The gift cards screen on phones: top bar, list (the server-rendered page content, with pull to
 * refresh) or one card's screen. On desktop only the list content shows.
 */
export function GiftScreen({ canManage, invoicing, children }: { canManage: boolean; invoicing: boolean; children: React.ReactNode }) {
  const detail = useDetailParam('c');
  const view = detail.id ? 'detail' : 'list';
  return (
    <div className={d.screen} data-view={view}>
      {view === 'detail' ? <TopBar mode="pushed" title="שובר מתנה" onBack={detail.close} /> : <TopBar mode="root" largeTitle="שוברי מתנה" />}
      <div className={d.listPane}>
        <PullToRefresh>{children}</PullToRefresh>
      </div>
      {view === 'detail' && detail.id && <CardScreen key={detail.id} code={detail.id} canManage={canManage} invoicing={invoicing} onGone={detail.close} />}
    </div>
  );
}

/** Code field at the top of the phone list: checks the code, then opens the card's screen. */
export function PhoneLookup() {
  const detail = useDetailParam('c');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, start] = useTransition();
  const find = () => {
    setErr('');
    if (!code.trim()) {
      haptic('warning');
      return setErr('הקלידי קוד שובר.');
    }
    start(async () => {
      const r = await deskFind(code);
      if (r.ok) {
        seen.set(r.card.code, r.card);
        setCode('');
        detail.open(r.card.code);
      } else {
        haptic('warning');
        setErr(r.error);
      }
    });
  };
  return (
    <form className={`${d.lookup} bf-shell-only`} onSubmit={e => { e.preventDefault(); find(); }} aria-label="מימוש בקבלה">
      <label className={d.lookupLabel} htmlFor="gift-code">מימוש בקבלה</label>
      <div className={d.lookupRow}>
        <input
          id="gift-code" dir="ltr" value={code} onChange={e => { setCode(e.target.value.toUpperCase()); setErr(''); }} placeholder="NOA-XXXX-XXXX"
          autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={20} enterKeyHint="search" className={d.lookupInput}
          aria-invalid={!!err || undefined}
        />
        <button type="submit" disabled={busy} className={d.lookupBtn}>בדיקה</button>
      </div>
      {err ? <p role="alert" className={s.errorInline}>{err}</p> : null}
    </form>
  );
}

/** The ledger as stacked cards (one row = one card, balance first). */
export function PhoneLedger({ rows, empty }: { rows: LedgerRow[]; empty: string }) {
  const detail = useDetailParam('c');
  if (!rows.length) return <p className={`${d.ledgerEmpty} bf-shell-only`}>{empty}</p>;
  return (
    <ul className={`${d.ledger} bf-shell-only`} aria-label="יומן שוברים">
      {rows.map(r => {
        const st = STATUS[r.status];
        return (
          <li key={r.id}>
            <button type="button" className={d.row} onClick={() => detail.open(r.code)}>
              <span className={d.rowTop}>
                <span className={d.balance}>
                  <span className="ltr">{money(r.balanceAgorot)}</span>
                  <span className={d.of}> מתוך <span className="ltr">{money(r.valueAgorot)}</span></span>
                </span>
                <span className={s.pill} style={{ background: st.bg, color: st.color }}>{r.statusNote ?? st.name}</span>
              </span>
              <span className={d.rowName}>{r.recipient}</span>
              <span className={d.rowSub}>
                <span className={s.code}>{r.code}</span> · מאת {r.buyer} · בתוקף עד <span className="ltr">{r.expires}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** One card on phones: facts, the redeem fields, and redeem / cancel in the action bar. */
function CardScreen({ code, canManage, invoicing, onGone }: { code: string; canManage: boolean; invoicing: boolean; onGone: () => void }) {
  const [card, setCard] = useState<DeskCard | null>(seen.get(code) ?? null);
  const [missing, setMissing] = useState('');
  const [amount, setAmount] = useState('');
  const [bookingRef, setBookingRef] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [toast, flash] = useFlash();
  const [busy, start] = useTransition();

  useEffect(() => {
    if (seen.has(code)) return;
    let live = true;
    deskFind(code)
      .then(r => {
        if (!live) return;
        if (r.ok) setCard(r.card);
        else setMissing(r.error);
      })
      .catch(() => live && setMissing('לא הצלחנו לטעון את השובר. בדקו את החיבור ונסו שוב.'));
    return () => {
      live = false;
    };
  }, [code]);

  // Mirrors what the server accepts (open, not expired, balance left); the server re-checks it.
  const redeemable = !!card && canManage && card.balanceAgorot > 0 && ['active', 'partially_redeemed', 'scheduled'].includes(card.status);

  const doRedeem = () => {
    if (!card) return;
    setErr('');
    setNote('');
    if (!amount.trim()) {
      haptic('warning');
      return setErr('הכניסי סכום למימוש.');
    }
    start(async () => {
      const r = await deskRedeem({ code: card.code, amount, bookingRef: bookingRef.trim() || undefined });
      if (r.ok) {
        haptic('success');
        setCard(r.card);
        seen.set(r.card.code, r.card);
        setAmount('');
        setBookingRef('');
        setNote(r.invoiceNote ?? '');
        flash(r.message);
      } else {
        haptic('warning');
        setErr(r.error);
      }
    });
  };

  const doCancel = () => {
    if (!card) return;
    setErr('');
    start(async () => {
      const r = await deskCancel(card.id);
      setConfirm(false);
      if (r.ok) {
        haptic('success');
        setCard(r.card);
        seen.set(r.card.code, r.card);
        flash(r.message);
      } else {
        haptic('warning');
        setErr(r.error);
      }
    });
  };

  if (!card) {
    return (
      <section className={`${d.detail} bf-shell-only`} aria-busy={!missing || undefined}>
        {missing ? (
          <div className={d.detailBody}>
            <p role="alert" className={s.errorInline}>{missing}</p>
            <button type="button" className={s.btnGhost} onClick={onGone}>לרשימת השוברים</button>
          </div>
        ) : (
          <div className={d.detailBody}>
            <span className={d.skel} style={{ width: '60%' }} />
            <span className={d.skel} style={{ width: '40%' }} />
            <span className={d.skel} style={{ width: '80%', height: 90 }} />
          </div>
        )}
      </section>
    );
  }

  return (
    <section className={`${d.detail} bf-shell-only`} aria-labelledby="gift-card-h">
      <div className={d.detailHead}>
        <span className={d.detailLabel}>יתרה בשובר</span>
        <h2 id="gift-card-h" className={d.detailValue}>
          <span className="ltr">{money(card.balanceAgorot)}</span>
        </h2>
        <span className={d.detailSub}>מתוך <span className="ltr">{money(card.valueAgorot)}</span> · {card.recipient}</span>
      </div>
      <div className={d.detailBody}>
        <CardFacts card={card} />
        {redeemable && (
          <div className={d.fields}>
            <label className={d.field}>
              <span>סכום למימוש</span>
              <span className={`${s.inputWrap} ${d.amountWrap}`}>
                <input
                  dir="ltr" inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value.replace(/[^\d.]/g, '').slice(0, 9)); setErr(''); }}
                  placeholder="0" className={`${s.input} ${d.input}`} aria-invalid={(!!err && !amount) || undefined}
                />
                <span aria-hidden="true" className={s.shekel}>₪</span>
              </span>
            </label>
            <label className={d.field}>
              <span>מספר תור <span className={d.optional}>(לא חובה{card.medical ? ', בשובר רפואי חובה' : ''})</span></span>
              <input dir="ltr" value={bookingRef} onChange={e => setBookingRef(e.target.value.toUpperCase())} placeholder="BF-0000" autoComplete="off" maxLength={20} className={`${s.input} ${d.input}`} />
            </label>
          </div>
        )}
        {!canManage ? <p className={s.small}>בהרשאה שלך אפשר לבדוק שוברים. מימוש וביטול אפשריים בהרשאת ניהול.</p> : null}
        {note ? <p className={`${s.note} ${s.noteWarn}`}>{note}</p> : null}
        {canManage && card.cancellable ? <p className={s.small}>ביטול עם החזר כספי אפשרי תוך 14 ימים מהקנייה, כל עוד השובר לא מומש.</p> : null}
      </div>

      {canManage && (redeemable || card.cancellable) && (
        <ActionBar mobileOnly error={err || undefined}>
          {card.cancellable && (
            <button type="button" className={d.barDanger} disabled={busy} onClick={() => setConfirm(true)}>
              ביטול השובר
            </button>
          )}
          {redeemable && (
            <button type="button" className={d.barPrimary} disabled={busy} aria-busy={busy || undefined} onClick={doRedeem}>
              {invoicing ? 'מימוש והפקת חשבונית' : 'מימוש'}
            </button>
          )}
        </ActionBar>
      )}
      {err && !(canManage && (redeemable || card.cancellable)) ? <p role="alert" className={`${s.errorInline} ${d.inset}`}>{err}</p> : null}

      <BottomSheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title="לבטל את השובר?"
        footer={
          <div className={d.sheetBtns}>
            <button type="button" className={d.barGhost} onClick={() => setConfirm(false)}>השאר פעיל</button>
            <button type="button" className={d.barDangerSolid} disabled={busy} onClick={doCancel}>ביטול והחזר</button>
          </div>
        }
      >
        <p className={d.sheetText}>
          <span className="ltr">{money(card.valueAgorot)}</span> יוחזרו לכרטיס של הקונה, {card.buyer}. אי אפשר לבטל את הביטול.
        </p>
      </BottomSheet>

      <Toast text={toast} />
    </section>
  );
}
