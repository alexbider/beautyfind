import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/server/db';
import { TEMPLATES } from '../messages/catalog';

// Shared lookups for /ops/emails: template names from the messages catalog, business names, and the filters of the
// sent list.

const EXTRA_NAMES: Record<string, string> = {
  email_test: 'מייל בדיקה',
  reply_forward: 'העברת תשובה לצוות',
  M_mk_order_paid: 'שירותי שיווק: התשלום התקבל',
  M_mk_quote_received: 'שירותי שיווק: בקשה להצעה התקבלה',
  M_mk_onboarding_received: 'שירותי שיווק: השאלון התקבל',
  M_mk_status: 'שירותי שיווק: עדכון סטטוס',
};

export function templateName(id: string): string {
  if (EXTRA_NAMES[id]) return EXTRA_NAMES[id];
  const t = TEMPLATES.find(x => x.codeIds.includes(id));
  if (!t) return id;
  return t.codeIds.length > 1 ? `${t.name} (${id})` : t.name;
}

export async function businessNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  const rows = await db.business.findMany({ where: { id: { in: unique } }, select: { id: true, legalName: true, branches: { select: { name: true }, take: 1, orderBy: { createdAt: 'asc' } } } });
  return new Map(rows.map(b => [b.id, b.branches[0]?.name ?? b.legalName ?? 'עסק ללא שם']));
}

export const RANGES = [7, 30, 90] as const;
export const rangeOf = (v: string) => (RANGES as readonly number[]).includes(Number(v)) ? Number(v) : 30;

export const STATE_FILTERS: Record<string, { name: string; where: Prisma.MessageSendWhereInput }> = {
  all: { name: 'הכול', where: {} },
  opened: { name: 'נפתחו', where: { openedAt: { not: null } } },
  unopened: { name: 'לא נפתחו', where: { openedAt: null, status: 'sent', OR: [{ deliveryStatus: null }, { deliveryStatus: { in: ['sent', 'delivered', 'delayed'] } }] } },
  clicked: { name: 'הקליקו', where: { clickedAt: { not: null } } },
  replied: { name: 'ענו', where: { repliedAt: { not: null } } },
  problems: { name: 'חזרו או נכשלו', where: { OR: [{ status: 'failed' }, { deliveryStatus: { in: ['bounced', 'complained', 'failed', 'suppressed'] } }] } },
};

export const AUDIENCES: Array<{ key: string; name: string }> = [
  { key: '', name: 'כל הנמענים' },
  { key: 'business', name: 'עסקים' },
  { key: 'client', name: 'לקוחות' },
  { key: 'staff', name: 'צוות' },
  { key: 'other', name: 'אחר' },
];
