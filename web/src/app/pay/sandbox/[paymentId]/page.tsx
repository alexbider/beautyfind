import { notFound, redirect } from 'next/navigation';
import { nisFromAgorot } from '@/lib/format';
import { db } from '@/lib/server/db';
import { applyPaymentResult } from '@/lib/server/money';
import styles from './page.module.css';

// Development checkout for the sandbox provider. Stands in for a provider's hosted payment page.
// Disabled in production unless ALLOW_SANDBOX_PAYMENTS=1.

export const metadata = { title: 'תשלום בסביבת בדיקה', robots: { index: false } };

const sandboxAllowed = () => process.env.NODE_ENV !== 'production' || process.env.ALLOW_SANDBOX_PAYMENTS === '1';
const safeReturn = (u: string | undefined) => {
  if (!u) return '/';
  try {
    const url = new URL(u);
    return url.pathname + url.search; // same-site only
  } catch {
    return '/';
  }
};

export default async function SandboxPay({ params, searchParams }: { params: Promise<{ paymentId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  if (!sandboxAllowed()) notFound();
  const { paymentId } = await params;
  const sp = await searchParams;
  const p = await db.payment.findFirst({ where: { id: paymentId, provider: 'sandbox' } });
  if (!p) notFound();
  const success = safeReturn(sp.success);
  const cancel = safeReturn(sp.cancel);

  async function pay(formData: FormData) {
    'use server';
    if (!sandboxAllowed()) return;
    const ok = formData.get('result') === 'ok';
    await applyPaymentResult(paymentId, { status: ok ? 'succeeded' : 'failed', providerRef: 'sbx_' + paymentId.slice(0, 8), cardBrand: 'visa', cardLast4: '4242', installments: 1 });
    redirect(ok ? success : cancel);
  }

  return (
    <main className={styles.root}>
      <div className={styles.card}>
        <p className={styles.badge}>סביבת בדיקה · לא מתבצע חיוב</p>
        <h1 className={styles.h1}>תשלום</h1>
        <p className={styles.amount}><span className="ltr">{nisFromAgorot(p.grossAgorot)}</span></p>
        <p className={styles.meta}>{p.payerName}</p>
        {p.status === 'pending' ? (
          <form action={pay} className={styles.actions}>
            <button name="result" value="ok" className={styles.pay}>תשלום בכרטיס בדיקה <span className="ltr">4242</span></button>
            <button name="result" value="fail" className={styles.fail}>סימולציית כישלון</button>
          </form>
        ) : (
          <p className={styles.meta}>התשלום כבר עובד ({p.status}).</p>
        )}
      </div>
    </main>
  );
}
