'use client';

import Link from 'next/link';
import { BUSINESS_TYPES, LIMITS, type ContactInput, type FieldErrors } from '@/app/for-business/marketing/shared';
import styles from '@/app/for-business/marketing/marketing.module.css';

type Props = {
  value: ContactInput;
  errors: FieldErrors;
  onChange: (patch: Partial<ContactInput>) => void;
  /** Show the message box (quote requests). */
  withMessage?: boolean;
  messageLabel?: string;
  idPrefix: string;
};

/** Name, email, phone, business, type, city, site, message and consent, with a honeypot. */
export function ContactFields({ value: v, errors: e, onChange, withMessage, messageLabel, idPrefix }: Props) {
  const id = (k: string) => `${idPrefix}-${k}`;
  const field = (k: keyof ContactInput, label: string, opts: { type?: string; auto?: string; max?: number; optional?: boolean; dir?: 'ltr'; placeholder?: string } = {}) => (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id(k)}>
        {label} {opts.optional && <em>(לא חובה)</em>}
      </label>
      <input
        id={id(k)}
        className={styles.input}
        type={opts.type ?? 'text'}
        autoComplete={opts.auto}
        maxLength={opts.max}
        dir={opts.dir}
        placeholder={opts.placeholder}
        value={v[k] as string}
        aria-invalid={e[k] ? true : undefined}
        aria-describedby={e[k] ? id(`${k}-err`) : undefined}
        onChange={ev => onChange({ [k]: ev.target.value } as Partial<ContactInput>)}
      />
      {e[k] && <span id={id(`${k}-err`)} className={styles.err}>{e[k]}</span>}
    </div>
  );
  return (
    <>
      <div className={styles.formRow}>
        {field('name', 'שם מלא', { auto: 'name', max: LIMITS.name })}
        {field('business', 'שם העסק', { auto: 'organization', max: LIMITS.business })}
      </div>
      <div className={styles.formRow}>
        {field('phone', 'טלפון', { type: 'tel', auto: 'tel', max: LIMITS.phone, dir: 'ltr', placeholder: '050-0000000' })}
        {field('email', 'אימייל', { type: 'email', auto: 'email', max: LIMITS.email, dir: 'ltr' })}
      </div>
      <div className={styles.formRow}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={id('type')}>
            סוג העסק <em>(לא חובה)</em>
          </label>
          <select id={id('type')} className={styles.select} value={v.businessType} onChange={ev => onChange({ businessType: ev.target.value })}>
            <option value="">בחרו</option>
            {BUSINESS_TYPES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        {field('city', 'עיר', { auto: 'address-level2', max: LIMITS.city, optional: true })}
      </div>
      {field('website', 'אתר או אינסטגרם', { type: 'text', auto: 'url', max: LIMITS.website, optional: true, dir: 'ltr', placeholder: 'https://' })}
      {withMessage && (
        <div className={styles.field}>
          <label className={styles.label} htmlFor={id('message')}>
            {messageLabel ?? 'מה חשוב לכם שנדע?'} <em>(לא חובה)</em>
          </label>
          <textarea id={id('message')} className={styles.textarea} maxLength={LIMITS.message} value={v.message} onChange={ev => onChange({ message: ev.target.value })} />
        </div>
      )}
      <div className={styles.honey} aria-hidden="true">
        <label htmlFor={id('company_url')}>אתר החברה</label>
        <input id={id('company_url')} tabIndex={-1} autoComplete="off" value={v.company_url} onChange={ev => onChange({ company_url: ev.target.value })} />
      </div>
      <label className={styles.consent}>
        <input type="checkbox" checked={v.consent} onChange={ev => onChange({ consent: ev.target.checked })} aria-invalid={e.consent ? true : undefined} />
        <span>
          אני מאשר/ת ש־BeautyFind תיצור איתי קשר בנוגע לבקשה, לפי <Link href="/privacy">מדיניות הפרטיות</Link> ו<Link href="/terms">תנאי השימוש</Link>.
          {e.consent && <span className={styles.err}> {e.consent}</span>}
        </span>
      </label>
    </>
  );
}

/** First-touch attribution from the URL, kept for the session. */
export function readUtm(): Record<string, string> | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const keep = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
    const q = new URLSearchParams(window.location.search);
    const fromUrl: Record<string, string> = {};
    for (const k of keep) {
      const val = q.get(k);
      if (val) fromUrl[k] = val.slice(0, 200);
    }
    if (Object.keys(fromUrl).length) {
      sessionStorage.setItem('bf_utm', JSON.stringify(fromUrl));
      return fromUrl;
    }
    const saved = sessionStorage.getItem('bf_utm');
    return saved ? (JSON.parse(saved) as Record<string, string>) : undefined;
  } catch {
    return undefined;
  }
}
