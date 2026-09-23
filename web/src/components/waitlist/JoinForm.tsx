'use client';

import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { FixedActionBar } from '@/components/review/FixedLayer';
import { haptic } from '@/components/shell/haptics';
import { IL_PHONE_RE } from '@/lib/format';
import { SHELL_MQ } from '@/lib/ui/shell';
import { DAYS, SPANS, TIMES, whenText, type SpanKey, type TimeRange } from './shared';
import { CheckIcon, HoldText, Ltr } from './ui';
import { Toast, useToast } from './toast';
import styles from './Waitlist.module.css';

// Design: project/BeautyFind Waitlist.dc.html (view=join)

export type JoinFormTreatment = { id: string; name: string; price: string; practitioners: { id: string; name: string }[] };

export type JoinActionInput = {
  branchId: string;
  treatmentId: string;
  days: number[];
  timeRanges: TimeRange[];
  span: SpanKey;
  practitionerId: string | null;
  name: string;
  phone: string;
};

export type JoinActionResult =
  | { ok: true; token: string; position: number; until: string; updated: boolean }
  | { ok: false; error: 'invalid' | 'prefs' | 'name' | 'phone' | 'not_found' | 'plan' | 'server' };

const ERRORS: Record<string, string> = {
  prefs: 'בחרי לפחות יום אחד וטווח שעות אחד',
  treatment: 'בחרי טיפול',
  staff: 'בחרי מטפלת, או סמני שגם מטפלת אחרת מתאימה',
  name: 'כתבי את השם שלך',
  phone: 'מספר הטלפון לא תקין',
  not_found: 'הטיפול הזה כבר לא זמין לרשימת המתנה. בחרי טיפול אחר.',
  plan: 'רשימת ההמתנה לא זמינה בקליניקה הזו',
  invalid: 'משהו בפרטים לא תקין. נסי שוב.',
  server: 'לא הצלחנו לשמור. נסי שוב בעוד רגע.',
};

type Field = 'prefs' | 'treatment' | 'staff' | 'name' | 'phone';

/** Where each field lives on the page, for "scroll to the first error". */
const FIELD_EL: Record<Field, string> = { treatment: 'wl-sec-t', prefs: 'wl-sec-d', staff: 'wl-sec-s', name: 'wl-name', phone: 'wl-phone' };

/** Scrolls the page (the scroll container) so the element sits under the top bar; never scrollIntoView. */
function scrollToEl(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const shell = window.matchMedia(SHELL_MQ).matches;
  const top = el.getBoundingClientRect().top + window.scrollY - (shell ? 56 + 16 : 24);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
  if (el instanceof HTMLInputElement) el.focus({ preventScroll: true });
}

export function JoinForm({
  branch,
  treatments,
  initialTreatmentId,
  holdMinutes,
  prefill,
  profileHref,
  join,
  leave,
}: {
  branch: { id: string; name: string; cityName: string };
  treatments: JoinFormTreatment[];
  initialTreatmentId: string | null;
  holdMinutes: number;
  prefill: { name: string; phone: string };
  profileHref: string;
  join: (input: JoinActionInput) => Promise<JoinActionResult>;
  leave: (token: string) => Promise<{ ok: boolean }>;
}) {
  const fixedTreatment = treatments.some(t => t.id === initialTreatmentId);
  const [treatmentId, setTreatmentId] = useState<string | null>(fixedTreatment ? initialTreatmentId : treatments.length === 1 ? treatments[0].id : null);
  const [days, setDays] = useState<number[]>([]);
  const [times, setTimes] = useState<TimeRange[]>([]);
  const [span, setSpan] = useState<SpanKey>('1m');
  const [anyStaff, setAnyStaff] = useState(true);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [name, setName] = useState(prefill.name);
  const [phone, setPhone] = useState(prefill.phone);
  const [tried, setTried] = useState(false);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const [done, setDone] = useState<(Extract<JoinActionResult, { ok: true }> & { days: number[]; times: TimeRange[] }) | null>(null);
  const [pending, start] = useTransition();
  const [toast, flash] = useToast();
  const doneRef = useRef<HTMLHeadingElement>(null);

  const treatment = treatments.find(t => t.id === treatmentId) ?? null;
  const staff = treatment?.practitioners ?? [];
  const canPickStaff = staff.length > 1;
  const chosenStaff = !anyStaff && canPickStaff ? staff.find(s => s.id === staffId) ?? null : null;

  const bad: Record<Field, boolean> = {
    prefs: !days.length || !times.length,
    treatment: !treatment,
    staff: !anyStaff && canPickStaff && !chosenStaff,
    name: name.trim().length < 2,
    phone: !IL_PHONE_RE.test(phone.trim()),
  };
  const firstBad = (['treatment', 'prefs', 'staff', 'name', 'phone'] as Field[]).find(f => bad[f]) ?? null;
  const show = (f: Field) => tried && bad[f];
  const error = tried && firstBad ? ERRORS[firstBad] : serverErr;

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

  const submit = () => {
    setServerErr(null);
    if (firstBad || !treatment) {
      setTried(true);
      haptic('warning');
      if (firstBad) scrollToEl(FIELD_EL[firstBad]);
      return;
    }
    start(async () => {
      let res: JoinActionResult;
      try {
        res = await join({
          branchId: branch.id,
          treatmentId: treatment.id,
          days,
          timeRanges: times,
          span,
          practitionerId: chosenStaff?.id ?? null,
          name: name.trim(),
          phone: phone.trim(),
        });
      } catch {
        res = { ok: false, error: 'server' };
      }
      if (!res.ok) {
        setServerErr(ERRORS[res.error] ?? ERRORS.server);
        return;
      }
      setDone({ ...res, days: [...days], times: [...times] });
      haptic('success');
      window.scrollTo({ top: 0 });
      flash(res.updated ? 'העדפות ההמתנה עודכנו' : 'הצטרפת לרשימת ההמתנה');
      requestAnimationFrame(() => doneRef.current?.focus());
    });
  };

  const doLeave = () => {
    if (!done) return;
    start(async () => {
      const r = await leave(done.token).catch(() => ({ ok: false }));
      if (!r.ok) {
        flash('לא הצלחנו להוציא אותך מהרשימה. נסי שוב.');
        return;
      }
      setDone(null);
      setTried(false);
      flash('יצאת מרשימת ההמתנה');
    });
  };

  if (done) {
    return (
      <div className={styles.fade}>
        <Toast text={toast} />
        <div className={`${styles.done} ${styles.doneFull}`}>
          <span aria-hidden="true" className={styles.doneIcon}>
            <CheckIcon size={26} />
          </span>
          <h1 className={styles.doneH} ref={doneRef} tabIndex={-1}>
            את ברשימת ההמתנה
          </h1>
          <p className={styles.doneP}>
            מקום <Ltr className={styles.num}>{done.position}</Ltr> ברשימה לטיפול הזה. נשלח וואטסאפ ברגע שיתפנה תור ב{whenText(done.days, done.times)}.
          </p>
          <dl className={styles.doneDl}>
            <dt>בתוקף עד</dt>
            <dd>
              <Ltr className={styles.num}>{done.until}</Ltr>
            </dd>
            <dt>שמירת תור</dt>
            <dd>
              <HoldText minutes={holdMinutes} /> מרגע ההודעה
            </dd>
          </dl>
          <div className={styles.actions}>
            <Link href={profileHref} className={styles.btn}>
              לפרופיל הקליניקה
            </Link>
            <button type="button" className={styles.btnGhost} onClick={doLeave} disabled={pending}>
              יציאה מהרשימה
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.fade}>
      <Toast text={toast} />
      <div className={styles.shell}>
        <div className={styles.main}>
          <div>
            <h1 className={styles.h1}>רשימת המתנה</h1>
            <p className={styles.lead}>
              כשמתפנה תור שמתאים לך, נשלח הודעת וואטסאפ עם קישור. התור נשמר לך <HoldText minutes={holdMinutes} />, ואחר כך עובר לבאה ברשימה.
            </p>
          </div>

          {!fixedTreatment && treatments.length > 1 && (
            <section id="wl-sec-t" aria-labelledby="wl-h0" className={styles.card}>
              <h2 id="wl-h0" className={styles.h2}>
                לאיזה טיפול?
              </h2>
              <div role="radiogroup" aria-labelledby="wl-h0" className={styles.chips}>
                {treatments.map(t => {
                  const on = t.id === treatmentId;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={`${styles.chip} ${on ? styles.on : ''} ${show('treatment') ? styles.bad : ''}`}
                      onClick={() => {
                        setTreatmentId(t.id);
                        setStaffId(null);
                      }}
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section id="wl-sec-d" aria-labelledby="wl-h1" className={styles.card}>
            <h2 id="wl-h1" className={styles.h2}>
              אילו ימים מתאימים?
            </h2>
            <div className={styles.days} role="group" aria-labelledby="wl-h1">
              {DAYS.map((d, i) => {
                const on = days.includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    className={`${styles.day} ${on ? styles.on : ''} ${tried && !days.length ? styles.bad : ''}`}
                    onClick={() => setDays(v => toggle(v, i))}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
            <h3 id="wl-h1b" className={styles.h3}>
              באילו שעות?
            </h3>
            <div className={styles.chips} role="group" aria-labelledby="wl-h1b">
              {TIMES.map(t => {
                const on = times.includes(t.key);
                return (
                  <button
                    key={t.key}
                    type="button"
                    aria-pressed={on}
                    className={`${styles.chip} ${on ? styles.on : ''} ${tried && !times.length ? styles.bad : ''}`}
                    onClick={() => setTimes(v => toggle(v, t.key))}
                  >
                    {t.name} <Ltr className={styles.chipRange}>{t.range}</Ltr>
                  </button>
                );
              })}
            </div>
          </section>

          <section id="wl-sec-s" aria-labelledby="wl-h2" className={styles.card}>
            <h2 id="wl-h2" className={styles.h2}>
              כמה זמן להמתין?
            </h2>
            <div role="radiogroup" aria-label="משך ההמתנה" className={styles.chips}>
              {SPANS.map(s => {
                const on = span === s.key;
                return (
                  <button key={s.key} type="button" role="radio" aria-checked={on} className={`${styles.chip} ${on ? styles.on : ''}`} onClick={() => setSpan(s.key)}>
                    {s.name}
                  </button>
                );
              })}
            </div>
            {canPickStaff && (
              <>
                <button type="button" role="checkbox" aria-checked={anyStaff} className={styles.check} onClick={() => setAnyStaff(v => !v)}>
                  <span aria-hidden="true" className={`${styles.box} ${anyStaff ? styles.boxOn : ''}`}>
                    {anyStaff && <CheckIcon />}
                  </span>
                  <span className={styles.checkText}>
                    <span className={styles.checkLabel}>גם מטפלת אחרת מתאימה לי</span>
                    <span className={styles.checkNote}>מגדיל את הסיכוי לקבל תור מהר יותר</span>
                  </span>
                </button>
                {!anyStaff && (
                  <>
                    <h3 id="wl-h2b" className={styles.h3}>
                      אצל מי?
                    </h3>
                    <div role="radiogroup" aria-labelledby="wl-h2b" className={styles.chips}>
                      {staff.map(s => {
                        const on = s.id === staffId;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            className={`${styles.chip} ${on ? styles.on : ''} ${show('staff') ? styles.bad : ''}`}
                            onClick={() => setStaffId(s.id)}
                          >
                            {s.name}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            )}
          </section>

          <section aria-labelledby="wl-h3" className={styles.card}>
            <h2 id="wl-h3" className={styles.h2}>
              לאן לשלוח את ההודעה?
            </h2>
            <div className={styles.fields}>
              <label className={styles.field}>
                שם
                <input
                  id="wl-name"
                  className={`${styles.input} ${show('name') ? styles.inputBad : ''}`}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  autoComplete="name"
                  enterKeyHint="next"
                  maxLength={80}
                  aria-invalid={show('name') || undefined}
                />
              </label>
              <label className={styles.field}>
                טלפון נייד (וואטסאפ)
                <input
                  id="wl-phone"
                  className={`${styles.input} ${styles.phone} ${show('phone') ? styles.inputBad : ''}`}
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  enterKeyHint="done"
                  placeholder="050-123-4567"
                  maxLength={16}
                  dir="ltr"
                  aria-invalid={show('phone') || undefined}
                />
              </label>
            </div>
          </section>

          {/* Desktop: summary and button in the column. Phones: the sticky action bar below. */}
          <div className={`${styles.deskSubmit} bf-desk-only`}>
            {error && (
              <p role="alert" className={styles.alert}>
                {error}
              </p>
            )}
            <button type="button" className={styles.primary} onClick={submit} disabled={pending}>
              {pending ? 'שומרת…' : 'הצטרפות לרשימה'}
            </button>
          </div>
        </div>

        <aside className={styles.aside} aria-label="פרטי ההמתנה">
          <div className={styles.asideHead}>
            <span className={styles.asideLabel}>ממתינה לתור</span>
            <span className={styles.asideName}>{treatment?.name ?? 'בחרי טיפול'}</span>
          </div>
          <dl className={styles.dl}>
            <dt>קליניקה</dt>
            <dd className={styles.strong}>
              {branch.name} · {branch.cityName}
            </dd>
            <dt>מטפלת</dt>
            <dd>{chosenStaff ? `${chosenStaff.name} בלבד` : 'כל מטפלת פנויה'}</dd>
            {treatment && (
              <>
                <dt>מחיר</dt>
                <dd>
                  {treatment.price} · לא כולל מע״מ
                </dd>
              </>
            )}
          </dl>
          <p className={styles.asideNote}>ההצטרפות לא מחייבת ואינה גובה מקדמה. המקדמה, אם הקליניקה דורשת, נגבית רק כשמאשרים תור.</p>
        </aside>
      </div>

      <FixedActionBar mobileOnly error={error} hint={error ? undefined : `${treatment?.name ?? 'בחרי טיפול'} · ${branch.name}`}>
        <button type="button" className={styles.primary} onClick={submit} disabled={pending}>
          {pending ? 'שומרת…' : 'הצטרפות לרשימה'}
        </button>
      </FixedActionBar>
    </div>
  );
}
