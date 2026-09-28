'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ResetPreview } from '@/lib/server/importOps';
import { resetImportAction } from './actions';
import styles from './import.module.css';

const n = (x: number) => x.toLocaleString('he-IL');
const WORD = 'מחיקה';

/** Danger zone at the bottom of the runs screen: wipe every listing the import created and every trace of earlier runs. */
export function ResetImport({ preview }: { preview: ResetPreview }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [typed, setTyped] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const empty = !preview.listings && !preview.places && !preview.runs;
  const go = () =>
    start(async () => {
      if (!confirm(`למחוק ${n(preview.listings)} עסקים שהייבוא יצר, ${n(preview.places)} רשומות ו־${n(preview.runs)} ריצות? אין דרך חזרה.`)) return;
      const r = await resetImportAction(typed);
      if (!r.ok) setMsg({ ok: false, text: r.error === 'running' ? 'יש ריצה פעילה כרגע. עצרו אותה (או חכו שתסתיים) ונסו שוב.' : r.error === 'confirm' ? `יש להקליד ${WORD} בתיבה.` : 'אין הרשאה.' });
      else setMsg({ ok: true, text: `נמחקו ${n(r.preview.listings)} עסקים, ${n(r.preview.places)} רשומות, ${n(r.preview.runs)} ריצות ו־${n(r.preview.media)} קבצי תמונה. המסכים נקיים.` });
      setTyped('');
      router.refresh();
    });
  return (
    <details className={styles.card}>
      <summary className={styles.h2} style={{ cursor: 'pointer', margin: 0 }}>איפוס הייבוא: מחיקת כל מה שנוצר עד עכשיו</summary>
      <div className={styles.stack} style={{ marginTop: 10 }}>
        <p className={styles.note} style={{ margin: 0 }}>
          מוחק את כל העסקים שהייבוא יצר ופרסם (כולל התמונות שלהם), את כל הרשומות בתור הבדיקה, הריצות, האצוות, הראיות וההוצאות שנרשמו, ואת זיכרון האתרים שנסרקו. ההגדרות והמפתחות נשארים. עסקים שנתבעו על ידי בעליהם, או שיש בהם הזמנות ופניות, לא נמחקים.
        </p>
        <ul className={styles.note} style={{ margin: 0, paddingInlineStart: 18 }}>
          <li>עסקים שיימחקו: <span className={styles.ltr}>{n(preview.listings)}</span>{preview.claimedKept ? ` (עוד ${n(preview.claimedKept)} נתבעו ונשארים)` : ''}{preview.activeKept ? ` (עוד ${n(preview.activeKept)} עם פעילות או סניף נוסף, נשארים)` : ''}</li>
          <li>רשומות ייבוא: <span className={styles.ltr}>{n(preview.places)}</span> · ריצות ואצוות: <span className={styles.ltr}>{n(preview.runs)}</span> · קבצי תמונה: <span className={styles.ltr}>{n(preview.media)}</span></li>
        </ul>
        {preview.running ? <p className={styles.error}>יש ריצה פעילה כרגע. עצרו אותה לפני האיפוס.</p> : null}
        {msg ? <p className={msg.ok ? styles.info : styles.error} role="status">{msg.text}</p> : null}
        {!empty ? (
          <div className={styles.btnRow} style={{ alignItems: 'center' }}>
            <input className={styles.input} style={{ maxWidth: 180 }} value={typed} onChange={e => setTyped(e.target.value)} placeholder={`הקלידו ${WORD}`} aria-label="אישור המחיקה" />
            <button type="button" className={`${styles.btn} ${styles.danger}`} disabled={pending || preview.running || typed.trim() !== WORD} onClick={go}>
              {pending ? 'מוחק…' : 'מחיקת הכול'}
            </button>
          </div>
        ) : <p className={styles.note} style={{ margin: 0 }}>אין מה למחוק, הייבוא נקי.</p>}
      </div>
    </details>
  );
}
