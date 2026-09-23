import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyChart } from '@/components/dashboard/charts/Charts';
import { BRANCHES, Count, dateIL, nf } from '@/components/dashboard/charts/format';
import ui from '@/components/dashboard/charts/ui.module.css';
import { BillingDetails } from '@/components/dashboard/billing/BillingDetails';
import b from '@/components/dashboard/billing/billing.module.css';
import { PlanPicker, type PlanCard } from '@/components/dashboard/billing/PlanPicker';
import { tabGuard } from '@/components/dashboard/guard';
import { ReadOnlyBanner } from '@/components/dashboard/ReadOnlyBanner';
import { PLAN_MONTHLY_NIS, PLATFORM_BILLING_LINE, PLATFORM_PRICE_NOTE, planPrice, YEARLY_MULTIPLIER, type PlanKey } from '@/lib/pricing';
import { ROUTES } from '@/lib/routes';

// Design: project/BeautyFind Dashboard.dc.html (isBilling; PLANS, INVOICES, QUARTERS, SPEND)
// Two plans only (08-open-decisions.md A3). The design's add-ons are removed.

export const metadata: Metadata = { title: 'מנוי וחשבונות' };

const PLANS: Array<{ key: PlanKey; name: string; line: string; feats: string[] }> = [
  {
    key: 'basic',
    name: 'רישום בסיסי',
    line: 'פרופיל, קביעת תור וביקורות',
    feats: ['פרופיל מאומת, גלריה ותפריט מחירים', 'קביעת תור אונליין עם אישורים ותזכורות', 'ביקורות Google וביקורות מאומתות', 'לוח פניות ואנליטיקת פרופיל'],
  },
  {
    key: 'advanced',
    name: 'רישום מתקדם + CRM',
    line: 'כל הבסיסי ומערכת ניהול הקליניקה',
    feats: [
      'כל מה שבמסלול הבסיסי',
      'יומן, CRM וכרטיסי לקוחות',
      'הצהרות בריאות, צ׳ק־אין ורישום קליני',
      'מלאי, אוטומציות והודעות וואטסאפ',
      'שוברים, רשימת המתנה ובקשות ייעוץ',
      'סנכרון יומן ואינטגרציות',
    ],
  },
];
const RANK: Record<PlanKey, number> = { basic: 0, advanced: 1 };

/** ₪1,200 or ₪80.46 from integer agorot (VAT lines keep their agorot). */
const money = (agorot: number) =>
  '₪' + (agorot / 100).toLocaleString('en-US', { minimumFractionDigits: agorot % 100 ? 2 : 0, maximumFractionDigits: 2 });

export default async function BillingPage() {
  const ctx = await tabGuard('billing');
  const { business, canEdit } = ctx;
  const sub = business.subscription;

  // Only live branches are billed. Drafts and unpublished branches are not.
  const billed = business.branches.filter(x => x.status === 'live').length;
  const notBilled = business.branches.length - billed;

  const cycle = sub?.cycle ?? 'monthly';
  const plan = sub?.plan ?? null;
  const nextPlan: PlanKey | null = sub ? (sub.pendingPlan ?? sub.plan) : null;
  const periodEnd = sub?.currentPeriodEnd ? dateIL(sub.currentPeriodEnd) : null;
  const unit = nextPlan ? planPrice(nextPlan, cycle) : 0;
  // Israfind Group charges no Israeli VAT, so the plan total is the amount charged.
  const netAg = unit * 100 * billed;
  const grossAg = netAg;
  const nextName = PLANS.find(p => p.key === nextPlan)?.name ?? '';

  const cards: PlanCard[] = PLANS.map(p => ({
    ...p,
    rank: RANK[p.key],
    price: '₪' + nf(planPrice(p.key, cycle)),
    per: `${cycle === 'yearly' ? 'לשנה' : 'לחודש'} לכל סניף · ${PLATFORM_PRICE_NOTE}`,
  }));

  const yearlyUnit = plan ? planPrice(sub?.pendingPlan ?? plan, 'yearly') : 0;
  const monthlyUnit = plan ? PLAN_MONTHLY_NIS[sub?.pendingPlan ?? plan] : 0;
  const yearlyLine =
    `המעבר נכנס לתוקף מיד: ₪${nf(yearlyUnit)} לסניף לשנה במקום ₪${nf(monthlyUnit)} לחודש, כלומר ${YEARLY_MULTIPLIER === 10 ? 'עשרה' : nf(YEARLY_MULTIPLIER)} חודשים במחיר של שנה. ` +
    'החיוב היחסי על יתרת החודש הנוכחי יקוזז בחשבונית הבאה.';

  return (
    <>
      {!canEdit ? <ReadOnlyBanner roleName={ctx.roleName} /> : null}
      <section aria-labelledby="h-bill" className={ui.section} style={{ gap: 0 }}>
        <div style={{ marginBottom: 14 }}>
          <h1 id="h-bill" className={ui.h1}>מנוי וחשבונות<span>.</span></h1>
          <p className={ui.h1Sub}>
            כל הסכומים בשקלים. החשבונית נשלחת אוטומטית לדואר האלקטרוני ביום החיוב, ואפשר להפנות אותה ישירות למשרד ראיית החשבון. {PLATFORM_BILLING_LINE}
          </p>
        </div>

        <PlanPicker
          plans={cards}
          current={plan}
          pending={sub?.pendingPlan ?? null}
          cycle={cycle}
          canEdit={canEdit}
          periodEnd={periodEnd}
          yearlyLine={yearlyLine}
        />

        <div className={`${ui.twoCols} ${ui.alignStart}`} style={{ marginBottom: 14 }}>
          <div className={ui.card}>
            <h2 className={ui.h2Tight}>מקום ממומן</h2>
            <p className={ui.meta} style={{ margin: '0 0 12px', fontSize: 13.5, color: 'var(--muted)', textWrap: 'pretty' }}>
              נראות נוספת בראש רשימת אזור ותחום, לפי שבוע. נרכש בנפרד, מחויב רק אחרי אישור התוכן, ומופיע בחשבונית נפרדת.
            </p>
            {/* TODO(sponsored): list this business's campaigns once the campaigns table exists. */}
            <div className={b.sponsorEmpty}>אין קמפיינים פעילים או מתוכננים.</div>
            {/* TODO(sponsored): purchase link once /biz/sponsored exists. */}
          </div>

          <div className={ui.stack}>
            <div className={ui.card}>
              <h2 className={ui.h2Tight}>{cycle === 'yearly' ? 'החיוב השנתי הבא' : 'החיוב החודשי הבא'}</h2>
              <p className={ui.meta} style={{ marginBottom: 14 }}>
                {nextPlan ? (
                  <>
                    {nextName} · <Count n={billed} {...BRANCHES} /> × <span className="ltr">₪{nf(unit)}</span> · {cycle === 'yearly' ? 'חיוב שנתי מתחדש' : 'חיוב חודשי מתחדש'}
                  </>
                ) : (
                  'עדיין לא נבחר מסלול'
                )}
              </p>
              <dl className={b.sum}>
                <dt>{nextName || 'מנוי'} · <Count n={billed} one="סניף פעיל אחד" two="שני סניפים פעילים" many="סניפים פעילים" /></dt>
                <dd>{money(netAg)}</dd>
              </dl>
              <div className={b.total}>
                <span className={b.totalLabel}>
                  {periodEnd ? <>לתשלום ב־<span className="ltr">{periodEnd}</span></> : 'סך הכול לתשלום'}
                </span>
                <span className={b.totalValue}>{money(grossAg)}</span>
              </div>
              {billed === 0 ? (
                <p className={`${b.callout} ${b.calloutInfo}`}>
                  אין עדיין סניפים פעילים לחיוב. סניפים בטיוטה אינם מחויבים, והחיוב מתחיל כשהסניף הראשון מתפרסם.
                </p>
              ) : notBilled > 0 ? (
                <p className={`${b.callout} ${b.calloutInfo}`}>
                  עוד <Count n={notBilled} {...BRANCHES} /> בטיוטה או לא מפורסמים, ולכן אינם מחויבים.
                </p>
              ) : null}
              {sub?.pendingPlan ? (
                <p className={`${b.callout} ${b.calloutWarn}`}>
                  המעבר ל{PLANS.find(p => p.key === sub.pendingPlan)?.name} ייכנס לתוקף בסוף מחזור החיוב
                  {periodEnd ? <>, ב־<span className="ltr">{periodEnd}</span></> : null}. מידע ממערכת ניהול הקליניקה נשמר 90 יום אחרי המעבר.
                </p>
              ) : null}
              {sub?.pendingCycle === 'monthly' ? (
                <p className={`${b.callout} ${b.calloutWarn}`}>
                  המעבר לחיוב חודשי ייכנס לתוקף בתאריך החידוש השנתי
                  {periodEnd ? <>, ב־<span className="ltr">{periodEnd}</span></> : null}. עד אז המנוי השנתי ממשיך כרגיל.
                </p>
              ) : null}
              {sub?.status === 'past_due' ? (
                <p className={`${b.callout} ${b.calloutBad}`}>החיוב האחרון לא עבר. נעדכן אתכם לפני ניסיון החיוב הבא, ובינתיים הפרופיל ממשיך להופיע.</p>
              ) : null}
            </div>

            <div className={`${ui.card} ${b.payCard}`}>
              <span className={b.payLabel}>אמצעי תשלום</span>
              {/* TODO(payments): show the tokenised card (last four digits, brand, expiry) and the update/cancel actions once a payment provider is connected. */}
              <p className={ui.emptyInline}>עדיין לא נשמר כרטיס אשראי. עדכון הכרטיס יתאפשר כאן לפני החיוב הראשון.</p>
            </div>
          </div>
        </div>

        <div className={ui.card} style={{ marginBottom: 14 }}>
          <div className={ui.cardHead}>
            <div style={{ minWidth: 0 }}>
              <h2 className={ui.h2Tight}>הנהלת חשבונות</h2>
              <p className={ui.meta}>פרטי החשבונית וריכוז רבעוני לראיית החשבון</p>
            </div>
          </div>
          <BillingDetails
            canEdit={canEdit}
            initial={{ companyNo: business.companyNo ?? '', invoiceEmail: business.invoiceEmail ?? '', accountantEmail: business.accountantEmail ?? '' }}
          />
          <div className={b.table}>
            <div aria-hidden="true" className={b.qHead}>
              <span>רבעון</span>
              <span>חשבוניות</span>
              <span>מסלול</span>
              <span>סה״כ</span>
            </div>
            {/* TODO(payments): quarterly totals from Israfind Group invoices, with CSV export per quarter. */}
            <p className={ui.emptyRow}>הריכוז הרבעוני יופיע כאן אחרי החיוב הראשון.</p>
          </div>
          <p className={ui.insight} style={{ marginTop: 14, lineHeight: 1.7 }}>
            הריכוז הרבעוני כולל את דמי המנוי בלבד. מקומות ממומנים מופיעים בחשבוניות נפרדות. הכנסות מטיפולים אינן נמדדות ב־BeautyFind ואינן מופיעות כאן.
          </p>
        </div>

        <div className={ui.card} style={{ marginBottom: 14 }}>
          <div className={ui.cardHead} style={{ marginBottom: 18 }}>
            <div style={{ minWidth: 0 }}>
              <h2 className={ui.h2Tight}>מה שילמתם ומה קיבלתם</h2>
              <p className={ui.meta}>חיוב חודשי מול עלות לפנייה · שישה חודשים</p>
            </div>
          </div>
          {/* TODO(payments): monthly charges from invoices against leads per month (cost per lead). */}
          <EmptyChart height={152}>הגרף יופיע אחרי החיוב הראשון: כמה שילמתם בכל חודש מול מספר הפניות שהתקבלו.</EmptyChart>
        </div>

        <div className={ui.cardFlush}>
          <div className={b.invTitle}>חשבוניות</div>
          <div aria-hidden="true" className={b.invHead}>
            <span>תאריך</span>
            <span>פירוט</span>
            <span>סכום</span>
          </div>
          {/* TODO(payments): list BeautyFind tax invoices (date, description, amount, paid status, PDF) once a documents table exists. */}
          <p className={ui.emptyRow}>החשבונית הראשונה תופיע כאן אחרי החיוב הראשון.</p>
        </div>

        <p className={ui.foot}>
          שאלות על החיוב? <Link href={ROUTES.contact} style={{ color: 'var(--teal-deep)', fontWeight: 700 }}>פנו אלינו</Link>.
        </p>
      </section>
    </>
  );
}
