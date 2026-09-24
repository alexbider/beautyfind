import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ui from '@/components/dashboard/charts/ui.module.css';
import { tabGuard } from '@/components/dashboard/guard';
import { PolicyForm } from '@/components/dashboard/payments/PolicyForm';
import { ProviderCard } from '@/components/dashboard/payments/Providers';
import { DEFAULT_CONSULT_FEE, DEFAULT_HOLD_MINUTES, type PolicyDTO, type ProviderDTO, type TreatmentDepositDTO } from '@/components/dashboard/payments/shared';
import s from '@/components/dashboard/payments/payments.module.css';
import { isAdvanced } from '@/lib/server/clinic';
import { db } from '@/lib/server/db';
import { hhmm, ilDate } from '@/lib/time';
import { INVOICE_PROVIDERS } from '@/lib/vendors/invoicing/registry';
import { PAYMENT_PROVIDERS } from '@/lib/vendors/payments/registry';
import type { ProviderInfo } from '@/lib/vendors/payments/types';

// No design file. Built in the dashboard's language (billing, team, charts/ui) and the Design System.
// Each business connects its own payment and invoicing providers (docs/decisions.md 2026-09-23).
// Advanced plan only; owner and billing-edit roles only.

export const metadata: Metadata = { title: 'תשלומים וחשבוניות', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const num = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== null && v !== '' ? n : fallback;
};

export default async function PaymentsPage() {
  const ctx = await tabGuard('billing');
  if (!ctx.canEdit) notFound();
  const businessId = ctx.business.id;

  const head = (
    <div>
      <h1 id="h-pay" className={ui.h1}>תשלומים וחשבוניות<span>.</span></h1>
      <p className={ui.h1Sub}>
        כל קליניקה מחברת את חברת הסליקה ואת מערכת החשבוניות שלה. מקדמות, שוברי מתנה וייעוץ בתשלום עוברים ישירות לחשבון שלכם, וחשבוניות המס מופקות על שמכם. BeautyFind לא גובה עמלה על תשלומים.
      </p>
    </div>
  );

  if (!(await isAdvanced(businessId))) {
    return (
      <section aria-labelledby="h-pay" className={ui.section}>
        {head}
        <div className={`${ui.card} ${s.upgrade}`}>
          <h2 className={ui.h2}>זמין במסלול המתקדם</h2>
          <p>
            חיבור חברת סליקה ומערכת חשבוניות, מקדמות בקביעת תור, שוברי מתנה וייעוץ בתשלום הם חלק ממערכת ניהול הקליניקה במסלול רישום מתקדם + CRM. במסלול הבסיסי אפשר להמשיך לקבל תורים בלי תשלום מראש.
          </p>
          <Link href="/biz/billing" className={s.upgradeLink}>למעבר למסלול המתקדם</Link>
        </div>
      </section>
    );
  }

  const [conns, policy, business, treatments] = await Promise.all([
    db.providerConnection.findMany({
      where: { businessId, kind: { in: ['payments', 'invoicing'] } },
      select: { kind: true, provider: true, status: true, lastError: true, lastCheckedAt: true, settings: true },
    }),
    db.depositPolicy.findUnique({ where: { businessId } }),
    db.business.findUniqueOrThrow({ where: { id: businessId }, select: { settings: true } }),
    db.treatment.findMany({
      where: { branch: { businessId }, isPublished: true },
      orderBy: [{ branch: { createdAt: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, priceAgorot: true, isMedical: true, depositOverrideAgorot: true, branch: { select: { name: true } } },
    }),
  ]);

  const toDTO = (p: ProviderInfo): ProviderDTO => {
    const c = conns.find(x => x.kind === p.kind && x.provider === p.key && x.status !== 'disabled');
    return {
      key: p.key, name: p.name, kind: p.kind, available: p.available, docsUrl: p.docsUrl,
      fields: p.fields.map(f => ({ key: f.key, label: f.label, secret: !!f.secret, help: f.help ?? null })),
      connection: c
        ? {
            status: c.status,
            lastError: c.lastError,
            checked: c.lastCheckedAt ? `${ilDate(c.lastCheckedAt)} ${hhmm(c.lastCheckedAt)}` : null,
            testMode: p.key === 'sandbox' || !!(c.settings as Record<string, unknown> | null)?.testMode,
          }
        : null,
    };
  };
  const payProviders = PAYMENT_PROVIDERS.map(toDTO);
  const invProviders = INVOICE_PROVIDERS.map(toDTO);
  const activePay = payProviders.find(p => p.connection?.status === 'connected') ?? null;
  const activeInv = invProviders.find(p => p.connection?.status === 'connected') ?? null;

  const settings = (business.settings ?? {}) as Record<string, unknown>;
  const policyDTO: PolicyDTO = {
    enabled: policy?.enabled ?? false,
    mode: policy?.mode ?? 'fixed',
    value: policy ? (policy.mode === 'fixed' ? Math.round(policy.value / 100) : policy.value) : 0,
    scope: policy?.scope ?? 'medical_only',
    refundWindowHours: policy?.refundWindowHours ?? 24,
    waitlistHoldMinutes: num(settings.waitlist_hold_minutes, DEFAULT_HOLD_MINUTES),
    consultFeeShekels: num(settings.consult_fee, DEFAULT_CONSULT_FEE),
  };
  const treatmentRows: TreatmentDepositDTO[] = treatments.map(t => ({
    id: t.id, name: t.name, branch: t.branch.name, priceShekels: Math.round(t.priceAgorot / 100), isMedical: t.isMedical,
    depositShekels: t.depositOverrideAgorot == null ? null : Math.round(t.depositOverrideAgorot / 100),
  }));

  const pay = !!activePay;
  const features: Array<{ name: string; on: boolean; why: string }> = [
    {
      name: 'מקדמות בקביעת תור',
      on: pay && policyDTO.enabled,
      why: !pay ? 'יופעל אחרי חיבור חברת סליקה.' : policyDTO.enabled ? 'לפי המדיניות למטה.' : 'חברת הסליקה מחוברת. המקדמה כבויה במדיניות למטה.',
    },
    { name: 'שוברי מתנה', on: pay, why: pay ? 'נמכרים בעמוד הקליניקה ומתממשים בקבלה.' : 'יופעל אחרי חיבור חברת סליקה.' },
    {
      name: 'ייעוץ בתשלום',
      on: pay && policyDTO.consultFeeShekels > 0,
      why: !pay ? 'יופעל אחרי חיבור חברת סליקה.' : policyDTO.consultFeeShekels > 0 ? `דמי ייעוץ ₪${policyDTO.consultFeeShekels.toLocaleString('en-US')}, מתקזזים מהטיפול.` : 'דמי הייעוץ מוגדרים ל־₪0.',
    },
    {
      name: 'חשבוניות מס אוטומטיות',
      on: !!activeInv,
      why: activeInv ? `מופקות דרך ${activeInv.name} בכל תשלום ומימוש שובר.` : 'בלי מערכת חשבוניות מחוברת, הקליניקה מפיקה אותן במערכת שלה.',
    },
  ];

  return (
    <section aria-labelledby="h-pay" className={ui.section}>
      {head}

      <div className={ui.card}>
        <h2 className={ui.h2Gap}>מה פעיל עכשיו</h2>
        <dl className={s.features}>
          {features.map(f => (
            <div key={f.name} className={s.feature} data-on={f.on || undefined}>
              <dt className={s.featureTop}>
                <span aria-hidden="true" className={s.dot} />
                <span className={s.featureName}>{f.name}</span>
                <span className={s.onOff}>{f.on ? 'פעיל' : 'כבוי'}</span>
              </dt>
              <dd className={s.featureWhy} style={{ margin: 0 }}>{f.why}</dd>
            </div>
          ))}
        </dl>
        {!pay ? (
          <p className={`${s.callout} ${s.warn}`} style={{ marginTop: 12 }}>
            אין חברת סליקה מחוברת, לכן מקדמות, שוברי מתנה וייעוץ בתשלום אינם זמינים. תורים בלי תשלום מראש ממשיכים כרגיל.
          </p>
        ) : null}
      </div>

      <div className={ui.card}>
        <div className={ui.cardHead}>
          <div style={{ minWidth: 0 }}>
            <h2 className={ui.h2Tight}>חברת סליקה</h2>
            <p className={ui.meta}>דרכה נגבים מקדמות, שוברים וייעוץ, ודרכה מבוצעים החזרים. ספק פעיל אחד בכל פעם.</p>
          </div>
        </div>
        <div className={s.providers}>
          {payProviders.map(p => <ProviderCard key={p.key} p={p} otherConnected={activePay && activePay.key !== p.key ? activePay.name : null} />)}
        </div>
        <p className={ui.foot}>פרטי הכרטיס של הלקוחות לא עוברים דרך BeautyFind: התשלום מתבצע בדף המאובטח של חברת הסליקה.</p>
      </div>

      <div className={ui.card}>
        <div className={ui.cardHead}>
          <div style={{ minWidth: 0 }}>
            <h2 className={ui.h2Tight}>מערכת חשבוניות</h2>
            <p className={ui.meta}>חשבונית מס/קבלה על כל תשלום, חשבונית מס על כל מימוש שובר, וחשבונית זיכוי על כל החזר.</p>
          </div>
        </div>
        <div className={s.providers}>
          {invProviders.map(p => <ProviderCard key={p.key} p={p} otherConnected={activeInv && activeInv.key !== p.key ? activeInv.name : null} />)}
        </div>
      </div>

      <div className={ui.card}>
        <div className={ui.cardHead}>
          <div style={{ minWidth: 0 }}>
            <h2 className={ui.h2Tight}>מקדמות וביטולים</h2>
            <p className={ui.meta}>המדיניות מוצגת ללקוח/ה בקביעת התור ולפני התשלום</p>
          </div>
        </div>
        <PolicyForm initial={policyDTO} treatments={treatmentRows} payments={pay} />
      </div>
    </section>
  );
}
