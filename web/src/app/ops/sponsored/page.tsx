import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminShell } from '@/components/ops/AdminShell';
import { areaLevel, requireArea } from '@/components/ops/guard';
import { atLeast } from '@/components/ops/roles';
import { Card, Check, Chip, dateIL, Empty, int, Kpis, nisAgorot, PageHead, Pills, ui } from '@/components/ops/ui';
import { CATEGORIES, REGIONS } from '@/lib/catalog';
import { sponsoredConfig } from '@/lib/server/sponsored';
import { SPONSORED_LINE_MAX } from '@/lib/sponsoredChecks';
import { counts, listCampaigns, orderableBranches, PHASE, type Filter } from './data';
import { CancelButton, OrderForm, ReviewButtons } from './SponsoredForms';

export const metadata: Metadata = { title: 'מקומות ממומנים · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function SponsoredPage({ searchParams }: { searchParams: SP }) {
  const user = await requireArea('sponsored', 'view', '/ops/sponsored');
  const f = one((await searchParams).filter);
  const filter: Filter = f === 'all' ? 'all' : f === 'live' ? 'live' : 'pending';
  const [level, rows, cfg, branches, n] = await Promise.all([areaLevel(user, 'sponsored'), listCampaigns(filter), sponsoredConfig(), orderableBranches(), counts()]);
  const canEdit = atLeast(level, 'edit');
  const monthlyRevenue = rows.filter(r => r.phase === 'live' || r.phase === 'ending').reduce((s, r) => s + r.monthlyPriceAgorot, 0);

  return (
    <AdminShell user={user}>
      <PageHead
        eyebrow="תפעול" title="מקומות ממומנים"
        lead={<>מקום ממומן הוא כרטיס בסליידר ״ממומן״ של עמוד אחד: רשימת עיר ותחום או עמוד תחום ({int(cfg.listMonthlyNis)} ₪ לחודש), או עמוד הבית ({int(cfg.homeMonthlyNis)} ₪ לחודש). עד {int(cfg.slots)} מקומות בכל עמוד. כל מקום נבדק לפני שהוא עולה ולפני חיוב. אסור: הבטחת תוצאה, ״ללא סיכון״ או ״ללא כאב״, טענת עליונות, מחיר רפואי ״חינם״, ותמונות לפני/אחרי בטיפול רפואי.</>}
      />
      <Kpis items={[
        { label: 'לבדיקה', value: int(n.pending), tone: n.pending ? 'warn' : undefined },
        { label: 'פעילים עכשיו', value: int(n.live) },
        { label: 'אושרו וממתינים לכרטיס', value: int(n.needsCard), tone: n.needsCard ? 'warn' : undefined },
        { label: 'חודש ראשון חינם', value: `${int(cfg.freeMonthQuota)} עסקים`, note: 'מבצע ההשקה, בהגדרות' },
      ]} />
      <div className={ui.split}>
        <div className={ui.stack}>
          <Pills current={filter} items={[
            { key: 'pending', name: 'לבדיקה', count: n.pending, href: '/ops/sponsored' },
            { key: 'live', name: 'מאושרים', href: '/ops/sponsored?filter=live' },
            { key: 'all', name: 'הכול', href: '/ops/sponsored?filter=all' },
          ]} />
          {filter !== 'pending' && monthlyRevenue > 0 ? <p className={ui.note}>הכנסה חודשית ממקומות פעילים ברשימה: {nisAgorot(monthlyRevenue)} ללא מע״מ ישראלי.</p> : null}
          {rows.length ? rows.map(c => (
            <Card
              key={c.id}
              title={<Link href={`/ops/businesses/${c.businessId}`} className={ui.rowLink}>{c.branchName}</Link>}
              sub={<>{c.ref} · <Link href={c.path} className={ui.rowLink} target="_blank">{c.page}</Link> · {nisAgorot(c.monthlyPriceAgorot)} לחודש{c.freeMonths ? ' · חודש ראשון חינם' : ''}</>}
              aside={<Chip tone={PHASE[c.phase].tone}>{PHASE[c.phase].name}</Chip>}
            >
              <p style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 700, color: '#0C243E' }}>״{c.line}״</p>
              <p className={ui.note} style={{ margin: '0 0 12px' }}>
                {c.featuredTreatment ? `מבליט: ${c.featuredTreatment} · ` : ''}
                {c.phase === 'review' ? `נשמר עד ${dateIL(c.holdUntil)}` : c.activeUntil ? `מוצג עד ${dateIL(c.activeUntil)}` : `התחלה ${dateIL(c.startsAt)}`}
                {c.status !== 'pending_review' ? ` · ${int(c.totals.impressions)} הצגות · ${int(c.totals.clicks)} כניסות לפרופיל · ${int(c.totals.contacts)} פניות` : ''}
              </p>
              {c.checks.map((k, i) => <Check key={i} tone={k.result}>{k.text}</Check>)}
              {c.reviewNote ? <p className={ui.note} style={{ marginTop: 8 }}><b>הערת הבדיקה:</b> {c.reviewNote}</p> : null}
              {canEdit && c.status === 'pending_review' ? <div style={{ marginTop: 12 }}><ReviewButtons id={c.id} blocking={c.blocking} /></div> : null}
              {canEdit && c.status === 'approved' && !c.endedAt && !c.cancelAtPeriodEnd ? <div style={{ marginTop: 12 }}><CancelButton id={c.id} /></div> : null}
            </Card>
          )) : (
            <Card><Empty title={filter === 'pending' ? 'אין מקומות ממומנים לבדיקה' : 'עוד אין מקומות ממומנים'} text="הזמנה חדשה נכנסת לכאן מלוח הבקרה של העסק או מהטופס בצד, ונבדקת לפני שהיא עולה." /></Card>
          )}
        </div>
        <Card title="הזמנה ידנית" sub={`${int(cfg.listMonthlyNis)} ₪ לחודש ברשימה · ${int(cfg.homeMonthlyNis)} ₪ בעמוד הבית`}>
          {canEdit ? (
            <OrderForm
              branches={branches}
              regions={REGIONS.map(r => ({ slug: r.slug, name: r.name }))} categories={CATEGORIES.map(c => ({ slug: c.slug, name: c.name }))}
              listNis={cfg.listMonthlyNis} homeNis={cfg.homeMonthlyNis} lineMax={SPONSORED_LINE_MAX}
            />
          ) : <p className={ui.note}>לתפקיד שלך יש צפייה בלבד במקומות ממומנים.</p>}
        </Card>
      </div>
    </AdminShell>
  );
}
