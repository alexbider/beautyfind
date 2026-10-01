import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminShell } from '@/components/ops/AdminShell';
import { areaLevel, requireArea } from '@/components/ops/guard';
import { atLeast } from '@/components/ops/roles';
import { Card, Chip, Empty, Kpis, PageHead, Pills, Table, Tabs, int, nisWhole, ui } from '@/components/ops/ui';
import { CATEGORIES, REGIONS, citiesOf, type RegionSlug } from '@/lib/catalog';
import { SECTION_NAME, STATUS_NAME } from '@/lib/import/coverage';
import { GAP_SECTIONS, listGaps } from '@/lib/server/enhanceRuns';
import { businessStats, mrr } from '@/lib/server/opsStats';
import { BIZ_FILTERS, businessCounts, listBusinesses, PLAN_NAME, STATUS_NAME as BIZ_STATUS, STATUS_TONE, type BizFilter } from './data';
import { GapsList } from './GapsList';
import gaps from './gaps.module.css';

export const metadata: Metadata = { title: 'עסקים · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // the gaps view scores every listing against the template

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const GAP_STATUSES = ['needs_review', 'needs_owner_information', 'ready_with_disclosed_gaps', 'ready'] as const;

export default async function BusinessesPage({ searchParams }: { searchParams: SP }) {
  const user = await requireArea('businesses', 'view', '/ops/businesses');
  const sp = await searchParams;
  const view = one(sp.view) === 'gaps' ? 'gaps' : 'list';
  const q = one(sp.q).slice(0, 80);
  const filter = (BIZ_FILTERS.some(f => f.key === one(sp.status)) ? one(sp.status) : 'all') as BizFilter;
  const region = REGIONS.some(r => r.slug === one(sp.region)) ? one(sp.region) : '';
  const city = one(sp.city).slice(0, 80);
  const category = CATEGORIES.some(c => c.slug === one(sp.cat)) ? one(sp.cat) : '';
  const claimed = (['claimed', 'unclaimed'].includes(one(sp.claimed)) ? one(sp.claimed) : 'all') as 'all' | 'claimed' | 'unclaimed';
  const plan = (['basic', 'advanced', 'none'].includes(one(sp.plan)) ? one(sp.plan) : 'all') as 'all' | 'basic' | 'advanced' | 'none';
  const missing = GAP_SECTIONS.includes(one(sp.missing)) ? one(sp.missing) : '';
  const gstatus = (GAP_STATUSES as readonly string[]).includes(one(sp.gstatus)) ? one(sp.gstatus) : '';
  const level = await areaLevel(user, 'businesses');
  const canEdit = atLeast(level, 'edit');
  const keep = { q, region, city, cat: category, claimed, plan, missing, gstatus };
  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...keep, ...over })) if (v && v !== 'all') p.set(k, v);
    const str = p.toString();
    return `/ops/businesses${str ? `?${str}` : ''}`;
  };

  return (
    <AdminShell user={user}>
      <PageHead
        eyebrow="תפעול" title="עסקים" lead="כל העסקים והסניפים: מסלול, אחריות מקצועית ומצב חיוב. עריכה מלאה של כל פרופיל, והשלמה ב־AI לרישום אחד או לקבוצה לפי החסרים."
        actions={<Link href={`/ops/businesses/export?status=${filter}${q ? `&q=${encodeURIComponent(q)}` : ''}`} className={ui.btn}>ייצוא CSV</Link>}
      />
      <Tabs label="תצוגה" current={view} items={[{ key: 'list', name: 'רשימת עסקים', href: qs({ view: '' }) }, { key: 'gaps', name: 'חוסרים והשלמה ב־AI', href: qs({ view: 'gaps' }) }]} />

      <form method="get" action="/ops/businesses" className={`${ui.toolbar}`} role="search">
        {view === 'gaps' ? <input type="hidden" name="view" value="gaps" /> : null}
        <input type="hidden" name="status" value={filter} />
        <div className={gaps.filters}>
          <input name="q" defaultValue={q} className={ui.input} placeholder="שם, עיר או ע.מ." aria-label="חיפוש" />
          <select name="region" defaultValue={region} className={ui.select} aria-label="אזור"><option value="">כל האזורים</option>{REGIONS.map(r => <option key={r.slug} value={r.slug}>{r.name}</option>)}</select>
          <select name="city" defaultValue={city} className={ui.select} aria-label="עיר"><option value="">כל הערים</option>{(region ? citiesOf(region as RegionSlug) : []).map(c => <option key={c.slug} value={c.name}>{c.name}</option>)}{city && !(region && citiesOf(region as RegionSlug).some(c => c.name === city)) ? <option value={city}>{city}</option> : null}</select>
          <select name="cat" defaultValue={category} className={ui.select} aria-label="תחום"><option value="">כל התחומים</option>{CATEGORIES.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select>
          <select name="claimed" defaultValue={claimed} className={ui.select} aria-label="בעלות"><option value="all">בעלות: הכול</option><option value="unclaimed">לא נתבעו (ניתנים להשלמה)</option><option value="claimed">בבעלות מאומתת</option></select>
          {view === 'list' ? (
            <select name="plan" defaultValue={plan} className={ui.select} aria-label="מסלול"><option value="all">מסלול: הכול</option><option value="basic">בסיסי</option><option value="advanced">מתקדם</option><option value="none">ללא מנוי</option></select>
          ) : (
            <>
              <select name="missing" defaultValue={missing} className={ui.select} aria-label="סעיף חסר"><option value="">חסר: הכול</option>{GAP_SECTIONS.map(id => <option key={id} value={id}>חסר: {SECTION_NAME[id] ?? id}</option>)}</select>
              <select name="gstatus" defaultValue={gstatus} className={ui.select} aria-label="מצב פרופיל"><option value="">מצב: הכול</option>{GAP_STATUSES.map(st => <option key={st} value={st}>{STATUS_NAME[st]}</option>)}</select>
            </>
          )}
          <button type="submit" className={`${ui.btn} ${ui.primary}`}>סינון</button>
        </div>
      </form>

      {view === 'list' ? <ListView filter={filter} q={q} region={region} category={category} claimed={claimed} plan={plan} qs={qs} /> : <GapsView region={region} city={city} category={category} q={q} claimed={claimed} missing={missing} gstatus={gstatus} canEdit={canEdit} />}
    </AdminShell>
  );
}

async function ListView({ filter, q, region, category, claimed, plan, qs }: { filter: BizFilter; q: string; region: string; category: string; claimed: 'all' | 'claimed' | 'unclaimed'; plan: 'all' | 'basic' | 'advanced' | 'none'; qs: (o: Record<string, string>) => string }) {
  const [{ rows, total }, counts, m, stats] = await Promise.all([listBusinesses({ filter, q, region, category, claimed, plan }), businessCounts(), mrr(), businessStats()]);
  return (
    <>
      <Kpis
        items={[
          { label: 'עסקים פעילים', value: int(stats.live), note: stats.newThisMonth ? `+${int(stats.newThisMonth)} החודש` : 'ללא חדשים החודש', tone: stats.newThisMonth ? 'ok' : undefined },
          { label: 'סניפים בחיוב', value: int(m.branches), note: `${int(m.basicBranches)} בסיסי · ${int(m.advancedBranches)} מתקדם` },
          { label: 'באחריות רפואית', value: int(stats.medical), note: 'סניפים עם רופא/ה אחראי/ת' },
          { label: 'ממתינים לאימות', value: int(stats.pending), note: 'הרשמה או בעלות', tone: stats.pending ? 'warn' : undefined },
        ]}
      />
      <div className={ui.toolbar}>
        <Pills current={filter} items={BIZ_FILTERS.map(f => ({ key: f.key, name: f.name, count: counts[f.key], href: qs({ status: f.key }) }))} />
      </div>
      <Card flush>
        {rows.length ? (
          <Table head={['עסק', 'אזור', 'תחום', 'סניפים', 'מסלול', 'חיוב חודשי', 'אחריות', 'מצב']} foot={`${int(total)} עסקים${total > rows.length ? ` · מוצגים ${int(rows.length)} הראשונים, צמצמו עם סינון` : ''} · לחיצה על שם העסק פותחת כרטיס מלא עם עריכת כל סניף`}>
            {rows.map(r => (
              <tr key={r.id}>
                <td>
                  <Link href={`/ops/businesses/${r.id}`} className={ui.rowLink}>{r.name}</Link>
                  <span className={ui.sub}>{r.city}{r.companyNo ? <> · ע.מ. <span dir="ltr">{r.companyNo}</span></> : ''}{r.claimed ? ' · בבעלות מאומתת' : ''}</span>
                </td>
                <td>{r.region}</td>
                <td>{r.category}</td>
                <td className={ui.num}>{int(r.branches)}{r.liveBranches !== r.branches ? <span className={ui.sub}>{int(r.liveBranches)} חיים</span> : null}</td>
                <td>{r.plan ? PLAN_NAME[r.plan] : <span className={ui.sub}>ללא מנוי</span>}</td>
                <td className={`${ui.num} ${ui.strong}`}>{r.monthlyNis != null ? nisWhole(r.monthlyNis) : '—'}</td>
                <td>
                  {r.responsible ?? (r.status === 'pending' ? 'ממתין לאימות רישיון' : '—')}
                  <span className={ui.sub}>{r.responsibility === 'medical' ? 'אחריות רפואית' : 'איש מקצוע אחראי'}</span>
                </td>
                <td><Chip tone={STATUS_TONE[r.status]}>{r.status === 'hidden' && !r.plan ? 'מוסתר · ללא מנוי' : BIZ_STATUS[r.status]}</Chip></td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty title="אין עסקים בסינון הזה" text={q ? 'נסו חיפוש אחר.' : 'עסקים נוספים מצטרפים דרך ההרשמה, תביעת בעלות או הייבוא.'} />
        )}
      </Card>
    </>
  );
}

async function GapsView({ region, city, category, q, claimed, missing, gstatus, canEdit }: { region: string; city: string; category: string; q: string; claimed: 'all' | 'claimed' | 'unclaimed'; missing: string; gstatus: string; canEdit: boolean }) {
  const { rows, total } = await listGaps({ region, city, category, q, claimed, missing, status: gstatus, live: 'live', take: 1500 });
  const n = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  const bySection = GAP_SECTIONS.map(id => ({ id, n: n(r => r.missing.includes(id)) })).filter(x => x.n).sort((a, b) => b.n - a.n).slice(0, 8);
  return (
    <>
      <Kpis
        items={[
          { label: 'רישומים חיים בסינון', value: int(total), note: `${int(n(r => r.canEnhance))} ניתנים להשלמה אוטומטית` },
          { label: 'מוכנות ממוצעת', value: rows.length ? `${Math.round(rows.reduce((a, r) => a + r.readiness, 0) / rows.length)}%` : '—', note: 'סעיפי התבנית שמולאו ממקור' },
          { label: 'דורשים בדיקה', value: int(n(r => r.status === 'needs_review')), tone: n(r => r.status === 'needs_review') ? 'bad' : undefined, note: 'סתירות או סיבות שצריכות אדם' },
          { label: 'מוכנים', value: int(n(r => r.status === 'ready' || r.status === 'ready_with_disclosed_gaps')), tone: 'ok', note: 'כולל פערים מוצהרים' },
        ]}
      />
      {bySection.length ? (
        <div className={ui.toolbar}>
          <span className={ui.note}>הכי חסר:</span>
          {bySection.map(x => <Chip key={x.id} tone="neutral">{SECTION_NAME[x.id] ?? x.id} · {int(x.n)}</Chip>)}
        </div>
      ) : null}
      <GapsList rows={rows} canEdit={canEdit} total={total} />
    </>
  );
}
