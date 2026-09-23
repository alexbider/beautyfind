import Link from 'next/link';
import { Check } from '@/components/icons';
import styles from './states.module.css';

// Design: project/BeautyFind States.dc.html → "לוח בקרה ריק".
// Rule: instead of zero charts, setup tasks with a stated impact. Metrics show a dash, never 0.

export interface SetupTask {
  key: string;
  name: string;
  note?: string;
  /** Short impact tag, e.g. "נדרש". Only claims the business can back up. */
  impact?: string;
  done: boolean;
  /** Where the task is done (dashboard area). */
  href?: string;
}

export interface ZeroKpi {
  label: string;
  note: string;
}

export const DEFAULT_ZERO_KPIS: ZeroKpi[] = [
  { label: 'צפיות בפרופיל', note: 'יתחיל להצטבר עם האינדוקס, בדרך כלל תוך 48 שעות' },
  { label: 'פניות', note: 'וואטסאפ, טלפון וטופס: יופיעו כאן עם הפנייה הראשונה' },
  { label: 'דירוג', note: 'נפתח אחרי הביקורת המאומתת הראשונה' },
  { label: 'מקומות בחיפוש', note: 'נמדד שבועית מול עסקים באותו אזור' },
];

export function NewBusiness({
  businessName,
  publishedAgo,
  tasks,
  completion,
  kpis = DEFAULT_ZERO_KPIS,
}: {
  businessName: string;
  /** e.g. "לפני שעתיים". Omit when not published yet. */
  publishedAgo?: string;
  tasks: SetupTask[];
  /** Profile completeness 0–100. Defaults to the share of tasks done. */
  completion?: number;
  kpis?: ZeroKpi[];
}) {
  const pct = Math.max(0, Math.min(100, Math.round(completion ?? (tasks.length ? (tasks.filter(t => t.done).length / tasks.length) * 100 : 0))));

  return (
    <div className={styles.enter}>
      <div className={styles.nbHead}>
        <h2 className={styles.h2}>ברוכים הבאים, {businessName}</h2>
        <p className={styles.lede}>
          {publishedAgo ? `הכרטיס פורסם ${publishedAgo}. ` : ''}אין עוד נתונים להציג, וזה נורמלי. במקום גרפים ריקים, הנה מה שמזיז את המחוג.
        </p>
      </div>

      <div className={styles.setup}>
        <div className={styles.setupHead}>
          <span id="nb-completion" className={styles.setupTitle}>שלמות הפרופיל</span>
          <span className={`${styles.setupPct} ltr`}>{pct}%</span>
        </div>
        <span role="progressbar" aria-labelledby="nb-completion" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className={styles.bar}>
          <span style={{ width: `${pct}%` }} />
        </span>
        <ul className={styles.tasks}>
          {tasks.map(t => {
            const inner = (
              <>
                <span aria-hidden="true" className={styles.box} data-on={t.done || undefined}>
                  {t.done && <Check size={12} strokeWidth={2.2} />}
                </span>
                <span className={styles.taskText}>
                  <span className={styles.taskName}>
                    {t.name}
                    <span className="sr-only">{t.done ? ' (הושלם)' : ' (לא הושלם)'}</span>
                  </span>
                  {t.note && <span className={styles.taskNote}>{t.note}</span>}
                </span>
                {t.impact && <span className={styles.taskImpact}>{t.impact}</span>}
              </>
            );
            return (
              <li key={t.key}>
                {t.href && !t.done ? (
                  <Link href={t.href} className={styles.task}>{inner}</Link>
                ) : (
                  <div className={styles.task} data-done={t.done || undefined}>{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <dl className={styles.kpis}>
        {kpis.map(k => (
          <div key={k.label} className={styles.kpi}>
            <dt>{k.label}</dt>
            <dd>
              <span aria-hidden="true">–</span>
              <span className="sr-only">אין נתונים עדיין</span>
            </dd>
            <span className={styles.kpiNote}>{k.note}</span>
          </div>
        ))}
      </dl>
    </div>
  );
}
