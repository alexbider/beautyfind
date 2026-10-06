import 'server-only';
import type { User } from '@prisma/client';
import type { ReactNode } from 'react';
import { permissionOverrides } from '@/lib/server/platformSettings';
import { AdminNav, type NavGroup } from './AdminNav';
import { navCounts } from './navCounts';
import { levelOf, OPS_ROLE_NAMES, type Area } from './roles';
import styles from './shell.module.css';

// The master admin frame: the sidebar shows only the areas the signed-in role can open (levels from
// roles.ts with the team's overrides), with live counts from the queues. Pages render inside `content`;
// `bare` lets a screen that brings its own page padding (the verification console, the import) use
// the full width.

const GROUPS: Array<{ name: string; areas: Area[] }> = [
  { name: 'ראשי', areas: ['overview'] },
  { name: 'תפעול', areas: ['businesses', 'clients', 'bookings', 'disputes', 'sponsored', 'moderation', 'verification', 'import'] },
  { name: 'כספים', areas: ['accounting'] },
  { name: 'צמיחה', areas: ['content', 'magazine', 'messages'] },
  { name: 'AI ונתונים', areas: ['ai', 'integrations'] },
  { name: 'מערכת', areas: ['team', 'audit', 'settings', 'health'] },
];

export async function AdminShell({ user, children, bare = false }: { user: User; children: ReactNode; bare?: boolean }) {
  const [overrides, counts] = await Promise.all([permissionOverrides(), navCounts()]);
  const groups: NavGroup[] = GROUPS.map(g => ({
    name: g.name,
    items: g.areas.filter(a => levelOf(user.opsRole, a, overrides) !== 'none').map(a => ({ area: a, count: counts[a]?.count, tone: counts[a]?.tone })),
  })).filter(g => g.items.length);
  const who = user.fullName ?? user.email ?? 'צוות BeautyFind';
  return (
    <AdminNav groups={groups} who={who} role={OPS_ROLE_NAMES[user.opsRole ?? ''] ?? 'צוות'} email={user.email ?? ''} staging={process.env.STAGING === '1' || process.env.VERCEL_ENV === 'preview'}>
      <div className={bare ? styles.bare : styles.content}>{children}</div>
    </AdminNav>
  );
}
