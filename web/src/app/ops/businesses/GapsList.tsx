'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { Chip, ui } from '@/components/ops/ui';
import { CATEGORIES, regionBySlug } from '@/lib/catalog';
import { SECTION_NAME, STATUS_NAME } from '@/lib/import/coverage';
import { STEP_SHORT } from '@/lib/import/enrichPlan';
import type { GapRow } from '@/lib/server/enhanceRuns';
import { enhanceBranchesAction, estimateCompletionAction, type EnhanceMode } from './actions';
import styles from './gaps.module.css';

// The bulk view of the businesses screen: every listing with what its profile is missing, a tick box
// per row, and one button that starts the AI completion for the selection.

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'neutral'> = { ready: 'ok', ready_with_disclosed_gaps: 'ok', needs_owner_information: 'warn', needs_review: 'bad' };
const catName = (slug: string) => CATEGORIES.find(c => c.slug === slug)?.name ?? slug;

export function GapsList({ rows, canEdit, total }: { rows: GapRow[]; canEdit: boolean; total: number }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [est, setEst] = useState<{ listings: number; unseeded: number; plan: Record<string, number>; usd: number } | null>(null);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const eligible = useMemo(() => rows.filter(r => r.canEnhance), [rows]);
  const chosen = [...picked].filter(id => rows.some(r => r.branchId === id));
  const toggle = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allEligible = () => setPicked(new Set(eligible.map(r => r.branchId)));

  const estimate = () => start(async () => {
    const r = await estimateCompletionAction(chosen);
    if (r.ok) setEst(r); else setRes({ ok: false, text: r.error });
  });
  const run = (mode: EnhanceMode) => start(async () => {
    const r = await enhanceBranchesAction(chosen, mode);
    if (!r.ok) { setRes({ ok: false, text: r.error }); return; }
    const parts = [r.count ? `נוצרה ריצה ל־${r.count} רישומים` : 'לא נוצרה ריצה'];
    if (r.seeded) parts.push(`${r.seeded} רשומות ייבוא נוצרו מהרישומים`);
    if (r.skipped.length) parts.push(`דולגו ${r.skipped.length}`);
    if (r.count) parts.push(`תקרה $${r.budgetUsd.toFixed(2)}${r.dispatched === false ? ' · העובד לא הופעל אוטומטית (חסר GITHUB_DISPATCH_TOKEN)' : ''}`);
    setRes({ ok: true, text: parts.join(' · ') });
    setPicked(new Set());
    setEst(null);
    router.refresh();
  });

  return (
    <div className={ui.stack}>
      {canEdit ? (
        <div className={`${ui.card} ${ui.cardPad} ${styles.bar}`}>
          <div className={styles.barText}>
            <strong>{chosen.length ? `${chosen.length} נבחרו` : 'בחרו רישומים'}</strong>
            <span className={ui.sub}>{eligible.length} מתוך {rows.length} ברשימה ניתנים להשלמה אוטומטית{total > rows.length ? ` · הרשימה מוגבלת ל־${rows.length} הראשונים, צמצמו בסינון` : ''}</span>
            {est ? <span className={ui.note}>אומדן: {est.listings} רישומים · {Object.entries(est.plan).map(([k, v]) => `${STEP_SHORT[k as keyof typeof STEP_SHORT] ?? k} ${v}`).join(', ') || 'ללא צעדים'} · כ־${est.usd.toFixed(2)}{est.unseeded ? ` · ${est.unseeded} בלי רשומת ייבוא (תיווצר בהפעלה; האומדן לא כולל אותם)` : ''}</span> : null}
            {res ? <span className={res.ok ? ui.ok : ui.error}>{res.text}</span> : null}
          </div>
          <div className={ui.actions}>
            <button type="button" className={`${ui.btn} ${ui.small}`} onClick={allEligible} disabled={pending}>בחירת כל הניתנים ({eligible.length})</button>
            <button type="button" className={`${ui.btn} ${ui.small}`} onClick={() => setPicked(new Set())} disabled={pending || !chosen.length}>ניקוי</button>
            <button type="button" className={`${ui.btn} ${ui.small}`} onClick={estimate} disabled={pending || !chosen.length}>אומדן</button>
            <button type="button" className={`${ui.btn} ${ui.small} ${ui.teal}`} onClick={() => run('auto')} disabled={pending || !chosen.length}>{pending ? 'רגע…' : 'השלמה ב־AI לנבחרים'}</button>
            <button type="button" className={`${ui.btn} ${ui.small}`} onClick={() => confirm('לכתוב מחדש תיאור ושאלות לכל הנבחרים? טקסט מאושר לא יוחלף.') && run('rewrite')} disabled={pending || !chosen.length}>כתיבה מחדש</button>
          </div>
        </div>
      ) : null}
      <div className={ui.card}>
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead><tr>{canEdit ? <th><input type="checkbox" aria-label="בחירת הכל" checked={chosen.length > 0 && chosen.length === eligible.length} onChange={e => (e.target.checked ? allEligible() : setPicked(new Set()))} /></th> : null}<th>רישום</th><th>מוכנות</th><th>חסר בפרופיל</th><th>תוכנית</th><th>ריצה אחרונה</th><th></th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.branchId} className={!r.canEnhance ? styles.off : undefined}>
                  {canEdit ? <td><input type="checkbox" checked={picked.has(r.branchId)} disabled={!r.canEnhance} onChange={() => toggle(r.branchId)} aria-label={`בחירת ${r.name}`} /></td> : null}
                  <td>
                    <Link href={`/ops/businesses/${r.businessId}/branches/${r.branchId}`} className={ui.rowLink}>{r.name}</Link>
                    <span className={ui.sub}>{r.cityName} · {regionBySlug(r.regionSlug)?.name ?? r.regionSlug} · {r.categories.slice(0, 2).map(catName).join(', ') || 'ללא תחום'}{r.claimed ? ' · בבעלות' : ''}{!r.live ? ' · לא מפורסם' : ''}</span>
                  </td>
                  <td><span className={styles.readiness} data-tone={r.readiness >= 80 ? 'ok' : r.readiness >= 50 ? 'warn' : 'bad'}>{r.readiness}%</span><span className={ui.sub}><Chip tone={STATUS_TONE[r.status] ?? 'neutral'}>{STATUS_NAME[r.status as keyof typeof STATUS_NAME] ?? r.status}</Chip></span></td>
                  <td><div className={styles.chips}>{r.missing.length ? r.missing.map(m => <span key={m} className={styles.gapChip} data-owner={r.ownerOnly.includes(m) || undefined}>{SECTION_NAME[m] ?? m}</span>) : <Chip tone="ok">מלא</Chip>}</div></td>
                  <td className={styles.plan}>{r.why ? <span className={ui.hint}>{r.why}</span> : r.plan.map(p => STEP_SHORT[p]).join(' · ')}</td>
                  <td className={ui.sub}>{r.lastRun ? `${new Date(r.lastRun.at).toLocaleDateString('he-IL')} · ${r.lastRun.skipped ? 'דולג' : r.lastRun.filled.length ? `${r.lastRun.filled.length} שדות` : 'ללא שינוי'}` : 'אף פעם'}</td>
                  <td>{r.live ? <a href={r.href} target="_blank" rel="noreferrer" className={`${ui.btn} ${ui.small}`}>פרופיל</a> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length ? <p className={ui.empty}>אין רישומים בסינון הזה.</p> : null}
      </div>
    </div>
  );
}
