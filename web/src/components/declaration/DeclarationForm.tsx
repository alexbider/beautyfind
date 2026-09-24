'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { linkExistingDeclaration, signDeclaration } from '@/app/b/[token]/declaration/actions';
import { inShell, scrollToField, scrollTop } from '@/components/booking/flow';
import { ActionBar } from '@/components/shell/ActionBar';
import { haptic } from '@/components/shell/haptics';
import { TopBar } from '@/components/shell/TopBar';
import { Wordmark } from '@/components/Wordmark';
import { LIMITS, MIN_INK_POINTS, QUESTIONS, nameOk, plAnswers, type DeclType } from './questions';
import { SignaturePad, typedSignaturePng, type SignaturePadHandle } from './SignaturePad';
import styles from './Declaration.module.css';

// Design: project/BeautyFind Health Declaration.dc.html. Desktop: one page with the appointment beside it.
// App shell (spec §3.3, §6): three step screens (details and questionnaire, medications, signature last),
// one question per row with כן/לא segmented buttons, and the submit in a sticky action bar.

export interface DeclarationProps {
  token: string;
  kiosk: boolean;
  type: DeclType;
  initialView: 'form' | 'done' | 'reuse' | 'closed';
  client: { name: string; phone: string; accountHref: string | null };
  clinicPhone: { display: string; href: string } | null;
  appt: { name: string; clinic: string; whoRole: string; who: string; day: string; when: string; ref: string; resp: string; doctor: string | null };
  done: { signedAt: string; yes: number } | null;
  reusable: { id: string; signedOn: string; validUntil: string } | null;
}

type Ans = Record<string, boolean | undefined>;
type Step = 1 | 2 | 3;

const TOTAL = 3;
const STEP_NAMES: Record<Step, string> = { 1: 'שאלון רפואי', 2: 'תרופות ותוספים', 3: 'חתימה' };

const PRIVACY = [
  'רק הצוות המטפל בתור הזה והרופא/ה האחראי/ת, לא הקבלה ולא BeautyFind',
  'נשמרת מוצפנת בתיק שלכם בקליניקה, לא בפרופיל הציבורי',
  'אפשר לבקש עותק או תיקון בכל עת דרך הקליניקה',
];

const Tick = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 7.5 5.5 10.5 11.5 4" />
  </svg>
);

function nowStamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function DeclarationForm(p: DeclarationProps) {
  const QS = QUESTIONS[p.type];
  const medical = p.type === 'medical';
  const draftKey = `bf-decl-draft:${p.appt.ref}`;

  const [view, setView] = useState(p.initialView);
  const [done, setDone] = useState(p.done);
  const [ans, setAns] = useState<Ans>({});
  const [detail, setDetail] = useState<Record<string, string>>({});
  const [meds, setMeds] = useState('');
  const [noMeds, setNoMeds] = useState(false);
  const [signName, setSignName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [idLast4, setIdLast4] = useState('');
  const [mode, setMode] = useState<'drawn' | 'typed'>('drawn');
  const [ink, setInk] = useState(0);
  const [typedConsent, setTypedConsent] = useState(false);
  const [attest, setAttest] = useState(false);
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState('');
  const [toast, setToast] = useState('');
  const [step, setStep] = useState<Step>(1);
  const [pending, start] = useTransition();
  const pad = useRef<SignaturePadHandle>(null);
  const toastT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const paneRef = useRef<HTMLDivElement>(null);
  const draftReady = useRef(false);
  const ids = useId();

  const flash = (t: string) => {
    clearTimeout(toastT.current);
    setToast(t);
    toastT.current = setTimeout(() => setToast(''), 3200);
  };
  useEffect(() => () => clearTimeout(toastT.current), []);

  // Draft: this device only, never on the reception tablet, and never the signature.
  useEffect(() => {
    draftReady.current = true;
    if (p.kiosk) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d && typeof d === 'object') {
        if (d.ans) setAns(d.ans);
        if (d.detail) setDetail(d.detail);
        if (typeof d.meds === 'string') setMeds(d.meds);
        if (typeof d.noMeds === 'boolean') setNoMeds(d.noMeds);
        if (d.step === 2 || d.step === 3) setStep(d.step);
      }
    } catch {
      /* storage unavailable */
    }
  }, [draftKey, p.kiosk]);

  // Saved on every change (spec §3.4), so the reminder link brings the client back where she stopped.
  useEffect(() => {
    if (!draftReady.current || p.kiosk || view !== 'form') return;
    if (!Object.keys(ans).length && !meds && !noMeds && step === 1) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ ans, detail, meds, noMeds, step }));
    } catch {
      /* storage unavailable */
    }
  }, [draftKey, p.kiosk, view, ans, detail, meds, noMeds, step]);

  const answered = QS.filter(q => ans[q.key] != null).length;
  const yesN = QS.filter(q => ans[q.key] === true).length;
  const allAns = answered === QS.length;
  const medsOk = noMeds || meds.trim().length > 1;
  const nameValid = nameOk(signName);
  const sigOk = mode === 'drawn' ? ink >= MIN_INK_POINTS : nameValid && typedConsent;
  const birthOk = !birthDate || /^\d{4}-\d{2}-\d{2}$/.test(birthDate);
  const idOk = !idLast4 || /^\d{4}$/.test(idLast4);
  const ok = allAns && medsOk && nameValid && sigOk && attest && birthOk && idOk;

  // Checks in page order, each tied to the step screen that shows the field.
  const checks: Array<{ step: Step; ok: boolean; msg: string }> = [
    { step: 1, ok: birthOk, msg: 'תאריך הלידה אינו תקין' },
    { step: 1, ok: idOk, msg: 'יש להקליד 4 ספרות בדיוק' },
    { step: 1, ok: allAns, msg: `יש לענות על כל שאלות השאלון: ${QS.length - answered === 1 ? 'חסרה שאלה אחת' : `חסרות ${QS.length - answered}`}` },
    { step: 2, ok: medsOk, msg: 'רשמו תרופות קבועות, או סמנו ״אין תרופות קבועות״' },
    { step: 3, ok: nameValid, msg: 'כתבו שם פרטי ושם משפחה' },
    { step: 3, ok: sigOk, msg: mode === 'drawn' ? 'חסרה חתימה' : 'יש לאשר שהקלדת השם מהווה חתימה' },
    { step: 3, ok: attest, msg: 'יש לאשר את ההצהרה בתחתית הטופס' },
  ];
  const firstBad = checks.find(c => !c.ok);
  const stepBad = checks.find(c => c.step === step && !c.ok);
  const errorText = (tried && firstBad ? firstBad.msg : '') || serverErr;
  const barError = (tried && stepBad ? stepBad.msg : '') || serverErr;

  const pregYes = ans.preg === true;
  const flagOn = yesN > 0;
  const pregMedical = pregYes && medical;
  const flagTitle = pregMedical ? 'לא מבצעים הזרקה בהריון או בהנקה' : `${plAnswers(yesN)} לבדיקה לפני הטיפול`;
  const flagBody = pregMedical
    ? `ההזרקה לא תתבצע בתור הזה. ${p.appt.doctor ? `${p.appt.doctor} או הקליניקה ייצרו` : 'הקליניקה תיצור'} איתכם קשר לתיאום מועד אחר. אין חיוב על העברת מועד מסיבה רפואית.`
    : `הפירוט יגיע אל ${p.appt.who} לפני הטיפול, וייצרו איתכם קשר רק אם צריך להתאים משהו. התור נשאר במקומו.`;

  // ---------- Steps (app shell) ----------

  /** In the shell only the current step shows; on desktop everything does. */
  const on = (n: Step) => (n === step ? '' : styles.off);

  const showFirstInvalid = () =>
    // Fields of later steps come later in the page, so the first match is on the step being shown.
    requestAnimationFrame(() => scrollToField(paneRef.current?.querySelector('[data-miss], [data-invalid]')));

  const go = (n: Step) => {
    const fwd = n >= step;
    setStep(n);
    setTried(false);
    setServerErr('');
    if (!inShell()) return;
    scrollTop();
    // Slide without remounting, so the drawn signature survives going back and forth.
    const el = paneRef.current;
    if (el && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.animate([{ opacity: 0, transform: `translateX(${fwd ? -40 : 40}px)` }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2,.7,.2,1)' });
    }
  };

  const next = () => {
    if (step === TOTAL) {
      submit();
      return;
    }
    if (stepBad) {
      setTried(true);
      haptic('warning');
      showFirstInvalid();
      return;
    }
    go((step + 1) as Step);
  };

  const submit = () => {
    setServerErr('');
    if (!ok) {
      setTried(true);
      haptic('warning');
      if (firstBad && inShell() && firstBad.step !== step) setStep(firstBad.step);
      showFirstInvalid();
      return;
    }
    start(async () => {
      const blob = mode === 'drawn' ? await pad.current?.toPng() : await typedSignaturePng(signName);
      if (!blob) {
        haptic('warning');
        setServerErr('לא הצלחנו לשמור את החתימה. נסו לחתום שוב.');
        return;
      }
      const fd = new FormData();
      fd.set('payload', JSON.stringify({
        answers: Object.fromEntries(QS.map(q => [q.key, { yes: ans[q.key] === true, detail: ans[q.key] ? (detail[q.key] ?? '').slice(0, LIMITS.detail) : '' }])),
        meds: noMeds ? '' : meds, noMeds, name: signName,
        ...(birthDate ? { birthDate } : {}), ...(idLast4 ? { idLast4 } : {}),
        attest, mode, ink, typedConsent,
      }));
      fd.set('signature', blob, 'signature.png');
      const r = await signDeclaration(p.token, fd);
      if (!r.ok) {
        haptic('warning');
        setServerErr(r.error);
        return;
      }
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
      setDone({ signedAt: nowStamp(), yes: r.yes });
      setView('done');
      haptic('success');
      window.scrollTo({ top: 0 });
      flash('ההצהרה נשלחה לקליניקה');
    });
  };

  const saveDraft = () => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ ans, detail, meds, noMeds, step }));
      flash('נשמר. הקישור בהודעת התזכורת יחזיר אתכם לכאן');
    } catch {
      flash('לא הצלחנו לשמור במכשיר הזה');
    }
  };

  const reuse = () => {
    if (!p.reusable) return;
    const id = p.reusable.id;
    start(async () => {
      const r = await linkExistingDeclaration(p.token, id);
      if (!r.ok) {
        haptic('warning');
        setServerErr(r.error);
        return;
      }
      setDone({ signedAt: p.reusable!.signedOn, yes: -1 });
      setView('done');
      haptic('success');
      flash('ההצהרה הקיימת צורפה לתור');
    });
  };

  const reopen = () => {
    setView('form');
    setStep(1);
    setInk(0);
    setAttest(false);
    setTypedConsent(false);
    setTried(false);
    setServerErr('');
  };

  const bookingHref = `/b/${p.token}`;
  const aside = (
    <aside className={`${styles.side} ${on(1)}`}>
      <div className={styles.card} style={{ padding: 0, overflow: 'hidden' }}>
        <div className={styles.apptHead}>
          <span className={styles.apptKicker}>ההצהרה עבור התור</span>
          <span className={styles.apptName}>{p.appt.name}</span>
        </div>
        <dl className={styles.apptDl}>
          <dt>קליניקה</dt><dd>{p.appt.clinic}</dd>
          {p.appt.who && <><dt>{p.appt.whoRole}</dt><dd className={styles.w600}>{p.appt.who}</dd></>}
          <dt>מועד</dt><dd className={styles.w600}>{p.appt.day} · <span className="ltr tnum">{p.appt.when}</span></dd>
          <dt>אסמכתא</dt><dd className={styles.w600}><span className="ltr tnum">{p.appt.ref}</span></dd>
        </dl>
        {p.appt.resp && <p className={styles.resp}>{p.appt.resp}</p>}
      </div>

      {view === 'form' && flagOn && (
        <div role="status" className={styles.flag}>
          <span className={styles.flagTitle}>{flagTitle}</span>
          <p>{flagBody}</p>
        </div>
      )}

      <div className={styles.card} style={{ padding: '14px 16px' }}>
        <h2 className={styles.h2sm}>מי רואה את התשובות</h2>
        <ul className={styles.privacy}>
          {PRIVACY.map(t => <li key={t}><span aria-hidden="true" />{t}</li>)}
        </ul>
        <p className={styles.privacyFoot}><Link href="/privacy">מדיניות הפרטיות</Link></p>
      </div>
    </aside>
  );

  // Close (×): back to the booking; on the reception tablet it only returns to the first screen.
  const closeProps = p.kiosk ? { onClose: () => (view === 'form' ? go(1) : undefined) } : { closeHref: bookingHref };
  const hint =
    step === 1 ? (
      <>
        נענו <span className="ltr tnum">{answered}</span> מתוך <span className="ltr tnum">{QS.length}</span> שאלות
      </>
    ) : step === 2 ? (
      'כולל גלולות, ויטמינים ותוספי צמחים'
    ) : (
      'ההצהרה נשלחת רק לצוות המטפל בקליניקה'
    );

  return (
    <div className={styles.root}>
      {view === 'form' ? (
        <TopBar mode="flow" title="הצהרת בריאות" progress={{ step, total: TOTAL }} noBack={step === 1} onBack={() => step > 1 && !pending && go((step - 1) as Step)} {...closeProps} />
      ) : (
        <TopBar mode="flow" title="הצהרת בריאות" noBack {...closeProps} />
      )}
      <header className={`${styles.header} bf-desk-only`}>
        <div className={styles.headerBar}>
          {p.kiosk ? <Wordmark size={21} /> : <Link href="/" aria-label="BeautyFind" className={styles.brand}><Wordmark size={21} /></Link>}
          <span className={styles.flex1} />
          {!p.kiosk && (
            <Link href={bookingHref} className={styles.backLink}>
              <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 7H2M6 3 2 7l4 4" /></svg>
              <span>לפרטי התור</span>
            </Link>
          )}
        </div>
      </header>

      <div className={styles.wrap}>
        {view === 'form' && (
          <div className={styles.fade}>
            <p className="sr-only" aria-live="polite">{`שלב ${step} מתוך ${TOTAL}: ${STEP_NAMES[step]}`}</p>
            <div className={on(1)}>
              <h1 className={styles.h1}>הצהרת בריאות לפני הטיפול</h1>
              <p className={styles.lede}>כמה דקות של מילוי שחוסכות הפתעות בחדר הטיפול. התשובות מגיעות רק לצוות המטפל, ותשובת ״כן״ לא מבטלת את התור: היא מאפשרת להתכונן נכון.</p>
            </div>

            <div className={styles.shell}>
              <main className={styles.main}>
                <div ref={paneRef} className={styles.pane}>
                  <section aria-labelledby={`${ids}-h1`} className={`${styles.card} ${on(1)}`}>
                    <h2 id={`${ids}-h1`} className={styles.h2}>הפרטים שלכם</h2>
                    <dl className={styles.meDl}>
                      <dt>שם מלא</dt><dd className={styles.w700}>{p.client.name}</dd>
                      <dt>טלפון</dt><dd><span className="ltr tnum">{p.client.phone}</span></dd>
                    </dl>
                    <div className={styles.meFields}>
                      <label className={styles.field}>
                        <span>תאריך לידה <span className={styles.optional}>(לא חובה)</span></span>
                        <input type="date" dir="ltr" value={birthDate} onChange={e => setBirthDate(e.target.value)} className={styles.input} data-invalid={(tried && !birthOk) || undefined} max={new Date().toISOString().slice(0, 10)} />
                      </label>
                      <label className={styles.field}>
                        <span>4 ספרות אחרונות של ת״ז <span className={styles.optional}>(לא חובה)</span></span>
                        <input dir="ltr" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={4} value={idLast4} onChange={e => setIdLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="4821" className={`${styles.input} tnum`} data-invalid={(tried && !idOk) || undefined} />
                      </label>
                    </div>
                    <p className={styles.small}>
                      משהו לא נכון?{' '}
                      {p.client.accountHref ? <Link href={p.client.accountHref}>עדכון בחשבון</Link>
                        : p.clinicPhone ? <>חייגו לקליניקה <a href={p.clinicPhone.href} className="ltr">{p.clinicPhone.display}</a></>
                        : 'פנו לקליניקה'}
                    </p>
                  </section>

                  <section aria-labelledby={`${ids}-h2`} className={`${styles.card} ${on(1)}`}>
                    <div className={styles.qHead}>
                      <h2 id={`${ids}-h2`} className={styles.h2} style={{ margin: 0 }}>שאלון רפואי</h2>
                      <span className={`${styles.prog} ltr tnum`} data-state={allAns ? 'ok' : tried ? 'bad' : undefined}>{answered} / {QS.length}</span>
                    </div>
                    <p className={styles.qIntro}>{medical ? 'לטיפול בהזרקה. תשובות חיוביות עוברות לרופא/ה המטפל/ת לפני הטיפול.' : 'לטיפול קוסמטי. תשובות חיוביות עוברות למטפל/ת לפני הטיפול.'}</p>
                    <ul className={styles.qList}>
                      {QS.map(q => {
                        const v = ans[q.key];
                        const miss = tried && v == null;
                        return (
                          <li key={q.key} className={styles.q} data-yes={v === true || undefined}>
                            <div className={styles.qRow}>
                              <span className={styles.qText}>
                                <span className={styles.qLabel} id={`${ids}-${q.key}`}>{q.label}</span>
                                {q.note && <span className={styles.qNote}>{q.note}</span>}
                              </span>
                              <span role="radiogroup" aria-labelledby={`${ids}-${q.key}`} className={styles.yn}>
                                <button type="button" role="radio" aria-checked={v === true} data-yes={v === true || undefined} data-miss={miss || undefined} onClick={() => setAns(a => ({ ...a, [q.key]: true }))}>כן</button>
                                <button type="button" role="radio" aria-checked={v === false} data-no={v === false || undefined} data-miss={miss || undefined} onClick={() => setAns(a => ({ ...a, [q.key]: false }))}>לא</button>
                              </span>
                            </div>
                            {v === true && (
                              <textarea
                                aria-label={`פירוט: ${q.label}`}
                                value={detail[q.key] ?? ''}
                                maxLength={LIMITS.detail}
                                onChange={e => setDetail(d => ({ ...d, [q.key]: e.target.value }))}
                                rows={2}
                                placeholder={q.placeholder}
                                className={styles.detail}
                              />
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>

                  <section aria-labelledby={`${ids}-h3`} className={`${styles.card} ${on(2)}`}>
                    <h2 id={`${ids}-h3`} className={styles.h2} style={{ marginBottom: 3 }}>תרופות ותוספים קבועים</h2>
                    <p className={styles.qIntro} style={{ marginBottom: 11 }}>כולל גלולות, ויטמינים ותוספי צמחים: חלקם משפיעים על דימום ועל רגישות העור.</p>
                    <textarea
                      aria-label="תרופות ותוספים קבועים"
                      value={meds}
                      maxLength={LIMITS.meds}
                      onChange={e => { setMeds(e.target.value); setNoMeds(false); }}
                      rows={3}
                      placeholder="למשל: אלטרוקסין 50 מק״ג בבוקר, אומגה 3"
                      className={styles.meds}
                      data-invalid={(tried && !medsOk) || undefined}
                    />
                    <button type="button" aria-pressed={noMeds} className={styles.noMeds} data-on={noMeds || undefined} onClick={() => { setNoMeds(n => !n); if (!noMeds) setMeds(''); }}>אין תרופות קבועות</button>
                  </section>

                  <section aria-labelledby={`${ids}-h4`} className={`${styles.card} ${on(3)}`}>
                    <h2 id={`${ids}-h4`} className={styles.h2}>חתימה</h2>
                    <label className={styles.field} style={{ marginBottom: 12 }}>
                      <span>שם מלא כפי שבתעודת הזהות</span>
                      <input value={signName} maxLength={LIMITS.name} autoComplete="name" enterKeyHint="done" onChange={e => setSignName(e.target.value)} placeholder={p.client.name} className={styles.input} data-invalid={(tried && !nameValid) || undefined} />
                    </label>

                    {mode === 'drawn' ? (
                      <>
                        <div className={styles.padHead}>
                          <span id={`${ids}-pad`} className={styles.padLabel}>חתמו באצבע או בעכבר</span>
                          <button type="button" className={styles.ghost} onClick={() => pad.current?.clear()}>ניקוי</button>
                        </div>
                        <SignaturePad ref={pad} labelId={`${ids}-pad`} onInk={setInk} hasInk={ink > 0} invalid={tried && !sigOk} />
                        <p className={styles.rotate} aria-hidden="true">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="7" y="2.5" width="10" height="19" rx="2" transform="rotate(-90 12 12)" />
                            <path d="M4 7.5A8 8 0 0 1 9.5 3M9.5 3 7 2.2M9.5 3 8.6 5.4" />
                          </svg>
                          סיבוב המסך לחתימה
                        </p>
                      </>
                    ) : (
                      <>
                        <div className={styles.padHead}><span className={styles.padLabel}>חתימה בהקלדת שם מלא</span></div>
                        <div className={styles.typedPreview} data-invalid={(tried && !sigOk) || undefined} aria-hidden="true">{signName.trim() || p.client.name}</div>
                        <Checkbox checked={typedConsent} onToggle={() => setTypedConsent(v => !v)} invalid={tried && !typedConsent}
                          title="אני מאשר/ת שהשם שהקלדתי מהווה את חתימתי על ההצהרה" />
                      </>
                    )}
                    <button type="button" className={styles.linkBtn} onClick={() => { setMode(m => (m === 'drawn' ? 'typed' : 'drawn')); setInk(0); setTypedConsent(false); }}>
                      {mode === 'drawn' ? 'חתימה בהקלדת שם מלא' : 'חזרה לחתימה באצבע או בעכבר'}
                    </button>

                    <Checkbox checked={attest} onToggle={() => setAttest(v => !v)} invalid={tried && !attest}
                      title="אני מצהיר/ה שהפרטים נכונים ומלאים, ושאעדכן את הקליניקה על כל שינוי במצבי לפני הטיפול"
                      sub="מסירת מידע חלקי עלולה לסכן אתכם. אם משהו לא ברור, כתבו בשדה הפירוט" />
                  </section>
                </div>

                {/* Desktop: summary and submit in the page. The shell puts them in the action bar. */}
                {errorText && <p role="alert" className={`${styles.error} bf-desk-only`}>{errorText}</p>}

                <div className={`${styles.actions} bf-desk-only`}>
                  <button type="button" className={styles.primary} onClick={submit} disabled={pending} aria-busy={pending || undefined}>
                    {pending ? 'שולחים…' : 'חתימה ושליחה לקליניקה'}
                  </button>
                  {!p.kiosk && <button type="button" className={styles.secondary} onClick={saveDraft}>שמירה והמשך אחר כך</button>}
                </div>
              </main>
              {aside}
            </div>

            <ActionBar mobileOnly hint={barError ? undefined : hint} error={barError || undefined}>
              <button type="button" className={styles.barBtn} data-off={(step < TOTAL && !!stepBad) || undefined} onClick={next} disabled={pending} aria-busy={pending || undefined}>
                {step < TOTAL ? 'המשך' : pending ? 'שולחים…' : 'חתימה ושליחה לקליניקה'}
              </button>
            </ActionBar>
          </div>
        )}

        {view === 'reuse' && p.reusable && (
          <main className={styles.doneCard}>
            <h1 className={styles.h1done}>יש לכם הצהרת בריאות בתוקף</h1>
            <p className={styles.doneBody}>
              חתמתם על הצהרה בקליניקה ב־<span className="ltr tnum">{p.reusable.signedOn}</span>, והיא בתוקף עד <span className="ltr tnum">{p.reusable.validUntil}</span>.
              {' '}אם לא השתנה דבר במצבכם הבריאותי או בתרופות, אפשר לצרף אותה לתור הזה. אם משהו השתנה, עדכנו את התשובות.
            </p>
            {serverErr && <p role="alert" className={styles.error} style={{ marginBottom: 14 }}>{serverErr}</p>}
            <div className={styles.doneActions}>
              <button type="button" className={styles.primarySm} onClick={reuse} disabled={pending}>שימוש בהצהרה הקיימת</button>
              <button type="button" className={styles.secondarySm} onClick={reopen}>עדכון התשובות</button>
            </div>
          </main>
        )}

        {view === 'done' && done && (
          <main className={styles.doneCard}>
            <span aria-hidden="true" className={styles.doneIcon}><Tick size={27} /></span>
            <h1 className={styles.h1done}>ההצהרה נחתמה</h1>
            <p className={styles.doneBody}>
              ההצהרה תגיע אל {p.appt.who || 'הצוות המטפל'} לפני הטיפול{done.yes > 0 ? ', וייצרו איתכם קשר אם צריך להתאים משהו.' : '.'}
            </p>
            {done.yes > 0 && pregMedical && (
              <div role="status" className={styles.flag} style={{ marginBottom: 16 }}>
                <span className={styles.flagTitle}>{flagTitle}</span>
                <p>{flagBody}</p>
              </div>
            )}
            <dl className={styles.doneDl}>
              <dt>נחתמה</dt><dd><span className="ltr tnum">{done.signedAt}</span></dd>
              <dt>לטיפול</dt><dd>{p.appt.name}</dd>
              {done.yes >= 0 && <><dt>תשובות ״כן״</dt><dd>{done.yes ? `${plAnswers(done.yes)} · עם פירוט` : 'אין'}</dd></>}
              <dt>בתוקף</dt><dd>12 חודשים, או עד שינוי במצבכם</dd>
            </dl>
            <div className={styles.doneActions}>
              {p.kiosk ? (
                <p className={styles.small} style={{ margin: 0 }}>תודה. אפשר להחזיר את הטאבלט לקבלה.</p>
              ) : (
                <>
                  <Link href={bookingHref} className={styles.primarySm}>לפרטי התור</Link>
                  <button type="button" className={styles.secondarySm} onClick={reopen}>עדכון התשובות</button>
                </>
              )}
            </div>
          </main>
        )}

        {view === 'closed' && (
          <main className={styles.doneCard}>
            <h1 className={styles.h1done}>התור הזה כבר לא פתוח לחתימה</h1>
            <p className={styles.doneBody}>אם חל שינוי במצבכם הבריאותי, עדכנו את הקליניקה ישירות.</p>
            {!p.kiosk && <div className={styles.doneActions}><Link href={bookingHref} className={styles.primarySm}>לפרטי התור</Link></div>}
          </main>
        )}
      </div>

      {toast && <div role="status" className={styles.toast}>{toast}</div>}
    </div>
  );
}

function Checkbox({ checked, onToggle, invalid, title, sub }: { checked: boolean; onToggle: () => void; invalid?: boolean; title: string; sub?: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={onToggle} className={styles.check} data-on={checked || undefined} data-invalid={invalid || undefined}>
      <span aria-hidden="true" className={styles.box}>{checked && <Tick />}</span>
      <span className={styles.checkText}>
        <span className={styles.checkTitle}>{title}</span>
        {sub && <span className={styles.checkSub}>{sub}</span>}
      </span>
    </button>
  );
}
