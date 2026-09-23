'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { buyGiftCard } from '@/app/gift/[branch]/actions';
import { FixedActionBar } from '@/components/review/FixedLayer';
import { haptic } from '@/components/shell/haptics';
import { TopBar } from '@/components/shell/TopBar';
import { EMAIL_RE, toE164 } from '@/lib/format';
import { SHELL_MQ } from '@/lib/ui/shell';
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
  /** App shell: where × leaves the flow (the clinic profile). */
  closeHref: string;
}

type Kind = 'amount' | 'treatment';

const durationNote = (m: number | null) => (m ? `כ־${m} דקות` : 'טיפול אחד');

// Phones (app shell): a step flow, what → to whom and when → your details, with the live card
// preview pinned under the top bar (it shrinks once the page scrolls). Desktop keeps the single page
// with the preview in the side column. The steps are CSS only (data-step / data-cur).
const STEPS = 3;
const STEP_HINT = ['', 'אפשר לשנות הכל עד התשלום', 'הברכה והשם מופיעים על השובר', 'התשלום בדף המאובטח של חברת הסליקה של הקליניקה'];

type Draft = {
  kind: Kind; amt: number; custom: string; treatId: string; to: string; msg: string; channel: Channel; contact: string;
  when: 'now' | 'date'; date: string; buyerName: string; buyerPhone: string; buyerEmail: string; step: number;
};

/** Scrolls the page (the scroll container) so the element sits under the top bar and the card; never scrollIntoView. */
function scrollToEl(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const shell = window.matchMedia(SHELL_MQ).matches;
  const top = el.getBoundingClientRect().top + window.scrollY - (shell ? 56 + 96 : 24);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
  if (el instanceof HTMLInputElement) el.focus({ preventScroll: true });
}

/** Design: Gift Cards → view "buy" (buyForm). */
export function BuyForm({ slug, businessName, years, expiry, treatments, today, maxDate, closeHref }: Props) {
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
  const [step, setStep] = useState(1);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const [compact, setCompact] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const restored = useRef(false);
  const draftKey = `bf-gift-draft:${slug}`;

  // Draft for this tab (sessionStorage: it holds contact details), saved on every change and step.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw) as Partial<Draft>;
        if (d.kind === 'amount' || (d.kind === 'treatment' && treatments.length)) setKind(d.kind);
        if (typeof d.amt === 'number' && AMOUNTS.includes(d.amt)) setAmt(d.amt);
        if (typeof d.custom === 'string') setCustom(d.custom);
        if (typeof d.treatId === 'string' && treatments.some(t => t.id === d.treatId)) setTreatId(d.treatId);
        if (typeof d.to === 'string') setTo(d.to);
        if (typeof d.msg === 'string') setMsg(d.msg);
        if (d.channel && CHANNELS.some(c => c.key === d.channel)) setChannel(d.channel);
        if (typeof d.contact === 'string') setContact(d.contact);
        if (d.when === 'now' || d.when === 'date') setWhen(d.when);
        if (typeof d.date === 'string') setDate(d.date);
        if (typeof d.buyerName === 'string') setBuyerName(d.buyerName);
        if (typeof d.buyerPhone === 'string') setBuyerPhone(d.buyerPhone);
        if (typeof d.buyerEmail === 'string') setBuyerEmail(d.buyerEmail);
        if (typeof d.step === 'number' && d.step >= 1 && d.step <= STEPS) setStep(d.step);
      }
    } catch {
      /* storage unavailable */
    }
    restored.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  useEffect(() => {
    if (!restored.current) return;
    const t = setTimeout(() => {
      try {
        const d: Draft = { kind, amt, custom, treatId, to, msg, channel, contact, when, date, buyerName, buyerPhone, buyerEmail, step };
        sessionStorage.setItem(draftKey, JSON.stringify(d));
      } catch {
        /* storage unavailable */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [draftKey, kind, amt, custom, treatId, to, msg, channel, contact, when, date, buyerName, buyerPhone, buyerEmail, step]);

  // The pinned preview shrinks once the page scrolls under the top bar (a sentinel, not a scroll listener).
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting), { rootMargin: '-64px 0px 0px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

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

  // In the order of the form (and of the steps): the first failing check is the one reported.
  const checks = [
    { ok: customOk, msg: `סכום בין ₪${CUSTOM_MIN} ל־₪${CUSTOM_MAX.toLocaleString('en-US')}`, step: 1, el: 'gc-custom' },
    { ok: valueAgorot > 0, msg: 'בחרו סכום או טיפול', step: 1, el: 'gc-sec-1' },
    { ok: toOk, msg: 'למי השובר?', step: 2, el: 'gc-to' },
    { ok: contactOk, msg: channel === 'wa' ? 'מספר וואטסאפ לא מלא' : 'כתובת מייל לא תקינה', step: 2, el: 'gc-contact' },
    { ok: dateOk, msg: 'בחרו תאריך שליחה מהיום ועד שנה קדימה', step: 2, el: 'gc-date' },
    { ok: bNameOk, msg: 'מה השם שלך?', step: 3, el: 'gc-bname' },
    { ok: bPhoneOk, msg: 'מספר הטלפון שלך לא תקין', step: 3, el: 'gc-bphone' },
    { ok: bEmailOk, msg: 'כתובת המייל שלך לא תקינה', step: 3, el: 'gc-bemail' },
  ];
  const firstBad = checks.find(c => !c.ok) ?? null;
  const ok = !firstBad && msgOk;
  const err = tried && firstBad ? firstBad.msg : '';
  const stepBad = firstBad && firstBad.step <= step ? firstBad : null;
  const stepErr = (tried && stepBad ? stepBad.msg : '') || serverErr;

  const goTo = (n: number, d: 'fwd' | 'back') => {
    setDir(d);
    setStep(n);
    window.scrollTo({ top: 0 });
  };

  const pay = () => {
    setServerErr('');
    if (!ok) {
      setTried(true);
      haptic('warning');
      if (firstBad) {
        if (window.matchMedia(SHELL_MQ).matches && firstBad.step !== step) goTo(firstBad.step, firstBad.step < step ? 'back' : 'fwd');
        const el = firstBad.el;
        requestAnimationFrame(() => scrollToEl(el));
      }
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
      else {
        haptic('warning');
        setServerErr(r.error);
      }
    });
  };

  const next = () => {
    setServerErr('');
    if (stepBad) {
      setTried(true);
      haptic('warning');
      if (stepBad.step < step) goTo(stepBad.step, 'back');
      const el = stepBad.el;
      requestAnimationFrame(() => scrollToEl(el));
      return;
    }
    if (step < STEPS) {
      setTried(false);
      goTo(step + 1, 'fwd');
    } else pay();
  };
  const back = () => {
    setTried(false);
    setServerErr('');
    goTo(Math.max(1, step - 1), 'back');
  };
  /** CSS-only steps: every block says which step it belongs to; the shell shows the current one. */
  const at = (n: number) => ({ 'data-step': n, 'data-cur': n === step || undefined });

  const cardWhat = kind === 'amount' ? `לכל טיפול ב${businessName}` : treat?.name ?? '';
  const cardTo = (to.trim() ? 'ל' + to.trim() : 'למי שאת אוהבת') + (msg.trim() ? ', ' + msg.trim() : '');
  const shownErr = err || serverErr;
  const bad = (cond: boolean) => (tried && cond ? true : undefined);

  const card = (
    <>
      <span aria-hidden="true" className={s.ring1} />
      <span aria-hidden="true" className={s.ring2} />
      <span className={s.pvTop}>
        <span className={s.pvLabel}>שובר מתנה</span>
        <span dir="ltr" className={s.pvMark}>beauty<span>find.</span></span>
      </span>
      <span className={s.pvValue}>{money(valueAgorot)}</span>
      <span className={s.pvWhat}>{cardWhat}</span>
      <span className={s.pvTo}>{cardTo}</span>
    </>
  );

  return (
    <>
      <TopBar mode="flow" title="שובר מתנה" progress={{ step, total: STEPS }} noBack={step === 1} onBack={back} closeHref={closeHref} />
      <main className={s.root}>
        <div className={`${s.wrap} ${s.flow}`} data-dir={dir}>
          <div ref={sentinel} className={s.pinSentinel} aria-hidden="true" />
          <div className={`${s.pin} bf-shell-only`} data-compact={compact || undefined}>
            <div aria-label="תצוגת השובר" className={`${s.preview} ${s.pinCard}`}>
              {card}
            </div>
          </div>

          <div className={s.fade}>
            <div {...at(1)}>
              <h1 className={s.h1}>שובר מתנה ל{businessName}</h1>
              <p className={s.lead}>
                השובר מונפק על ידי הקליניקה ובתוקף {yearsText(years)}. אפשר לממש אותו על כל טיפול, בכמה ביקורים, עד שהיתרה נגמרת.
              </p>
            </div>
            <div className={s.shell}>
              <div className={s.main}>
                <section id="gc-sec-1" aria-labelledby="gc-h1" className={s.card} {...at(1)}>
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
                            id="gc-custom" dir="ltr" inputMode="numeric" enterKeyHint="next" value={custom} onChange={e => setCustom(e.target.value.replace(/[^\d]/g, '').slice(0, 5))}
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

                <section aria-labelledby="gc-h2" className={s.card} {...at(2)}>
                  <h2 id="gc-h2" className={s.h2}>למי ומתי</h2>
                  <label className={s.field}>
                    שם המקבל/ת
                    <input id="gc-to" value={to} onChange={e => setTo(e.target.value)} placeholder="דנה" maxLength={60} autoComplete="off" enterKeyHint="next" className={s.input} aria-invalid={bad(!toOk)} />
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
                        id="gc-contact" dir="ltr" type={channel === 'wa' ? 'tel' : 'email'} inputMode={channel === 'wa' ? 'tel' : 'email'} value={contact} onChange={e => setContact(e.target.value)}
                        placeholder={channel === 'wa' ? '050-000-0000' : 'name@example.com'} autoComplete="off" enterKeyHint="next" className={s.input} aria-invalid={bad(!contactOk)}
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
                      <input id="gc-date" type="date" dir="ltr" min={today} max={maxDate} value={date} onChange={e => setDate(e.target.value)} className={s.input} aria-invalid={bad(!dateOk)} />
                    </label>
                  ) : null}
                </section>

                <section aria-labelledby="gc-h3" className={s.card} {...at(3)}>
                  <h2 id="gc-h3" className={s.h2}>הפרטים שלך</h2>
                  <p className={s.small}>לקבלה, לעדכון כשהשובר נפתח ולביטול אם יהיה צורך.</p>
                  <label className={s.field}>
                    שם מלא
                    <input id="gc-bname" value={buyerName} onChange={e => setBuyerName(e.target.value)} autoComplete="name" enterKeyHint="next" maxLength={80} className={s.input} aria-invalid={bad(!bNameOk)} />
                  </label>
                  <div className={s.fields2}>
                    <label className={s.field}>
                      טלפון נייד
                      <input id="gc-bphone" dir="ltr" type="tel" inputMode="tel" value={buyerPhone} onChange={e => setBuyerPhone(e.target.value)} autoComplete="tel" enterKeyHint="next" placeholder="050-000-0000" className={s.input} aria-invalid={bad(!bPhoneOk)} />
                    </label>
                    <label className={s.field}>
                      מייל לקבלה
                      <input id="gc-bemail" dir="ltr" type="email" inputMode="email" value={buyerEmail} onChange={e => setBuyerEmail(e.target.value)} autoComplete="email" enterKeyHint="done" placeholder="name@example.com" className={s.input} aria-invalid={bad(!bEmailOk)} />
                    </label>
                  </div>
                </section>

                {/* Desktop: summary and button in the column. Phones: the sticky action bar below. */}
                <div className={`${s.deskSubmit} bf-desk-only`}>
                  {shownErr ? <p role="alert" className={s.error}>{shownErr}</p> : null}
                  <button type="button" onClick={pay} disabled={busy} className={s.pay}>
                    {busy ? 'מעבירים לתשלום…' : <>תשלום <span className="ltr">{money(valueAgorot)}</span></>}
                  </button>
                </div>
                <p className={s.small} {...at(3)}>
                  בלחיצה על תשלום את/ה מאשר/ת את התנאים שבצד: בקנייה תתקבל קבלה; חשבונית מס מופקת בכל מימוש. ביטול תוך 14 ימים מהקנייה, כל עוד השובר לא מומש, בהחזר מלא. התשלום מתבצע בדף המאובטח של חברת הסליקה של הקליניקה.
                </p>
              </div>

              <aside className={s.side}>
                <div aria-label="תצוגת השובר" className={`${s.preview} bf-desk-only`}>
                  {card}
                </div>
                <div className={s.card} {...at(3)}>
                  <h2 className={s.h2Sm}>חשוב לדעת</h2>
                  <ul className={s.facts}>
                    {termsFor(years).map(f => <li key={f}>{f}</li>)}
                    <li>בתוקף עד <span className="ltr">{expiry}</span> אם נקנה היום</li>
                  </ul>
                </div>
              </aside>
            </div>
          </div>
        </div>
      </main>

      <FixedActionBar mobileOnly error={stepErr || undefined} hint={stepErr ? undefined : STEP_HINT[step]}>
        <button type="button" onClick={next} disabled={busy} className={s.barBtn}>
          {step < STEPS ? 'המשך' : busy ? 'מעבירים לתשלום…' : <>תשלום <span className="ltr">{money(valueAgorot)}</span></>}
        </button>
      </FixedActionBar>
    </>
  );
}
