import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { isStaff, staffHome } from '@/components/ops/guard';
import { currentUser } from '@/lib/server/session';
import { StaffLogin } from './StaffLogin';

export const metadata: Metadata = {
  title: 'כניסת צוות',
  robots: { index: false, follow: false },
};

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function StaffLoginPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const next = one(sp.next);
  const user = await currentUser();
  // Already signed in as staff: straight to work.
  if (user && isStaff(user) && !one(sp.denied)) redirect(next.startsWith('/ops') && !next.startsWith('/ops/login') ? next : staffHome(user));
  return <StaffLogin next={next} signedInAs={user && !isStaff(user) ? user.email ?? user.phone ?? '' : ''} denied={!!one(sp.denied)} />;
}
