import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ClaimFlow } from '@/components/claim/ClaimFlow';
import { ROUTES } from '@/lib/routes';
import { currentUser } from '@/lib/server/session';
import { loadListingHit, searchLiveBranches } from './data';

// Design: project/BeautyFind Claim.dc.html

export const metadata: Metadata = {
  title: 'אישור בעלות על עסק',
  description:
    'אישור בעלות על עסק ב־BeautyFind בארבעה שלבים: איתור העסק, אימות בקוד שנשלח לטלפון או לדוא״ל, השלמת הפרטים ותפריט המחירים.',
  alternates: { canonical: ROUTES.claim },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ClaimPage({ searchParams }: Props) {
  const sp = await searchParams;
  const branch = (Array.isArray(sp.branch) ? sp.branch[0] : sp.branch) ?? '';
  // The profile page links here with ?branch=<id>: the flow opens on that listing, and the login
  // redirect keeps it so the visitor lands back on the same listing after signing in.
  const here = branch ? `${ROUTES.claim}?branch=${encodeURIComponent(branch)}` : ROUTES.claim;
  const user = await currentUser();
  if (!user || user.kind !== 'business') redirect(`${ROUTES.bizLogin}&next=${encodeURIComponent(here)}`);

  const [initialHits, preselected] = await Promise.all([searchLiveBranches(''), branch ? loadListingHit(branch) : null]);
  // Dev only: every OTP is DEV_FIXED_OTP, and the design's error line names it.
  const devCode = process.env.NODE_ENV !== 'production' ? process.env.DEV_FIXED_OTP || null : null;

  return <ClaimFlow initialHits={initialHits} devCode={devCode} preselected={preselected} />;
}
