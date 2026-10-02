import 'server-only';
import type { User } from '@prisma/client';
import { currentUser } from '@/lib/server/session';
import { permissionOverrides } from '@/lib/server/platformSettings';
import { atLeast, levelOf, type Area, type Level } from './roles';

// The access check behind server actions and route handlers: who is signed in (a browser session, or
// the staff member the MCP server acts for) and their level in an area, with the team's overrides.
// Kept apart from guard.ts, whose page helpers import next/navigation, so action modules and the MCP
// tool registry can load outside a page (route handlers, tests).

type StaffLike = Pick<User, 'opsRole'> | null | undefined;

/** The signed-in staff member's level in an area, with the team's overrides applied. */
export async function areaLevel(u: StaffLike, area: Area): Promise<Level> {
  if (!u?.opsRole) return 'none';
  return levelOf(u.opsRole, area, await permissionOverrides());
}

/** For server actions and route handlers: the signed-in staff member with at least `level` in `area`, or null. */
export async function areaUserOrNull(area: Area, level: Level = 'view') {
  const user = await currentUser();
  if (!user) return null;
  return atLeast(await areaLevel(user, area), level) ? user : null;
}
