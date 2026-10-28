'use client';

import { useState, useTransition } from 'react';
import { beginCheckout } from '@/app/for-business/marketing/actions';
import { emptyContact, type ContactInput, type FieldErrors } from '@/app/for-business/marketing/shared';
import styles from '@/app/for-business/marketing/marketing.module.css';
import { ArrowForward } from '@/components/icons';
import { ContactFields, readUtm } from './ContactFields';

/** Contact details, then off to Stripe Checkout. Prefilled for a signed-in owner. */
export function OrderForm({ service, packageKey, prefill, cta }: { service: string; packageKey: string; prefill?: Partial<ContactInput>; cta: string }) {
  const [v, setV] = useState<ContactInput>({ ...emptyContact(), ...prefill });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [leaving, setLeaving] = useState(false);

  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={e => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await beginCheckout({ service, packageKey, contact: v, utm: readUtm() });
          if (r.ok && r.url) {
            setLeaving(true);
            window.location.assign(r.url);
          } else if (!r.ok) {
            setError(r.message);
            setErrors(r.errors ?? {});
          }
        });
      }}
    >
      <ContactFields idPrefix={`o-${service}`} value={v} errors={errors} withMessage messageLabel="משהו שחשוב שנדע לפני שמתחילים?" onChange={p => setV(prev => ({ ...prev, ...p }))} />
      {error && (
        <div className={styles.formError} role="alert">
          {error}
        </div>
      )}
      <button type="submit" className={styles.ctaPrimary} disabled={pending || leaving}>
        <span>{pending || leaving ? 'פותחים את דף התשלום…' : cta}</span>
        {!(pending || leaving) && <ArrowForward />}
      </button>
    </form>
  );
}
