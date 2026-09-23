import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import { CLAIM_METHODS, type ClaimMethod, type ListingHit } from '@/app/for-business/claim/shared';
import { ArrowForward } from '../icons';
import { InfoIcon } from './InfoIcon';
import styles from './Claim.module.css';

const METHOD_COPY: Record<ClaimMethod, { name: string; note: string; missingTarget: string; missingNote: string }> = {
  sms: { name: 'קוד ב־SMS', note: 'למספר הרשום בפרופיל', missingTarget: 'אין מספר רשום', missingNote: 'לפרופיל לא רשום מספר טלפון' },
  call: { name: 'שיחה קולית', note: 'הקוד נמסר בשיחה מוקלטת', missingTarget: 'אין מספר רשום', missingNote: 'לפרופיל לא רשום מספר טלפון' },
  mail: { name: 'דואר אלקטרוני', note: 'לכתובת בדומיין של העסק', missingTarget: 'אין כתובת רשומה', missingNote: 'לפרופיל לא רשומה כתובת דואר' },
};

interface Props {
  headingRef: RefObject<HTMLHeadingElement | null>;
  picked: ListingHit;
  method: ClaimMethod;
  onMethod: (m: ClaimMethod) => void;
  codeSent: boolean;
  code: string;
  onCode: (v: string) => void;
  codeError: ReactNode | null;
  sendError: ReactNode | null;
  busy: 'send' | 'verify' | null;
  cooldownLeft: number;
  onSend: () => void;
  onCheck: () => void;
}

export const secondsLabel = (n: number): ReactNode =>
  n === 1 ? 'שנייה אחת' : n === 2 ? 'שתי שניות' : <><span className="ltr">{n}</span> שניות</>;

export function VerifyStep(p: Props) {
  const available = CLAIM_METHODS.filter(m => p.picked.targets[m]);
  const target = p.picked.targets[p.method];

  // Radio group keys: arrows move and select, skipping methods without a target.
  const onRadioKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (!keys.includes(e.key) || available.length < 2) return;
    e.preventDefault();
    // RTL: left is forward.
    const step = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? 1 : -1;
    const i = available.indexOf(p.method);
    const next = available[(i + step + available.length) % available.length];
    p.onMethod(next);
    (e.currentTarget.querySelector(`[data-method="${next}"]`) as HTMLElement | null)?.focus();
  };

  return (
    <section aria-labelledby="h-verify" className={styles.section}>
      <h2 id="h-verify" ref={p.headingRef} tabIndex={-1} className={styles.h2}>
        אימות בעלות<span className={styles.dot}>.</span>
      </h2>
      <p className={styles.lede}>
        בחרו דרך אימות ל<strong>{p.picked.name}</strong>. הקוד תקף ל־<span className="ltr">10</span> דקות, ואפשר לבקש חדש.
      </p>

      <div role="radiogroup" aria-label="דרך אימות" className={styles.methods} onKeyDown={onRadioKey}>
        {CLAIM_METHODS.map(m => {
          const t = p.picked.targets[m];
          const on = m === p.method && !!t;
          const copy = METHOD_COPY[m];
          return (
            <button
              key={m}
              type="button"
              role="radio"
              data-method={m}
              aria-checked={on}
              aria-disabled={!t || undefined}
              tabIndex={on ? 0 : -1}
              className={styles.method}
              onClick={() => t && p.onMethod(m)}
            >
              <span className={styles.methodName}>{copy.name}</span>
              {t ? <span dir="ltr" className={`${styles.methodTarget} ltr`}>{t}</span> : <span className={styles.methodTarget}>{copy.missingTarget}</span>}
              <span className={styles.methodNote}>{t ? copy.note : copy.missingNote}</span>
            </button>
          );
        })}
      </div>

      {p.codeSent && target && (
        <form
          className={styles.codeBox}
          noValidate
          onSubmit={e => {
            e.preventDefault();
            p.onCheck();
          }}
        >
          <p>
            שלחנו קוד בן שש ספרות ל<span dir="ltr" className={`${styles.strong} ltr`}>{target}</span>. הזינו אותו כאן.
          </p>
          <label className={styles.codeLabel}>
            <span className={styles.label}>קוד אימות</span>
            <input
              type="text"
              dir="ltr"
              className={styles.codeInput}
              value={p.code}
              onChange={e => p.onCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              aria-invalid={!!p.codeError}
              aria-describedby={p.codeError ? 'err-code' : undefined}
            />
          </label>
          {p.codeError && (
            <p id="err-code" role="alert" className={styles.error}>{p.codeError}</p>
          )}
          <div className={styles.codeActions}>
            <button type="submit" className={`${styles.btnDark} ${styles.btnCheck}`} disabled={p.busy !== null} aria-busy={p.busy === 'verify'}>
              <span>אימות הקוד</span>
            </button>
            <button type="button" className={styles.btnLink} onClick={p.onSend} disabled={p.busy !== null || p.cooldownLeft > 0}>
              {p.cooldownLeft > 0 ? <>שליחת קוד חדש בעוד {secondsLabel(p.cooldownLeft)}</> : 'שליחת קוד חדש'}
            </button>
          </div>
        </form>
      )}

      {!p.codeSent && target && (
        <button type="button" className={styles.btnDark} onClick={p.onSend} disabled={p.busy !== null || p.cooldownLeft > 0} aria-busy={p.busy === 'send'}>
          <span>שליחת קוד</span>
          <ArrowForward />
        </button>
      )}
      {p.sendError && (
        <p role="alert" className={styles.error}>{p.sendError}</p>
      )}

      <div className={styles.note}>
        <InfoIcon />
        <p>
          <strong>אין לכם גישה לטלפון או לדואר הרשומים?</strong> אפשר לאמת במסמך: תעודת עוסק, אישור ניהול ספרים או רישיון עסק על שם העסק. שלחו אותו ל
          <a href="mailto:business@beautyfind.co.il">
            <span className="ltr">business@beautyfind.co.il</span>
          </a>{' '}
          ונטפל בתוך שני ימי עסקים.
        </p>
      </div>
    </section>
  );
}
