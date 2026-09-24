import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ClaimFlow } from '@/components/claim/ClaimFlow';
import { ROUTES } from '@/lib/routes';
import { currentUser } from '@/lib/server/session';
import { searchLiveBranches } from './data';

// Design: project/BeautyFind Claim.dc.html

export const metadata: Metadata = {
  title: 'אישור בעלות על עסק',
  description:
    'אישור בעלות על עסק ב־BeautyFind בארבעה שלבים: איתור העסק, אימות בקוד שנשלח לטלפון או לדוא״ל, השלמת הפרטים ותפריט המחירים.',
  alternates: { canonical: ROUTES.claim },
};

export default async function ClaimPage() {
  const user = await currentUser();
  if (!user || user.kind !== 'business') redirect(`${ROUTES.bizLogin}&next=${encodeURIComponent(ROUTES.claim)}`);

  const initialHits = await searchLiveBranches('');
  // Dev only: every OTP is DEV_FIXED_OTP, and the design's error line names it.
  const devCode = process.env.NODE_ENV !== 'production' ? process.env.DEV_FIXED_OTP || null : null;

  return <ClaimFlow initialHits={initialHits} devCode={devCode} />;
}
