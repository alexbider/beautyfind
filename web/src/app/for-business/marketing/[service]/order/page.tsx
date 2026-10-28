import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Check } from '@/components/icons';
import { OrderForm } from '@/components/marketing/OrderForm';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { isServiceSlug } from '@/content/marketing/types';
import { nis } from '@/lib/format';
import { PLATFORM_PRICE_NOTE } from '@/lib/pricing';
import { ROUTES, marketingService } from '@/lib/routes';
import { db } from '@/lib/server/db';
import { canBuy, resolvedService } from '@/lib/server/marketing';
import { currentUser } from '@/lib/server/session';
import styles from '../../marketing.module.css';

export const metadata: Metadata = { title: 'הזמנת שירות', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ service: string }>; searchParams: Promise<{ package?: string }> };

export default async function OrderPage({ params, searchParams }: Props) {
  const { service } = await params;
  const { package: pkgKey } = await searchParams;
  if (!isServiceSlug(service)) notFound();
  const s = await resolvedService(service);
  if (!s) notFound();
  if (!canBuy(s)) redirect(`${marketingService(service)}#quote`);
  const pkg = s.resolvedPackages.find(p => p.key === pkgKey && !p.hidden);
  if (!pkg) redirect(`${marketingService(service)}#packages`);

  // A signed-in owner: prefill from the account and the business.
  const user = await currentUser();
  let prefill: Record<string, string> | undefined;
  if (user && user.kind === 'business') {
    const m = await db.staffMember.findFirst({
      where: { userId: user.id, status: 'active' },
      orderBy: { createdAt: 'asc' },
      include: { business: { include: { branches: { take: 1, orderBy: { createdAt: 'asc' }, select: { name: true, cityName: true, websiteUrl: true } } } } },
    });
    const br = m?.business.branches[0];
    prefill = {
      name: user.fullName ?? '',
      email: user.email ?? '',
      phone: user.phone ? user.phone.replace(/^\+972/, '0') : '',
      business: br?.name ?? m?.business.legalName ?? '',
      city: br?.cityName ?? '',
      website: br?.websiteUrl ?? '',
    };
  }

  const first = pkg.priceNis + (pkg.setupNis ?? 0);

  return (
    <div className={styles.root}>
      <SiteHeader title="הזמנה" backHref={marketingService(service)} />
      <main className={styles.flow}>
        <nav aria-label="פירורי לחם" style={{ marginBottom: 18 }}>
          <ol className={styles.crumbs}>
            <li><Link href={ROUTES.marketing}>שירותי שיווק</Link></li>
            <li><Link href={marketingService(service)}>{s.name}</Link></li>
            <li aria-current="page">הזמנה</li>
          </ol>
        </nav>
        <div className={styles.flowGrid}>
          <section className={styles.panel} aria-labelledby="h-order">
            <h1 id="h-order" className={styles.h2Sm} style={{ marginBottom: 8 }}>
              כמעט שם<span aria-hidden="true" className={styles.dot}>.</span>
            </h1>
            <p>פרטים ליצירת קשר וחשבונית. אחרי התשלום תגיעו לשאלון פתיחה קצר, וממנו נתחיל לעבוד.</p>
            <OrderForm service={service} packageKey={pkg.key} prefill={prefill} cta={`למעבר לתשלום מאובטח (${nis(first)})`} />
          </section>

          <aside className={`${styles.panel} ${styles.summary}`} aria-labelledby="h-summary">
            <h2 id="h-summary">סיכום ההזמנה</h2>
            <div className={styles.summaryRow}><span>שירות</span><span>{s.name}</span></div>
            <div className={styles.summaryRow}><span>חבילה</span><span>{pkg.name}</span></div>
            <div className={styles.summaryRow}><span>מחיר</span><span className="ltr">{pkg.cycle === 'monthly' ? `${nis(pkg.priceNis)} / חודש` : nis(pkg.priceNis)}</span></div>
            {pkg.setupNis ? <div className={styles.summaryRow}><span>הקמה (פעם אחת)</span><span className="ltr">{nis(pkg.setupNis)}</span></div> : null}
            {pkg.minMonths ? <div className={styles.summaryRow}><span>התחייבות</span><span>{pkg.minMonths} חודשים</span></div> : null}
            {pkg.deliveryDays ? <div className={styles.summaryRow}><span>זמן מסירה</span><span>עד {pkg.deliveryDays} ימי עסקים</span></div> : null}
            <div className={styles.summaryTotal}>
              <span>לתשלום היום</span>
              <strong className="ltr">{nis(first)}</strong>
            </div>
            <p className={styles.asOf}>{PLATFORM_PRICE_NOTE}{pkg.cycle === 'monthly' ? '. החיוב מתחדש אוטומטית כל חודש.' : '.'}</p>
            <ul className={styles.planFeats}>
              {pkg.feats.slice(0, 6).map(f => (
                <li key={f}>
                  <Check size={14} />
                  {f}
                </li>
              ))}
            </ul>
            {pkg.note && <p className={styles.planNote}>{pkg.note}</p>}
            <p className={styles.secure}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              התשלום מתבצע ב־Stripe. פרטי הכרטיס לא עוברים דרכנו.
            </p>
          </aside>
        </div>
      </main>
    </div>
  );
}
