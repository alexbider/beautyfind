import 'server-only';
import type { OpsRole, User } from '@prisma/client';
import { notFound, redirect } from 'next/navigation';
import { currentUser } from '@/lib/server/session';
import { permissionOverrides } from '@/lib/server/platformSettings';
import { areaLevel, areaUserOrNull } from './access';
import { AREA_HREF, atLeast, DEFAULT_PERMISSIONS, firstArea, type Area, type Level } from './roles';

export { OPS_ROLE_NAMES } from './roles';

// BeautyFind staff access (04-permissions.md). Every admin screen is an area with a level per role
// (roles.ts); staff with the ops role can adjust the other roles on /ops/team. Everyone without the
// needed level gets a 404, never a hint. The import and verification helpers keep their names: the
// import creates public listings in bulk (ops), the verification queue reads private documents
// (verifier and ops).

type StaffLike = Pick<User, 'opsRole'> | null | undefined;

export const VERIFY_ROLES: readonly OpsRole[] = ['verifier', 'ops'];
export const IMPORT_ROLES: readonly OpsRole[] = ['ops'];

/** Default-only checks (no overrides): the roles that can verify or import out of the box. */
export const canVerify = (u: StaffLike): boolean => !!u?.opsRole && atLeast(DEFAULT_PERMISSIONS[u.opsRole].verification, 'edit');
export const canImport = (u: StaffLike): boolean => !!u?.opsRole && atLeast(DEFAULT_PERMISSIONS[u.opsRole].import, 'edit');

/** Any BeautyFind staff role. */
export const isStaff = (u: StaffLike): boolean => !!u?.opsRole;

export { areaLevel, areaUserOrNull } from './access';

/** For pages: login redirect when signed out, 404 when signed in without the level. */
export async function requireArea(area: Area, level: Level, next: string) {
  const user = await currentUser();
  if (!user) redirect(`/ops/login?next=${encodeURIComponent(next)}`);
  if (!atLeast(await areaLevel(user, area), level)) notFound();
  return user;
}

export const verifierOrNull = () => areaUserOrNull('verification', 'edit');
export const requireVerifier = (next: string) => requireArea('verification', 'edit', next);
export const importerOrNull = () => areaUserOrNull('import', 'edit');
export const requireImporter = (next: string) => requireArea('import', 'edit', next);

/** Where a staff member lands after signing in: the first screen their role can open. */
export async function staffHome(u: Pick<User, 'opsRole'>): Promise<string> {
  const a = firstArea(u.opsRole, await permissionOverrides());
  return a ? AREA_HREF[a] : '/ops/login?denied=1';
}
