'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from 'react';
import { nisFromAgorot } from '@/lib/format';
import { ROUTES } from '@/lib/routes';
import { dowOf } from '@/lib/time';
import { Wordmark } from '../Wordmark';
import { ArrowGlyph, PhoneButton, Toast, WhatsAppButton, useToast } from './bits';
import { cancelByToken, loadRescheduleDays, rescheduleByToken, type ManageError } from './manage-actions';
import {
  CANCEL_REASONS, DOW_SHORT, dateText, dayMonth, downloadIcs, freeTxt, googleCalHref, hoursRows, keyOf, longDay, relUntil, timeOfIso, wazeHref,
  type CalEvent, type DaySlots, type ManageData,
} from './shared';
import s from './ManageBooking.module.css';

type View = 'view' | 'resched' | 'cancel' | 'done';
type Done = { kind: 'resched'; startsAt: string } | { kind: 'cancel'; late: boolean; refunded: number; hadDeposit: boolean };

const CHUNK_DAYS = 14;
const MAX_DAYS_AHEAD = 56;
const PAYMENT_POLL_MS = 3000;
const PAYMENT_POLL_TRIES = 6;

/** Hours in running text: digits go in an LTR span, 1 and 2 are words (שעה, שעתיים). */
function Hours({ n }: { n: number }) {
  if (n === 1) return <>שעה</>;
  if (n === 2) return <>שעתיים</>;
  return (
    <>
      <span className="ltr tnum">{n}</span> שעות
    </>
  );
}

/** "פחות מ־24 שעות" / "פחות משעתיים": the maqaf joins digits only. */
function LessThan({ n }: { n: number }) {
  return (
    <>
      פחות מ{n <= 2 ? '' : '־'}
      <Hours n={n} />
    </>
  );
}

/** Arrow keys move focus between the radios of a group (RTL: left = next). */
function radioKeys(e: KeyboardEvent<HTMLElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])')];
  if (!items.length) return;
  e.preventDefault();
  const i = items.indexOf(document.activeElement as HTMLElement);
  const n = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
  items[n].focus();
}

const PILL: Record<ManageData['status'], { text: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' }> = {
  pending_payment: { text: 'ממתין לתשלום דמי קדימה', tone: 'warn' },
  abandoned: { text: 'ההזמנה לא הושלמה', tone: 'neutral' },
  confirmed: { text: 'התור מאושר', tone: 'ok' },
  checked_in: { text: 'הגעת לקליניקה', tone: 'ok' },
  in_treatment: { text: 'בטיפול', tone: 'ok' },
  completed: { text: 'הטיפול הסתיים', tone: 'neutral' },
  cancelled_client: { text: 'התור בוטל', tone: 'bad' },
  cancelled_clinic: { text: 'הקליניקה ביטלה את התור', tone: 'bad' },
  no_show: { text: 'התור סומן כאי־הגעה', tone: 'bad' },
};

const MANAGE_ERRORS: Record<ManageError, string> = {
  not_found: 'התור לא נמצא. ייתכן שהקישור שגוי.',
  not_allowed: 'אי אפשר לשנות את התור הזה אונליין. אפשר לפנות לקליניקה בוואטסאפ או בטלפון.',
  slot_taken: 'השעה שבחרת נתפסה הרגע. בחרי שעה אחרת מהרשימה המעודכנת.',
  rate_limited: 'נעשו יותר מדי ניסיונות בשעה האחרונה. נסי שוב מאוחר יותר, או פני לקליניקה.',
  failed: 'משהו השתבש. נסי שוב בעוד רגע.',
};

export function ManageBooking({ data }: { data: ManageData }) {
  const router = useRouter();
  const { branch, deposit, policy } = data;
  const [view, setView] = useState<View>('view');
  const [done, setDone] = useState<Done | null>(null);
  const [days, setDays] = useState<DaySlots[]>([]);
  const [loadedTo, setLoadedTo] = useState(0);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast, flash } = useToast();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const lastView = useRef<View>('view');

  const key = keyOf(data.startsAt);
  const time = timeOfIso(data.startsAt);
  const win = policy.refundH;
  const late = data.hoursUntil < win;
  const depositPaid = deposit.state === 'paid';
  const depText = nisFromAgorot(deposit.agorot);

  // Focus follows the view; a status line announces it.
  useEffect(() => {
    if (view === lastView.current) return;
    lastView.current = view;
    headingRef.current?.focus();
  }, [view]);

  // Returning from the provider with ?paid=1 before its webhook landed: refresh a few times.
  const polls = useRef(0);
  useEffect(() => {
    if (data.paid !== '1' || data.status !== 'pending_payment' || polls.current >= PAYMENT_POLL_TRIES) return;
    const t = setTimeout(() => {
      polls.current += 1;
      router.refresh();
    }, PAYMENT_POLL_MS);
    return () => clearTimeout(t);
  }, [data.paid, data.status, router]);

  // ---------- Reschedule data ----------

  const loadMore = useCallback(
    async (offset: number) => {
      setLoadState('loading');
      try {
        const res = await loadRescheduleDays({ token: data.token, offset });
        if (!res.ok) {
          setLoadState('failed');
          return;
        }
        setDays(d => [...d.filter(x => x.date < res.days[0]?.date), ...res.days]);
        setLoadedTo(offset + CHUNK_DAYS);
        setLoadState('idle');
        return res.days;
      } catch {
        setLoadState('failed');
      }
    },
    [data.token],
  );

  const openResched = async () => {
    setError(null);
    setSlot(null);
    setView('resched');
    setDays([]);
    const fresh = await loadMore(0);
    const first = fresh?.find(d => d.slots.length > 0);
    setDayKey(first?.date ?? null);
  };

  const openDays = days.filter(d => d.open);
  const day = days.find(d => d.date === dayKey);

  // ---------- Actions ----------

  const confirmResched = () => {
    if (!slot) return;
    setError(null);
    startTransition(async () => {
      let res;
      try {
        res = await rescheduleByToken({ token: data.token, startsAt: slot });
      } catch {
        res = { ok: false as const, error: 'failed' as const };
      }
      if (res.ok) {
        setDone({ kind: 'resched', startsAt: slot });
        setView('done');
        router.refresh();
        return;
      }
      setError(MANAGE_ERRORS[res.error]);
      if (res.error === 'slot_taken') {
        setSlot(null);
        setDays([]);
        await loadMore(0);
      }
    });
  };

  const confirmCancel = () => {
    setError(null);
    startTransition(async () => {
      let res;
      try {
        res = await cancelByToken({ token: data.token, reason });
      } catch {
        res = { ok: false as const, error: 'failed' as const };
      }
      if (res.ok) {
        setDone({ kind: 'cancel', late: res.late, refunded: res.refunded, hadDeposit: depositPaid });
        setView('done');
        router.refresh();
        return;
      }
      setError(MANAGE_ERRORS[res.error]);
    });
  };

  const cal: CalEvent = {
    uid: `${data.ref}@beautyfind.co.il`,
    title: `${data.title} · ${branch.name}`,
    startsAt: data.startsAt,
    durationMin: data.durationMin,
    location: branch.address,
    details: `אסמכתא ${data.ref}. ניהול התור: ${data.manageUrl}`,
  };
  const addCal = () => {
    downloadIcs(cal, `${data.ref}.ics`);
    flash('קובץ יומן הורד, מתאים ל־Google, Outlook ו־iPhone');
  };

  // ---------- Pieces ----------

  const back = (
    <button type="button" className={s.back} onClick={() => { setError(null); setView('view'); }}>
      <ArrowGlyph size={13} back />
      חזרה לפרטי התור
    </button>
  );

  const errorBox = error && (
    <p className={s.error} role="alert">
      {error}
    </p>
  );

  const pill = PILL[data.status];
  const isFuture = data.hoursUntil > 0;
  const active = data.status === 'confirmed' || data.status === 'pending_payment' || data.status === 'checked_in' || data.status === 'in_treatment';

  // Notice after returning from the payment page.
  let paidNotice: ReactNode = null;
  if (data.paid === '1') {
    paidNotice =
      data.status === 'confirmed' ? (
        <div className={s.notice} data-tone="ok" role="status">
          <strong>התשלום התקבל והתור מאושר.</strong> אישור נשלח בוואטסאפ.
        </div>
      ) : data.status === 'pending_payment' ? (
        <div className={s.notice} data-tone="info" role="status">
          <strong>מאשרים את התשלום מול חברת הסליקה.</strong> הדף יתעדכן בעוד רגע.
        </div>
      ) : null;
  } else if (data.paid === '0' && (data.status === 'pending_payment' || data.status === 'abandoned')) {
    paidNotice = (
      <div className={s.notice} data-tone="bad" role="alert">
        <strong>התשלום לא הושלם.</strong>{' '}
        {deposit.holdUntil ? (
          <>
            השעה עדיין שמורה עבורך עד <span className="ltr tnum">{timeOfIso(deposit.holdUntil)}</span>, ואפשר לנסות שוב.
          </>
        ) : (
          'השעה שוחררה, ואפשר לקבוע תור חדש.'
        )}
      </div>
    );
  }

  // Status card for everything that isn't a plain confirmed booking.
  let statusCard: ReactNode = null;
  if (data.status === 'pending_payment' && deposit.holdUntil) {
    statusCard = (
      <section className={s.statusCard} data-tone="warn" aria-labelledby="mb-h-pay">
        <h2 id="mb-h-pay" className={s.statusTitle}>
          התור שמור עד <span className="ltr tnum">{timeOfIso(deposit.holdUntil)}</span>
        </h2>
        <p className={s.statusBody}>
          כדי לאשר את התור, יש להשלים את תשלום דמי הקדימה בסך <span className="ltr tnum">{depText}</span>. אם התשלום לא יושלם עד אז, השעה תשתחרר.
        </p>
        {deposit.checkoutUrl ? (
          <a href={deposit.checkoutUrl} className={s.primary}>
            השלמת התשלום
          </a>
        ) : (
          <p className={s.statusBody}>לא נמצא קישור תשלום פעיל. אפשר לפנות לקליניקה.</p>
        )}
      </section>
    );
  } else if (data.status === 'abandoned' || (data.status === 'pending_payment' && !deposit.holdUntil)) {
    statusCard = (
      <section className={s.statusCard} data-tone="neutral" aria-labelledby="mb-h-ab">
        <h2 id="mb-h-ab" className={s.statusTitle}>
          ההזמנה לא הושלמה
        </h2>
        <p className={s.statusBody}>תשלום דמי הקדימה לא הושלם בזמן, והשעה שוחררה. לא בוצע חיוב.</p>
        <Link href={branch.bookHref} className={s.primary}>
          לקביעת תור חדש
        </Link>
      </section>
    );
  } else if (data.status === 'cancelled_client' || data.status === 'cancelled_clinic') {
    const byClinic = data.status === 'cancelled_clinic';
    const body = byClinic
      ? deposit.state === 'refunding' || deposit.state === 'refunded'
        ? <>הקליניקה ביטלה את התור. המקדמה בסך <span className="ltr tnum">{depText}</span> מוחזרת במלואה לאמצעי התשלום המקורי תוך 7–10 ימי עסקים.</>
        : 'הקליניקה ביטלה את התור. לא בוצע חיוב.'
      : deposit.state === 'refunding'
        ? <>המקדמה בסך <span className="ltr tnum">{depText}</span> מוחזרת לאמצעי התשלום המקורי תוך 7–10 ימי עסקים, עם חשבונית זיכוי.</>
        : deposit.state === 'refunded'
          ? <>המקדמה בסך <span className="ltr tnum">{depText}</span> הוחזרה לאמצעי התשלום המקורי.</>
          : deposit.state === 'forfeited'
            ? 'התור בוטל פחות מהזמן שנקבע במדיניות, והמקדמה לא הוחזרה.'
            : 'לא בוצע חיוב.';
    statusCard = (
      <section className={s.statusCard} data-tone="neutral" aria-labelledby="mb-h-cx-st">
        <h2 id="mb-h-cx-st" className={s.statusTitle}>
          {byClinic ? 'הקליניקה ביטלה את התור' : 'התור בוטל'}
        </h2>
        <p className={s.statusBody}>{body}</p>
        <Link href={branch.bookHref} className={s.primary}>
          לקביעת תור חדש
        </Link>
      </section>
    );
  } else if (data.status === 'no_show') {
    statusCard = (
      <section className={s.statusCard} data-tone="neutral" aria-labelledby="mb-h-ns">
        <h2 id="mb-h-ns" className={s.statusTitle}>
          התור סומן כאי־הגעה
        </h2>
        <p className={s.statusBody}>
          {deposit.state === 'forfeited' ? 'לפי מדיניות הקליניקה, המקדמה לא מוחזרת. ' : ''}
          אם מדובר בטעות, אפשר לפנות לקליניקה בוואטסאפ או בטלפון.
        </p>
        <Link href={branch.bookHref} className={s.primary}>
          לקביעת תור חדש
        </Link>
      </section>
    );
  } else if (data.status === 'completed') {
    statusCard = (
      <section className={s.statusCard} data-tone="ok" aria-labelledby="mb-h-cp">
        <h2 id="mb-h-cp" className={s.statusTitle}>
          הטיפול הסתיים
        </h2>
        <p className={s.statusBody}>ההנחיות לימים שאחרי הטיפול זמינות כאן, ונשמח לשמוע איך היה.</p>
        <div className={s.statusActions}>
          <Link href={`/b/${data.token}/aftercare`} className={s.primary}>
            הנחיות אחרי הטיפול
          </Link>
          <Link href={`/review/${data.token}`} className={s.secondary}>
            כתיבת ביקורת
          </Link>
          <Link href={branch.bookHref} className={s.secondary}>
            קביעת תור נוסף
          </Link>
        </div>
      </section>
    );
  }

  // Pre-visit checklist.
  const prep: Array<{ mark: string; tone: 'ok' | 'warn' | 'teal' | 'muted'; name: ReactNode; note: ReactNode; href?: string; cta?: string }> = [];
  if (data.declaration === 'signed') {
    prep.push({ mark: '✓', tone: 'ok', name: 'הצהרת בריאות נחתמה', note: 'אפשר לעדכן עד תחילת הטיפול', href: `/b/${data.token}/declaration`, cta: 'לעדכון' });
  } else if (data.declaration === 'missing') {
    prep.push({ mark: '!', tone: 'warn', name: 'הצהרת בריאות ממתינה לחתימה', note: <>חובה לפני הטיפול · כ־<span className="ltr tnum">3</span> דקות</>, href: `/b/${data.token}/declaration`, cta: 'למילוי' });
  }
  if (depositPaid || deposit.state === 'applied') {
    prep.push({
      mark: '₪',
      tone: 'teal',
      name: <>שולמה מקדמה <span className="ltr tnum">{depText}</span></>,
      note: 'מתקזזת מהתשלום בקליניקה · הקבלה זמינה בקישור',
      href: `/b/${data.token}/receipt`,
      cta: 'לקבלה',
    });
  } else if (data.status !== 'pending_payment') {
    prep.push({ mark: '₪', tone: 'teal', name: 'תשלום בקליניקה', note: 'התשלום על הטיפול בסיום הביקור · חשבונית מס מהקליניקה' });
  }
  prep.push({
    mark: '10',
    tone: 'muted',
    name: <>להגיע <span className="ltr tnum">10</span> דקות לפני</>,
    note: branch.freeParking ? 'כדי שהתור יתחיל בזמן · חניה חינם במקום' : 'כדי שהתור יתחיל בזמן',
  });

  const actionCount = (data.canChange ? 1 : 0) + (data.status === 'confirmed' && isFuture ? 1 : 0) + (data.canCancel ? 1 : 0);

  // ---------- Views ----------

  const viewMain = (
    <div className={s.stack}>
      <div>
        <span className={s.pill} data-tone={pill.tone}>
          <span aria-hidden="true" className={s.pillDot} />
          {pill.text}
        </span>
        <h1 className={s.h1} ref={view === 'view' ? headingRef : undefined} tabIndex={-1}>
          {longDay(key)}, <span className="ltr tnum">{time}</span>
        </h1>
        <p className={s.rel}>
          {active && isFuture ? relUntil(data.hoursUntil) : dateText(key)} · {branch.name}
        </p>
      </div>

      {paidNotice}
      {statusCard}

      <section aria-label="פרטי התור" className={s.details}>
        <dl className={s.dl}>
          <dt>טיפול</dt>
          <dd className={s.ddStrong}>{data.title}</dd>
          <dt>משך</dt>
          <dd>
            כ־<span className="ltr tnum">{data.durationMin}</span> דקות
          </dd>
          {data.practitioner && (
            <>
              <dt>{data.practitioner.role || 'מטפלת'}</dt>
              <dd>{data.practitioner.name}</dd>
            </>
          )}
          <dt>כתובת</dt>
          <dd>{branch.address}</dd>
          <dt>אסמכתא</dt>
          <dd className={`${s.ddRef} ltr tnum`}>{data.ref}</dd>
        </dl>
        {(branch.whatsapp || branch.phone || branch.address) && (
          <div className={s.contact}>
            {branch.whatsapp && <WhatsAppButton e164={branch.whatsapp} text={`שלום ${branch.name}, לגבי התור שלי (אסמכתא ${data.ref}) ב־${dateText(key)} בשעה ${time}.`} />}
            {branch.phone && <PhoneButton e164={branch.phone} label="חיוג" />}
            <a href={wazeHref(branch.wazeUrl, branch.address)} target="_blank" rel="noopener noreferrer" className={s.waze}>
              ניווט ב־Waze
            </a>
          </div>
        )}
      </section>

      {active && (
        <section aria-labelledby="mb-h-prep" className={s.card}>
          <h2 id="mb-h-prep" className={s.h2}>
            לפני שמגיעים
          </h2>
          <ul className={s.prep}>
            {prep.map((p, i) => (
              <li key={i} className={s.prepItem}>
                <span aria-hidden="true" className={s.prepMark} data-tone={p.tone}>
                  {p.mark}
                </span>
                <span className={s.prepText}>
                  <span className={s.prepName}>{p.name}</span>
                  <span className={s.prepNote}>{p.note}</span>
                </span>
                {p.href && (
                  <Link href={p.href} className={s.prepCta}>
                    {p.cta}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {actionCount > 0 && (
        <>
          <div className={s.actions} data-count={actionCount}>
            {data.canChange && (
              <button type="button" className={s.actPrimary} onClick={openResched}>
                העברת מועד
              </button>
            )}
            {data.status === 'confirmed' && isFuture && (
              <button type="button" className={s.actGhost} onClick={addCal}>
                הוספה ליומן
              </button>
            )}
            {data.canCancel && (
              <button type="button" className={s.actDanger} onClick={() => { setError(null); setView('cancel'); }}>
                {data.status === 'pending_payment' ? 'ביטול ההזמנה' : 'ביטול התור'}
              </button>
            )}
          </div>
          {data.status === 'confirmed' && isFuture && (
            <p className={s.calNote}>
              מעדיפה Google Calendar?{' '}
              <a href={googleCalHref(cal)} target="_blank" rel="noopener noreferrer">
                הוספה ישירה ליומן Google
              </a>
            </p>
          )}
        </>
      )}
    </div>
  );

  const reschedMain = (
    <section aria-labelledby="mb-h-rs" className={s.card}>
      {back}
      <h1 id="mb-h-rs" ref={view === 'resched' ? headingRef : undefined} tabIndex={-1} className={s.h1Sm}>
        העברת מועד
      </h1>
      <p className={s.sub}>
        אותו טיפול{data.practitioner ? ` ואותה ${data.practitioner.role.startsWith('רופא') ? 'רופאה' : 'מטפלת'}` : ''}.{' '}
        {late ? (
          <>
            העברה <LessThan n={win} /> לפני התור נחשבת כביטול מאוחר.
          </>
        ) : (
          'העברה עכשיו, ללא חיוב.'
        )}
      </p>
      {errorBox}

      {loadState === 'failed' && openDays.length === 0 ? (
        <div className={s.empty}>
          <p className={s.emptyTitle}>לא הצלחנו לטעון את השעות הפנויות</p>
          <button type="button" className={s.soft} onClick={() => loadMore(0)}>
            נסי שוב
          </button>
        </div>
      ) : openDays.length === 0 && loadState === 'loading' ? (
        <div className={s.loading} aria-busy="true">
          טוענים שעות פנויות…
        </div>
      ) : (
        <>
          <div role="radiogroup" aria-label="בחירת יום" onKeyDown={radioKeys} className={s.days}>
            {openDays.map((d, i) => {
              const on = d.date === dayKey;
              const full = d.slots.length === 0;
              return (
                <button
                  key={d.date}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={`${longDay(d.date)}, ${freeTxt(d.slots.length, 'מלא')}`}
                  tabIndex={on || (!dayKey && i === 0) ? 0 : -1}
                  disabled={full}
                  className={s.day}
                  onClick={() => {
                    setDayKey(d.date);
                    setSlot(null);
                  }}
                >
                  <span className={s.dayDow}>{d.date === data.todayKey ? 'היום' : DOW_SHORT[dowOf(d.date)]}</span>
                  <span className={`${s.dayDm} ltr tnum`}>{dayMonth(d.date)}</span>
                  <span className={s.dayCount}>{freeTxt(d.slots.length, 'מלא')}</span>
                </button>
              );
            })}
            {loadedTo < MAX_DAYS_AHEAD && (
              <button type="button" className={s.moreDays} onClick={() => loadMore(loadedTo)} disabled={loadState === 'loading'}>
                {loadState === 'loading' ? 'טוענים…' : 'ימים נוספים'}
              </button>
            )}
          </div>

          {day && day.slots.length > 0 ? (
            <div role="radiogroup" aria-label="בחירת שעה" onKeyDown={radioKeys} className={s.slots}>
              {day.slots.map((x, i) => {
                const on = slot === x.startsAt;
                return (
                  <button key={x.startsAt} type="button" role="radio" aria-checked={on} tabIndex={on || (!slot && i === 0) ? 0 : -1} dir="ltr" className={s.slot} onClick={() => setSlot(x.startsAt)}>
                    {x.time}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className={s.sub}>{openDays.some(d => d.slots.length > 0) ? 'בחרי יום כדי לראות שעות פנויות.' : 'אין שעות פנויות בימים האלה. אפשר לטעון ימים נוספים או לפנות לקליניקה.'}</p>
          )}
        </>
      )}

      <button type="button" className={s.confirm} onClick={confirmResched} disabled={!slot || pending}>
        {pending ? 'מעבירים…' : slot ? `העברה ל${longDay(keyOf(slot))}, ${timeOfIso(slot)}` : 'בחרי שעה'}
      </button>
    </section>
  );

  const pol = data.status === 'pending_payment'
    ? { tone: 'ok', title: 'ביטול ללא חיוב', body: 'ההזמנה עוד לא שולמה, ולכן אין חיוב בביטול. השעה תשתחרר מיד.' as ReactNode }
    : late
      ? {
          tone: 'warn',
          title: <>ביטול מאוחר: <LessThan n={win} /> לפני התור</>,
          body: depositPaid
            ? <>המקדמה בסך <span className="ltr tnum">{depText}</span> לא מוחזרת לפי מדיניות הקליניקה. מסיבה רפואית? כתבי לקליניקה בוואטסאפ לפני הביטול.</>
            : 'הקליניקה רשאית לחייב דמי ביטול מאוחר. מסיבה רפואית? כתבי לקליניקה בוואטסאפ לפני הביטול.',
        }
      : {
          tone: 'ok',
          title: 'ביטול ללא חיוב',
          body: depositPaid
            ? <>המקדמה בסך <span className="ltr tnum">{depText}</span> תוחזר לאמצעי התשלום המקורי תוך 7–10 ימי עסקים, עם חשבונית זיכוי.</>
            : 'לא נגבה תשלום על התור הזה, ואין דמי ביטול.',
        };

  const cancelMain = (
    <section aria-labelledby="mb-h-cx" className={s.card}>
      {back}
      <h1 id="mb-h-cx" ref={view === 'cancel' ? headingRef : undefined} tabIndex={-1} className={`${s.h1Sm} ${s.h1Gap}`}>
        {data.status === 'pending_payment' ? 'ביטול ההזמנה' : 'ביטול התור'}
      </h1>
      <div className={s.policyBox} data-tone={pol.tone}>
        <span className={s.policyTitle}>{pol.title}</span>
        <p className={s.policyBody}>{pol.body}</p>
      </div>
      <h2 className={s.reasonH}>
        מה הסיבה? <span className={s.reasonNote}>· לא חובה, עוזר לקליניקה</span>
      </h2>
      <div className={s.reasons}>
        {CANCEL_REASONS.map(r => (
          <button key={r} type="button" aria-pressed={reason === r} className={s.reason} onClick={() => setReason(reason === r ? null : r)}>
            {r}
          </button>
        ))}
      </div>
      {errorBox}
      <div className={s.cancelRow}>
        <button type="button" className={s.cancelConfirm} onClick={confirmCancel} disabled={pending}>
          {pending ? 'מבטלים…' : 'אישור הביטול'}
        </button>
        {data.canChange && (
          <button type="button" className={s.cancelAlt} onClick={openResched} disabled={pending}>
            להעביר מועד במקום
          </button>
        )}
      </div>
    </section>
  );

  let doneMain: ReactNode = null;
  if (done?.kind === 'resched') {
    const carry = [depositPaid ? 'המקדמה' : null, data.declaration === 'signed' ? 'הצהרת הבריאות' : null].filter(Boolean) as string[];
    doneMain = (
      <div className={s.done} data-tone="ok">
        <h1 ref={view === 'done' ? headingRef : undefined} tabIndex={-1} className={s.doneTitle}>
          התור הועבר
        </h1>
        <p className={s.doneBody}>
          המועד החדש: {longDay(keyOf(done.startsAt))} בשעה <span className="ltr tnum">{timeOfIso(done.startsAt)}</span>. אישור נשלח בוואטסאפ
          {carry.length ? `, ו${carry.join(' ו')} ${carry.length > 1 ? 'עוברות' : 'עוברת'} איתך.` : '.'}
        </p>
        <div className={s.doneActions}>
          <button type="button" className={s.primary} onClick={() => { setDone(null); setView('view'); }}>
            לפרטי התור
          </button>
          <Link href={branch.profileHref} className={s.secondary}>
            לפרופיל הקליניקה
          </Link>
        </div>
      </div>
    );
  } else if (done?.kind === 'cancel') {
    const body =
      done.refunded > 0 ? (
        <>המקדמה בסך <span className="ltr tnum">{nisFromAgorot(done.refunded)}</span> תוחזר תוך 7–10 ימי עסקים, עם חשבונית זיכוי.</>
      ) : done.late && done.hadDeposit ? (
        'המקדמה לא מוחזרת לפי מדיניות הביטול.'
      ) : done.hadDeposit ? (
        'בקשת ההחזר על המקדמה הועברה לקליניקה.'
      ) : (
        'לא בוצע חיוב.'
      );
    doneMain = (
      <div className={s.done}>
        <h1 ref={view === 'done' ? headingRef : undefined} tabIndex={-1} className={s.doneTitle}>
          התור בוטל
        </h1>
        <p className={s.doneBody}>
          {body} השעה שוחררה, ותודה שעדכנת.
        </p>
        <div className={s.doneActions}>
          <Link href={branch.bookHref} className={s.primary}>
            לקביעת תור חדש
          </Link>
          <Link href={branch.profileHref} className={s.secondary}>
            לפרופיל הקליניקה
          </Link>
        </div>
      </div>
    );
  }

  // ---------- Aside ----------

  const rows = hoursRows(branch.hours);
  const aside = (
    <aside className={s.side}>
      <div className={s.sideCard}>
        <span className={s.sideLabel}>הקליניקה</span>
        <span className={s.sideName}>
          {branch.name} · {branch.cityName}
        </span>
        {rows.length > 0 && (
          <dl className={s.hours}>
            {rows.map(r => (
              <div key={r.day} className={s.hoursRow}>
                <dt>{r.day}</dt>
                <dd className={r.closed ? undefined : 'ltr tnum'}>{r.h}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <div className={s.sideCard}>
        <h2 className={s.sideH}>מדיניות ביטול</h2>
        <p className={s.sideText}>
          ביטול או העברה עד <Hours n={win} /> לפני התור: ללא חיוב{policy.depositOn ? ', והמקדמה מוחזרת' : ''}. בפחות מזה
          {policy.depositOn ? ', המקדמה לא מוחזרת' : ', הקליניקה רשאית לחייב'}. המדיניות נקבעת על ידי הקליניקה.
        </p>
        {(data.hasReceipt || data.status === 'completed') && (
          <p className={s.sideLinks}>
            {data.hasReceipt && <Link href={`/b/${data.token}/receipt`}>קבלה על המקדמה</Link>}
            {data.status === 'completed' && <Link href={`/b/${data.token}/aftercare`}>הנחיות אחרי הטיפול</Link>}
          </p>
        )}
        <p className={s.private}>הקישור הזה אישי ונשלח רק אלייך. אל תעבירי אותו הלאה.</p>
      </div>
    </aside>
  );

  return (
    <div className={s.root}>
      <header className={s.header}>
        <div className={s.headerIn}>
          <Link href="/" className={s.logo} aria-label="BeautyFind, לדף הבית">
            <Wordmark size={21} />
          </Link>
          <span className={s.spacer} />
          <Link href={ROUTES.login} className={s.login}>
            יש לך חשבון? כניסה
          </Link>
        </div>
      </header>

      <div className={s.wrap}>
        <div className={s.shell}>
          <main className={s.main}>
            {view === 'view' && viewMain}
            {view === 'resched' && reschedMain}
            {view === 'cancel' && cancelMain}
            {view === 'done' && doneMain}
          </main>
          {aside}
        </div>
      </div>

      <Toast text={toast} />
    </div>
  );
}
