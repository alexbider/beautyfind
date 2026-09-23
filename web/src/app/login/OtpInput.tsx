'use client';

import { useEffect, useRef } from 'react';
import styles from './AuthScreen.module.css';

export const OTP_LEN = 6;

/** Six single-digit boxes, always LTR. Supports typing, backspace, arrows, paste and SMS autofill. */
export function OtpInput({ value, onChange, markEmpty, markAll }: { value: string[]; onChange: (v: string[]) => void; markEmpty: boolean; markAll: boolean }) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  const focus = (i: number) => refs.current[Math.max(0, Math.min(OTP_LEN - 1, i))]?.focus();

  const fill = (start: number, digits: string) => {
    const next = [...value];
    let i = start;
    for (const d of digits) {
      if (i >= OTP_LEN) break;
      next[i++] = d;
    }
    onChange(next);
    focus(i);
  };

  return (
    <div dir="ltr" role="group" aria-label="קוד אימות" className={styles.otpGrid}>
      {value.map((v, i) => (
        <input
          key={i}
          ref={el => {
            refs.current[i] = el;
          }}
          value={v}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`ספרה ${i + 1}`}
          aria-invalid={markAll || (markEmpty && v === '') || undefined}
          className={styles.otpCell}
          onFocus={e => e.currentTarget.select()}
          onChange={e => {
            const digits = e.target.value.replace(/\D/g, '');
            if (digits.length > 1) {
              // Autofill or a multi-digit entry: spread it from here (or from the start for a full code).
              fill(digits.length >= OTP_LEN ? 0 : i, digits.slice(0, OTP_LEN));
              return;
            }
            const next = [...value];
            next[i] = digits;
            onChange(next);
            if (digits) focus(i + 1);
          }}
          onKeyDown={e => {
            if (e.key === 'Backspace' && v === '' && i > 0) {
              e.preventDefault();
              const next = [...value];
              next[i - 1] = '';
              onChange(next);
              focus(i - 1);
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              focus(i - 1);
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              focus(i + 1);
            }
          }}
          onPaste={e => {
            const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LEN);
            if (!digits) return;
            e.preventDefault();
            fill(digits.length === OTP_LEN ? 0 : i, digits);
          }}
        />
      ))}
    </div>
  );
}
