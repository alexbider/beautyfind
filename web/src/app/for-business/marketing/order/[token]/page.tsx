import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { MarketingOrderStatus } from '@prisma/client';
import { OnboardingForm } from '@/components/marketing/OnboardingForm';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { getService } from '@/content/marketing';
import { COMMON_ONBOARDING } from '@/content/marketing/common';
import { isServiceSlug } from '@/content/marketing/types';
import { ROUTES, marketingService } from '@/lib/routes';
import { orderByToken, priceLine, STATUS_HINT, STATUS_LABEL } from '@/lib/server/marketing';
import styles from '../../marketing.module.css';

export const metadata: Metadata = { title: 'ההזמנה שלכם', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const TONE: Partial<Record<MarketingOrderStatus, 'ok' | 'warn' | 'bad'>> = {
  paid: 'warn', awaiting_payment: 'warn', active: 'ok', completed: 'ok', in_progress: 'ok', past_due: 'bad', cancelled: 'bad',
};

const dateIL = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'Asia/Jerusalem' });

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ paid?: string }> };

export default async function MarketingOrderPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { paid } = await searchParams;
  const order = await orderByToken(token);
  if (!order || !isServiceSlug(order.serviceSlug)) notFound();
  const s = getService(order.serviceSlug);
  // Stripe redirects here before its webhook may have landed: show the paid state optimistically.
  const status: MarketingOrderStatus = paid && order.status === 'awaiting_payment' ? 'paid' : order.status;
  const needsOnboarding = order.kind === 'purchase' && ['paid', 'onboarding', 'in_progress', 'active'].includes(status);
  const onboarded = !!order.onboardedAt;
  const timeline = (Array.isArray(order.timeline) ? order.timeline : []) as Array<{ at: string; status: MarketingOrderStatus; note?: string }>;
  const price = order.priceAgorot
    ? priceLine({ priceNis: order.priceAgorot / 100, cycle: order.cycle === 'monthly' ? 'monthly' : 'one_time', setupNis: order.setupAgorot ? order.setupAgorot / 100 : undefined })
    : null;

  return (
    <div className={styles.root}>
      <SiteHeader title="ההזמנה שלכם" backHref={ROUTES.marketing} />
      <main className={styles.flow}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 22 }}>
          <h1 className={styles.h2Sm} style={{ margin: 0 }}>
            {needsOnboarding && !onboarded ? 'תודה! עוד צעד אחד ומתחילים' : order.kind === 'quote' ? 'הבקשה שלכם' : 'ההזמנה שלכם'}
            <span aria-hidden="true" className={styles.dot}>.</span>
          </h1>
          <span className={styles.statusPill} data-tone={TONE[status]}>{STATUS_LABEL[status]}</span>
        </div>

        <div className={styles.flowGrid} data-wide>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
            {needsOnboarding && !onboarded && (
              <section className={styles.panel} aria-labelledby="h-onb">
                <h2 id="h-onb">שאלון פתיחה</h2>
                <p>כעשר דקות. ככל שנדע יותר על העסק, כך נגיע מהר יותר לתוצאות. אפשר לדלג על שאלות שאינן חובה.</p>
                <OnboardingForm token={token} common={COMMON_ONBOARDING} specific={s.onboarding.fields} serviceName={s.name} />
              </section>
            )}

            {(!needsOnboarding || onboarded) && (
              <section className={styles.panel} aria-labelledby="h-status">
                <h2 id="h-status">מה קורה עכשיו</h2>
                <p>{order.statusNote || STATUS_HINT[status]}</p>
                {order.kind === 'quote' && (
                  <p>
                    בינתיים אפשר לקרוא עוד על <Link href={marketingService(s.slug)}>{s.name}</Link> או לעבור על <Link href={ROUTES.marketing}>שאר השירותים</Link>.
                  </p>
                )}
            {needsOnboarding && s.onboarding.access.length > 0 && (
              <section className={styles.panel} aria-labelledby="h-access">
                <h2 id="h-access">גישות שנצטרך</h2>
                <p>כדי לעבוד על החשבונות שלכם בלי לבקש סיסמאות, מעניקים לנו גישה מתוך כל פלטפורמה. אם משהו לא ברור, נעשה את זה יחד בשיחת הפתיחה.</p>
                <ol className={styles.access}>
                  {s.onboarding.access.map(a => (
                    <li key={a.title}>
                      <div>
                        <h3>{a.title}</h3>
                        <p>{a.body}</p>
                        {a.href && (
                          <a href={a.href} target="_blank" rel="noopener noreferrer">
                            הוראות מהפלטפורמה
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            )}

              </section>
            )}
          </div>

          <aside className={`${styles.panel} ${styles.summary}`} aria-labelledby="h-sum">
            <h2 id="h-sum">פרטי ההזמנה</h2>
            <div className={styles.summaryRow}><span>מספר</span><span className="ltr">{order.ref}</span></div>
            <div className={styles.summaryRow}><span>שירות</span><span>{s.name}</span></div>
            {order.packageName && <div className={styles.summaryRow}><span>חבילה</span><span>{order.packageName}</span></div>}
            {price && <div className={styles.summaryRow}><span>מחיר</span><span>{price}</span></div>}
            <div className={styles.summaryRow}><span>עסק</span><span>{order.businessName}</span></div>
            {order.currentPeriodEnd && order.cycle === 'monthly' && (
              <div className={styles.summaryRow}>
                <span>{order.cancelAtPeriodEnd ? 'מסתיים ב־' : 'החיוב הבא'}</span>
                <span className="ltr">{dateIL(order.currentPeriodEnd.toISOString())}</span>
              </div>
            )}
            {timeline.length > 0 && (
              <ol className={styles.timeline} aria-label="היסטוריית ההזמנה">
                {timeline.map((t, i) => (
                  <li key={i}>
                    <span>
                      {STATUS_LABEL[t.status] ?? t.status}
                      {t.note && <small>{t.note}</small>}
                      <small className="ltr">{dateIL(t.at)}</small>
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <p className={styles.asOf}>שאלות? השיבו למייל האישור, או כתבו לנו דרך <Link href={ROUTES.contact}>עמוד יצירת הקשר</Link> עם מספר ההזמנה.</p>
            <p className={styles.asOf}>
              בעלי עסק רשום ב־BeautyFind רואים את ההזמנה גם ב<Link href={ROUTES.bizMarketing}>לוח הניהול</Link>.
            </p>
          </aside>
        </div>
      </main>
    </div>
  );
}
