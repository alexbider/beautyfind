'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { rewriteBranchesAction } from '../actions';
import styles from '../import.module.css';

/** "Write the description again" for one published listing; the batch appears on the enrichment tab. */
export function RewriteButton({ branchId, name }: { branchId: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const go = () =>
    start(async () => {
      if (!confirm(`לכתוב מחדש את התיאור והשאלות הנפוצות של ${name}? הטקסט החדש מחליף את הקיים.`)) return;
      const r = await rewriteBranchesAction([branchId]);
      setNote(!r.ok ? 'הפעולה נכשלה' : !r.count ? 'אין מה לכתוב מחדש (העסק נתבע או שהכתיבה כבויה)' : `נשלח לכתיבה מחדש${r.dispatched === false ? ' (העובד לא הופעל, הפעילו אותו מדף הריצות)' : ''}`);
      router.refresh();
    });
  return (
    <>
      <button type="button" className={styles.btn} style={{ minHeight: 28, padding: '2px 10px', fontSize: 12.5 }} disabled={pending} onClick={go}>{pending ? 'שולח…' : 'כתיבה מחדש של התיאור'}</button>
      {note ? <span className={styles.note}> {note}</span> : null}
    </>
  );
}
