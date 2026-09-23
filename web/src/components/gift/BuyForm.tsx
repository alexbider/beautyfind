'use client';

import { useState, useTransition } from 'react';
import { buyGiftCard } from '@/app/gift/[branch]/actions';
import { EMAIL_RE, toE164 } from '@/lib/format';
import { AMOUNTS, CHANNELS, CUSTOM_MAX, CUSTOM_MIN, MESSAGE_MAX, money, termsFor, yearsText, type Channel } from './shared';
import s from './gift.module.css';

export interface GiftTreatment {
  id: string;
  name: string;
  valueAgorot: number;
  durationMin: number | null;
  isMedical: boolean;
}

interface Props {
  slug: string;
  businessName: string;
  years: number;
  expiry: string; // DD/MM/YYYY if bought today
  treatments: GiftTreatment[];
  today: string; // YYYY-MM-DD, Israel
  maxDate: string;
}

type Kind = 'amount' | 'treatment';

const durationNote = (m: number | null) => (m ? `כ־${m} דקות` : 'טיפול אחד');

/** Design: Gift Cards → view "buy" (buyForm). */
export function BuyForm({ slug, businessName, years, expiry, treatments, today, maxDate }: Props) {
  const [kind, setKind] = useState<Kind>('amount');
  const [amt, setAmt] = useState(500);
  const [custom, setCustom] = useState('');
  const [treatId, setTreatId] = useState(treatments[0]?.id ?? '');
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState('');
  const [channel, setChannel] = useState<Channel>('wa');
  const [contact, setContact] = useState('');
  const [when, setWhen] = useState<'now' | 'date'>('now');
  const [date, setDate] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState('');
  const [busy, start] = useTransition();

  const customN = parseInt(custom.replace(/\D/g, ''), 10) || 0;
  const customOk = !custom || (customN >= CUSTOM_MIN && customN <= CUSTOM_MAX);
  const treat = treatments.find(t => t.id === treatId) ?? null;
  const valueAgorot = kind === 'amount' ? (custom ? customN : amt) * 100 : treat?.valueAgorot ?? 0;
  const needsContact = channel !== 'self';
  const contactOk = !needsContact || (channel === 'wa' ? !!toE164(contact) : EMAIL_RE.test(contact.trim()));
  const toOk = to.trim().length >= 2;
  const msgOk = [...msg].length <= MESSAGE_MAX;
  const dateOk = when === 'now' || (!!date && date >= today && date <= maxDate);
  const bNameOk = buyerName.trim().length >= 2;
  const bPhoneOk = !!toE164(buyerPhone);
  const bEmailOk = EMAIL_RE.test(buyerEmail.trim());
  const ok = customOk && valueAgorot > 0 && toOk && contactOk && msgOk && dateOk && bNameOk && bPhoneOk && bEmailOk;

  const err = !tried
    ? ''
    : !customOk
      ? `סכום בין ₪${CUSTOM_MIN} ל־₪${CUSTOM_MAX.toLocaleString('en-US')}`
      : valueAgorot <= 0
        ? 'בחרו סכום או טיפול'
        : !toOk
          ? 'למי השובר?'
          : !contactOk
            ? channel === 'wa' ? 'מספר וואטסאפ לא מלא' : 'כתובת מייל לא תקינה'
            : !dateOk
              ? 'בחרו תאריך שליחה מהיום ועד שנה קדימה'
              : !bNameOk
                ? 'מה השם שלך?'
                : !bPhoneOk
                  ? 'מספר הטלפון שלך לא תקין'
                  : !bEmailOk
                    ? 'כתובת המייל שלך לא תקינה'
                    : '';

  const pay = () => {
    setServerErr('');
    if (!ok) {
      setTried(true);
      return;
    }
    start(async () => {
      const r = await buyGiftCard(slug, {
        kind,
        amountShekels: kind === 'amount' ? (custom ? customN : amt) : undefined,
        treatmentId: kind === 'treatment' ? treatId : undefined,
        recipientName: to,
        channel,
        contact: needsContact ? contact : '',
        message: msg,
        when,
        date: when === 'date' ? date : undefined,
        buyerName,
        buyerPhone,
        buyerEmail,
      });
      if (r.ok) window.location.assign(r.checkoutUrl);
      else setServerErr(r.error);
    });
  };

  const cardWhat = kind === 'amount' ? `לכל טיפול ב${businessName}` : treat?.name ?? '';
  const cardTo = (to.trim() ? 'ל' + to.trim() : 'למי שאת אוהבת') + (msg.trim() ? ', ' + msg.trim() : '');
  const shownErr = err || serverErr;
  const bad = (cond: boolean) => (tried && cond ? true : undefined);

  return (
    <div className={s.fade}>
      <h1 className={s.h1}>שובר מתנה ל{businessName}</h1>
      <p className={s.lead}>
        השובר מונפק על ידי הקליניקה ובתוקף {yearsText(years)}. אפשר לממש אותו על כל טיפול, בכמה ביקורים, עד שהיתרה נגמרת.
      </p>
      <div className={s.shell}>
        <div className={s.main}>
          <section aria-labelledby="gc-h1" className={s.card}>
            <h2 id="gc-h1" className={s.h2}>סוג השובר</h2>
            {treatments.length > 0 ? (
              <div role="radiogroup" aria-label="סוג השובר" className={s.chips}>
                {([['amount', 'לפי סכום'], ['treatment', 'לפי טיפול']] as const).map(([k, name]) => (
                  <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={s.chip}>{name}</button>
                ))}
              </div>
            ) : null}
            {kind === 'amount' ? (
              <div>
                <div role="radiogroup" aria-label="סכום" className={s.amounts}>
                  {AMOUNTS.map(a => (
                    <button key={a} type="button" role="radio" aria-checked={!custom && amt === a} onClick={() => { setAmt(a); setCustom(''); }} className={s.amount}>
                      {money(a * 100)}
                    </button>
                  ))}
                </div>
                <label className={`${s.field} ${s.fieldNarrow}`} style={{ marginTop: 11 }}>
                  סכום אחר
                  <span className={s.inputWrap}>
                    <input
                      dir="ltr" inputMode="numeric" value={custom} onChange={e => setCustom(e.target.value.replace(/[^\d]/g, '').slice(0, 5))}
                      placeholder={`${CUSTOM_MIN}–${CUSTOM_MAX.toLocaleString('en-US')}`} className={s.input} aria-invalid={custom && !customOk ? true : undefined}
                    />
                    <span aria-hidden="true" className={s.shekel}>₪</span>
                  </span>
                </label>
              </div>
            ) : (
              <>
                <div role="radiogroup" aria-label="טיפול" className={s.treats}>
                  {treatments.map(t => (
                    <button key={t.id} type="button" role="radio" aria-checked={treatId === t.id} onClick={() => setTreatId(t.id)} className={s.treat}>
                      <span className={s.treatText}>
                        <span className={s.treatName}>{t.name}</span>
                        <span className={s.treatNote}>{t.isMedical ? `${durationNote(t.durationMin)} · המימוש אחרי ייעוץ רפואי` : durationNote(t.durationMin)}</span>
                      </span>
                      <span className={s.treatPrice}>{money(t.valueAgorot)}</span>
                    </button>
                  ))}
                </div>
                <p className={s.small}>שווי השובר הוא מחיר הטיפול כולל מע״מ.</p>
              </>
            )}
          </section>

          <section aria-labelledby="gc-h2" className={s.card}>
            <h2 id="gc-h2" className={s.h2}>למי ומתי</h2>
            <label className={s.field}>
              שם המקבל/ת
              <input value={to} onChange={e => setTo(e.target.value)} placeholder="דנה" maxLength={60} autoComplete="off" className={s.input} aria-invalid={bad(!toOk)} />
            </label>
            <label className={s.field}>
              <span>ברכה <span className={s.fieldNote}>· עד <span className="ltr">{MESSAGE_MAX}</span> תווים</span></span>
              <textarea value={msg} onChange={e => setMsg([...e.target.value].slice(0, MESSAGE_MAX).join(''))} rows={2} maxLength={MESSAGE_MAX} placeholder="יום הולדת שמח! מגיע לך רגע רק בשבילך" className={s.textarea} aria-invalid={msgOk ? undefined : true} />
              <span className={s.count} aria-live="polite"><span className="ltr">{[...msg].length}/{MESSAGE_MAX}</span></span>
            </label>
            <div>
              <span className={s.label} id="gc-ch">שליחה</span>
              <div role="radiogroup" aria-labelledby="gc-ch" className={s.chips}>
                {CHANNELS.map(c => (
                  <button key={c.key} type="button" role="radio" aria-checked={channel === c.key} onClick={() => { setChannel(c.key); setContact(''); }} className={`${s.chip} ${s.chipSm}`}>{c.name}</button>
                ))}
              </div>
            </div>
            {needsContact ? (
              <label className={s.field}>
                {channel === 'wa' ? 'מספר הוואטסאפ של המקבל/ת' : 'המייל של המקבל/ת'}
                <input
                  dir="ltr" type={channel === 'wa' ? 'tel' : 'email'} inputMode={channel === 'wa' ? 'tel' : 'email'} value={contact} onChange={e => setContact(e.target.value)}
                  placeholder={channel === 'wa' ? '050-000-0000' : 'name@example.com'} autoComplete="off" className={s.input} aria-invalid={bad(!contactOk)}
                />
              </label>
            ) : null}
            <div>
              <span className={s.label} id="gc-when">מועד שליחה</span>
              <div role="radiogroup" aria-labelledby="gc-when" className={s.chips}>
                {([['now', 'עכשיו'], ['date', 'תאריך אחר']] as const).map(([k, name]) => (
                  <button key={k} type="button" role="radio" aria-checked={when === k} onClick={() => setWhen(k)} className={`${s.chip} ${s.chipSm}`}>{name}</button>
                ))}
              </div>
            </div>
            {when === 'date' ? (
              <label className={`${s.field} ${s.fieldNarrow}`}>
                תאריך השליחה <span className={s.fieldNote}>· בשעה <span className="ltr">09:00</span></span>
                <input type="date" dir="ltr" min={today} max={maxDate} value={date} onChange={e => setDate(e.target.value)} className={s.input} aria-invalid={bad(!dateOk)} />
              </label>
            ) : null}
          </section>

          <section aria-labelledby="gc-h3" className={s.card}>
            <h2 id="gc-h3" className={s.h2}>הפרטים שלך</h2>
            <p className={s.small}>לקבלה, לעדכון כשהשובר נפתח ולביטול אם יהיה צורך.</p>
            <label className={s.field}>
              שם מלא
              <input value={buyerName} onChange={e => setBuyerName(e.target.value)} autoComplete="name" maxLength={80} className={s.input} aria-invalid={bad(!bNameOk)} />
            </label>
            <div className={s.fields2}>
              <label className={s.field}>
                טלפון נייד
                <input dir="ltr" type="tel" inputMode="tel" value={buyerPhone} onChange={e => setBuyerPhone(e.target.value)} autoComplete="tel" placeholder="050-000-0000" className={s.input} aria-invalid={bad(!bPhoneOk)} />
              </label>
              <label className={s.field}>
                מייל לקבלה
                <input dir="ltr" type="email" inputMode="email" value={buyerEmail} onChange={e => setBuyerEmail(e.target.value)} autoComplete="email" placeholder="name@example.com" className={s.input} aria-invalid={bad(!bEmailOk)} />
              </label>
            </div>
          </section>

          {shownErr ? <p role="alert" className={s.error}>{shownErr}</p> : null}
          <button type="button" onClick={pay} disabled={busy} className={s.pay}>
            {busy ? 'מעבירים לתשלום…' : <>תשלום <span className="ltr">{money(valueAgorot)}</span></>}
          </button>
          <p className={s.small}>
            בלחיצה על תשלום את/ה מאשר/ת את התנאים שבצד: בקנייה תתקבל קבלה; חשבונית מס מופקת בכל מימוש. ביטול תוך 14 ימים מהקנייה, כל עוד השובר לא מומש, בהחזר מלא. התשלום מתבצע בדף המאובטח של חברת הסליקה של הקליניקה.
          </p>
        </div>

        <aside className={s.side}>
          <div aria-label="תצוגת השובר" className={s.preview}>
            <span aria-hidden="true" className={s.ring1} />
            <span aria-hidden="true" className={s.ring2} />
            <span className={s.pvTop}>
              <span className={s.pvLabel}>שובר מתנה</span>
              <span dir="ltr" className={s.pvMark}>beauty<span>find.</span></span>
            </span>
            <span className={s.pvValue}>{money(valueAgorot)}</span>
            <span className={s.pvWhat}>{cardWhat}</span>
            <span className={s.pvTo}>{cardTo}</span>
          </div>
          <div className={s.card}>
            <h2 className={s.h2Sm}>חשוב לדעת</h2>
            <ul className={s.facts}>
              {termsFor(years).map(f => <li key={f}>{f}</li>)}
              <li>בתוקף עד <span className="ltr">{expiry}</span> אם נקנה היום</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
