'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { searchListings, sendClaimCode, submitClaim, verifyClaimCode } from '@/app/for-business/claim/actions';
import { CLAIM_METHODS, DEFAULT_DAYS, detailsOk, type ClaimMethod, type ListingHit } from '@/app/for-business/claim/shared';
import { nis } from '@/lib/format';
import { PLAN_MONTHLY_NIS } from '@/lib/pricing';
import { ROUTES } from '@/lib/routes';
import { revealFirstInvalid } from '../dashboard/media';
import { ArrowForward } from '../icons';
import { ActionBar } from '../shell/ActionBar';
import { haptic } from '../shell/haptics';
import { TopBar } from '../shell/TopBar';
import { ClaimFooter, ClaimHeader } from './ClaimChrome';
import { DetailsStep, type DetailsForm } from './DetailsStep';
import { DoneStep } from './DoneStep';
import { FindStep } from './FindStep';
import { VerifyStep, secondsLabel } from './VerifyStep';
import styles from './Claim.module.css';

type Step = 'find' | 'verify' | 'details' | 'done';

const STEPS: Array<{ key: Step; name: string; note: string }> = [
  { key: 'find', name: 'איתור העסק', note: 'חיפוש באינדקס' },
  { key: 'verify', name: 'אימות בעלות', note: 'קוד לטלפון או לדואר' },
  { key: 'details', name: 'פרטי העסק', note: 'תחומים, שעות, קשר' },
  { key: 'done', name: 'סיום', note: 'בדיקה ואישור' },
];

const SEARCH_DEBOUNCE_MS = 250;
const PRICE = nis(PLAN_MONTHLY_NIS.basic);

const EMPTY_FORM: DetailsForm = { bizName: '', address: '', phone: '', whatsapp: '', doctor: '', cats: [], days: DEFAULT_DAYS };

const COMMON_ERRORS: Record<string, ReactNode> = {
  claimed: 'לעסק הזה כבר יש בעלים מאומתים. אפשר לבקש מהבעלים הזמנה לצוות.',
  not_found: 'העסק לא נמצא או שאינו מפורסם כרגע.',
  no_target: 'אין פרטי קשר רשומים לדרך האימות הזו.',
  unauthorized: (
    <>
      פג תוקף ההתחברות. <Link href={`${ROUTES.bizLogin}&next=${encodeURIComponent(ROUTES.claim)}`}>התחברו שוב</Link> כדי להמשיך.
    </>
  ),
  failed: 'משהו השתבש. נסו שוב בעוד רגע.',
};

const cooldownMsg = (s: number) => <>אפשר לבקש קוד חדש בעוד {secondsLabel(s)}.</>;

const firstMethod = (h: ListingHit): ClaimMethod => CLAIM_METHODS.find(m => h.targets[m]) ?? 'sms';

// Draft (spec §3.4): the picked listing and the details form survive a reload or a later visit.
// Verification is never restored; it is re-done against the server.
const DRAFT_KEY = 'bf-claim-draft';
type Draft = { picked: ListingHit; form: DetailsForm };
function readDraft(): Draft | null {
  try {
    const d = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? 'null') as Partial<Draft> | null;
    return d?.picked?.id && d.form ? (d as Draft) : null;
  } catch {
    return null;
  }
}
function writeDraft(d: Draft | null) {
  try {
    if (d) window.localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Storage can be blocked (private mode). The draft is a convenience only.
  }
}

export function ClaimFlow({ initialHits, devCode }: { initialHits: ListingHit[]; devCode: string | null }) {
  const [step, setStep] = useState<Step>('find');
  const [touched, setTouched] = useState(false);

  // Find
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(initialHits);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [picked, setPicked] = useState<ListingHit | null>(null);

  // Verify
  const [method, setMethod] = useState<ClaimMethod>('sms');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<ReactNode | null>(null);
  const [sendError, setSendError] = useState<ReactNode | null>(null);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState<'send' | 'verify' | 'submit' | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(0);

  // Details and done
  const [form, setForm] = useState<DetailsForm>(EMPTY_FORM);
  const [submitError, setSubmitError] = useState<ReactNode | null>(null);
  const [refCode, setRefCode] = useState('');

  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [hydrated, setHydrated] = useState(false);

  // Resume a saved draft once: back at the verify step for the listing picked last time.
  useEffect(() => {
    const d = readDraft();
    if (d && !d.picked.claimed) {
      setPicked(d.picked);
      setMethod(firstMethod(d.picked));
      setForm({ ...EMPTY_FORM, ...d.form });
      setStep('verify');
    }
    setHydrated(true);
  }, []);
  const searchSeq = useRef(0);
  const lastQuery = useRef(q);
  const lastStep = useRef(step);

  // Debounced server search; stale responses are dropped.
  useEffect(() => {
    if (q === lastQuery.current) return;
    lastQuery.current = q;
    const id = ++searchSeq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await searchListings(q);
        if (id !== searchSeq.current) return;
        if (res.ok) setHits(res.hits);
        setSearchFailed(!res.ok);
      } catch {
        if (id === searchSeq.current) setSearchFailed(true);
      } finally {
        if (id === searchSeq.current) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  // Move focus to the new step's heading so screen readers follow the flow.
  useEffect(() => {
    if (step === lastStep.current) return;
    lastStep.current = step;
    headingRef.current?.focus();
  }, [step]);

  // Resend countdown.
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    setNow(Date.now());
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= cooldownUntil) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [cooldownUntil]);
  const cooldownLeft = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  const resetVerify = () => {
    setCodeSent(false);
    setCode('');
    setCodeError(null);
    setSendError(null);
    setVerified(false);
  };

  const pick = (h: ListingHit) => {
    if (picked?.id === h.id) return;
    setPicked(h);
    resetVerify();
    setMethod(firstMethod(h));
    setSubmitError(null);
    setForm({ ...EMPTY_FORM, bizName: h.name, ...h.prefill });
  };

  const pickMethod = (m: ClaimMethod) => {
    if (m === method) return;
    setMethod(m);
    resetVerify();
  };

  const sendCode = async () => {
    if (!picked || busy) return;
    setBusy('send');
    setSendError(null);
    setCodeError(null);
    try {
      const res = await sendClaimCode({ branchId: picked.id, method });
      if (res.ok) {
        setCodeSent(true);
        setCode('');
        setCooldownUntil(Date.now() + res.cooldownSeconds * 1000);
      } else if (res.error === 'cooldown') {
        const s = res.retryInSeconds ?? 30;
        setCooldownUntil(Date.now() + s * 1000);
        setSendError(cooldownMsg(s));
      } else {
        setSendError(COMMON_ERRORS[res.error]);
      }
    } catch {
      setSendError(COMMON_ERRORS.failed);
    } finally {
      setBusy(null);
    }
  };

  const checkCode = async () => {
    if (!picked || busy) return;
    if (code.length !== 6) {
      setCodeError('הזינו את כל שש הספרות של הקוד.');
      return;
    }
    setBusy('verify');
    setCodeError(null);
    try {
      const res = await verifyClaimCode({ branchId: picked.id, method, code });
      if (res.ok) {
        setVerified(true);
        setTouched(false);
        setStep('details');
        return;
      }
      const dev = devCode ? <> בהדגמה הזו הקוד הוא <span className="ltr">{devCode}</span>.</> : null;
      const msg: Record<string, ReactNode> = {
        invalid: <>הקוד שגוי. בדקו את הספרות ונסו שוב.{dev}</>,
        expired: 'הקוד פג תוקף. בקשו קוד חדש.',
        too_many_attempts: 'היו יותר מדי ניסיונות שגויים. בקשו קוד חדש.',
      };
      setCodeError(msg[res.error] ?? COMMON_ERRORS[res.error]);
    } catch {
      setCodeError(COMMON_ERRORS.failed);
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (!picked || busy) return;
    setBusy('submit');
    setSubmitError(null);
    try {
      const res = await submitClaim({ branchId: picked.id, ...form });
      if (res.ok) {
        haptic('success');
        setRefCode(res.ref);
        setStep('done');
        return;
      }
      if (res.error === 'duplicate') {
        setSubmitError(<>כבר שלחתם בקשה לעסק הזה, מספר הבקשה <span className="ltr">{res.ref}</span>. נעדכן אתכם כשהבדיקה תסתיים.</>);
      } else if (res.error === 'invalid') {
        setTouched(true);
        setSubmitError('יש שדות חובה שצריך להשלים');
      } else if (res.error === 'not_verified') {
        setVerified(false);
        setCodeSent(false);
        setCode('');
        setSubmitError('תוקף האימות פג. חזרו לשלב האימות ובקשו קוד חדש.');
      } else {
        setSubmitError(COMMON_ERRORS[res.error]);
      }
    } catch {
      setSubmitError(COMMON_ERRORS.failed);
    } finally {
      setBusy(null);
    }
  };

  const restart = () => {
    setStep('find');
    setTouched(false);
    setQ('');
    setHits(initialHits);
    setPicked(null);
    resetVerify();
    setForm(EMPTY_FORM);
    setSubmitError(null);
    setRefCode('');
  };

  useEffect(() => {
    if (!hydrated) return;
    if (step === 'done' || !picked) writeDraft(null);
    else writeDraft({ picked, form });
  }, [hydrated, step, picked, form]);

  const stepIndex = STEPS.findIndex(s => s.key === step);
  const goStep = (k: Step) => {
    setStep(k);
    setTouched(false);
    setSubmitError(null);
  };

  const hasTarget = !!picked && CLAIM_METHODS.some(m => picked.targets[m]);
  const formOk = detailsOk(form);
  const nextOk =
    step === 'find' ? !!picked && !picked.claimed : step === 'verify' ? verified : step === 'details' ? formOk && busy === null : true;

  const hint =
    step === 'find'
      ? picked?.claimed
        ? 'לעסק הזה כבר יש בעלים מאומתים'
        : picked
          ? 'אפשר להמשיך לאימות'
          : 'בחרו עסק מהרשימה, או פתחו פרופיל חדש'
      : step === 'verify'
        ? verified
          ? 'האימות הושלם'
          : hasTarget
            ? 'שלחו קוד ואמתו אותו כדי להמשיך'
            : 'לעסק אין פרטי קשר רשומים. אפשר לאמת במסמך'
        : formOk
          ? 'הפרטים יישמרו בפרופיל אחרי האישור'
          : 'יש שדות חובה שצריך להשלים';

  const next = () => {
    if (busy) return;
    if (!nextOk) {
      setTouched(true);
      haptic('warning');
      revealFirstInvalid(contentRef.current);
      return;
    }
    if (step === 'find') goStep('verify');
    else if (step === 'verify') goStep('details');
    else if (step === 'details') void submit();
  };

  const back = () => goStep(STEPS[Math.max(stepIndex - 1, 0)].key);

  const progress = Math.round(((stepIndex + (step === 'done' ? 1 : 0)) / STEPS.length) * 100);

  return (
    <div
      className={styles.root}
      onKeyDown={e => {
        if (e.key === 'Escape') setCodeError(null);
      }}
    >
      <TopBar
        mode="flow"
        title={step === 'done' ? 'הבקשה נשלחה' : STEPS[stepIndex].name}
        progress={step === 'done' ? undefined : { step: stepIndex + 1, total: STEPS.length - 1 }}
        noBack={stepIndex === 0 || step === 'done'}
        onBack={back}
        closeHref={step === 'done' ? ROUTES.dashboard : ROUTES.forBusiness}
      />
      <ClaimHeader progress={progress} />

      <main className={styles.main}>
        <div className={styles.layout}>
          <aside aria-label="שלבי התהליך" className={`${styles.rail} bf-desk-only`}>
            <div>
              <span className={styles.eyebrow}>
                <span aria-hidden="true" className={styles.eyebrowLine} />
                אישור בעלות
              </span>
              <h1 className={styles.h1}>
                העסק הזה שלכם<span className={styles.dot}>?</span>
              </h1>
            </div>
            <ol className={styles.steps}>
              {STEPS.map((st, i) => {
                const state = i === stepIndex ? 'current' : i < stepIndex ? 'done' : 'locked';
                // After submission the request is final, so earlier steps stay closed.
                const locked = state !== 'done' || step === 'done';
                return (
                  <li key={st.key}>
                    <button
                      type="button"
                      className={styles.stepBtn}
                      data-state={state}
                      disabled={locked && state !== 'current'}
                      aria-current={state === 'current' ? 'step' : undefined}
                      onClick={() => !locked && goStep(st.key)}
                    >
                      <span aria-hidden="true" className={styles.stepDot}>{state === 'done' ? '✓' : i + 1}</span>
                      <span className={styles.stepText}>
                        <span className={styles.stepName}>{st.name}</span>
                        <span className={styles.stepNote}>{st.note}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <div className={styles.railInfo}>
              <div className={styles.railInfoTitle}>מה זה נותן</div>
              <p>
                אישור בעלות פותח את הפרופיל לעריכה: תפריט מחירים, שעות, טלפון, WhatsApp, תמונות ותגובה לביקורות. האישור עצמו חינם; רישום מלא הוא{' '}
                <span className="ltr">{PRICE}</span> לחודש.
              </p>
              <Link href={ROUTES.listingStandards} className={styles.railLink}>
                תקן הרישום
                <ArrowForward size={13} />
              </Link>
            </div>
          </aside>

          <div ref={contentRef} className={styles.content} key={step} data-step-anim>
            {step === 'find' && (
              <FindStep
                headingRef={headingRef}
                q={q}
                onQuery={setQ}
                hits={hits}
                searching={searching}
                searchFailed={searchFailed}
                pickedId={picked?.id ?? null}
                onPick={pick}
              />
            )}
            {step === 'verify' && picked && (
              <VerifyStep
                headingRef={headingRef}
                picked={picked}
                method={method}
                onMethod={pickMethod}
                codeSent={codeSent}
                code={code}
                onCode={v => {
                  setCode(v);
                  setCodeError(null);
                }}
                codeError={codeError}
                sendError={sendError}
                busy={busy === 'submit' ? null : busy}
                cooldownLeft={cooldownLeft}
                onSend={sendCode}
                onCheck={checkCode}
              />
            )}
            {step === 'details' && (
              <DetailsStep headingRef={headingRef} form={form} touched={touched} onChange={patch => setForm(f => ({ ...f, ...patch }))} />
            )}
            {step === 'done' && <DoneStep headingRef={headingRef} bizName={form.bizName.trim() || picked?.name || ''} refCode={refCode} onRestart={restart} />}

            {step !== 'done' && (
              <>
                {submitError && (
                  <p role="alert" className={`${styles.submitError} bf-desk-only`}>{submitError}</p>
                )}
                <ActionBar mobileOnly hint={submitError ? undefined : hint} error={submitError ?? undefined}>
                  <button type="button" className={styles.next} onClick={next} aria-disabled={!nextOk} aria-busy={busy === 'submit'}>
                    <span>{step === 'details' ? 'שמירה וסיום' : 'המשך'}</span>
                  </button>
                </ActionBar>
                <div className={`${styles.stepNav} bf-desk-only`}>
                  <button
                    type="button"
                    className={styles.next}
                    onClick={next}
                    aria-disabled={!nextOk}
                    aria-busy={busy === 'submit'}
                    aria-describedby="claim-hint"
                  >
                    <span>{step === 'details' ? 'שמירה וסיום' : 'המשך'}</span>
                    <ArrowForward />
                  </button>
                  {stepIndex > 0 && (
                    <button type="button" className={styles.back} onClick={back}>חזרה</button>
                  )}
                  <span id="claim-hint" className={styles.hint} aria-live="polite">{hint}</span>
                </div>
              </>
            )}

            <p className={styles.mobileNote}>
              אישור בעלות פותח את הפרופיל לעריכה: מחירים, שעות, תמונות ותגובה לביקורות. האישור חינם; רישום מלא הוא <span className="ltr">{PRICE}</span> לחודש.{' '}
              <Link href={ROUTES.listingStandards}>תקן הרישום</Link>
            </p>
          </div>
        </div>
      </main>

      <ClaimFooter />
    </div>
  );
}
