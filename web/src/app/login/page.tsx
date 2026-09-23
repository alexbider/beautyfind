import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CATEGORIES, REGIONS } from '@/lib/catalog';
import { db } from '@/lib/server/db';
import { currentUser } from '@/lib/server/session';
import { AuthScreen, type AuthView, type Role } from './AuthScreen';
import { destinationFor, safeNext } from './redirects';
import { findResetToken, normalizeEmail } from './reset-token';

// Design: project/BeautyFind Auth.dc.html

export const metadata: Metadata = {
  title: 'כניסה והרשמה',
  description: 'כניסה והרשמה ל־BeautyFind: אימות בוואטסאפ, כניסה לעסקים וללקוחות, ואיפוס סיסמה.',
  alternates: { canonical: '/login' },
  robots: { index: false, follow: true },
};

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Live listings for the client aside. Falls back to a static fact when there are none yet. */
async function listingStat(): Promise<{ n: string; label: string }> {
  try {
    const n = await db.branch.count({ where: { status: 'live' } });
    if (n > 0) return { n: n.toLocaleString('en-US'), label: 'עסקים' };
  } catch {
    // Aside stats are decorative; never fail the page over them.
  }
  return { n: '60+', label: 'ערים' };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const role: Role = one(sp.role) === 'biz' ? 'biz' : 'client';
  const next = safeNext(one(sp.next));
  const token = one(sp.token) ?? '';
  const email = normalizeEmail(one(sp.email) ?? '');
  const rawView = one(sp.view);

  // A reset link is honoured even for a signed-in visitor; everything else sends them on.
  const withToken = rawView === 'reset' && !!token;
  if (!withToken) {
    const user = await currentUser();
    if (user) redirect(destinationFor(user.kind, next));
  }

  let view: AuthView = rawView === 'signup' ? 'signup' : rawView === 'reset' ? 'forgot' : 'signin';
  let resetValid = false;
  if (withToken) {
    view = 'reset';
    resetValid = !!(await findResetToken(email, token));
  }

  return (
    <AuthScreen
      initialRole={withToken ? 'biz' : role}
      initialView={view}
      next={next}
      reset={withToken ? { email, token, valid: resetValid } : null}
      clientStats={[await listingStat(), { n: String(REGIONS.length), label: 'אזורים' }, { n: String(CATEGORIES.length), label: 'קטגוריות' }]}
    />
  );
}
