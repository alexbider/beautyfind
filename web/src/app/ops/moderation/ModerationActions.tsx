'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ui } from '@/components/ops/ui';
import { moderateReviewAction, setReportStatusAction } from './actions';

export function ReviewButtons({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const run = (action: 'publish' | 'reject' | 'remove') => {
    const reason = action === 'publish' ? '' : window.prompt(action === 'reject' ? 'סיבת הדחייה (נשלחת לכותבת):' : 'סיבת ההסרה:', '');
    if (reason === null) return;
    start(async () => {
      const r = await moderateReviewAction({ id, action, reason });
      if (!r.ok) setErr(r.error);
      else router.refresh();
    });
  };
  return (
    <div className={ui.actions}>
      {status !== 'published' ? <button type="button" className={`${ui.btn} ${ui.small} ${ui.teal}`} disabled={pending} onClick={() => run('publish')}>פרסום</button> : null}
      {status === 'submitted' ? <button type="button" className={`${ui.btn} ${ui.small}`} disabled={pending} onClick={() => run('reject')}>דחייה</button> : null}
      {status === 'published' ? <button type="button" className={`${ui.btn} ${ui.small} ${ui.danger}`} disabled={pending} onClick={() => run('remove')}>הסרה</button> : null}
      {err ? <span className={ui.error}>{err}</span> : null}
    </div>
  );
}

export function ReportButtons({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (next: 'in_progress' | 'closed') =>
    start(async () => {
      const r = await setReportStatusAction({ id, status: next });
      if (r.ok) router.refresh();
    });
  return (
    <div className={ui.actions}>
      {status === 'new' ? <button type="button" className={`${ui.btn} ${ui.small}`} disabled={pending} onClick={() => run('in_progress')}>בטיפול</button> : null}
      {status !== 'closed' ? <button type="button" className={`${ui.btn} ${ui.small} ${ui.teal}`} disabled={pending} onClick={() => run('closed')}>סגירה</button> : null}
    </div>
  );
}
