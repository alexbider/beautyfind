'use client';

import { useState, useTransition } from 'react';
import { saveBillingDetails } from '@/app/biz/billing/actions';
import { EMAIL_RE } from '@/lib/format';
import s from './billing.module.css';

type Values = { companyNo: string; invoiceEmail: string; accountantEmail: string };

/** Company number and invoice addresses (Business.companyNo / invoiceEmail / accountantEmail). */
export function BillingDetails({ initial, canEdit }: { initial: Values; canEdit: boolean }) {
  const [v, setV] = useState<Values>(initial);
  const [saved, setSaved] = useState<Values>(initial);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, start] = useTransition();

  const hpBad = v.companyNo !== '' && !/^\d{9}$/.test(v.companyNo);
  const invBad = v.invoiceEmail.trim() !== '' && !EMAIL_RE.test(v.invoiceEmail.trim());
  const cpaBad = v.accountantEmail.trim() !== '' && !EMAIL_RE.test(v.accountantEmail.trim());
  const dirty = v.companyNo !== saved.companyNo || v.invoiceEmail !== saved.invoiceEmail || v.accountantEmail !== saved.accountantEmail;

  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = k === 'companyNo' ? e.target.value.replace(/\D/g, '').slice(0, 9) : e.target.value;
    setV(x => ({ ...x, [k]: val }));
    setDone(false);
    setError('');
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (hpBad) return setError('מספר ח.פ או עוסק מורשה צריך להכיל בדיוק 9 ספרות.');
    if (invBad || cpaBad) return setError('אחת מכתובות הדוא״ל אינה תקינה.');
    start(async () => {
      const r = await saveBillingDetails(v);
      if (r.ok) {
        setSaved(v);
        setDone(true);
        setTried(false);
      } else setError(r.error);
    });
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className={s.fields}>
        <label className={`${s.field} ${s.fieldNarrow}`}>
          <span>ח.פ / עוסק מורשה</span>
          <input
            type="text" dir="ltr" inputMode="numeric" autoComplete="off" value={v.companyNo} onChange={set('companyNo')}
            disabled={!canEdit} aria-invalid={tried && hpBad} className={`${s.input} ${s.inputBold}`}
          />
        </label>
        <label className={s.field}>
          <span>כתובת למשלוח חשבונית</span>
          <input
            type="email" dir="ltr" autoComplete="email" value={v.invoiceEmail} onChange={set('invoiceEmail')}
            disabled={!canEdit} aria-invalid={tried && invBad} className={s.input}
          />
        </label>
        <label className={s.field}>
          <span>משרד ראיית החשבון</span>
          <input
            type="email" dir="ltr" autoComplete="off" value={v.accountantEmail} onChange={set('accountantEmail')}
            disabled={!canEdit} aria-invalid={tried && cpaBad} className={s.input}
          />
        </label>
      </div>
      <p className={s.hint}>כשמוזנת כתובת של משרד ראיית החשבון, עותק מכל חשבונית נשלח אליה ישירות ביום החיוב.</p>
      {canEdit ? (
        <div className={s.saveRow}>
          <button type="submit" className={s.primary} disabled={busy || !dirty}>{busy ? 'שומר…' : 'שמירת הפרטים'}</button>
          {done ? (
            <span role="status" className={s.ok}>
              <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="#0B7A87" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2.8 7.6 6.6 11.4 15 3" />
              </svg>
              הפרטים נשמרו
            </span>
          ) : null}
          {error ? <p role="alert" className={s.error} style={{ margin: 0 }}>{error}</p> : null}
        </div>
      ) : null}
    </form>
  );
}
