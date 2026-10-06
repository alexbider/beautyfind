'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Toggle } from '@/components/ops/Toggle';
import { ui } from '@/components/ops/ui';
import { deleteArticleAction, publishArticleAction, setMagazineApprovalAction, unpublishArticleAction } from './actions';

// The interactive parts of /ops/magazine: publish, take down or delete an article (the same actions the
// MCP tools call) and the approvals switch.

export function ArticleActions({ id, status, title }: { id: string; status: string; title: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string; queued?: boolean }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? ('queued' in r && r.queued ? 'נשלח לתור האישורים' : 'בוצע') : r.error ?? 'שגיאה');
      router.refresh();
    });
  return (
    <span className={ui.actions}>
      {status !== 'published' ? <button type="button" className={`${ui.btn} ${ui.small} ${ui.primary}`} disabled={pending} onClick={() => run(() => publishArticleAction(id))}>פרסום</button> : null}
      {status === 'published' || status === 'scheduled' ? <button type="button" className={`${ui.btn} ${ui.small}`} disabled={pending} onClick={() => run(() => unpublishArticleAction(id))}>הורדה מהאתר</button> : null}
      <button type="button" className={`${ui.btn} ${ui.small} ${ui.danger}`} disabled={pending} onClick={() => { if (window.confirm(`למחוק את ״${title}״? המאמר יורד מהאתר ונעלם מהרשימה.`)) run(() => deleteArticleAction(id)); }}>מחיקה</button>
      {msg ? <span className={ui.sub}>{msg}</span> : null}
    </span>
  );
}

export function ApprovalToggle({ checked, canEdit }: { checked: boolean; canEdit: boolean }) {
  return <Toggle name="magazinePublishApproval" checked={checked} disabled={!canEdit} title="פרסום דרך תור האישורים" sub="דלוק: publish_article (מה־MCP ומכאן) פותח בקשה בתור האישורים ב־/ops/ai, והאישור הוא שמפרסם. כבוי: הפרסום מיידי" onChange={(_n, v) => setMagazineApprovalAction(v)} />;
}
