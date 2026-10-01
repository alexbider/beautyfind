'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ui } from '@/components/ops/ui';
import { saveSeoAction } from './actions';

export function SeoForm({ path, title, description, keyword, noindex, defaultTitle, defaultDescription, keywordHint, canEdit }: {
  path: string; title: string; description: string | null; keyword: string | null; noindex: boolean; defaultTitle: string; defaultDescription: string | null; keywordHint: string; canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [t, setT] = useState(title === defaultTitle ? '' : title);
  const [d, setD] = useState(description === defaultDescription ? '' : description ?? '');
  const [k, setK] = useState(keyword ?? '');
  const [ni, setNi] = useState(noindex);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!canEdit) return null;
  if (!open) return <button type="button" className={`${ui.btn} ${ui.small}`} onClick={() => setOpen(true)}>עריכה</button>;
  return (
    <form
      className={ui.stack} style={{ gap: 8, minWidth: 280 }}
      onSubmit={e => {
        e.preventDefault();
        start(async () => {
          const r = await saveSeoAction({ path, title: t, description: d, keyword: k, noindex: ni });
          setMsg(r.ok ? { ok: true, text: 'נשמר' } : { ok: false, text: r.error });
          if (r.ok) { setOpen(false); router.refresh(); }
        });
      }}
    >
      <div className={ui.field}><label className={ui.label}>כותרת (ריק = ברירת המחדל)</label><input className={ui.input} value={t} onChange={e => setT(e.target.value)} maxLength={120} placeholder={defaultTitle} /><span className={ui.hint}>{[...(t || defaultTitle)].length} תווים · מומלץ 25 עד 65</span></div>
      <div className={ui.field}><label className={ui.label}>תיאור</label><textarea className={ui.textarea} style={{ minHeight: 70 }} value={d} onChange={e => setD(e.target.value)} maxLength={320} placeholder={defaultDescription ?? ''} /><span className={ui.hint}>{[...(d || defaultDescription || '')].length} תווים · מומלץ 70 עד 160</span></div>
      <div className={ui.field}><label className={ui.label}>מילת מפתח</label><input className={ui.input} value={k} onChange={e => setK(e.target.value)} maxLength={60} placeholder={keywordHint} /></div>
      <label className={ui.note} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={ni} onChange={e => setNi(e.target.checked)} /> noindex (להסתיר מגוגל)</label>
      <div className={ui.actions}>
        <button type="submit" className={`${ui.btn} ${ui.small} ${ui.primary}`} disabled={pending}>שמירה</button>
        <button type="button" className={`${ui.btn} ${ui.small}`} onClick={() => setOpen(false)}>ביטול</button>
        {msg ? <span className={msg.ok ? ui.ok : ui.error}>{msg.text}</span> : null}
      </div>
    </form>
  );
}
