'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { staffSignin } from './actions';
import styles from './StaffLogin.module.css';

const ERR = {
  bad_credentials: 'הדוא״ל או הסיסמה שגויים.',
  not_staff: 'לחשבון הזה אין הרשאת צוות. פנו למנהל המערכת כדי לקבל גישה.',
  locked: 'יותר מדי ניסיונות. החשבון נעול ל־15 דקות.',
} as const;

export function StaffLogin({ next, signedInAs, denied }: { next: string; signedInAs: string; denied: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string>(denied ? ERR.not_staff : '');
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return setError(ERR.bad_credentials);
    start(async () => {
      setError('');
      const r = await staffSignin({ email, password, next });
      if (r.ok) router.replace(r.redirectTo);
      else {
        setError(ERR[r.error]);
        setPassword('');
      }
    });
  };

  return (
    <div dir="rtl" lang="he" className={styles.root}>
      <main className={styles.wrap}>
        <div className={styles.brand}>
          <span dir="ltr" className={styles.mark}>beauty<span>find.</span></span>
          <span className={styles.badge}>ממשק ניהול</span>
        </div>
        <form className={styles.card} onSubmit={submit} noValidate>
          <h1 className={styles.h1}>כניסת צוות</h1>
          <p className={styles.lead}>לצוות BeautyFind בלבד. כל כניסה נרשמת ביומן הפעולות.</p>
          {signedInAs ? <p className={styles.info}>את/ה מחובר/ת כעת כ־<span dir="ltr">{signedInAs}</span>, חשבון ללא הרשאת צוות.</p> : null}

          <label className={styles.field}>
            דוא״ל
            <input
              className={styles.input} type="email" dir="ltr" autoComplete="username" inputMode="email" value={email}
              onChange={e => setEmail(e.target.value)} aria-invalid={error ? true : undefined} required
            />
          </label>
          <div className={styles.field}>
            <label htmlFor="staff-pw">סיסמה</label>
            <span className={styles.pwWrap}>
              <input
                id="staff-pw" className={styles.input} type={show ? 'text' : 'password'} dir="ltr" autoComplete="current-password" value={password}
                onChange={e => setPassword(e.target.value)} aria-invalid={error ? true : undefined} required
              />
              <button type="button" className={styles.eye} onClick={() => setShow(!show)} aria-pressed={show} aria-label={show ? 'הסתרת הסיסמה' : 'הצגת הסיסמה'}>
                {show ? 'הסתרה' : 'הצגה'}
              </button>
            </span>
          </div>

          {error ? <p role="alert" className={styles.error}>{error}</p> : null}
          <button type="submit" className={styles.submit} disabled={pending}>{pending ? 'נכנסים…' : 'כניסה לממשק הניהול'}</button>
          <p className={styles.small}>שכחתם סיסמה? <Link href="/login?role=biz&view=reset">איפוס סיסמה</Link></p>
        </form>
        <p className={styles.foot}>בעלי עסקים? <Link href="/login?role=biz">לכניסת עסקים</Link></p>
      </main>
    </div>
  );
}
