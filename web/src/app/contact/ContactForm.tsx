'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { REASONS, reasonInfo, slaLine, type ContactReason } from '@/components/contact/reasons';
import { ArrowForward } from '@/components/icons';
import { ROUTES } from '@/lib/routes';
import { submitContact } from './actions';
import { FIELD_ERRORS, LIMITS, summaryError, validateContact, type FieldKey } from './shared';
import styles from './ContactForm.module.css';

export interface ContactPrefill {
  name: string;
  email: string;
  phone: string;
  extra: string;
  msg: string;
}

type Sent = { ref: string | null; reason: ContactReason; email: string };

const EMPTY = { name: '', email: '', phone: '', extra: '', msg: '' };

export function ContactForm({ initialReason, prefill }: { initialReason: ContactReason; prefill: ContactPrefill }) {
  const [reason, setReason] = useState<ContactReason>(initialReason);
  const [f, setF] = useState(prefill);
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [touched, setTouched] = useState<Partial<Record<FieldKey | 'all', boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [sent, setSent] = useState<Sent | null>(null);

  const refs = {
    name: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    phone: useRef<HTMLInputElement>(null),
    msg: useRef<HTMLTextAreaElement>(null),
    consent: useRef<HTMLInputElement>(null),
  };
  const sentHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (sent) sentHeading.current?.focus();
  }, [sent]);

  const r = reasonInfo(reason);
  const v = validateContact({ ...f, consent });
  const show = (k: FieldKey) => !!(touched[k] || touched.all) && !v[k];
  const touch = (k: FieldKey) => setTouched(t => ({ ...t, [k]: true }));
  const set = (k: keyof ContactPrefill) => (e: { target: { value: string } }) => setF(s => ({ ...s, [k]: e.target.value }));

  const pick = (key: ContactReason) => {
    setReason(key);
    setFormError('');
    // Keep ?reason= shareable without a navigation.
    try {
      const sp = new URLSearchParams(window.location.search);
      sp.set('reason', key);
      window.history.replaceState(null, '', `${window.location.pathname}?${sp.toString()}`);
    } catch {}
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const summary = summaryError(v);
    if (summary) {
      setTouched({ all: true });
      setFormError(summary);
      const first = (['name', 'email', 'phone', 'msg', 'consent'] as FieldKey[]).find(k => !v[k]);
      if (first) refs[first].current?.focus();
      return;
    }
    setBusy(true);
    setFormError('');
    try {
      const res = await submitContact({ reason, ...f, consent, website });
      if (res.ok) setSent({ ref: res.ref, reason: res.reason, email: res.email });
      else setFormError(res.message);
    } catch {
      setFormError('השליחה נכשלה. בדקו את החיבור לאינטרנט ונסו שוב.');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setSent(null);
    setF(EMPTY);
    setConsent(false);
    setTouched({});
    setFormError('');
  };

  if (sent) {
    const sr = reasonInfo(sent.reason);
    return (
      <div role="status" className={styles.sent}>
        <span aria-hidden="true" className={styles.sentIcon}>
          <svg width="22" height="22" viewBox="0 0 18 18" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.8 7.6 6.6 11.4 15 3" />
          </svg>
        </span>
        <h2 ref={sentHeading} tabIndex={-1} className={styles.sentH}>הפנייה נשלחה</h2>
        <p className={styles.sentLine}>{sr.sent}</p>
        {sent.ref && (
          <p className={styles.sentRef}>
            מספר הפנייה <span className="ltr">{sent.ref}</span> · {slaLine(sent.reason)}
          </p>
        )}
        <p className={styles.sentNote}>
          שלחנו אישור ל<span className="ltr">{sent.email}</span>. אם לא הגיע בתוך כמה דקות, כדאי לבדוק בתיקיית הספאם.
        </p>
        <button type="button" onClick={reset} className={styles.again}>שליחת פנייה נוספת</button>
      </div>
    );
  }

  const err = (k: Exclude<FieldKey, 'consent'>) =>
    show(k) ? (
      <span id={`err-${k}`} className={styles.err}>{FIELD_ERRORS[k]}</span>
    ) : null;
  const described = (k: FieldKey, extra?: string) => [show(k) ? `err-${k}` : '', extra ?? ''].filter(Boolean).join(' ') || undefined;
  const msgLen = f.msg.trim().length;

  return (
    <form onSubmit={onSubmit} noValidate className={styles.form} aria-busy={busy || undefined}>
      <fieldset className={styles.reasons}>
        <legend className={styles.legend}>סוג הפנייה</legend>
        <div className={styles.reasonGrid}>
          {REASONS.map(x => {
            const on = x.key === reason;
            return (
              <button key={x.key} type="button" aria-pressed={on} onClick={() => pick(x.key)} className={styles.reason} data-on={on || undefined}>
                <span className={styles.reasonName}>{x.name}</span>
                <span className={styles.reasonHint}>{x.hint}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Honeypot: off-screen, skipped by keyboard and screen readers. */}
      <div className={styles.hp} aria-hidden="true">
        <label>
          אתר
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} />
        </label>
      </div>

      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.label}>
            שם מלא <span aria-hidden="true" className={styles.req}>*</span>
          </span>
          <input
            ref={refs.name} type="text" value={f.name} onChange={set('name')} onBlur={() => touch('name')} autoComplete="name"
            maxLength={LIMITS.name} required aria-invalid={show('name')} aria-describedby={described('name')} className={styles.input}
          />
          {err('name')}
        </label>
        <label className={styles.field}>
          <span className={styles.label}>
            דואר אלקטרוני <span aria-hidden="true" className={styles.req}>*</span>
          </span>
          <input
            ref={refs.email} type="email" dir="ltr" value={f.email} onChange={set('email')} onBlur={() => touch('email')} autoComplete="email"
            inputMode="email" maxLength={LIMITS.email} required aria-invalid={show('email')} aria-describedby={described('email')}
            className={`${styles.input} ${styles.inputLtr}`}
          />
          {err('email')}
        </label>
        <label className={styles.field}>
          <span className={styles.label}>
            טלפון <span className={styles.optional}>(לא חובה)</span>
          </span>
          <input
            ref={refs.phone} type="tel" dir="ltr" value={f.phone} onChange={set('phone')} onBlur={() => touch('phone')} autoComplete="tel"
            inputMode="tel" placeholder="050-0000000" maxLength={LIMITS.phone} aria-invalid={show('phone')} aria-describedby={described('phone')}
            className={`${styles.input} ${styles.inputLtr}`}
          />
          {err('phone')}
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{r.extraLabel}</span>
          <input type="text" value={f.extra} onChange={set('extra')} placeholder={r.extraPh} maxLength={LIMITS.extra} className={styles.input} />
        </label>
      </div>

      <label className={styles.field}>
        <span className={styles.label}>
          הפנייה <span aria-hidden="true" className={styles.req}>*</span>
        </span>
        <span id="msg-hint" className={styles.hint}>{r.msgHint}</span>
        <textarea
          ref={refs.msg} value={f.msg} onChange={set('msg')} onBlur={() => touch('msg')} rows={6} maxLength={LIMITS.msgMax} required
          aria-invalid={show('msg')} aria-describedby={described('msg', 'msg-hint')} className={styles.textarea}
        />
        <span className={styles.msgFoot}>
          {err('msg')}
          <span aria-hidden="true" className={`${styles.count} ltr`}>
            {msgLen} / {LIMITS.msgMin}
          </span>
        </span>
      </label>

      <label className={styles.consent}>
        <input ref={refs.consent} type="checkbox" checked={consent} onChange={e => { setConsent(e.target.checked); setFormError(''); }} aria-invalid={!!touched.all && !consent} />
        <span>
          קראתי את <Link href={ROUTES.privacy} className={styles.consentLink}>מדיניות הפרטיות</Link> ואני מאשר/ת שתפנו אליי בנוגע לפנייה הזו. הפרטים לא ישמשו לשליחת דיוור שיווקי.
        </span>
      </label>

      <div className={styles.submitRow}>
        <button type="submit" disabled={busy} className={styles.submit}>
          <span>{busy ? 'שולח…' : 'שליחת הפנייה'}</span>
          {!busy && <ArrowForward />}
        </button>
        <span className={styles.sla}>{slaLine(reason)}</span>
      </div>

      {formError && (
        <div role="alert" className={styles.formError}>
          <svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="#A8432C" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="10" cy="10" r="7.6" />
            <path d="M10 6v4.4M10 13.6v.2" />
          </svg>
          <p>{formError}</p>
        </div>
      )}
    </form>
  );
}
