'use client';

import { useState, useTransition } from 'react';
import { submitOnboarding } from '@/app/for-business/marketing/actions';
import styles from '@/app/for-business/marketing/marketing.module.css';
import type { OnboardingField } from '@/content/marketing/types';
import { ArrowForward, Check } from '@/components/icons';

type Answers = Record<string, string | string[]>;

/** The intake questionnaire after a purchase, in two steps: about the business, then the service itself. */
export function OnboardingForm({ token, common, specific, initial, serviceName }: { token: string; common: OnboardingField[]; specific: OnboardingField[]; initial?: Answers | null; serviceName: string }) {
  const [a, setA] = useState<Answers>(initial ?? {});
  const [step, setStep] = useState(0);
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const groups = [common, specific].filter(g => g.length);
  const fields = groups[step] ?? [];

  const check = (list: OnboardingField[]) =>
    list.filter(f => f.required).filter(f => {
      const val = a[f.key];
      return Array.isArray(val) ? val.length === 0 : !String(val ?? '').trim();
    }).map(f => f.key);

  if (done) {
    return (
      <div className={styles.success} role="status">
        <span className={styles.successIcon}>
          <Check size={22} />
        </span>
        <h3>השאלון התקבל, תודה</h3>
        <p>מנהל/ת הלקוח שלכם יעבור על התשובות ויחזור אליכם עם תוכנית עבודה ל{serviceName}. בינתיים אפשר להעניק את הגישות שמופיעות בעמוד הזה.</p>
      </div>
    );
  }

  const set = (k: string, val: string | string[]) => setA(prev => ({ ...prev, [k]: val }));

  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={e => {
        e.preventDefault();
        const miss = check(fields);
        setMissing(miss);
        if (miss.length) {
          setError('יש כמה שאלות חובה שעוד לא מולאו.');
          document.getElementById(`ob-${miss[0]}`)?.focus();
          return;
        }
        setError(null);
        if (step < groups.length - 1) {
          setStep(step + 1);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        start(async () => {
          const r = await submitOnboarding({ token, answers: a });
          if (r.ok) setDone(true);
          else setError(r.message);
        });
      }}
    >
      {groups.length > 1 && (
        <ol className={styles.steps} aria-label={`שלב ${step + 1} מתוך ${groups.length}`}>
          {groups.map((_, i) => (
            <li key={i} data-on={i <= step || undefined} />
          ))}
        </ol>
      )}
      {fields.map(f => {
        const id = `ob-${f.key}`;
        const bad = missing.includes(f.key);
        const val = a[f.key];
        return (
          <div key={f.key} className={styles.field}>
            {f.type === 'checkbox' ? (
              <label className={styles.consent}>
                <input id={id} type="checkbox" checked={val === 'כן'} onChange={ev => set(f.key, ev.target.checked ? 'כן' : '')} />
                <span>{f.label}</span>
              </label>
            ) : (
              <label className={styles.label} htmlFor={id}>
                {f.label} {!f.required && <em>(לא חובה)</em>}
              </label>
            )}
            {f.help && <span className={styles.help}>{f.help}</span>}
            {(f.type === 'text' || f.type === 'url') && (
              <input id={id} className={styles.input} type={f.type === 'url' ? 'url' : 'text'} dir={f.type === 'url' ? 'ltr' : undefined} placeholder={f.placeholder} value={(val as string) ?? ''} aria-invalid={bad || undefined} onChange={ev => set(f.key, ev.target.value)} />
            )}
            {f.type === 'textarea' && <textarea id={id} className={styles.textarea} placeholder={f.placeholder} value={(val as string) ?? ''} aria-invalid={bad || undefined} onChange={ev => set(f.key, ev.target.value)} />}
            {f.type === 'select' && (
              <select id={id} className={styles.select} value={(val as string) ?? ''} aria-invalid={bad || undefined} onChange={ev => set(f.key, ev.target.value)}>
                <option value="">בחרו</option>
                {f.options?.map(o => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            )}
            {f.type === 'multi' && (
              <div className={styles.checks} id={id} tabIndex={-1}>
                {f.options?.map(o => {
                  const list = Array.isArray(val) ? val : [];
                  const on = list.includes(o);
                  return (
                    <label key={o} className={styles.checkPill}>
                      <input type="checkbox" checked={on} onChange={() => set(f.key, on ? list.filter(x => x !== o) : [...list, o])} />
                      <span>{o}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {bad && <span className={styles.err}>שאלת חובה</span>}
          </div>
        );
      })}
      {error && (
        <div className={styles.formError} role="alert">
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {step > 0 && (
          <button type="button" className={styles.ctaGhost} onClick={() => setStep(step - 1)}>
            חזרה
          </button>
        )}
        <button type="submit" className={styles.ctaPrimary} disabled={pending}>
          <span>{pending ? 'שולחים…' : step < groups.length - 1 ? 'המשך' : 'שליחת השאלון'}</span>
          {!pending && <ArrowForward />}
        </button>
      </div>
    </form>
  );
}
