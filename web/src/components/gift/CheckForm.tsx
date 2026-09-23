'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { checkGiftCode, type CheckResult } from '@/app/gift/check/actions';
import { money } from './shared';
import s from './gift.module.css';

/** Design: Gift Cards → view "redeem". `initial` comes from ?code= (the link in the M14 message). */
export function CheckForm({ initial }: { initial: string }) {
  const [code, setCode] = useState(initial);
  const [res, setRes] = useState<CheckResult | null>(null);
  const [busy, start] = useTransition();
  const auto = useRef(false);

  const check = (value = code) => {
    if (!value.trim()) return;
    start(async () => setRes(await checkGiftCode(value)));
  };

  useEffect(() => {
    if (initial && !auto.current) {
      auto.current = true;
      check(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const bad = res && !res.ok;
  const card = res?.ok ? res.card : null;
  const live = card && (card.status === 'active' || card.status === 'partially_redeemed' || card.status === 'scheduled');

  return (
    <div className={`${s.narrow} ${s.fade}`}>
      <div>
        <h1 className={s.h1}>קיבלת שובר?</h1>
        <p className={s.lead} style={{ margin: 0 }}>הקלידי את הקוד כדי לראות יתרה, תוקף ואיפה אפשר לממש.</p>
      </div>
      <form className={s.codeRow} onSubmit={e => { e.preventDefault(); check(); }}>
        <input
          dir="ltr" value={code} onChange={e => { setCode(e.target.value.toUpperCase()); setRes(null); }} aria-label="קוד השובר" placeholder="NOA-XXXX-XXXX"
          autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={20} className={s.codeInput} aria-invalid={bad ? true : undefined}
        />
        <button type="submit" disabled={busy || !code.trim()} className={s.codeBtn}>{busy ? 'בודקים…' : 'בדיקה'}</button>
      </form>
      {res && !res.ok ? (
        <p role="alert" className={s.errorInline}>
          {res.error === 'rate'
            ? 'יותר מדי ניסיונות בזמן קצר. נסי שוב בעוד כמה דקות.'
            : 'הקוד לא נמצא. בדקי שהעתקת את כל התווים, כולל האותיות שבהתחלה. אפשר גם לפנות לקליניקה שהנפיקה את השובר.'}
        </p>
      ) : null}
      {card ? (
        <div className={`${s.result} ${s.pop}`} role="region" aria-label="פרטי השובר">
          <div className={s.resultHead} data-tone={live ? undefined : 'off'}>
            <span className={s.resultLabel}>
              {card.status === 'refunded' ? 'השובר בוטל והכסף הוחזר' : card.status === 'expired' ? 'תוקף השובר פג' : card.status === 'redeemed' ? 'השובר מומש במלואו' : 'יתרה בשובר'}
            </span>
            <span className={s.resultValue}>{money(card.balanceAgorot)}</span>
          </div>
          <dl className={s.resultDl}>
            <dt>קוד</dt>
            <dd><span className={s.code}>{card.code}</span></dd>
            <dt>שווי מקורי</dt>
            <dd><span className="ltr">{money(card.valueAgorot)}</span>{card.from ? <> · מאת {card.from}</> : null}</dd>
            {card.treatment ? (
              <>
                <dt>טיפול</dt>
                <dd>{card.treatment}</dd>
              </>
            ) : null}
            {card.redemptions.length ? (
              <>
                <dt>מומש</dt>
                <dd>
                  {card.redemptions.map((r, i) => (
                    <span key={i} style={{ display: 'block' }}>
                      <span className="ltr">{money(r.amountAgorot)}</span> · {r.what ? `${r.what}, ` : ''}<span className="ltr tnum">{r.date}</span>
                    </span>
                  ))}
                </dd>
              </>
            ) : null}
            {card.sendDate ? (
              <>
                <dt>יישלח</dt>
                <dd><span className="ltr">{card.sendDate}</span></dd>
              </>
            ) : null}
            <dt>בתוקף עד</dt>
            <dd><span className="ltr tnum">{card.expires}</span></dd>
            <dt>למימוש ב</dt>
            <dd>{card.business}{card.cities ? ` · ${card.cities}` : ''}</dd>
          </dl>
          {live && card.bookHref ? (
            <div className={s.resultActions}>
              <Link href={card.bookHref} className={s.btn}>{card.bookLabel}</Link>
            </div>
          ) : null}
          <p className={s.resultNote}>
            השובר מקוזז מהתשלום בקליניקה, ועל כל מימוש מופקת חשבונית מס. בטיפול בהזרקה, המימוש אחרי ייעוץ רפואי, והרופאה מחליטה אם הטיפול מתאים.
            {card.medical ? ' השובר הזה הוא לטיפול רפואי, ולכן יש לקבוע קודם פגישת ייעוץ.' : ''}
          </p>
        </div>
      ) : null}
    </div>
  );
}
