'use client';

import { useState, useTransition } from 'react';
import { openPortal, startCheckout } from '@/app/biz/billing/actions';
import s from './billing.module.css';

/** Card on file (or the button to add one) and the way into Stripe's portal for card changes and invoices. */
export function PaymentMethod({
  card, canEdit, hasCustomer, liveBranches, label,
}: {
  /** "Visa ·4242 · 08/28", or null when no card is saved. */
  card: string | null;
  canEdit: boolean;
  /** A Stripe customer exists, so the portal can open. */
  hasCustomer: boolean;
  liveBranches: number;
  /** Button text for the primary action. */
  label?: string;
}) {
  const [error, setError] = useState('');
  const [busy, start] = useTransition();

  const go = (fn: () => Promise<{ ok: boolean; url?: string; error?: string }>) =>
    start(async () => {
      setError('');
      const r = await fn();
      if (r.ok && r.url) window.location.assign(r.url);
      else if (!r.ok) setError(r.error ?? 'משהו השתבש. נסו שוב.');
    });

  return (
    <>
      {card ? (
        <p style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }} className="ltr">{card}</p>
      ) : (
        <p style={{ margin: '0 0 12px', fontSize: 13.5, color: 'var(--muted)', textWrap: 'pretty' }}>
          {liveBranches > 0
            ? 'עדיין לא נשמר כרטיס אשראי. התשלום מתבצע בעמוד מאובטח של Stripe, והחיוב הראשון יבוצע מיד עם השמירה.'
            : 'עדיין לא נשמר כרטיס אשראי. אפשר לשמור אותו כבר עכשיו בעמוד מאובטח של Stripe: לא יבוצע חיוב עד שהסניף הראשון יתפרסם.'}
        </p>
      )}
      {canEdit ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {card || hasCustomer ? (
            <button type="button" className={s.primary} disabled={busy} onClick={() => go(card ? openPortal : startCheckout)}>
              {busy ? 'פותח…' : label ?? (card ? 'ניהול אמצעי תשלום וחשבוניות' : 'הוספת כרטיס אשראי')}
            </button>
          ) : (
            <button type="button" className={s.primary} disabled={busy} onClick={() => go(startCheckout)}>
              {busy ? 'פותח…' : label ?? 'הוספת כרטיס אשראי'}
            </button>
          )}
          {card ? null : hasCustomer ? (
            <button type="button" className={s.ghost} disabled={busy} onClick={() => go(openPortal)}>חשבוניות קודמות</button>
          ) : null}
        </div>
      ) : null}
      {error ? <p className={s.error} role="alert">{error}</p> : null}
    </>
  );
}
