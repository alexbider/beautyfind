import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminShell } from '@/components/ops/AdminShell';
import { areaLevel, requireArea } from '@/components/ops/guard';
import { atLeast } from '@/components/ops/roles';
import { Card, Check, Chip, Empty, PageHead, Pills, dayMonthIL, int, nisAgorot, ui } from '@/components/ops/ui';
import { CATEGORIES, REGIONS } from '@/lib/catalog';
import { platformSettings } from '@/lib/server/platformSettings';
import { SPONSORED_LINE_MAX, weekEnd } from '@/lib/sponsoredChecks';
import { listCampaigns, orderableBranches, STATUS_NAME, STATUS_TONE } from './data';
import { OrderForm, ReviewButtons } from './SponsoredForms';

export const metadata: Metadata = { title: 'מקומות ממומנים · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function SponsoredPage({ searchParams }: { searchParams: SP }) {
  const user = await requireArea('sponsored', 'view', '/ops/sponsored');
  const filter = one((await searchParams).filter) === 'all' ? 'all' : 'pending';
  const [level, rows, s, branches] = await Promise.all([areaLevel(user, 'sponsored'), listCampaigns(filter), platformSettings(), orderableBranches()]);
  const canEdit = atLeast(level, 'edit');

  return (
    <AdminShell user={user}>
      <PageHead
        eyebrow="תפעול" title="מקומות ממומנים"
        lead={<>כל מקום נבדק לפני שהוא עולה ולפני חיוב. עד {int(s.sponsoredMaxPerList)} ממומנים בכל רשימה. אסור: הבטחת תוצאה, ״ללא סיכון״ או ״ללא כאב״, טענת עליונות, מחיר רפואי ״חינם״, ותמונות לפני/אחרי בטיפול רפואי. חיוב רק אחרי אישור.</>}
      />
      <div className={ui.split}>
        <div className={ui.stack}>
          <Pills current={filter} items={[{ key: 'pending', name: 'לבדיקה', href: '/ops/sponsored' }, { key: 'all', name: 'הכול', href: '/ops/sponsored?filter=all' }]} />
          {rows.length ? rows.map(c => (
            <Card
              key={c.id}
              title={<><Link href={`/ops/businesses/${c.businessId}`} className={ui.rowLink}>{c.branchName}</Link></>}
              sub={`${c.ref} · ${c.categoryName} · ${c.regionName} · ${dayMonthIL(c.weekStart)}–${dayMonthIL(weekEnd(c.weekStart, c.weeks))} · ${c.weeks === 1 ? 'שבוע' : c.weeks === 2 ? 'שבועיים' : `${c.weeks} שבועות`}`}
              aside={<Chip tone={STATUS_TONE[c.status]}>{STATUS_NAME[c.status]}</Chip>}
            >
              <p style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 700, color: '#0C243E' }}>״{c.line}״</p>
              <p className={ui.note} style={{ margin: '0 0 12px' }}>{c.featuredTreatment ? `מבליט: ${c.featuredTreatment} · ` : ''}{nisAgorot(c.totalAgorot)} ללא מע״מ ישראלי{c.discountPct ? ` · כולל ${c.discountPct}% הנחה` : ''}</p>
              {c.checks.map((k, i) => <Check key={i} tone={k.result}>{k.text}</Check>)}
              {c.reviewNote ? <p className={ui.note} style={{ marginTop: 8 }}><b>הערת הבדיקה:</b> {c.reviewNote}</p> : null}
              {canEdit && c.status === 'pending_review' ? <div style={{ marginTop: 12 }}><ReviewButtons id={c.id} blocking={c.blocking} /></div> : null}
            </Card>
          )) : (
            <Card><Empty title={filter === 'pending' ? 'אין מקומות ממומנים לבדיקה' : 'עוד לא הוזמנו מקומות ממומנים'} text="הזמנה חדשה נכנסת לכאן מהעסק או מהטופס בצד, ונבדקת לפני שהיא עולה." /></Card>
          )}
        </div>
        <Card title="הזמנה ידנית" sub={`₪${int(s.sponsoredWeeklyNis)} לשבוע`}>
          {canEdit ? (
            <OrderForm
              branches={branches.map(b => ({ id: b.id, name: b.name, cityName: b.cityName, regionSlug: b.regionSlug, categories: b.categories.sort((a, z) => Number(z.isPrimary) - Number(a.isPrimary)).map(c => c.categorySlug) }))}
              regions={REGIONS.map(r => ({ slug: r.slug, name: r.name }))} categories={CATEGORIES.map(c => ({ slug: c.slug, name: c.name }))} weeklyNis={s.sponsoredWeeklyNis} lineMax={SPONSORED_LINE_MAX}
            />
          ) : <p className={ui.note}>לתפקיד שלך יש צפייה בלבד במקומות ממומנים.</p>}
        </Card>
      </div>
    </AdminShell>
  );
}
