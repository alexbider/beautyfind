'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Toggle } from '@/components/ops/Toggle';
import { ui } from '@/components/ops/ui';
import { runGoogleIndexingAction, saveGoogleIndexingLimitsAction, setGoogleIndexingFlagAction, testGoogleIndexingAction } from './actions';

// The controls of the Google tab: switches that save on change, the quotas and property form, and the
// test and run buttons. The server actions check the permission and log every change.

export function GoogleToggle({ name, checked, title, sub, canEdit }: { name: string; checked: boolean; title: string; sub?: string; canEdit: boolean }) {
  return <Toggle name={name} checked={checked} title={title} sub={sub} onChange={setGoogleIndexingFlagAction} disabled={!canEdit} />;
}

export function GoogleLimitsForm({ values, defaultProperty, canEdit }: { values: { dailySubmitLimit: number; dailyInspectLimit: number; property: string }; defaultProperty: string; canEdit: boolean }) {
  const router = useRouter();
  const [v, setV] = useState({ dailySubmitLimit: String(values.dailySubmitLimit), dailyInspectLimit: String(values.dailyInspectLimit), property: values.property });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form className={ui.stack} style={{ gap: 0 }} onSubmit={e => { e.preventDefault(); start(async () => { const r = await saveGoogleIndexingLimitsAction(v); setMsg(r.ok ? { ok: true, text: 'נשמר' } : { ok: false, text: r.error }); if (r.ok) router.refresh(); }); }}>
      <div className={ui.setting}>
        <label className={ui.settingLabel} htmlFor="g-submit">שליחות ביום (Indexing API)</label>
        <span className={ui.settingInput}><input id="g-submit" className={ui.input} type="number" min={1} max={2000} value={v.dailySubmitLimit} disabled={!canEdit} onChange={e => setV({ ...v, dailySubmitLimit: e.target.value })} /><span className={ui.unit}>כתובות</span></span>
      </div>
      <div className={ui.setting}>
        <label className={ui.settingLabel} htmlFor="g-inspect">בדיקות ביום (URL Inspection)</label>
        <span className={ui.settingInput}><input id="g-inspect" className={ui.input} type="number" min={0} max={2000} value={v.dailyInspectLimit} disabled={!canEdit} onChange={e => setV({ ...v, dailyInspectLimit: e.target.value })} /><span className={ui.unit}>כתובות</span></span>
      </div>
      <div className={ui.field} style={{ padding: '12px 0' }}>
        <label className={ui.label} htmlFor="g-prop">נכס ב־Search Console</label>
        <input id="g-prop" className={ui.input} dir="ltr" placeholder={defaultProperty} value={v.property} disabled={!canEdit} onChange={e => setV({ ...v, property: e.target.value })} />
        <span className={ui.hint}>ריק: {defaultProperty}. לנכס דומיין: sc-domain:beautyfind.co.il</span>
      </div>
      {canEdit ? <div className={ui.actions}><button type="submit" className={`${ui.btn} ${ui.small}`} disabled={pending}>שמירה</button>{msg ? <span className={msg.ok ? ui.ok : ui.error}>{msg.text}</span> : null}</div> : null}
    </form>
  );
}

export function GoogleRunButtons({ canEdit, configured }: { canEdit: boolean; configured: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const go = (fn: () => Promise<{ ok: true; text: string } | { ok: false; error: string }>) => start(async () => { setMsg(null); const r = await fn(); setMsg(r.ok ? { ok: true, text: r.text } : { ok: false, text: r.error }); router.refresh(); });
  return (
    <div className={ui.stack} style={{ gap: 8 }}>
      <div className={ui.actions}>
        <button type="button" className={ui.btn} disabled={pending || !configured} onClick={() => go(testGoogleIndexingAction)}>בדיקת חיבור</button>
        {canEdit ? <button type="button" className={`${ui.btn} ${ui.primary}`} disabled={pending || !configured} onClick={() => go(runGoogleIndexingAction)}>{pending ? 'רץ…' : 'הרצה עכשיו'}</button> : null}
      </div>
      {msg ? <span className={msg.ok ? ui.ok : ui.error} role="status">{msg.text}</span> : null}
    </div>
  );
}
