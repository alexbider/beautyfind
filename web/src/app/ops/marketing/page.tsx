import type { Metadata } from 'next';
import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { AdminShell } from '@/components/ops/AdminShell';
import { areaLevel, requireArea } from '@/components/ops/guard';
import { atLeast } from '@/components/ops/roles';
import { Card, Chip, Empty, Kpis, PageHead, Pills, Table, dateTimeIL, int, nisAgorot, ui } from '@/components/ops/ui';
import { getService, SERVICES } from '@/content/marketing';
import { isServiceSlug } from '@/content/marketing/types';
import { marketingService } from '@/lib/routes';
import { db } from '@/lib/server/db';
import { resolvedServices, STATUS_LABEL } from '@/lib/server/marketing';
import { STATUS_TONE } from './data';
import { ServiceConfigForm } from './MarketingForms';

export const metadata: Metadata = { title: 'שירותי שיווק · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';


const FILTERS: Record<string, Prisma.MarketingOrderWhereInput> = {
  todo: { status: { in: ['quote_requested', 'paid', 'onboarding', 'past_due'] } },
  running: { status: { in: ['in_progress', 'active'] } },
  quotes: { kind: 'quote' },
  all: { NOT: { status: 'awaiting_payment', createdAt: { lt: new Date(Date.now() - 2 * 86_400_000) } } },
};

export default async function MarketingAdminPage({ searchParams }: { searchParams: SP }) {
  const user = await requireArea('marketing', 'view', '/ops/marketing');
  const sp = await searchParams;
  const tab = one(sp.tab) === 'services' ? 'services' : 'orders';
  const filter = one(sp.filter) in FILTERS ? one(sp.filter) : 'todo';
  const service = one(sp.service);
  const level = await areaLevel(user, 'marketing');

  const where: Prisma.MarketingOrderWhereInput = { ...FILTERS[filter], ...(isServiceSlug(service) ? { serviceSlug: service } : {}) };
  const [rows, active, mrr, quotes30, paid30] = await Promise.all([
    db.marketingOrder.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 }),
    db.marketingOrder.count({ where: { status: { in: ['in_progress', 'active', 'onboarding', 'paid'] } } }),
    db.marketingOrder.aggregate({ where: { status: { in: ['active', 'in_progress', 'onboarding', 'paid'] }, cycle: 'monthly' }, _sum: { priceAgorot: true } }),
    db.marketingOrder.count({ where: { kind: 'quote', createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
    db.marketingOrder.count({ where: { paidAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
  ]);

  const tabs = (
    <Pills
      current={tab}
      items={[
        { key: 'orders', name: 'הזמנות ובקשות', href: '/ops/marketing' },
        { key: 'services', name: 'שירותים ומחירים', href: '/ops/marketing?tab=services' },
      ]}
    />
  );

  if (tab === 'services') {
    const services = await resolvedServices();
    return (
      <AdminShell user={user}>
        <PageHead eyebrow="כספים" title="שירותי שיווק" lead="מחירים, אופן ההזמנה וזמינות של כל שירות. השינוי מתפרסם באתר מיד. המחירים ללא מע״מ ישראלי, כמו מנויי הפלטפורמה." />
        {tabs}
        <div className={ui.stack}>
          {services.map(s => (
            <Card key={s.slug} title={<Link href={marketingService(s.slug)} className={ui.rowLink}>{s.name}</Link>} sub={s.primaryKeyword} aside={<Chip tone={s.enabled ? 'ok' : 'neutral'}>{s.enabled ? 'פעיל' : 'מוסתר'}</Chip>}>
              <ServiceConfigForm
                slug={s.slug}
                enabled={s.enabled}
                mode={s.mode}
                canEdit={atLeast(level, 'full')}
                packages={s.resolvedPackages.map(p => {
                  const base = getService(s.slug).packages.find(x => x.key === p.key)!;
                  return { key: p.key, name: p.name, cycle: p.cycle, defaultPrice: base.priceNis, defaultSetup: base.setupNis ?? 0, priceNis: p.priceNis, setupNis: p.setupNis ?? 0, hidden: p.hidden };
                })}
              />
            </Card>
          ))}
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell user={user}>
      <PageHead eyebrow="כספים" title="שירותי שיווק" lead="הזמנות ששולמו ובקשות להצעת מחיר משירותי BeautyFind לעסקים. כל הזמנה עוברת ארבעה שלבים: שולם, שאלון פתיחה, בעבודה, ולבסוף פעיל או הושלם. עדכון סטטוס יכול לשלוח ללקוח מייל עם שורת הסטטוס." />
      {tabs}
      <Kpis
        items={[
          { label: 'שירותים פעילים', value: int(active) },
          { label: 'הכנסה חודשית חוזרת', value: nisAgorot(mrr._sum.priceAgorot ?? 0), note: 'מנויים חודשיים פעילים' },
          { label: 'בקשות להצעה, 30 יום', value: int(quotes30) },
          { label: 'הזמנות ששולמו, 30 יום', value: int(paid30) },
        ]}
      />
      <div className={ui.stack}>
        <Pills
          current={filter}
          items={[
            { key: 'todo', name: 'לטיפול', href: '/ops/marketing' },
            { key: 'running', name: 'בעבודה ופעילים', href: '/ops/marketing?filter=running' },
            { key: 'quotes', name: 'הצעות מחיר', href: '/ops/marketing?filter=quotes' },
            { key: 'all', name: 'הכול', href: '/ops/marketing?filter=all' },
          ]}
        />
        {rows.length ? (
          <Card flush>
            <Table head={['מספר', 'שירות', 'עסק', 'סוג', 'סכום', 'סטטוס', 'נוצר']}>
              {rows.map(o => (
                <tr key={o.id}>
                  <td><Link href={`/ops/marketing/${o.id}`} className={ui.rowLink}><span className="ltr">{o.ref}</span></Link></td>
                  <td>{isServiceSlug(o.serviceSlug) ? getService(o.serviceSlug).name : o.serviceSlug}{o.packageName ? <div className={ui.note}>{o.packageName}</div> : null}</td>
                  <td>
                    {o.businessId ? <Link href={`/ops/businesses/${o.businessId}`} className={ui.rowLink}>{o.businessName}</Link> : o.businessName}
                    <div className={ui.note}>{o.contactName} · <span className="ltr">{o.contactPhone}</span></div>
                  </td>
                  <td>{o.kind === 'quote' ? 'הצעת מחיר' : o.cycle === 'monthly' ? 'חודשי' : 'חד־פעמי'}</td>
                  <td className="ltr">{o.priceAgorot ? nisAgorot(o.priceAgorot + (o.setupAgorot || 0)) : '—'}</td>
                  <td><Chip tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Chip></td>
                  <td className="ltr">{dateTimeIL(o.createdAt)}</td>
                </tr>
              ))}
            </Table>
          </Card>
        ) : (
          <Card>
            <Empty title={filter === 'todo' ? 'אין כרגע הזמנות לטיפול' : 'אין הזמנות בתצוגה הזו'} text="הזמנות ובקשות להצעת מחיר נכנסות לכאן מעמודי השירותים באתר." />
          </Card>
        )}
        <p className={ui.note}>סינון לפי שירות: {SERVICES.map((s, i) => (
          <span key={s.slug}>{i ? ' · ' : ''}<Link href={`/ops/marketing?filter=all&service=${s.slug}`} className={ui.rowLink}>{s.name}</Link></span>
        ))}</p>
      </div>
    </AdminShell>
  );
}
