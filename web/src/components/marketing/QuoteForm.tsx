'use client';

import { useState, useTransition } from 'react';
import { requestQuote } from '@/app/for-business/marketing/actions';
import { emptyContact, type ContactInput, type FieldErrors } from '@/app/for-business/marketing/shared';
import styles from '@/app/for-business/marketing/marketing.module.css';
import { ArrowForward, Check } from '@/components/icons';
import { ContactFields, readUtm } from './ContactFields';

/** Quote request for one service. Shows the reference number on success. */
export function QuoteForm({ service, serviceName, packages = [], messageLabel, services }: { service: string; serviceName: string; packages?: { key: string; name: string }[]; messageLabel?: string; services?: { slug: string; name: string }[] }) {
  const [svc, setSvc] = useState(service);
  const [v, setV] = useState<ContactInput>(emptyContact);
  const [pkg, setPkg] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null | false>(false);
  const [pending, start] = useTransition();

  if (done !== false) {
    return (
      <div className={styles.success} role="status">
        <span className={styles.successIcon}>
          <Check size={22} />
        </span>
        <h3>הבקשה התקבלה</h3>
        <p>
          נחזור אליכם תוך יום עסקים אחד עם הצעה מסודרת{services ? '' : ` ל${serviceName}`}.
          {done && (
            <>
              {' '}
              מספר הבקשה: <strong className="ltr">{done}</strong>.
            </>
          )}
        </p>
        <p>שלחנו אישור גם למייל.</p>
      </div>
    );
  }

  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={e => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await requestQuote({ service: svc, packageKey: pkg || null, contact: v, utm: readUtm() });
          if (r.ok) setDone(r.ref);
          else {
            setError(r.message);
            setErrors(r.errors ?? {});
          }
        });
      }}
    >
      {services && services.length > 0 && (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="q-hub-service">
            באיזה שירות מדובר?
          </label>
          <select id="q-hub-service" className={styles.select} value={svc} onChange={e => setSvc(e.target.value)}>
            {services.map(x => (
              <option key={x.slug} value={x.slug}>{x.name}</option>
            ))}
          </select>
          <span className={styles.help}>מתעניינים בכמה שירותים? בחרו את העיקרי וכתבו את השאר בהודעה.</span>
        </div>
      )}
      {packages.length > 1 && (
        <div className={styles.field}>
          <span className={styles.label} id={`q-${service}-pkg`}>
            מה מעניין אתכם? <em>(לא חובה)</em>
          </span>
          <div className={styles.checks} role="radiogroup" aria-labelledby={`q-${service}-pkg`}>
            {[{ key: '', name: 'עוד לא יודעים' }, ...packages].map(p => (
              <label key={p.key || 'none'} className={styles.checkPill}>
                <input type="radio" name={`q-${service}-pkg`} checked={pkg === p.key} onChange={() => setPkg(p.key)} />
                <span>{p.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      <ContactFields idPrefix={`q-${service}`} value={v} errors={errors} withMessage messageLabel={messageLabel} onChange={p => setV(prev => ({ ...prev, ...p }))} />
      {error && (
        <div className={styles.formError} role="alert">
          {error}
        </div>
      )}
      <button type="submit" className={styles.ctaPrimary} disabled={pending}>
        <span>{pending ? 'שולחים…' : 'לקבלת הצעת מחיר'}</span>
        {!pending && <ArrowForward />}
      </button>
    </form>
  );
}
