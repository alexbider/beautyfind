import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { MarketingOrderStatus } from '@prisma/client';
import { AdminShell } from '@/components/ops/AdminShell';
import { areaLevel, requireArea } from '@/components/ops/guard';
import { atLeast } from '@/components/ops/roles';
import { Band, Card, Chip, PageHead, dateTimeIL, nisAgorot, ui } from '@/components/ops/ui';
import { getService } from '@/content/marketing';
import { COMMON_ONBOARDING } from '@/content/marketing/common';
import { isServiceSlug } from '@/content/marketing/types';
import { db } from '@/lib/server/db';
import { orderPagePath, STATUS_LABEL } from '@/lib/server/marketing';
import { OrderEditForm } from '../MarketingForms';
import { STATUS_TONE } from '../data';

export const metadata: Metadata = { title: 'הזמנת שירות שיווק · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const STATUSES: MarketingOrderStatus[] = ['quote_requested', 'quoted', 'awaiting_payment', 'paid', 'onboarding', 'in_progress', 'active', 'completed', 'past_due', 'cancelled'];

export default async function MarketingOrderAdmin({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireArea('marketing', 'view', `/ops/marketing/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const order = await db.marketingOrder.findUnique({ where: { id } });
  if (!order) notFound();
  const level = await areaLevel(user, 'marketing');
  const svc = isServiceSlug(order.serviceSlug) ? getService(order.serviceSlug) : null;
  const fields = [...COMMON_ONBOARDING, ...(svc?.onboarding.fields ?? [])];
  const answers = (order.onboarding ?? {}) as Record<string, string | string[]>;
  const timeline = (Array.isArray(order.timeline) ? order.timeline : []) as Array<{ at: string; status: MarketingOrderStatus; note?: string; by?: string }>;
  const payments = await db.payment.findMany({ where: { purpose: 'marketing', payerEmail: order.contactEmail }, orderBy: { createdAt: 'desc' }, take: 20, include: { documents: { select: { pdfUrl: true, number: true } } } });
  const utm = (order.utm ?? null) as Record<string, string> | null;

  return (
    <AdminShell user={user}>
      <PageHead
        eyebrow={<Link href="/ops/marketing" className={ui.rowLink}>שירותי שיווק</Link>}
        title={`${order.ref} · ${svc?.name ?? order.serviceSlug}`}
        lead={<>{order.kind === 'quote' ? 'בקשה להצעת מחיר' : 'רכישה אונליין'} · {order.businessName} · נוצר {dateTimeIL(order.createdAt)}</>}
        actions={<Chip tone={STATUS_TONE[order.status]}>{STATUS_LABEL[order.status]}</Chip>}
      />
      <Band
        items={[
          { label: 'חבילה', value: order.packageName ?? '—' },
          { label: 'סכום', value: order.priceAgorot ? `${nisAgorot(order.priceAgorot)}${order.cycle === 'monthly' ? ' לחודש' : ''}${order.setupAgorot ? ` + ${nisAgorot(order.setupAgorot)} הקמה` : ''}` : '—' },
          { label: 'שולם', value: order.paidAt ? dateTimeIL(order.paidAt) : '—' },
          { label: 'חיוב הבא', value: order.currentPeriodEnd ? dateTimeIL(order.currentPeriodEnd) : '—' },
        ]}
      />
      <div className={ui.split}>
        <div className={ui.stack}>
          <Card title="פרטי קשר">
            <ul className={ui.list}>
              <li className={ui.listItem}><span className={ui.listTitle}>{order.contactName}</span><span className={ui.listSub}><a href={`tel:${order.contactPhone}`} className="ltr">{order.contactPhone}</a> · <a href={`mailto:${order.contactEmail}`} className="ltr">{order.contactEmail}</a></span></li>
              <li className={ui.listItem}><span className={ui.listTitle}>{order.businessName}</span><span className={ui.listSub}>{[order.businessType, order.city, order.website].filter(Boolean).join(' · ') || '—'}</span></li>
              {order.businessId && <li className={ui.listItem}><Link href={`/ops/businesses/${order.businessId}`} className={ui.rowLink}>לכרטיס העסק ב־BeautyFind</Link></li>}
              {order.message && <li className={ui.listItem}><span className={ui.listSub} style={{ whiteSpace: 'pre-wrap' }}>{order.message}</span></li>}
              <li className={ui.listItem}><a href={orderPagePath(order.accessToken)} target="_blank" rel="noreferrer" className={ui.rowLink}>עמוד ההזמנה של הלקוח</a></li>
              {utm && Object.keys(utm).length > 0 && <li className={ui.listItem}><span className={ui.listSub} dir="ltr">{Object.entries(utm).map(([k, v]) => `${k}=${v}`).join(' · ')}</span></li>}
            </ul>
          </Card>
          <Card title="שאלון פתיחה" sub={order.onboardedAt ? `התקבל ${dateTimeIL(order.onboardedAt)}` : 'עוד לא התקבל'}>
            {order.onboardedAt ? (
              <dl style={{ margin: 0, display: 'grid', gap: 12 }}>
                {fields
                  .filter(f => answers[f.key] !== undefined && String(answers[f.key]).trim() !== '')
                  .map(f => (
                    <div key={f.key}>
                      <dt className={ui.note} style={{ fontWeight: 700 }}>{f.label}</dt>
                      <dd style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{Array.isArray(answers[f.key]) ? (answers[f.key] as string[]).join(', ') : String(answers[f.key])}</dd>
                    </div>
                  ))}
              </dl>
            ) : (
              <p className={ui.note}>הלקוח עדיין לא מילא את השאלון. הקישור לעמוד ההזמנה נשלח אליו במייל עם אישור התשלום.</p>
            )}
          </Card>
          {payments.length > 0 && (
            <Card title="תשלומים">
              <ul className={ui.list}>
                {payments.map(p => (
                  <li key={p.id} className={ui.listItem}>
                    <span className={ui.listTitle}>{nisAgorot(p.grossAgorot)} · {dateTimeIL(p.paidAt ?? p.createdAt)}</span>
                    <span className={ui.listSub}>{p.documents[0]?.pdfUrl ? <a href={p.documents[0].pdfUrl} target="_blank" rel="noreferrer" className={ui.rowLink}>חשבונית {p.documents[0].number}</a> : p.providerRef}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="היסטוריה">
            <ul className={ui.list}>
              {timeline.slice().reverse().map((t, i) => (
                <li key={i} className={ui.listItem}>
                  <span className={ui.listTitle}>{STATUS_LABEL[t.status] ?? t.status}</span>
                  <span className={ui.listSub}>{dateTimeIL(t.at)}{t.by ? ` · ${t.by}` : ''}{t.note ? ` · ${t.note}` : ''}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <Card title="עדכון">
          <OrderEditForm
            id={order.id}
            status={order.status}
            statusNote={order.statusNote ?? ''}
            internalNote={order.internalNote ?? ''}
            businessId={order.businessId ?? ''}
            statuses={STATUSES.map(s => ({ key: s, name: STATUS_LABEL[s] }))}
            canEdit={atLeast(level, 'edit')}
          />
        </Card>
      </div>
    </AdminShell>
  );
}
