'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { ui } from '@/components/ops/ui';
import { createCampaignAction, reviewCampaignAction } from './actions';

export function ReviewButtons({ id, blocking }: { id: string; blocking: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const run = (decision: 'approve' | 'reject') => {
    const note = decision === 'reject' ? window.prompt('הסבר לעסק (נשלח עם הדחייה):', '') : window.prompt('הערה (רשות):', '');
    if (note === null) return;
    start(async () => {
      const r = await reviewCampaignAction({ id, decision, note });
      if (!r.ok) setErr(r.error);
      else router.refresh();
    });
  };
  return (
    <div className={ui.actions}>
      <button type="button" className={`${ui.btn} ${ui.teal}`} disabled={pending || blocking} title={blocking ? 'יש ממצאים חוסמים' : undefined} onClick={() => run('approve')}>אישור וחיוב</button>
      <button type="button" className={`${ui.btn} ${ui.danger}`} disabled={pending} onClick={() => run('reject')}>דחייה עם הסבר</button>
      {err ? <span className={ui.error}>{err}</span> : null}
    </div>
  );
}

export type BranchOption = { id: string; name: string; cityName: string; regionSlug: string; categories: string[] };

export function OrderForm({ branches, regions, categories, weeklyNis, lineMax }: { branches: BranchOption[]; regions: Array<{ slug: string; name: string }>; categories: Array<{ slug: string; name: string }>; weeklyNis: number; lineMax: number }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [branchId, setBranchId] = useState('');
  const [region, setRegion] = useState('');
  const [category, setCategory] = useState('');
  const [weeks, setWeeks] = useState(1);
  const [weekStart, setWeekStart] = useState('');
  const [line, setLine] = useState('');
  const [featured, setFeatured] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const matches = useMemo(() => (q.trim().length < 2 ? [] : branches.filter(b => `${b.name} ${b.cityName}`.includes(q.trim())).slice(0, 8)), [q, branches]);
  const chosen = branches.find(b => b.id === branchId);
  const total = weeklyNis * weeks * (weeks >= 4 ? 0.9 : 1);
  return (
    <form
      className={ui.stack} style={{ gap: 10 }}
      onSubmit={e => {
        e.preventDefault();
        start(async () => {
          const r = await createCampaignAction({ branchId, region, category, weeks, weekStart: weekStart || undefined, line, featuredTreatment: featured || undefined });
          setMsg(r.ok ? { ok: true, text: `נוצר ${r.ref} ונכנס לבדיקה` } : { ok: false, text: r.error });
          if (r.ok) { setLine(''); setFeatured(''); router.refresh(); }
        });
      }}
    >
      <div className={ui.field}>
        <label className={ui.label} htmlFor="sp-q">סניף</label>
        <input id="sp-q" className={ui.input} value={chosen ? `${chosen.name} · ${chosen.cityName}` : q} onChange={e => { setBranchId(''); setQ(e.target.value); }} placeholder="הקלידו שם עסק" required />
        {!chosen && matches.length ? (
          <div className={ui.pills} style={{ marginTop: 6 }}>
            {matches.map(b => <button key={b.id} type="button" className={ui.pill} onClick={() => { setBranchId(b.id); setRegion(b.regionSlug); setCategory(b.categories[0] ?? ''); }}>{b.name} · {b.cityName}</button>)}
          </div>
        ) : null}
      </div>
      <div className={ui.formGrid}>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="sp-region">אזור</label>
          <select id="sp-region" className={ui.select} value={region} onChange={e => setRegion(e.target.value)} required>
            <option value="">בחירה</option>
            {regions.map(r => <option key={r.slug} value={r.slug}>{r.name}</option>)}
          </select>
        </div>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="sp-cat">תחום</label>
          <select id="sp-cat" className={ui.select} value={category} onChange={e => setCategory(e.target.value)} required>
            <option value="">בחירה</option>
            {categories.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </div>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="sp-week">שבוע התחלה (יום ראשון)</label>
          <input id="sp-week" type="date" className={ui.input} value={weekStart} onChange={e => setWeekStart(e.target.value)} />
          <span className={ui.hint}>ריק = יום ראשון הקרוב</span>
        </div>
        <div className={ui.field}>
          <label className={ui.label} htmlFor="sp-weeks">שבועות</label>
          <input id="sp-weeks" type="number" min={1} max={12} className={ui.input} value={weeks} onChange={e => setWeeks(Math.max(1, Math.min(12, Number(e.target.value) || 1)))} />
          <span className={ui.hint}>מ־4 שבועות: 10% הנחה</span>
        </div>
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="sp-line">שורת הפרסום (עד {lineMax} תווים)</label>
        <input id="sp-line" className={ui.input} value={line} onChange={e => setLine(e.target.value)} maxLength={lineMax} required placeholder="למשל: בוטוקס טבעי, ייעוץ עם רופא עור" />
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="sp-feat">טיפול מודגש (רשות)</label>
        <input id="sp-feat" className={ui.input} value={featured} onChange={e => setFeatured(e.target.value)} maxLength={80} />
      </div>
      <div className={ui.actions}>
        <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={pending || !branchId}>יצירת הזמנה לבדיקה</button>
        <span className={ui.note}>{Math.round(total).toLocaleString('en-US')} ₪ לפני בדיקה · ללא מע״מ ישראלי</span>
        {msg ? <span className={msg.ok ? ui.ok : ui.error}>{msg.text}</span> : null}
      </div>
    </form>
  );
}
