import type { Metadata } from 'next';
import Link from 'next/link';
import type { MarketingOrderStatus } from '@prisma/client';
import ui from '@/components/dashboard/charts/ui.module.css';
import { tabGuard } from '@/components/dashboard/guard';
import { PathIcon } from '@/components/icons';
import { getService } from '@/content/marketing';
import { isServiceSlug } from '@/content/marketing/types';
import { nis } from '@/lib/format';
import { ROUTES, marketingService } from '@/lib/routes';
import { canBuy, isOpen, orderPagePath, ordersForBusiness, priceLine, resolvedServices, STATUS_HINT, STATUS_LABEL } from '@/lib/server/marketing';
import s from './page.module.css';

// The marketing services this business ordered (BeautyFind for Business), with their status and the link to
// each order page (onboarding, access, timeline), and the catalog to order more. Follows the billing area.

export const metadata: Metadata = { title: 'שירותי שיווק', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const TONE: Partial<Record<MarketingOrderStatus, 'ok' | 'warn' | 'bad'>> = {
  paid: 'warn', awaiting_payment: 'warn', active: 'ok', completed: 'ok', in_progress: 'ok', past_due: 'bad', cancelled: 'bad',
};
const dateIL = (d: Date) => d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'Asia/Jerusalem' });

export default async function BizMarketingPage() {
  const ctx = await tabGuard('billing');
  const [orders, services] = await Promise.all([ordersForBusiness(ctx.business.id, ctx.member.isOwner ? ctx.user.email : null), resolvedServices()]);
  const open = orders.filter(o => isOpen(o.status));
  const past = orders.filter(o => !isOpen(o.status));
  const ownedSlugs = new Set(open.map(o => o.serviceSlug));

  const row = (o: (typeof orders)[number]) => {
    const svc = isServiceSlug(o.serviceSlug) ? getService(o.serviceSlug) : null;
    const price = o.priceAgorot ? priceLine({ priceNis: o.priceAgorot / 100, cycle: o.cycle === 'monthly' ? 'monthly' : 'one_time', setupNis: o.setupAgorot ? o.setupAgorot / 100 : undefined }) : null;
    const needsIntake = o.kind === 'purchase' && o.status === 'paid' && !o.onboardedAt;
    return (
      <li key={o.id} className={s.order}>
        <div className={s.orderTop}>
          <span className={s.orderName}>{svc?.name ?? o.serviceSlug}</span>
          <span className={s.pill} data-tone={TONE[o.status]}>{STATUS_LABEL[o.status]}</span>
          <span className={`${s.ref} ltr`}>{o.ref}</span>
        </div>
        <div className={s.meta}>
          {o.packageName && <span>חבילה: {o.packageName}</span>}
          {price && <span>{price}</span>}
          {o.currentPeriodEnd && o.cycle === 'monthly' && <span>{o.cancelAtPeriodEnd ? 'מסתיים' : 'חיוב הבא'}: <span className="ltr">{dateIL(o.currentPeriodEnd)}</span></span>}
          <span>הוזמן: <span className="ltr">{dateIL(o.createdAt)}</span></span>
        </div>
        <p className={s.hint}>{o.statusNote || STATUS_HINT[o.status]}</p>
        <div className={s.actions}>
          <Link href={orderPagePath(o.accessToken)} className={needsIntake ? s.btn : s.btnGhost}>
            {needsIntake ? 'למילוי שאלון הפתיחה' : 'לעמוד ההזמנה'}
          </Link>
          {o.cycle === 'monthly' && o.stripeSubscriptionId && (
            <Link href={ROUTES.contact} className={s.btnGhost}>
              שינוי או ביטול
            </Link>
          )}
        </div>
      </li>
    );
  };

  return (
    <section aria-labelledby="h-mk" className={ui.section}>
      <div>
        <h1 id="h-mk" className={ui.h1}>שירותי שיווק<span>.</span></h1>
        <p className={ui.h1Sub}>שיווק דיגיטלי שנבנה לעסקי יופי: קמפיינים, קידום בגוגל ובמנועי AI, אתר, מיתוג ותוכן. כאן רואים את השירותים שהזמנתם, את הסטטוס של כל אחד ואת השלב הבא.</p>
      </div>

      <div className={ui.card}>
        <h2 className={ui.h2}>השירותים שלכם</h2>
        {open.length ? (
          <ul className={s.list} style={{ listStyle: 'none', margin: 0, padding: 0 }}>{open.map(row)}</ul>
        ) : (
          <p className={ui.emptyText}>עוד לא הזמנתם שירותי שיווק. אפשר להתחיל מאחד השירותים בהמשך, או לבקש הצעה שמשלבת כמה מהם.</p>
        )}
      </div>

      <div className={ui.card}>
        <h2 className={ui.h2}>{open.length ? 'שירותים נוספים' : 'השירותים שאפשר להזמין'}</h2>
        <ul className={s.catalog}>
          {services
            .filter(x => x.enabled && !ownedSlugs.has(x.slug))
            .map(x => {
              const from = canBuy(x) ? Math.min(...x.resolvedPackages.filter(p => !p.hidden).map(p => p.priceNis)) : null;
              const fromPkg = from ? x.resolvedPackages.find(p => p.priceNis === from) : null;
              return (
                <li key={x.slug}>
                  <Link href={marketingService(x.slug)} className={s.svc}>
                    <span className={s.svcIcon} aria-hidden="true"><PathIcon paths={x.icon} /></span>
                    <span className={s.svcName}>{x.name}</span>
                    <span className={s.svcLine}>{x.cardLine}</span>
                    <span className={s.svcFrom}>{from ? `החל מ־${nis(from)}${fromPkg?.cycle === 'monthly' ? ' לחודש' : ''}` : 'בהצעת מחיר'}</span>
                  </Link>
                </li>
              );
            })}
        </ul>
      </div>

      {past.length > 0 && (
        <div className={ui.card}>
          <h2 className={ui.h2}>הזמנות קודמות</h2>
          <ul className={s.list} style={{ listStyle: 'none', margin: 0, padding: 0 }}>{past.map(row)}</ul>
        </div>
      )}
    </section>
  );
}
