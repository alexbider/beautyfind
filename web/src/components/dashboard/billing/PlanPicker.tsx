'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { changeCycle, changePlan } from '@/app/biz/billing/actions';
import { ConfirmSheet } from '../ConfirmSheet';
import { useSheetMode } from '../media';
import s from './billing.module.css';

export type PlanCard = {
  key: 'basic' | 'advanced';
  name: string;
  line: string;
  feats: string[];
  price: string;
  per: string;
  rank: number;
};

type Ask = { kind: 'plan'; plan: PlanCard } | { kind: 'yearly' } | null;

/** Plan cards + monthly/yearly switch, each change behind an explicit confirmation. */
export function PlanPicker({
  plans, current, pending, cycle, canEdit, periodEnd, yearlyLine,
}: {
  plans: PlanCard[];
  current: PlanCard['key'] | null;
  pending: PlanCard['key'] | null;
  cycle: 'monthly' | 'yearly';
  canEdit: boolean;
  /** 1.10.2026, or null when the period end is not known yet. */
  periodEnd: string | null;
  yearlyLine: string;
}) {
  const [ask, setAsk] = useState<Ask>(null);
  const [error, setError] = useState('');
  const [busy, start] = useTransition();
  const cur = plans.find(p => p.key === current) ?? null;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError('');
      const r = await fn();
      if (r.ok) setAsk(null);
      else setError(r.error ?? 'משהו השתבש. נסו שוב.');
    });

  const when = periodEnd ? <>, ב־<span className="ltr">{periodEnd}</span></> : null;
  // Below 768px the confirmation is a bottom sheet.
  const sheet = useSheetMode();
  const askTitle = !ask ? '' : ask.kind === 'plan' ? `לעבור למסלול ${ask.plan.name}?` : 'לעבור לחיוב שנתי?';
  const askLine: ReactNode = !ask ? null : ask.kind === 'yearly' ? (
    yearlyLine
  ) : cur && ask.plan.rank < cur.rank ? (
    <>מערכת ניהול הקליניקה (יומן, CRM, מלאי, אוטומציות) תיסגר בסוף מחזור החיוב{when}. עד אז הכול ממשיך לעבוד, והמידע יישמר 90 יום למקרה שתחזרו.</>
  ) : cur ? (
    <>המעבר נכנס לתוקף מיד. החיוב היחסי לתקופה הנוכחית יופיע בחשבונית הבאה{when}.</>
  ) : (
    <>המסלול נשמר מיד. החיוב מתחיל כשהסניף הראשון מתפרסם.</>
  );
  const confirm = () => {
    if (!ask) return;
    run(() => (ask.kind === 'plan' ? changePlan(ask.plan.key) : changeCycle('yearly')));
  };

  return (
    <div onKeyDown={e => { if (e.key === 'Escape') setAsk(null); }}>
      <div className={s.cycleRow}>
        <span className={s.cycleLabel} id="cycle-label">מחזור חיוב</span>
        <div role="group" aria-labelledby="cycle-label" className={s.cycle}>
          <button
            type="button"
            className={s.cycleBtn}
            aria-pressed={cycle === 'monthly'}
            disabled={!canEdit || busy || cycle === 'monthly'}
            onClick={() => setError('מעבר מחיוב שנתי לחודשי נכנס לתוקף רק בתאריך החידוש השנתי. פנו אלינו ונקבע את המעבר לתאריך הזה.')}
          >
            חודשי
          </button>
          <button
            type="button"
            className={s.cycleBtn}
            aria-pressed={cycle === 'yearly'}
            disabled={!canEdit || busy || cycle === 'yearly' || !current}
            onClick={() => { setError(''); setAsk({ kind: 'yearly' }); }}
          >
            שנתי · חודשיים מתנה
          </button>
        </div>
      </div>

      <div className={s.plans}>
        {plans.map(p => {
          const isCur = p.key === current;
          const isPending = p.key === pending;
          const label = !cur ? 'בחירת המסלול' : p.rank > cur.rank ? 'שדרוג' : 'מעבר למסלול';
          return (
            <div key={p.key} className={s.plan} data-current={isCur || undefined}>
              <div className={s.planTop}>
                <span className={s.planName}>{p.name}</span>
                {isCur ? <span className={s.badge}>המסלול שלכם</span> : null}
                {isPending ? (
                  <span className={`${s.badge} ${s.badgeSoft}`}>
                    {periodEnd ? <>מתחיל ב־<span className="ltr">{periodEnd}</span></> : 'מתחיל במחזור הבא'}
                  </span>
                ) : null}
              </div>
              <span className={s.price}>{p.price}</span>
              <span className={s.per}>{p.per}</span>
              <span className={s.planLine}>{p.line}</span>
              <ul className={s.feats}>
                {p.feats.map(f => (
                  <li key={f}>
                    <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="#0B7A87" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M2.8 7.6 6.6 11.4 15 3" />
                    </svg>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              {canEdit && isCur && pending ? (
                <button type="button" className={s.pick} disabled={busy} onClick={() => run(() => changePlan(p.key))}>
                  ביטול המעבר והישארות במסלול
                </button>
              ) : null}
              {canEdit && !isCur && !isPending ? (
                <button type="button" className={s.pick} disabled={busy} onClick={() => { setError(''); setAsk({ kind: 'plan', plan: p }); }}>
                  {label}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {ask && !sheet ? (
        <div className={s.ask} role="group" aria-labelledby="ask-title" aria-describedby="ask-line">
          <p id="ask-title" className={s.askTitle}>{askTitle}</p>
          <p id="ask-line" className={s.askLine}>{askLine}</p>
          <div className={s.askActions}>
            <button type="button" className={s.primary} disabled={busy} autoFocus onClick={confirm}>
              {busy ? 'שומר…' : 'אישור המעבר'}
            </button>
            <button type="button" className={s.ghost} onClick={() => setAsk(null)}>ביטול</button>
          </div>
        </div>
      ) : null}
      <ConfirmSheet
        open={!!ask && sheet}
        title={askTitle}
        body={<p>{askLine}</p>}
        confirmLabel={busy ? 'שומר…' : 'אישור המעבר'}
        tone="primary"
        pending={busy}
        error={error || undefined}
        onConfirm={confirm}
        onCancel={() => setAsk(null)}
      />
      {error ? <p role="alert" className={s.error} style={{ margin: '0 0 14px' }}>{error}</p> : null}
    </div>
  );
}
