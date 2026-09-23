import type { Metadata } from 'next';
import { CheckForm } from '@/components/gift/CheckForm';

// Design: project/BeautyFind Gift Cards.dc.html (view=redeem). ?code= prefills and checks once.

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  return {
    title: 'בדיקת יתרה בשובר מתנה',
    description: 'קיבלת שובר מתנה לקליניקה דרך BeautyFind? הקלידי את הקוד כדי לראות יתרה, תוקף ואיפה אפשר לממש.',
    alternates: { canonical: '/gift/check' },
    // A link that carries a code is personal: never index it.
    robots: sp.code ? { index: false, follow: false } : undefined,
  };
}

export default async function GiftCheckPage({ searchParams }: Props) {
  const sp = await searchParams;
  const code = typeof sp.code === 'string' ? sp.code.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20) : '';
  return <CheckForm initial={code} />;
}
