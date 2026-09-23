'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { savePolicy } from '@/app/biz/payments/actions';
import type { PolicyDTO, TreatmentDepositDTO } from './shared';
import s from './payments.module.css';

const SCOPES: Array<{ key: PolicyDTO['scope']; name: string; sub: string }> = [
  { key: 'all', name: 'כל הטיפולים', sub: 'מקדמה בכל תור אונליין' },
  { key: 'medical_only', name: 'טיפולים רפואיים בלבד', sub: 'הזרקות ושאר טיפולים שמבצע רופא/ה' },
  { key: 'per_treatment', name: 'לפי טיפול', sub: 'סכום נפרד לכל טיפול, בטבלה למטה' },
];
const WINDOWS = [24, 48, 72];

/** שעה · שעתיים · N שעות, with the number in an LTR span. */
function Hours({ h }: { h: number }) {
  if (h === 1) return <>שעה</>;
  if (h === 2) return <>שעתיים</>;
  return <><span className="ltr">{h}</span> שעות</>;
}
const int = (v: string) => {
  const n = parseInt(v.replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <span className={s.switchWrap}>
      <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={s.switch} disabled={disabled}>
        <span aria-hidden="true" />
      </button>
      <span className={s.switchLabel} aria-hidden="true">{on ? 'פעיל' : 'כבוי'}</span>
    </span>
  );
}

/** DepositPolicy + Business.settings (waitlist_hold_minutes, consult_fee). */
export function PolicyForm({ initial, treatments, payments }: { initial: PolicyDTO; treatments: TreatmentDepositDTO[]; payments: boolean }) {
  const [v, setV] = useState(initial);
  const [value, setValue] = useState(String(initial.value || ''));
  const [windowText, setWindowText] = useState(String(initial.refundWindowHours));
  const [hold, setHold] = useState(String(initial.waitlistHoldMinutes));
  const [fee, setFee] = useState(String(initial.consultFeeShekels));
  const [ov, setOv] = useState<Record<string, string>>(() => Object.fromEntries(treatments.map(t => [t.id, t.depositShekels == null ? '' : String(t.depositShekels)])));
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [busy, start] = useTransition();

  const set = <K extends keyof PolicyDTO>(k: K, val: PolicyDTO[K]) => {
    setV(x => ({ ...x, [k]: val }));
    setDone(false);
  };
  const multiBranch = new Set(treatments.map(t => t.branch)).size > 1;
  const valN = int(value);
  const example = treatments.find(t => (v.scope === 'medical_only' ? t.isMedical : true)) ?? null;
  const exampleDeposit =
    example && v.scope !== 'per_treatment' && valN > 0
      ? v.mode === 'fixed' ? valN : Math.round((example.priceShekels * 1.18 * valN) / 100)
      : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setDone(false);
    start(async () => {
      const r = await savePolicy({
        enabled: v.enabled,
        mode: v.mode,
        value: valN,
        scope: v.scope,
        refundWindowHours: int(windowText),
        waitlistHoldMinutes: int(hold),
        consultFeeShekels: int(fee),
        overrides: v.scope === 'per_treatment' ? treatments.map(t => ({ id: t.id, shekels: ov[t.id]?.trim() ? int(ov[t.id]) : null })) : [],
      });
      if (r.ok) setDone(true);
      else setErr(r.error);
    });
  };

  return (
    <form onSubmit={submit} noValidate>
      {!payments && v.enabled ? (
        <p className={`${s.callout} ${s.warn}`} style={{ marginBottom: 12 }}>
          המדיניות נשמרת, אבל מקדמות לא ייגבו עד שתחובר חברת סליקה. בינתיים תורים אונליין נקבעים בלי מקדמה.
        </p>
      ) : null}

      <div className={s.row}>
        <div className={s.rowText}>
          <span className={s.rowTitle} id="dep-on">מקדמה בקביעת תור</span>
          <span className={s.rowSub}>הלקוח/ה משלם/ת מקדמה בקביעת התור, והיא מקוזזת מהתשלום על הטיפול.</span>
        </div>
        <div className={s.rowCtl}>
          <Switch on={v.enabled} onChange={x => set('enabled', x)} label="מקדמה בקביעת תור" />
        </div>
      </div>

      <fieldset disabled={!v.enabled} style={{ border: 0, margin: 0, padding: 0, minWidth: 0, opacity: v.enabled ? 1 : 0.55 }}>
        <div className={s.row}>
          <div className={s.rowText}>
            <span className={s.rowTitle} id="dep-scope">על אילו טיפולים</span>
            <span className={s.rowSub}>{SCOPES.find(x => x.key === v.scope)?.sub}</span>
          </div>
          <div role="radiogroup" aria-labelledby="dep-scope" className={s.chips}>
            {SCOPES.map(x => (
              <button key={x.key} type="button" role="radio" aria-checked={v.scope === x.key} onClick={() => set('scope', x.key)} className={s.chip}>{x.name}</button>
            ))}
          </div>
        </div>

        {v.scope !== 'per_treatment' ? (
          <div className={s.row}>
            <div className={s.rowText}>
              <span className={s.rowTitle} id="dep-mode">גובה המקדמה</span>
              <span className={s.rowSub}>סכום קבוע בשקלים, או אחוז מהמחיר כולל מע״מ.</span>
              {exampleDeposit != null && example ? (
                <p className={s.example}>
                  לדוגמה: {example.name} · מקדמה <span className="ltr">₪{exampleDeposit.toLocaleString('en-US')}</span>
                </p>
              ) : null}
            </div>
            <div className={s.rowCtl}>
              <div role="radiogroup" aria-labelledby="dep-mode" className={s.chips}>
                <button type="button" role="radio" aria-checked={v.mode === 'fixed'} onClick={() => set('mode', 'fixed')} className={s.chip}>סכום קבוע</button>
                <button type="button" role="radio" aria-checked={v.mode === 'percent'} onClick={() => set('mode', 'percent')} className={s.chip}>אחוז</button>
              </div>
              <span className={s.unitInput}>
                <input
                  dir="ltr" inputMode="numeric" value={value} onChange={e => { setValue(e.target.value.replace(/\D/g, '').slice(0, 4)); setDone(false); }}
                  aria-label={v.mode === 'fixed' ? 'סכום המקדמה בשקלים' : 'אחוז המקדמה'} className={s.input}
                />
                <span aria-hidden="true" className={s.unit}>{v.mode === 'fixed' ? '₪' : '%'}</span>
              </span>
            </div>
          </div>
        ) : (
          <div className={s.row} style={{ display: 'block' }}>
            <span className={s.rowTitle}>מקדמה לכל טיפול</span>
            <span className={s.rowSub}>שדה ריק או <span className="ltr">0</span> = בלי מקדמה לטיפול הזה. המחירים לפני מע״מ, כמו בתפריט המחירים.</span>
            {treatments.length ? (
              <div className={s.overrides}>
                <div aria-hidden="true" className={s.ovHead}>
                  <span>טיפול</span>
                  <span style={{ textAlign: 'left' }}>מחיר</span>
                  <span>מקדמה</span>
                </div>
                {treatments.map(t => (
                  <div key={t.id} className={s.ovRow}>
                    <span className={s.ovName}>
                      {t.name}
                      {multiBranch || t.isMedical ? <span className={s.ovSub}>{[multiBranch ? t.branch : null, t.isMedical ? 'רפואי' : null].filter(Boolean).join(' · ')}</span> : null}
                    </span>
                    <span className={s.ovPrice}>₪{t.priceShekels.toLocaleString('en-US')}</span>
                    <span className={s.unitInput}>
                      <input
                        dir="ltr" inputMode="numeric" value={ov[t.id] ?? ''} onChange={e => { setOv(x => ({ ...x, [t.id]: e.target.value.replace(/\D/g, '').slice(0, 4) })); setDone(false); }}
                        aria-label={`מקדמה: ${t.name}`} className={s.input}
                      />
                      <span aria-hidden="true" className={s.unit}>₪</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className={`${s.callout} ${s.info}`} style={{ marginTop: 8 }}>
                אין עדיין טיפולים בתפריט. <Link href="/biz/menu">לתפריט המחירים</Link>
              </p>
            )}
          </div>
        )}
      </fieldset>

      <div className={s.row}>
        <div className={s.rowText}>
          <span className={s.rowTitle} id="dep-win">ביטול עם החזר מלא</span>
          <span className={s.rowSub}>
            {int(windowText) ? <>ביטול עד <Hours h={int(windowText)} /> לפני התור מחזיר את המקדמה במלואה. ביטול מאוחר יותר או אי הגעה: המקדמה לא מוחזרת.</> : 'בחלון של 0 שעות המקדמה לא מוחזרת בביטול.'}
          </span>
        </div>
        <div className={s.rowCtl}>
          <div role="radiogroup" aria-labelledby="dep-win" className={s.chips}>
            {WINDOWS.map(h => (
              <button key={h} type="button" role="radio" aria-checked={int(windowText) === h} onClick={() => { setWindowText(String(h)); setDone(false); }} className={s.chip}>
                <span className="ltr">{h}</span>&nbsp;שעות
              </button>
            ))}
          </div>
          <span className={s.unitInput} style={{ width: 110 }}>
            <input dir="ltr" inputMode="numeric" value={windowText} onChange={e => { setWindowText(e.target.value.replace(/\D/g, '').slice(0, 3)); setDone(false); }} aria-label="חלון הביטול בשעות" className={s.input} />
            <span aria-hidden="true" className={s.unit} style={{ fontSize: 12 }}>שע׳</span>
          </span>
        </div>
      </div>

      <div className={s.row}>
        <div className={s.rowText}>
          <span className={s.rowTitle}>החזקת תור מרשימת ההמתנה</span>
          <span className={s.rowSub}>כשמתפנה תור, הוא נשמר לממתין/ה הראשון/ה לזמן הזה לפני שעובר הלאה.</span>
        </div>
        <span className={s.unitInput}>
          <input dir="ltr" inputMode="numeric" value={hold} onChange={e => { setHold(e.target.value.replace(/\D/g, '').slice(0, 3)); setDone(false); }} aria-label="זמן החזקה בדקות" className={s.input} />
          <span aria-hidden="true" className={s.unit} style={{ fontSize: 12 }}>דק׳</span>
        </span>
      </div>

      <div className={s.row}>
        <div className={s.rowText}>
          <span className={s.rowTitle}>דמי פגישת ייעוץ</span>
          <span className={s.rowSub}>נגבים בקביעת פגישת ייעוץ לטיפול רפואי ומתקזזים מהטיפול. <span className="ltr">0</span> = ייעוץ בלי תשלום.{!payments ? ' ייעוץ בתשלום דורש חברת סליקה מחוברת.' : ''}</span>
        </div>
        <span className={s.unitInput}>
          <input dir="ltr" inputMode="numeric" value={fee} onChange={e => { setFee(e.target.value.replace(/\D/g, '').slice(0, 4)); setDone(false); }} aria-label="דמי ייעוץ בשקלים" className={s.input} />
          <span aria-hidden="true" className={s.unit}>₪</span>
        </span>
      </div>

      <div className={s.saveRow}>
        <button type="submit" className={s.primary} disabled={busy}>{busy ? 'שומר…' : 'שמירת המדיניות'}</button>
        {done ? (
          <span role="status" className={s.okMsg}>
            <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2.8 7.6 6.6 11.4 15 3" />
            </svg>
            ההגדרות נשמרו
          </span>
        ) : null}
        {err ? <p role="alert" className={s.error}>{err}</p> : null}
      </div>
      <p className={s.provMeta} style={{ marginTop: 10 }}>המדיניות מוצגת ללקוח/ה לפני התשלום ונשמרת עם כל תור, כך שמחלוקות נבדקות מול מה שהוצג בפועל.</p>
    </form>
  );
}
