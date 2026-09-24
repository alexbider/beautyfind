'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { completeSetup } from './actions';
import styles from '../login/StaffLogin.module.css';

const ERR = {
  invalid_link: 'הקישור כבר שומש או שאינו תקף. היכנסו עם הסיסמה שבחרתם.',
  weak: 'הסיסמה צריכה להכיל לפחות 12 תווים.',
  mismatch: 'שתי הסיסמאות אינן זהות.',
} as const;

export function SetupForm({ token, email }: { token: string; email: string | null }) {
  const router = useRouter();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 12) return setError(ERR.weak);
    if (pw !== confirm) return setError(ERR.mismatch);
    start(async () => {
      const r = await completeSetup({ token, password: pw, confirm });
      if (r.ok) router.replace('/ops');
      else setError(ERR[r.error]);
    });
  };

  return (
    <div dir="rtl" lang="he" className={styles.root}>
      <main className={styles.wrap}>
        <div className={styles.brand}>
          <span dir="ltr" className={styles.mark}>beauty<span>find.</span></span>
          <span className={styles.badge}>ממשק ניהול</span>
        </div>
        {email ? (
          <form className={styles.card} onSubmit={submit} noValidate>
            <h1 className={styles.h1}>הגדרת סיסמת מנהל</h1>
            <p className={styles.lead}>
              לחשבון <span dir="ltr">{email}</span>. הקישור עובד פעם אחת בלבד.
            </p>
            <div className={styles.field}>
              <label htmlFor="pw1">סיסמה חדשה</label>
              <input id="pw1" className={styles.input} type="password" dir="ltr" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label htmlFor="pw2">אימות הסיסמה</label>
              <input id="pw2" className={styles.input} type="password" dir="ltr" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} />
            </div>
            <p className={styles.small} style={{ textAlign: 'start' }}>לפחות 12 תווים. מומלץ משפט קצר שקל לזכור ומנהל סיסמאות.</p>
            {error ? <p role="alert" className={styles.error}>{error}</p> : null}
            <button type="submit" className={styles.submit} disabled={pending}>{pending ? 'שומרים…' : 'שמירה וכניסה'}</button>
          </form>
        ) : (
          <div className={styles.card}>
            <h1 className={styles.h1}>הקישור אינו תקף</h1>
            <p className={styles.lead}>הקישור כבר שומש או שפג תוקפו. אם הסיסמה כבר הוגדרה, היכנסו כרגיל.</p>
            <Link href="/ops/login" className={styles.submit} style={{ display: 'grid', placeItems: 'center', textDecoration: 'none' }}>לכניסת צוות</Link>
          </div>
        )}
      </main>
    </div>
  );
}
