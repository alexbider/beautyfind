'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ui } from '@/components/ops/ui';
import { saveBusinessDetailsAction } from './actions';

export interface BusinessDetails { id: string; legalName: string; companyNo: string; type: 'clinic' | 'medspa' | 'cosmetics' | 'salon'; invoiceEmail: string; accountantEmail: string; chainKey: string }
const TYPE_NAME = { clinic: 'מרפאה (רופא/ה מבצע/ת)', medspa: 'מדספא (קוסמטיקה + רפואה)', cosmetics: 'קוסמטיקה (ללא הזרקות)', salon: 'סלון / עסק אחר' } as const;

export function BusinessDetailsForm({ initial, canEdit }: { initial: BusinessDetails; canEdit: boolean }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (p: Partial<BusinessDetails>) => setF(prev => ({ ...prev, ...p }));
  const ro = !canEdit;
  return (
    <form className={ui.stack} style={{ gap: 10 }} onSubmit={e => { e.preventDefault(); start(async () => { const r = await saveBusinessDetailsAction(f); setMsg(r.ok ? { ok: true, text: 'נשמר' } : { ok: false, text: r.error }); if (r.ok) router.refresh(); }); }}>
      <div className={ui.field}><label className={ui.label}>שם משפטי</label><input className={ui.input} value={f.legalName} disabled={ro} maxLength={200} onChange={e => set({ legalName: e.target.value })} /></div>
      <div className={ui.field}><label className={ui.label}>ח.פ. / ע.מ. (9 ספרות, לא מוצג בפומבי)</label><input className={ui.input} dir="ltr" inputMode="numeric" value={f.companyNo} disabled={ro} maxLength={12} onChange={e => set({ companyNo: e.target.value })} /></div>
      <div className={ui.field}><label className={ui.label}>סוג העסק</label><select className={ui.select} value={f.type} disabled={ro} onChange={e => set({ type: e.target.value as BusinessDetails['type'] })}>{Object.entries(TYPE_NAME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <div className={ui.field}><label className={ui.label}>דוא״ל לחשבוניות</label><input className={ui.input} dir="ltr" type="email" value={f.invoiceEmail} disabled={ro} maxLength={160} onChange={e => set({ invoiceEmail: e.target.value })} /></div>
      <div className={ui.field}><label className={ui.label}>דוא״ל רואה חשבון</label><input className={ui.input} dir="ltr" type="email" value={f.accountantEmail} disabled={ro} maxLength={160} onChange={e => set({ accountantEmail: e.target.value })} /></div>
      <div className={ui.field}><label className={ui.label}>מפתח רשת (דומיין משותף לסניפים)</label><input className={ui.input} dir="ltr" value={f.chainKey} disabled={ro} maxLength={120} onChange={e => set({ chainKey: e.target.value })} /></div>
      {canEdit ? <div className={ui.actions}><button type="submit" className={`${ui.btn} ${ui.small} ${ui.primary}`} disabled={pending}>שמירת פרטי העסק</button>{msg ? <span className={msg.ok ? ui.ok : ui.error}>{msg.text}</span> : null}</div> : null}
    </form>
  );
}
