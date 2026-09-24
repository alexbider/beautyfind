'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { haptic } from '@/components/shell/haptics';
import { ROUTES } from '@/lib/routes';
import { clock, leavePath, minutesLeftText } from './shared';
import { Ltr } from './ui';
import styles from './Waitlist.module.css';

// Design: project/BeautyFind Waitlist.dc.html (view=offer). The hold timer counts down from the
// server's holdUntil; the server is the authority on expiry (it re-checks on accept and on reload).

export type OfferViewState = 'open' | 'accepted' | 'passed' | 'expired' | 'gone';

export type OfferViewData = {
  state: OfferViewState;
  relative: 'היום' | 'מחר' | null;
  weekday: string; // "יום ה׳"
  dateText: string; // "24/09"
  time: string; // "16:00"
  sub: string; // treatment · practitioner · clinic
  practitioner: string | null;
  holdUntil: number; // epoch ms
  serverNow: number; // epoch ms when the page rendered
  bookingPath: string | null;
  leaveToken: string | null;
};

export type AcceptActionResult = { ok: true; url: string } | { ok: false; error: 'not_found' | 'expired' | 'closed' | 'gone' | 'payments' | 'server' };
export type PassActionResult = { ok: true } | { ok: false; error: 'not_found' | 'expired' | 'closed' | 'server' };

const LOW_SECONDS = 300;

export function OfferView({
  token,
  data,
  accept,
  pass,
}: {
  token: string;
  data: OfferViewData;
  accept: (token: string) => Promise<AcceptActionResult>;
  pass: (token: string) => Promise<PassActionResult>;
}) {
  const router = useRouter();
  const [state, setState] = useState<OfferViewState>(data.state);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const skew = useRef(0);
  const [left, setLeft] = useState(() => Math.max(0, Math.round((data.holdUntil - data.serverNow) / 1000)));
  const [spoken, setSpoken] = useState(() => minutesLeftText(Math.max(0, (data.holdUntil - data.serverNow) / 1000)));
  const heading = useRef<HTMLHeadingElement>(null);

  // A server refresh (e.g. after expiry) brings a new state.
  useEffect(() => setState(data.state), [data.state]);

  useEffect(() => {
    if (state !== 'open') return;
    skew.current = data.serverNow - Date.now();
    let lastMinute = Math.ceil(left / 60);
    const tick = () => {
      const s = Math.max(0, Math.round((data.holdUntil - (Date.now() + skew.current)) / 1000));
      setLeft(s);
      const m = Math.ceil(s / 60);
      if (m !== lastMinute) {
        lastMinute = m;
        setSpoken(minutesLeftText(s));
      }
      if (s === 0) {
        clearInterval(iv);
        setState('expired');
        // Let the server close the offer and move it to the next person.
        router.refresh();
      }
    };
    const iv = setInterval(tick, 1000);
    tick();
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, data.holdUntil, data.serverNow]);

  useEffect(() => {
    if (state !== 'open') requestAnimationFrame(() => heading.current?.focus());
  }, [state]);

  const onAccept = () => {
    setErr(null);
    start(async () => {
      const r = await accept(token).catch((): AcceptActionResult => ({ ok: false, error: 'server' }));
      if (r.ok) {
        haptic('success');
        window.location.assign(r.url);
        return;
      }
      if (r.error === 'expired') setState('expired');
      else if (r.error === 'gone') setState('gone');
      else if (r.error === 'payments') setErr('לא הצלחנו לפתוח את תשלום המקדמה. נסו שוב או התקשרו לקליניקה.');
      else if (r.error === 'closed' || r.error === 'not_found') router.refresh();
      else setErr('משהו השתבש. נסו שוב בעוד רגע.');
    });
  };

  const onPass = () => {
    setErr(null);
    start(async () => {
      const r = await pass(token).catch((): PassActionResult => ({ ok: false, error: 'server' }));
      if (r.ok) {
        haptic('light');
        setState('passed');
      }
      else if (r.error === 'expired') setState('expired');
      else if (r.error === 'closed' || r.error === 'not_found') router.refresh();
      else setErr('משהו השתבש. נסו שוב בעוד רגע.');
    });
  };

  if (state !== 'open') {
    const when = (
      <>
        {data.weekday} <Ltr className={styles.num}>{data.dateText}</Ltr> בשעה <Ltr className={styles.num}>{data.time}</Ltr>
      </>
    );
    const r =
      state === 'accepted'
        ? {
            title: 'התור נקבע',
            body: (
              <>
                {when}
                {data.practitioner ? ` עם ${data.practitioner}` : ''}. אישור נשלח בוואטסאפ, ויצאתם מרשימת ההמתנה.
              </>
            ),
            cta: 'לפרטי התור',
            href: data.bookingPath ?? ROUTES.account,
          }
        : state === 'passed'
          ? { title: 'בסדר גמור', body: <>נשארתם ברשימה באותו מקום, ונעדכן אתכם כשיתפנה תור נוסף שמתאים להעדפות שלכם.</>, cta: 'לחשבון שלי', href: ROUTES.account }
          : state === 'gone'
            ? { title: 'התור כבר נתפס', body: <>מישהו אחר קבע את התור הזה רגע לפני כן. אתם עדיין ברשימה, ונעדכן אתכם כשיתפנה תור נוסף.</>, cta: 'לחשבון שלי', href: ROUTES.account }
            : { title: 'הזמן לשמירת התור עבר', body: <>התור הוצע לבאים ברשימה. אתם עדיין ברשימה, ונעדכן אתכם כשיתפנה תור נוסף.</>, cta: 'לחשבון שלי', href: ROUTES.account };
    return (
      <div className={styles.offerWrap}>
        <div className={`${styles.done} ${styles.plain}`}>
          <h1 className={styles.doneH} ref={heading} tabIndex={-1}>
            {r.title}
          </h1>
          <p className={styles.doneP}>{r.body}</p>
          <div className={styles.actions}>
            <Link href={r.href} className={styles.btn}>
              {r.cta}
            </Link>
            {state !== 'accepted' && data.leaveToken && (
              <Link href={leavePath(data.leaveToken)} className={styles.btnGhost}>
                יציאה מהרשימה
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  const low = left < LOW_SECONDS;
  return (
    <div className={styles.offerWrap}>
      <div className={styles.offer}>
        <div className={styles.offerHead}>
          <span className={styles.offerTitle}>התפנה תור בשבילכם</span>
          <span role="timer" aria-label="זמן שנותר לשמירת התור" dir="ltr" className={`${styles.timer} ${low ? styles.timerLow : ''}`}>
            {clock(left)}
          </span>
          <span className="sr-only" aria-live="polite" aria-atomic="true">
            {spoken}
          </span>
        </div>
        <div className={styles.offerBody}>
          <h1 className={styles.offerH1}>
            {data.relative ? (
              `${data.relative}, ${data.weekday}`
            ) : (
              <>
                {data.weekday} <Ltr className={styles.num}>{data.dateText}</Ltr>
              </>
            )}{' '}
            · <Ltr className={styles.num}>{data.time}</Ltr>
          </h1>
          <p className={styles.offerSub}>{data.sub}</p>
          <p className={styles.offerNote}>התור שמור עבורכם עד שהשעון יתאפס. אחר כך הוא יוצע לבאים ברשימה, ואתם תישארו ברשימה לתור הבא.</p>
          <div className={styles.offerBtns}>
            <button type="button" className={styles.accept} onClick={onAccept} disabled={pending}>
              {pending ? 'רגע…' : 'קביעת התור'}
            </button>
            <button type="button" className={styles.pass} onClick={onPass} disabled={pending}>
              לא מתאים הפעם
            </button>
          </div>
          {err && (
            <p role="alert" className={`${styles.alert} ${styles.offerErr}`}>
              {err}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
