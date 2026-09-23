import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BuyForm } from '@/components/gift/BuyForm';
import { BuyDone, BuyFailed, BuyWaiting } from '@/components/gift/BuyReturn';
import { NoSales } from '@/components/gift/NoSales';
import { giftTreatments, returnState, sellableBranch } from '@/components/gift/server';
import { yearsText } from '@/components/gift/shared';
import { addDays, ilDate, ilDateKey } from '@/lib/time';

// Design: project/BeautyFind Gift Cards.dc.html (view=buy). Payment runs at the business's own provider;
// the checkout returns here with ?card=<id>&paid=1|0 and the card turns active once the provider confirms.

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ branch: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { branch } = await params;
  const sp = await searchParams;
  const s = await sellableBranch(branch);
  if (!s) return { title: 'העמוד לא נמצא', robots: { index: false } };
  const title = `שובר מתנה ל${s.branch.name}, ${s.branch.cityName}`;
  const description = `שובר מתנה ל${s.branch.name} לפי סכום או לפי טיפול, נשלח בוואטסאפ או במייל. בתוקף ${yearsText(s.years)}, מימוש בכמה ביקורים, ביטול תוך 14 ימים אם לא מומש.`;
  return {
    title,
    description,
    alternates: { canonical: `/gift/${s.branch.slug}` },
    robots: sp.card || !s.canSell ? { index: false } : undefined,
    openGraph: { title, description, url: `/gift/${s.branch.slug}`, type: 'website', locale: 'he_IL', siteName: 'BeautyFind' },
  };
}

export default async function GiftBuyPage({ params, searchParams }: Props) {
  const { branch } = await params;
  const sp = await searchParams;
  const s = await sellableBranch(branch);
  if (!s) notFound();

  const cardId = typeof sp.card === 'string' ? sp.card : null;
  if (cardId) {
    const r = await returnState(s.businessId, cardId, typeof sp.paid === 'string' ? sp.paid : undefined);
    if (r?.state === 'done') {
      const { state: _state, ...done } = r;
      return <BuyDone slug={s.branch.slug} {...done} />;
    }
    if (r?.state === 'waiting') return <BuyWaiting />;
    if (r?.state === 'failed' && s.canSell) return <BuyFailed slug={s.branch.slug} cardId={cardId} />;
  }

  if (!s.canSell) return <NoSales branch={s.branch} />;

  const now = new Date();
  const today = ilDateKey(now);
  const expires = new Date(now);
  expires.setUTCFullYear(expires.getUTCFullYear() + s.years);
  const treatments = await giftTreatments(s.branch.id);

  return (
    <BuyForm
      slug={s.branch.slug}
      businessName={s.branch.name}
      years={s.years}
      expiry={ilDate(expires)}
      treatments={treatments}
      today={today}
      maxDate={addDays(today, 365)}
    />
  );
}
