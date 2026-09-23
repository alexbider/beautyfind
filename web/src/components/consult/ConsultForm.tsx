'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { submitConsult } from '@/app/consult/[branch]/actions';
import { Check } from '@/components/icons';
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

  const doneH = useRef<HTMLHeadingElement>(null);
  const errRef = useRef<HTMLParagraphElement>(null);
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
  const bad = (k: Field) => tried && !ok[k];
  const errorText = serverError || (tried && firstBad ? MSG[firstBad] : '');

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

  const focusField = (k: Field) => {
    const el = refs[k].current;
    if (!el) return;
    const target = el instanceof HTMLDivElement ? el.querySelector<HTMLElement>('button') : el;
    target?.focus();
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const submit = async () => {
    if (busy) return;
    setServerError('');
    if (firstBad) {
      setTried(true);
      focusField(firstBad);
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
        setDone(res);
        setToast(res.checkoutUrl ? 'המועד נשמר' : res.scheduled ? 'הייעוץ נקבע' : 'הבקשה נשלחה');
        window.scrollTo({ top: 0 });
        return;
      }
      setServerError(res.message);
      if (res.code === 'slot_taken') {
        setSlot(null);
        router.refresh(); // fresh availability
      }
      requestAnimationFrame(() => errRef.current?.focus());
    } catch {
      setServerError('השליחה נכשלה. בדקי את החיבור לאינטרנט ונסי שוב.');
      requestAnimationFrame(() => errRef.current?.focus());
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
      <main className={styles.done}>
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
        <div className={styles.row}>
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
        {toast && <div role="status" className={styles.toast}>{toast}</div>}
      </main>
    );
  }

  return (
    <>
      <h1 className={styles.h1}>בקשת ייעוץ לפני הזרקה</h1>
      <p className={styles.lead}>
        בוטוקס וחומרי מילוי הם טיפול רפואי. לפני שקובעים טיפול, פגישה עם {doctor.name} מאפשרת לשמוע מה חשוב לך ולהחליט אם ובאיזו כמות זה מתאים.
      </p>
      <div className={styles.shell}>
        <main className={styles.main}>
          <section aria-labelledby="cs-h1" className={styles.card}>
            <h2 id="cs-h1" className={styles.h2}>על מה נרצה לדבר?</h2>
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
            <label className={styles.field}>
              מה היית רוצה שישתנה?
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

          <section aria-labelledby="cs-h2" className={styles.card}>
            <h2 id="cs-h2" className={`${styles.h2} ${styles.h2Gap}`}>הזרקות קודמות</h2>
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

          <section aria-labelledby="cs-h3" className={styles.card}>
            <h2 id="cs-h3" className={`${styles.h2} ${styles.h2Gap}`}>איך נוח לך להיפגש</h2>
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

            <div className={styles.fieldRow}>
              <label className={styles.field}>
                שם מלא
                <input
                  ref={refs.name}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  maxLength={NAME_MAX}
                  autoComplete="name"
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
          </section>

          <button
            ref={refs.consent}
            type="button"
            role="checkbox"
            aria-checked={consent}
            onClick={() => setConsent(c => !c)}
            className={styles.consent}
            data-invalid={bad('consent') || undefined}
          >
            <span aria-hidden="true" className={styles.box}>{consent && <Check size={12} strokeWidth={2.2} />}</span>
            <span className={styles.consentText}>
              <span className={styles.consentMain}>אני מאשרת שהפרטים יועברו לצוות הרפואי של הקליניקה לצורך הייעוץ</span>
              <span className={styles.consentSub}>לא לדיוור · הצהרת בריאות מלאה תתבקש רק אם ייקבע טיפול</span>
            </span>
          </button>

          {errorText && (
            <p ref={errRef} tabIndex={-1} role="alert" className={styles.alert}>{errorText}</p>
          )}
          <button type="button" onClick={submit} disabled={busy} aria-busy={busy || undefined} className={styles.primary}>
            {busy ? 'שולחת…' : 'שליחת בקשת ייעוץ'}
          </button>
        </main>

        <aside className={styles.aside}>
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
      {toast && <div role="status" className={styles.toast}>{toast}</div>}
    </>
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
