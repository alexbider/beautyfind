'use client';

import { useState, useTransition } from 'react';
import { ui } from '@/components/ops/ui';
import type { AuthorizeParams } from '@/lib/mcp';
import { decideAuthorizeAction } from './actions';

export function ConsentForm({ params }: { params: AuthorizeParams }) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const go = (approve: boolean) =>
    start(async () => {
      const r = await decideAuthorizeAction({ ...params, approve });
      if (!r.ok) { setErr(r.error); return; }
      window.location.assign(r.redirect);
    });
  return (
    <div className={ui.stack} style={{ gap: 10, marginTop: 18 }}>
      <div className={ui.actions}>
        <button type="button" className={`${ui.btn} ${ui.primary}`} disabled={pending} onClick={() => go(true)}>אישור החיבור</button>
        <button type="button" className={ui.btn} disabled={pending} onClick={() => go(false)}>ביטול</button>
      </div>
      {err ? <p className={ui.error}>{err}</p> : null}
    </div>
  );
}
