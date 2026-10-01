import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/server/db';
import { monthStart } from '@/lib/server/opsStats';

// Client accounts and privacy requests for /ops/clients. A client's clinical data belongs to the
// clinic and is never read here; the screen shows the account, its bookings count, its last visit,
// its marketing consent and whether staff blocked it.

export type ClientFilter = 'all' | 'consented' | 'blocked';
export const CLIENT_FILTERS: Array<{ key: ClientFilter; name: string }> = [{ key: 'all', name: 'הכול' }, { key: 'consented', name: 'מסכימות לדיוור' }, { key: 'blocked', name: 'חסומות' }];

export interface ClientRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  bookings: number;
  lastVisit: Date | null;
  consent: boolean;
  blockedAt: Date | null;
  blockedReason: string | null;
  createdAt: Date;
}

export async function listClients(opts: { filter: ClientFilter; q: string; take?: number }): Promise<{ rows: ClientRow[]; total: number }> {
  const q = opts.q.trim();
  const digits = q.replace(/\D/g, '');
  const where: Prisma.UserWhereInput = {
    kind: 'client',
    ...(opts.filter === 'blocked' ? { blockedAt: { not: null } } : {}),
    ...(opts.filter === 'consented' ? { OR: [{ marketingOptIn: true }, { consents: { some: { marketing: true } } }] } : {}),
    ...(q ? { AND: [{ OR: [{ fullName: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : [])] }] } : {}),
  };
  const [total, users] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where, orderBy: { createdAt: 'desc' }, take: opts.take ?? 150,
      select: {
        id: true, fullName: true, phone: true, email: true, marketingOptIn: true, blockedAt: true, blockedReason: true, createdAt: true,
        consents: { where: { marketing: true }, select: { id: true }, take: 1 },
        bookings: { where: { status: { notIn: ['pending_payment', 'abandoned'] } }, select: { startsAt: true, branch: { select: { cityName: true } } }, orderBy: { startsAt: 'desc' }, take: 1 },
        _count: { select: { bookings: { where: { status: { notIn: ['pending_payment', 'abandoned'] } } } } },
      },
    }),
  ]);
  return {
    total,
    rows: users.map(u => ({
      id: u.id, name: u.fullName ?? 'ללא שם', phone: u.phone, email: u.email, city: u.bookings[0]?.branch.cityName ?? null, bookings: u._count.bookings,
      lastVisit: u.bookings[0]?.startsAt ?? null, consent: u.marketingOptIn || u.consents.length > 0, blockedAt: u.blockedAt, blockedReason: u.blockedReason, createdAt: u.createdAt,
    })),
  };
}

export async function clientStats() {
  const [total, newThisMonth, consented, blocked] = await Promise.all([
    db.user.count({ where: { kind: 'client' } }),
    db.user.count({ where: { kind: 'client', createdAt: { gte: monthStart() } } }),
    db.user.count({ where: { kind: 'client', OR: [{ marketingOptIn: true }, { consents: { some: { marketing: true } } }] } }),
    db.user.count({ where: { kind: 'client', blockedAt: { not: null } } }),
  ]);
  return { total, newThisMonth, consented, blocked, consentPct: total ? (consented / total) * 100 : 0 };
}

export const PRIVACY_DAYS = 30;

export type PrivacyRequest = {
  id: string; // decision id or contact message id
  kind: 'delete' | 'access' | 'correction';
  ref: string;
  who: string;
  contact: string | null;
  userId: string | null;
  receivedAt: Date;
  dueAt: Date;
  text: string | null;
  done: boolean;
  doneAt: Date | null;
};

/** Deletion requests (append-only decisions) and access or correction messages, with their 30-day deadlines. */
export async function privacyRequests(): Promise<PrivacyRequest[]> {
  const [requests, done, messages] = await Promise.all([
    db.decision.findMany({ where: { subjectType: 'user', action: 'delete_request' }, orderBy: { createdAt: 'desc' }, take: 100 }),
    db.decision.findMany({ where: { subjectType: 'user', action: { in: ['delete_done', 'delete_rejected'] } }, select: { subjectId: true, createdAt: true, supersedesDecisionId: true } }),
    db.contactMessage.findMany({ where: { reason: { in: ['access', 'correction'] } }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ]);
  const userIds = [...new Set(requests.map(r => r.subjectId))];
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, phone: true, email: true } }) : [];
  const out: PrivacyRequest[] = requests.map(r => {
    const u = users.find(x => x.id === r.subjectId);
    const d = done.find(x => x.supersedesDecisionId === r.id || (x.subjectId === r.subjectId && x.createdAt > r.createdAt));
    return {
      id: r.id, kind: 'delete', ref: `PR-${r.id.slice(0, 6).toUpperCase()}`, who: u?.fullName ?? (u ? 'ללא שם' : 'חשבון שנמחק'), contact: u?.phone ?? u?.email ?? null, userId: r.subjectId,
      receivedAt: r.createdAt, dueAt: new Date(r.createdAt.getTime() + PRIVACY_DAYS * 86_400_000), text: r.reason, done: !!d, doneAt: d?.createdAt ?? null,
    };
  });
  for (const m of messages) {
    out.push({
      id: m.id, kind: m.reason === 'access' ? 'access' : 'correction', ref: m.ref, who: m.name, contact: m.phone ?? m.email, userId: m.userId,
      receivedAt: m.createdAt, dueAt: new Date(m.createdAt.getTime() + PRIVACY_DAYS * 86_400_000), text: m.message, done: m.status === 'closed', doneAt: m.status === 'closed' ? m.updatedAt : null,
    });
  }
  return out.sort((a, b) => Number(a.done) - Number(b.done) || a.dueAt.getTime() - b.dueAt.getTime());
}
