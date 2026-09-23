'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { submitConsult } from '@/app/consult/[branch]/actions';
import { DRAFT_MAX_AGE, clearDraft, inShell, readDraft, scrollToField, scrollTop, writeDraft } from '@/components/booking/flow';
import { Check } from '@/components/icons';
import { ActionBar } from '@/components/shell/ActionBar';
import { haptic } from '@/components/shell/haptics';
import { TopBar } from '@/components/shell/TopBar';
import { IL_PHONE_RE } from '@/lib/format';
import { ROUTES } from '@/lib/routes';
import {
  AREAS, DAY_LETTERS, FLAGS, FORMATS, GOAL_MAX, GOAL_MIN, NAME_MAX, PRIOR, TIMES, WHY,
  type FlagKey, type FormatKey, type PriorKey, type SlotDay, type TimeKey,
} from './constants';
import { SlotPicker } from './SlotPicker';
import { LtrText, radioKeys, rove } from './ui';
import styles from './consult.module.css';

// Design: project/BeautyFind Consult Request.dc.html (side=patient)
// Desktop: one page with the doctor card beside it. App shell (spec §6): one step per screen,
// areas → goal → prior injections → format + slot → name, phone and consent, with a sticky action bar.

interface Props {
  branch: { id: string; name: string; place: string; profileHref: string };
  doctor: { name: string; license: string | null; specialty: string | null };
  treatment: { id: string; name: string } | null;
  fee: number; // whole shekels
  slots: SlotDay[];
  openDays: number[];
  prefill: { name: string; phone: string };
  signedIn: boolean;
}

type Done = { ref: string; scheduled: boolean; slot: string | null; manageHref: string | null; checkoutUrl: string | null };
type Area = (typeof AREAS)[number];
type Field = 'areas' | 'goal' | 'prior' | 'when' | 'name' | 'phone' | 'consent';
type Step = 1 | 2 | 3 | 4 | 5;

const TOTAL = 5;
const STEP_FIELDS: Record<Step, Field[]> = { 1: ['areas'], 2: ['goal'], 3: ['prior'], 4: ['when'], 5: ['name', 'phone', 'consent'] };
const STEP_NAMES: Record<Step, string> = { 1: 'אזורים', 2: 'מה חשוב לך', 3: 'הזרקות קודמות', 4: 'סוג פגישה ומועד', 5: 'פרטים ואישור' };
const stepOf = (f: Field) => (Number(Object.keys(STEP_FIELDS).find(k => STEP_FIELDS[Number(k) as Step].includes(f))) || 1) as Step;

/** Resumable answers (this device only). Medical flags are never stored. */
interface ConsultDraft {
  areas: Area[];
  goal: string;
  prior: PriorKey | null;
  format: FormatKey;
  slot: string | null;
  noFit: boolean;
  times: TimeKey[];
  days: number[];
  name: string;
  phone: string;
  step: Step;
}

export function ConsultForm({ branch, doctor, treatment, fee, slots, openDays, prefill, signedIn }: Props) {
  const router = useRouter();
  const [areas, setAreas] = useState<Area[]>([]);
  const [goal, setGoal] = useState('');
  const [prior, setPrior] = useState<PriorKey | null>(null);
  const [flags, setFlags] = useState<FlagKey[]>([]);
  const [format, setFormat] = useState<FormatKey>('clinic');
  const [slot, setSlot] = useState<string | null>(null);
  const [noFit, setNoFit] = useState(slots.length === 0);
  const [times, setTimes] = useState<TimeKey[]>([]);
  const [days, setDays] = useState<number[]>([]);
  const [name, setName] = useState(prefill.name);
  const [phone, setPhone] = useState(prefill.phone);
  const [consent, setConsent] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState('');
  const [done, setDone] = useState<Done | null>(null);
  const [toast, setToast] = useState('');
  const [step, setStep] = useState<Step>(1);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');

  const doneH = useRef<HTMLHeadingElement>(null);
  const errRef = useRef<HTMLParagraphElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const draftReady = useRef(false);
  const draftKey = `bf-consult-draft:${branch.id}`;
  const refs = {
    areas: useRef<HTMLDivElement>(null),
    goal: useRef<HTMLTextAreaElement>(null),
    prior: useRef<HTMLDivElement>(null),
    when: useRef<HTMLDivElement>(null),
    name: useRef<HTMLInputElement>(null),
    phone: useRef<HTMLInputElement>(null),
    consent: useRef<HTMLButtonElement>(null),
  };

  useEffect(() => {
    if (done) doneH.current?.focus();
  }, [done]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // ---------- Draft (spec §3.4): resume from the WhatsApp link ----------

  useEffect(() => {
    draftReady.current = true;
    const d = readDraft<ConsultDraft>(draftKey, DRAFT_MAX_AGE);
    if (!d) return;
    const known = <T,>(list: readonly T[], v: T[]) => v.filter(x => list.includes(x));
    if (Array.isArray(d.areas)) setAreas(known(AREAS, d.areas));
    if (typeof d.goal === 'string') setGoal(d.goal.slice(0, GOAL_MAX));
    if (d.prior && PRIOR.some(p => p.key === d.prior)) setPrior(d.prior);
    if (FORMATS.some(f => f.key === d.format)) setFormat(d.format);
    if (d.slot && slots.some(x => x.slots.some(s => s.startsAt === d.slot))) {
      setSlot(d.slot);
      setNoFit(false);
    } else if (d.noFit) setNoFit(true);
    if (Array.isArray(d.times)) setTimes(known(TIMES.map(t => t.key), d.times));
    if (Array.isArray(d.days)) setDays(d.days.filter(x => openDays.includes(x)));
    if (typeof d.name === 'string' && !prefill.name) setName(d.name.slice(0, NAME_MAX));
    if (typeof d.phone === 'string' && !prefill.phone) setPhone(d.phone.slice(0, 14));
    if (d.step >= 1 && d.step <= TOTAL) setStep(d.step);
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draftReady.current || done) return;
    const empty = !areas.length && !goal.trim() && !prior && step === 1;
    if (empty) clearDraft(draftKey);
    else writeDraft<ConsultDraft>(draftKey, { areas, goal, prior, format, slot, noFit, times, days, name, phone, step });
  }, [draftKey, areas, goal, prior, format, slot, noFit, times, days, name, phone, step, done]);

  // A slot that disappeared on refresh (taken by someone else) is no longer selected.
  const slotStillThere = !slot || slots.some(d => d.slots.some(s => s.startsAt === slot));
  const chosen = slotStillThere ? slot : null;

  const ok: Record<Field, boolean> = {
    areas: areas.length > 0,
    goal: goal.trim().length >= GOAL_MIN,
    prior: prior !== null,
    when: noFit ? times.length > 0 : chosen !== null,
    name: name.trim().length >= 2,
    phone: IL_PHONE_RE.test(phone.trim()),
    consent,
  };
  const ORDER: Field[] = ['areas', 'goal', 'prior', 'when', 'name', 'phone', 'consent'];
  const MSG: Record<Field, string> = {
    areas: 'בחרי לפחות אזור אחד',
    goal: 'ספרי במשפט מה היית רוצה שישתנה',
    prior: 'סמני אם היו הזרקות קודמות',
    when: noFit ? 'בחרי לפחות טווח שעות אחד' : 'בחרי מועד לייעוץ, או ״אף מועד לא מתאים״',
    name: 'כתבי שם מלא',
    phone: 'מספר הטלפון לא מלא',
    consent: 'יש לאשר העברת הפרטים לצוות הרפואי',
  };
  const firstBad = ORDER.find(k => !ok[k]);
  const stepBad = STEP_FIELDS[step].find(k => !ok[k]);
  const bad = (k: Field) => tried && !ok[k];
  const errorText = serverError || (tried && firstBad ? MSG[firstBad] : '');
  const barError = serverError || (tried && stepBad ? MSG[stepBad] : '');

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

  const focusField = (k: Field) => {
    const el = refs[k].current;
    if (!el) return;
    const target = el instanceof HTMLDivElement ? el.querySelector<HTMLElement>('button') : el;
    target?.focus({ preventScroll: true });
    scrollToField(el);
  };

  // ---------- Steps (app shell) ----------

  const go = (n: Step) => {
    setDir(n >= step ? 'fwd' : 'back');
    setStep(n);
    setTried(false);
    setServerError('');
    scrollTop();
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(`[data-head="${n}"]`)?.focus({ preventScroll: true }));
  };

  const next = () => {
    if (step === TOTAL) {
      void submit();
      return;
    }
    if (stepBad) {
      setTried(true);
      haptic('warning');
      requestAnimationFrame(() => focusField(stepBad));
      return;
    }
    go((step + 1) as Step);
  };

  /** In the shell only the current step shows; on desktop everything does. */
  const on = (...n: Step[]) => (n.includes(step) ? '' : styles.off);

  const submit = async () => {
    if (busy) return;
    setServerError('');
    if (firstBad) {
      setTried(true);
      haptic('warning');
      const at = stepOf(firstBad);
      if (inShell() && at !== step) {
        setDir('back');
        setStep(at);
      }
      requestAnimationFrame(() => focusField(firstBad));
      return;
    }
    setBusy(true);
    try {
      const res = await submitConsult({
        branchId: branch.id,
        treatmentId: treatment?.id ?? null,
        name: name.trim().slice(0, NAME_MAX),
        phone: phone.trim(),
        areas,
        goal: goal.trim(),
        prior: prior!,
        format,
        slot: noFit ? null : chosen,
        noFit,
        times: noFit ? times : [],
        days: noFit ? days : [],
        flags,
        consent: true,
      });
      if (res.ok) {
        clearDraft(draftKey);
        setDone(res);
        haptic('success');
        setToast(res.checkoutUrl ? 'המועד נשמר' : res.scheduled ? 'הייעוץ נקבע' : 'הבקשה נשלחה');
        window.scrollTo({ top: 0 });
        return;
      }
      haptic('warning');
      setServerError(res.message);
      if (res.code === 'slot_taken') {
        setSlot(null);
        if (inShell()) {
          setDir('back');
          setStep(4);
        }
        router.refresh(); // fresh availability
      }
      requestAnimationFrame(() => errRef.current?.focus({ preventScroll: inShell() }));
    } catch {
      haptic('warning');
      setServerError('השליחה נכשלה. בדקי את החיבור לאינטרנט ונסי שוב.');
      requestAnimationFrame(() => errRef.current?.focus({ preventScroll: inShell() }));
    } finally {
      setBusy(false);
    }
  };

  const formatDef = FORMATS.find(f => f.key === format)!;
  const priorIdx = PRIOR.findIndex(p => p.key === prior);
  const formatIdx = FORMATS.findIndex(f => f.key === format);

  if (done) {
    const whenText = done.slot ?? TIMES.filter(t => times.includes(t.key)).map(t => t.name).join(', ');
    const [title, body] = done.checkoutUrl
      ? ['המועד שמור לך', `כדי להשלים את קביעת הייעוץ יש לשלם את דמי הייעוץ, ₪${fee}, שמתקזזים מהטיפול. המועד נשמר לך ל־10 דקות.`]
      : done.scheduled
        ? [
            'הייעוץ נקבע',
            `אישור נשלח בוואטסאפ, עם קישור לניהול המועד. בייעוץ ייבדק אם ואיזה טיפול מתאים, ואם מתאים, אפשר לטפל באותו ביקור.${fee > 0 ? ` דמי הייעוץ, ₪${fee}, משולמים בקליניקה ומתקזזים מהטיפול.` : ''}`,
          ]
        : [
            `הבקשה נשלחה ל${doctor.name}`,
            'הקליניקה תחזור אלייך בוואטסאפ תוך יום עסקים עם הצעת מועד. אם יתברר שהטיפול לא מתאים, תקבלי הסבר, לא רק ״לא״.',
          ];
    return (
      <>
        <TopBar mode="flow" title="בקשת ייעוץ" noBack closeHref={branch.profileHref} />
        <div className={styles.flowBody}>
          <main className={styles.done}>
            <span aria-hidden="true" className={styles.doneRing}>
              <Check size={27} strokeWidth={2} />
            </span>
            <h1 ref={doneH} tabIndex={-1} className={styles.doneH}>{title}</h1>
            <p className={styles.doneBody}><LtrText text={body} /></p>
            <dl className={styles.doneFacts}>
              <dt>אזורים</dt>
              <dd>{areas.join(' · ')}</dd>
              <dt>ייעוץ</dt>
              <dd>
                {formatDef.name} · {done.slot ? <SlotText label={done.slot} /> : whenText}
              </dd>
              <dt>אסמכתא</dt>
              <dd><span className="ltr tnum">{done.ref}</span></dd>
            </dl>
            <div className={`${styles.row} ${styles.doneRow}`}>
              {done.checkoutUrl && (
                <a href={done.checkoutUrl} className={styles.btnLink}>
                  לתשלום&nbsp;<span className="ltr tnum">₪{fee}</span>
                </a>
              )}
              {!done.checkoutUrl && done.manageHref && <Link href={done.manageHref} className={styles.btnLink}>לניהול המועד</Link>}
              {signedIn && (
                <Link href={ROUTES.account} className={done.manageHref || done.checkoutUrl ? styles.btnGhostLink : styles.btnLink}>
                  לחשבון שלי
                </Link>
              )}
              <Link href={branch.profileHref} className={styles.btnGhostLink}>לפרופיל הקליניקה</Link>
            </div>
          </main>
        </div>
        {toast && <div role="status" className={styles.toast}>{toast}</div>}
      </>
    );
  }

  const nextLabel = step === TOTAL ? (busy ? 'שולחת…' : 'שליחת בקשת ייעוץ') : 'המשך';
  const hint: React.ReactNode =
    step === 1
      ? areas.length ? areas.join(' · ') : 'אפשר לבחור יותר מאזור אחד'
      : step === 2
        ? goal.trim().length >= GOAL_MIN ? 'אפשר להוסיף עוד פרטים, או להמשיך' : 'משפט או שניים מספיקים'
        : step === 3
          ? 'המידע עובר רק לצוות הרפואי של הקליניקה'
          : step === 4
            ? chosen ? <>נבחר מועד: <SlotLabel days={slots} startsAt={chosen} /></> : noFit ? 'הקליניקה תציע מועד לפי הזמנים שסימנת' : 'המועד נשמר לך מיד עם השליחה'
            : 'לא לדיוור · תשובה בוואטסאפ תוך יום עסקים';

  return (
    <div ref={rootRef}>
      <TopBar
        mode="flow"
        title="בקשת ייעוץ"
        progress={{ step, total: TOTAL }}
        noBack={step === 1}
        onBack={() => step > 1 && !busy && go((step - 1) as Step)}
        closeHref={branch.profileHref}
      />
      <p className="sr-only" aria-live="polite">{`שלב ${step} מתוך ${TOTAL}: ${STEP_NAMES[step]}`}</p>
      <div className={styles.flowBody}>
        <div className={on(1)}>
          <h1 className={styles.h1}>בקשת ייעוץ לפני הזרקה</h1>
          <p className={styles.lead}>
            בוטוקס וחומרי מילוי הם טיפול רפואי. לפני שקובעים טיפול, פגישה עם {doctor.name} מאפשרת לשמוע מה חשוב לך ולהחליט אם ובאיזו כמות זה מתאים.
          </p>
        </div>
        <div className={styles.shell}>
          <main className={styles.main}>
            <div key={step} className={styles.pane} data-dir={dir}>
              <section aria-labelledby="cs-h1" className={`${styles.card} ${on(1, 2)}`}>
                <div className={on(1)}>
                  <h2 id="cs-h1" data-head="1" tabIndex={-1} className={styles.h2}>על מה נרצה לדבר?</h2>
                  <p className={styles.hint}>אפשר לבחור יותר מאזור אחד.</p>
                  <div ref={refs.areas} role="group" aria-labelledby="cs-h1" className={styles.chips}>
                    {AREAS.map(a => (
                      <button
                        key={a}
                        type="button"
                        aria-pressed={areas.includes(a)}
                        onClick={() => setAreas(l => toggle(l, a))}
                        className={styles.chip}
                        data-invalid={bad('areas') || undefined}
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                </div>
                <label className={`${styles.field} ${styles.goalField} ${on(2)}`}>
                  <span data-head="2" tabIndex={-1} className={styles.goalLabel}>מה היית רוצה שישתנה?</span>
                  <textarea
                    ref={refs.goal}
                    value={goal}
                    onChange={e => setGoal(e.target.value.slice(0, GOAL_MAX))}
                    rows={3}
                    maxLength={GOAL_MAX}
                    placeholder="למשל: הקמט בין הגבות נראה כועס גם כשאני רגועה. רוצה משהו טבעי, לא קפוא."
                    aria-invalid={bad('goal') || undefined}
                    className={styles.textarea}
                  />
                </label>
              </section>

              <section aria-labelledby="cs-h2" className={`${styles.card} ${on(3)}`}>
                <h2 id="cs-h2" data-head="3" tabIndex={-1} className={`${styles.h2} ${styles.h2Gap}`}>הזרקות קודמות</h2>
                <div ref={refs.prior} role="radiogroup" aria-labelledby="cs-h2" onKeyDown={radioKeys} className={styles.chips}>
                  {PRIOR.map((p, i) => (
                    <button
                      key={p.key}
                      type="button"
                      role="radio"
                      aria-checked={prior === p.key}
                      tabIndex={rove(i, priorIdx)}
                      onClick={() => setPrior(p.key)}
                      className={styles.chip}
                      data-invalid={bad('prior') || undefined}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
                <h3 id="cs-h2b" className={styles.h3}>חשוב שנדע מראש</h3>
                <p className={styles.hintSm}>לא חובה. המידע עובר רק לצוות הרפואי של הקליניקה.</p>
                <div role="group" aria-labelledby="cs-h2b" className={styles.chips}>
                  {FLAGS.map(f => (
                    <button key={f.key} type="button" aria-pressed={flags.includes(f.key)} onClick={() => setFlags(l => toggle(l, f.key))} className={styles.chip}>
                      {f.name}
                    </button>
                  ))}
                </div>
                {FLAGS.filter(f => flags.includes(f.key)).map(f => (
                  <p key={f.key} className={styles.warn}>
                    <strong>{f.name}.</strong> {f.note}
                  </p>
                ))}
              </section>

              <section aria-labelledby="cs-h3" className={`${styles.card} ${on(4, 5)}`}>
                <div className={on(4)}>
                  <h2 id="cs-h3" data-head="4" tabIndex={-1} className={`${styles.h2} ${styles.h2Gap}`}>איך נוח לך להיפגש</h2>
                  <div role="radiogroup" aria-labelledby="cs-h3" onKeyDown={radioKeys} className={styles.formats}>
                    {FORMATS.map((f, i) => (
                      <button
                        key={f.key}
                        type="button"
                        role="radio"
                        aria-checked={format === f.key}
                        tabIndex={rove(i, formatIdx)}
                        onClick={() => setFormat(f.key)}
                        className={styles.format}
                      >
                        <span className={styles.formatName}>{f.name}</span>
                        <span className={styles.formatNote}>{f.note}</span>
                      </button>
                    ))}
                  </div>

                  <h3 className={styles.h3}>מועד לייעוץ</h3>
                  <p className={styles.hintSm}>מועדים פנויים ביומן של {doctor.name}. המועד נשמר לך מיד.</p>
                  <div ref={refs.when}>
                    {slots.length === 0 && (
                      <p className={styles.emptySlots}>
                        אין כרגע מועדים פנויים בשבועיים הקרובים. סמני מתי נוח לך, והקליניקה תציע מועד.
                      </p>
                    )}
                    <SlotPicker
                      days={slots}
                      value={noFit ? null : chosen}
                      onChange={v => {
                        setSlot(v);
                        setNoFit(false);
                      }}
                      invalid={bad('when') && !noFit}
                      label="מועד לייעוץ"
                      strip
                      after={
                        slots.length > 0 && (
                          <button
                            type="button"
                            aria-pressed={noFit}
                            onClick={() => {
                              setNoFit(n => !n);
                              setSlot(null);
                            }}
                            className={styles.noFit}
                          >
                            אף מועד לא מתאים
                          </button>
                        )
                      }
                    />
                    {noFit && (
                      <>
                        <span id="cs-times" className={styles.subLabel}>מתי בדרך כלל נוח לך? הקליניקה תציע מועד.</span>
                        <div role="group" aria-labelledby="cs-times" className={styles.chips}>
                          {TIMES.map(t => (
                            <button
                              key={t.key}
                              type="button"
                              aria-pressed={times.includes(t.key)}
                              onClick={() => setTimes(l => toggle(l, t.key))}
                              className={styles.chip}
                              data-invalid={bad('when') || undefined}
                            >
                              {t.name} <span className={`ltr tnum ${styles.chipRange}`}>{t.range}</span>
                            </button>
                          ))}
                        </div>
                        <span id="cs-days" className={styles.subLabel} style={{ marginTop: 12 }}>
                          ימים מועדפים <span className={styles.soft}>(לא חובה)</span>
                        </span>
                        <div role="group" aria-labelledby="cs-days" className={styles.chips}>
                          {openDays.map(d => (
                            <button
                              key={d}
                              type="button"
                              aria-pressed={days.includes(d)}
                              aria-label={`יום ${DAY_LETTERS[d]}`}
                              onClick={() => setDays(l => toggle(l, d))}
                              className={styles.chip}
                              style={{ minWidth: 44 }}
                            >
                              {DAY_LETTERS[d]}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className={on(5)}>
                  <h2 data-head="5" tabIndex={-1} className={`${styles.h2} ${styles.h2Gap} bf-shell-only`}>לאן לחזור אלייך</h2>
                  <div className={styles.fieldRow}>
                    <label className={styles.field}>
                      שם מלא
                      <input
                        ref={refs.name}
                        value={name}
                        onChange={e => setName(e.target.value)}
                        maxLength={NAME_MAX}
                        autoComplete="name"
                        enterKeyHint="next"
                        aria-invalid={bad('name') || undefined}
                        className={styles.input}
                      />
                    </label>
                    <label className={styles.field}>
                      טלפון לחזרה
                      <input
                        ref={refs.phone}
                        dir="ltr"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel-national"
                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                        placeholder="050-000-0000"
                        maxLength={14}
                        aria-invalid={bad('phone') || undefined}
                        className={`${styles.input} ${styles.inputPhone}`}
                      />
                    </label>
                  </div>
                </div>
              </section>

              <button
                ref={refs.consent}
                type="button"
                role="checkbox"
                aria-checked={consent}
                onClick={() => setConsent(c => !c)}
                className={`${styles.consent} ${on(5)}`}
                data-invalid={bad('consent') || undefined}
              >
                <span aria-hidden="true" className={styles.box}>{consent && <Check size={12} strokeWidth={2.2} />}</span>
                <span className={styles.consentText}>
                  <span className={styles.consentMain}>אני מאשרת שהפרטים יועברו לצוות הרפואי של הקליניקה לצורך הייעוץ</span>
                  <span className={styles.consentSub}>לא לדיוור · הצהרת בריאות מלאה תתבקש רק אם ייקבע טיפול</span>
                </span>
              </button>
            </div>

            {/* Desktop: summary and submit in the page. The shell puts them in the action bar. */}
            {errorText && (
              <p ref={errRef} tabIndex={-1} role="alert" className={`${styles.alert} bf-desk-only`}>{errorText}</p>
            )}
            <button type="button" onClick={submit} disabled={busy} aria-busy={busy || undefined} className={`${styles.primary} bf-desk-only`}>
              {busy ? 'שולחת…' : 'שליחת בקשת ייעוץ'}
            </button>
          </main>

          <aside className={`${styles.aside} ${on(1)}`}>
            <div className={styles.cardTeal}>
              <div className={styles.respHead}>
                <span className={styles.respKicker}>אחריות רפואית</span>
                <span className={styles.respName}>{doctor.name}</span>
                <span className={styles.respSub}>
                  {doctor.specialty ?? 'רופא/ה'}
                  {doctor.license && (
                    <>
                      {' · '}רישיון <span className="ltr tnum">{doctor.license}</span>
                    </>
                  )}
                </span>
              </div>
              <dl className={styles.facts}>
                {treatment && (
                  <>
                    <dt>טיפול</dt>
                    <dd>{treatment.name}</dd>
                  </>
                )}
                <dt>עלות ייעוץ</dt>
                <dd className={styles.strong}>
                  {fee > 0 ? (
                    <>
                      <span className="ltr tnum">₪{fee}</span> <span className={styles.soft}>· מתקזז מהטיפול</span>
                    </>
                  ) : (
                    'ללא עלות'
                  )}
                </dd>
                <dt>מענה</dt>
                <dd>תוך יום עסקים</dd>
                <dt>קליניקה</dt>
                <dd>{branch.place}</dd>
              </dl>
            </div>
            <div className={styles.whyCard}>
              <h2 className={styles.whyH}>למה ייעוץ ולא תור ישיר</h2>
              <ul className={styles.whyList}>
                {WHY.map(w => (
                  <li key={w}>
                    <span aria-hidden="true" className={styles.dot} />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
              <p className={styles.whyMore}>
                <Link href="/treatments/medical-aesthetics">עוד על טיפולי הזרקה</Link>
              </p>
            </div>
          </aside>
        </div>
      </div>

      <ActionBar mobileOnly hint={barError ? undefined : hint} error={barError || undefined}>
        <button type="button" className={styles.barBtn} data-off={(step < TOTAL && !!stepBad) || undefined} disabled={busy} aria-busy={busy || undefined} onClick={next}>
          {nextLabel}
        </button>
      </ActionBar>
      {toast && <div role="status" className={styles.toast}>{toast}</div>}
    </div>
  );
}

function SlotText({ label }: { label: string }) {
  const [letter, date, time] = label.split(' ');
  return (
    <>
      {letter} <span className="ltr tnum">{date}</span> <span className="ltr tnum">{time}</span>
    </>
  );
}

/** "ה׳ 24/09 10:30" for a chosen slot, numbers isolated LTR. */
function SlotLabel({ days, startsAt }: { days: SlotDay[]; startsAt: string }) {
  const d = days.find(x => x.slots.some(s => s.startsAt === startsAt));
  const t = d?.slots.find(s => s.startsAt === startsAt);
  if (!d || !t) return null;
  return <SlotText label={`${d.label} ${t.time}`} />;
}
