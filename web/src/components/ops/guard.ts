import 'server-only';
import type { OpsRole, User } from '@prisma/client';
import { notFound, redirect } from 'next/navigation';
import { currentUser } from '@/lib/server/session';

export { OPS_ROLE_NAMES } from './roles';

// BeautyFind staff access (04-permissions.md). Roles that may work the verification queue
// and read private documents (license scans). Everyone else gets a 404, never a hint.
export const VERIFY_ROLES: readonly OpsRole[] = ['verifier', 'ops'];


export const canVerify = (u: Pick<User, 'opsRole'> | null | undefined): boolean =>
  !!u?.opsRole && VERIFY_ROLES.includes(u.opsRole);

/** For server actions and route handlers: the signed-in verifier, or null. */
export async function verifierOrNull() {
  const user = await currentUser();
  return canVerify(user) ? user! : null;
}

/** For pages: login redirect when signed out, 404 when signed in without a verifier role. */
export async function requireVerifier(next: string) {
  const user = await currentUser();
  if (!user) redirect(`/login?role=biz&next=${encodeURIComponent(next)}`);
  if (!canVerify(user)) notFound();
  return user;
}
