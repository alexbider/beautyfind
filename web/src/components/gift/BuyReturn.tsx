'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { retryGiftCard } from '@/app/gift/[branch]/actions';
import { haptic } from '@/components/shell/haptics';
import { money, type Channel } from './shared';
import s from './gift.module.css';

export interface DoneProps {
  slug: string;
  code: string;
  valueAgorot: number;
  what: string;
  expires: string;
  channel: Channel;
  recipient: string;
  scheduled: boolean;
  sendDate: string;
  receipt: boolean;
  receiptUrl: string | null;
}

/** Design: Gift Cards → view "buy" (buyDone). */
export function BuyDone(p: DoneProps) {
  const title = p.channel === 'self' ? 'השובר מוכן' : p.scheduled ? 'השובר מתוזמן' : 'השובר נשלח';
  const via = p.channel === 'wa' ? ' בוואטסאפ' : ' במייל';
  const receiptLine = p.receipt ? 'הקבלה נשלחה אלייך במייל.' : 'הקבלה על התשלום נשלחת מהקליניקה.';
  // No haptic here: the page opens from the checkout redirect, without a tap (browsers block vibrate).
  useEffect(() => {
    // The purchase is done: the form draft of this tab is no longer needed.
    try {
      sessionStorage.removeItem(`bf-gift-draft:${p.slug}`);
    } catch {
      /* storage unavailable */
    }
  }, [p.slug]);
  return (
    <div className={`${s.done} ${s.doneFull} ${s.pop}`}>
      <span aria-hidden="true" className={s.doneIcon}>
        <svg width="28" height="28" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 7.5 5.5 10.5 11.5 4" />
        </svg>
      </span>
      <h1 className={s.h1Sm}>{title}</h1>
      <p className={s.doneBody}>
        {p.channel === 'self' ? (
          <>שלחנו לך את השובר להדפסה או להעברה. {receiptLine}</>
        ) : (
          <>
            {p.scheduled ? <>יישלח ב־<span className="ltr">{p.sendDate}</span> בשעה <span className="ltr">09:00</span></> : 'נשלח עכשיו'} ל{p.recipient}{via}. {receiptLine}
          </>
        )}
      </p>
      <dl className={s.dl}>
        <dt>קוד השובר</dt>
        <dd><span className={s.code}>{p.code}</span></dd>
        <dt>שווי</dt>
        <dd><span className="ltr">{money(p.valueAgorot)}</span>{p.what ? <> · {p.what}</> : null}</dd>
        <dt>בתוקף עד</dt>
        <dd><span className="ltr">{p.expires}</span></dd>
      </dl>
      <div className={s.actions}>
        {p.receiptUrl ? <Link href={p.receiptUrl} className={s.btn}>לקבלה</Link> : null}
        <Link href={`/gift/${p.slug}`} className={p.receiptUrl ? s.btnGhost : s.btn}>שובר נוסף</Link>
      </div>
    </div>
  );
}

/** Back from the checkout before the provider confirmed: re-check every 2 seconds for about a minute. */
export function BuyWaiting() {
  const router = useRouter();
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (tries >= 30) return;
    const t = setTimeout(() => {
      router.refresh();
      setTries(n => n + 1);
    }, 2000);
    return () => clearTimeout(t);
  }, [tries, router]);
  return (
    <div className={`${s.done} ${s.pop}`} role="status" aria-live="polite">
      <div className={s.statusRow}>
        <span className={s.spinner} aria-hidden="true" />
        <h1 className={s.h1Sm} style={{ margin: 0 }}>מאשרים את התשלום</h1>
      </div>
      <p className={s.doneBody} style={{ marginTop: 10 }}>
        {tries >= 30
          ? 'האישור מחברת הסליקה מתעכב. אם החיוב עבר, השובר יישלח ברגע שיתקבל האישור והקבלה תגיע במייל. אפשר לרענן את העמוד בעוד כמה דקות.'
          : 'זה לוקח בדרך כלל כמה שניות. לא צריך לשלם שוב.'}
      </p>
      {tries >= 30 ? <button type="button" className={s.btnGhost} onClick={() => { setTries(0); router.refresh(); }}>לבדוק שוב</button> : null}
    </div>
  );
}

/** Payment cancelled or declined. The card stays unpaid until a retry succeeds. */
export function BuyFailed({ slug, cardId }: { slug: string; cardId: string }) {
  const [err, setErr] = useState('');
  const [busy, start] = useTransition();
  const retry = () =>
    start(async () => {
      const r = await retryGiftCard(slug, cardId);
      if (r.ok) window.location.assign(r.checkoutUrl);
      else {
        haptic('warning');
        setErr(r.error);
      }
    });
  return (
    <div className={`${s.done} ${s.pop}`} style={{ borderColor: 'var(--bad-line)' }}>
      <h1 className={s.h1Sm}>התשלום לא הושלם</h1>
      <p className={s.doneBody}>לא בוצע חיוב והשובר לא נשלח. אפשר לנסות שוב עם אותם פרטים, או לחזור לטופס ולשנות אותם.</p>
      {err ? <p role="alert" className={s.errorInline} style={{ marginBottom: 12 }}>{err}</p> : null}
      <div className={s.actions}>
        <button type="button" onClick={retry} disabled={busy} className={s.btn}>{busy ? 'מעבירים לתשלום…' : 'לנסות שוב'}</button>
        <Link href={`/gift/${slug}`} className={s.btnGhost}>חזרה לטופס</Link>
      </div>
    </div>
  );
}
