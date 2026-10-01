import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminShell } from '@/components/ops/AdminShell';
import { requireArea } from '@/components/ops/guard';
import { Card, Chip, Empty, Kpis, PageHead, Pills, Table, int, nisWhole, ui } from '@/components/ops/ui';
import { businessStats, mrr } from '@/lib/server/opsStats';
import { BIZ_FILTERS, businessCounts, listBusinesses, PLAN_NAME, STATUS_NAME, STATUS_TONE, type BizFilter } from './data';

export const metadata: Metadata = { title: 'עסקים · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function BusinessesPage({ searchParams }: { searchParams: SP }) {
  const user = await requireArea('businesses', 'view', '/ops/businesses');
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 80);
  const filter = (BIZ_FILTERS.some(f => f.key === one(sp.status)) ? one(sp.status) : 'all') as BizFilter;
  const [{ rows, total }, counts, m, stats] = await Promise.all([listBusinesses({ filter, q }), businessCounts(), mrr(), businessStats()]);
  const href = (key: BizFilter) => `/ops/businesses?status=${key}${q ? `&q=${encodeURIComponent(q)}` : ''}`;

  return (
    <AdminShell user={user}>
      <PageHead
        eyebrow="תפעול" title="עסקים" lead="כל העסקים והסניפים: מסלול, אחריות מקצועית ומצב חיוב."
        actions={<Link href={`/ops/businesses/export?status=${filter}${q ? `&q=${encodeURIComponent(q)}` : ''}`} className={ui.btn}>ייצוא CSV</Link>}
      />
      <Kpis
        items={[
          { label: 'עסקים פעילים', value: int(stats.live), note: stats.newThisMonth ? `+${int(stats.newThisMonth)} החודש` : 'ללא חדשים החודש', tone: stats.newThisMonth ? 'ok' : undefined },
          { label: 'סניפים בחיוב', value: int(m.branches), note: `${int(m.basicBranches)} בסיסי · ${int(m.advancedBranches)} מתקדם` },
          { label: 'באחריות רפואית', value: int(stats.medical), note: 'סניפים עם רופא/ה אחראי/ת' },
          { label: 'ממתינים לאימות', value: int(stats.pending), note: 'הרשמה או בעלות', tone: stats.pending ? 'warn' : undefined },
        ]}
      />
      <div className={ui.toolbar}>
        <form method="get" action="/ops/businesses" className={ui.toolbarGrow} role="search">
          <input type="hidden" name="status" value={filter} />
          <input name="q" defaultValue={q} className={ui.input} placeholder="שם, עיר, אזור או ע.מ." aria-label="חיפוש עסקים" />
        </form>
        <Pills current={filter} items={BIZ_FILTERS.map(f => ({ key: f.key, name: f.name, count: counts[f.key], href: href(f.key) }))} />
      </div>
      <Card flush>
        {rows.length ? (
          <Table head={['עסק', 'אזור', 'תחום', 'סניפים', 'מסלול', 'חיוב חודשי', 'אחריות', 'מצב']} foot={`${int(total)} עסקים${total > rows.length ? ` · מוצגים ${int(rows.length)} הראשונים, צמצמו עם חיפוש` : ''} · לחיצה על שם העסק פותחת כרטיס מלא`}>
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
                <td><Chip tone={STATUS_TONE[r.status]}>{r.status === 'hidden' && !r.plan ? 'מוסתר · ללא מנוי' : STATUS_NAME[r.status]}</Chip></td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty title="אין עסקים בסינון הזה" text={q ? 'נסו חיפוש אחר.' : 'עסקים נוספים מצטרפים דרך ההרשמה, תביעת בעלות או הייבוא.'} />
        )}
      </Card>
    </AdminShell>
  );
}
