'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { ui } from '@/components/ops/ui';
import { pageKeyOf, type PageTarget } from '@/lib/sponsored';
import { cancelCampaignAction, createCampaignAction, reviewCampaignAction } from './actions';

export function ReviewButtons({ id, blocking }: { id: string; blocking: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (decision: 'approve' | 'reject') => {
    const note = decision === 'reject' ? window.prompt('הסבר לעסק (נשלח עם הדחייה):', '') : window.prompt('הערה (רשות):', '');
    if (note === null) return;
    start(async () => {
      const r = await reviewCampaignAction({ id, decision, note });
      if (!r.ok) setMsg({ ok: false, text: r.error });
      else {
        if (r.message) setMsg({ ok: true, text: r.message });
        router.refresh();
      }
    });
  };
  return (
    <div className={ui.actions}>
      <button type="button" className={`${ui.btn} ${ui.teal}`} disabled={pending || blocking} title={blocking ? 'יש ממצאים חוסמים' : undefined} onClick={() => run('approve')}>אישור והפעלה</button>
      <button type="button" className={`${ui.btn} ${ui.danger}`} disabled={pending} onClick={() => run('reject')}>דחייה עם הסבר</button>
      {msg ? <span className={msg.ok ? ui.ok : ui.error}>{msg.text}</span> : null}
    </div>
  );
}

export function CancelButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className={ui.actions}>
      <button
        type="button" className={ui.btn} disabled={pending}
        onClick={() => {
          if (!window.confirm('לבטל את המקום? לפני שעלה: מבוטל מיד עם החזר מלא. אחרי שעלה: ממשיך עד סוף החודש ששולם ולא מתחדש.')) return;
          start(async () => {
            const r = await cancelCampaignAction(id);
            setMsg(r.ok ? { ok: true, text: r.message ?? 'בוטל' } : { ok: false, text: r.error });
            if (r.ok) router.refresh();
          });
        }}
      >ביטול המקום</button>
      {msg ? <span className={msg.ok ? ui.ok : ui.error}>{msg.text}</span> : null}
    </div>
  );
}

export type BranchOption = { id: string; name: string; cityName: string; regionSlug: string; citySlug: string | null; categories: string[] };

type Where = 'city_list' | 'treatment_page' | 'homepage';

export function OrderForm({ branches, categories, listNis, homeNis, lineMax }: { branches: BranchOption[]; regions: Array<{ slug: string; name: string }>; categories: Array<{ slug: string; name: string }>; listNis: number; homeNis: number; lineMax: number }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [branchId, setBranchId] = useState('');
  const [where, setWhere] = useState<Where>('city_list');
  const [category, setCategory] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [line, setLine] = useState('');
  const [featured, setFeatured] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const matches = useMemo(() => (q.trim().length < 2 ? [] : branches.filter(b => `${b.name} ${b.cityName}`.includes(q.trim())).slice(0, 8)), [q, branches]);
  const chosen = branches.find(b => b.id === branchId);
  const catName = (slug: string) => categories.find(c => c.slug === slug)?.name ?? slug;

  let target: PageTarget | null = null;
  if (chosen && where === 'homepage') target = { placement: 'homepage' };
  else if (chosen && category && where === 'treatment_page') target = { placement: 'treatment_page', category };
  else if (chosen && category && chosen.citySlug) target = { placement: 'city_list', region: chosen.regionSlug, city: chosen.citySlug, category };
  const price = where === 'homepage' ? homeNis : listNis;

  return (
    <form
      className={ui.stack} style={{ gap: 10 }}
      onSubmit={e => {
        e.preventDefault();
        if (!target || !chosen) return;
        start(async () => {
          const r = await createCampaignAction({ branchId: chosen.id, pageKey: pageKeyOf(target!), startsAt: startsAt || undefined, line, featuredTreatment: featured || undefined });
          setMsg(r.ok ? { ok: true, text: `נוצר ${r.ref} ונכנס לבדיקה${r.message ? ` · ${r.message}` : ''}` } : { ok: false, text: r.error });
          if (r.ok) { setLine(''); setFeatured(''); router.refresh(); }
        });
      }}
    >
      <div className={ui.field}>
        <label className={ui.label} htmlFor="sp-q">סניף</label>
        <input id="sp-q" className={ui.input} value={chosen ? `${chosen.name} · ${chosen.cityName}` : q} onChange={e => { setBranchId(''); setQ(e.target.value); }} placeholder="הקלידו שם עסק" required />
        {!chosen && matches.length ? (
          <div className={ui.pills} style={{ marginTop: 6 }}>
            {matches.map(b => <button key={b.id} type="button" className={ui.pill} onClick={() => { setBranchId(b.id); setCategory(b.categories[0] ?? ''); }}>{b.name} · {b.cityName}</button>)}
          </div>
        ) : null}
      </div>
      <div className={ui.field}>
        <span className={ui.label}>איפה</span>
        <div className={ui.pills}>
          {([['city_list', 'רשימת העיר והתחום'], ['treatment_page', 'עמוד התחום'], ['homepage', 'עמוד הבית']] as const).map(([k, n]) => (
            <button key={k} type="button" className={ui.pill} aria-pressed={where === k} style={where === k ? { background: '#0B7A87', color: '#fff', borderColor: '#0B7A87' } : undefined} onClick={() => setWhere(k)}>{n}</button>
          ))}
        </div>
      </div>
      {where !== 'homepage' ? (
        <div className={ui.field}>
          <label className={ui.label} htmlFor="sp-cat">תחום</label>
          <select id="sp-cat" className={ui.select} value={category} onChange={e => setCategory(e.target.value)} required disabled={!chosen}>
            <option value="">בחירה</option>
            {(chosen?.categories ?? []).map(c => <option key={c} value={c}>{catName(c)}</option>)}
          </select>
          {chosen && where === 'city_list' && !chosen.citySlug ? <span className={ui.error}>לסניף אין עיר מהקטלוג, אז אין לו רשימת עיר</span> : null}
        </div>
      ) : null}
      <div className={ui.field}>
        <label className={ui.label} htmlFor="sp-start">התחלה</label>
        <input id="sp-start" type="date" className={ui.input} value={startsAt} onChange={e => setStartsAt(e.target.value)} />
        <span className={ui.hint}>ריק = מיד אחרי האישור</span>
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="sp-line">שורת הפרסום (עד {lineMax} תווים)</label>
        <input id="sp-line" className={ui.input} value={line} onChange={e => setLine(e.target.value)} maxLength={lineMax} required placeholder="למשל: טיפולי פנים עם קוסמטיקאית מוסמכת, תורים גם בערב" />
      </div>
      <div className={ui.field}>
        <label className={ui.label} htmlFor="sp-feat">טיפול מודגש (רשות)</label>
        <input id="sp-feat" className={ui.input} value={featured} onChange={e => setFeatured(e.target.value)} maxLength={80} />
      </div>
      <div className={ui.actions}>
        <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={pending || !target}>יצירת הזמנה לבדיקה</button>
        <span className={ui.note}>{price.toLocaleString('en-US')} ₪ לחודש · ללא מע״מ ישראלי</span>
        {msg ? <span className={msg.ok ? ui.ok : ui.error}>{msg.text}</span> : null}
      </div>
    </form>
  );
}
