import 'server-only';
import type { OtpChannel, Prisma } from '@prisma/client';
import { db } from '@/lib/server/db';
import { fromE164 } from '@/lib/format';
import { DEFAULT_DAYS, TIME_RE, type ClaimMethod, type DayHours, type ListingHit } from './shared';

const MAX_HITS = 20;

const branchInclude = {
  categories: { include: { category: true } },
  business: { select: { ownerUserId: true } },
} satisfies Prisma.BranchInclude;

type BranchRow = Prisma.BranchGetPayload<{ include: typeof branchInclude }>;

/** 09-748-2210 → 09-•••-2210 */
export function maskPhone(e164: string): string {
  const parts = fromE164(e164).split('-');
  if (parts.length !== 3) return fromE164(e164).replace(/\d(?=\d{4})/g, '•');
  return `${parts[0]}-${'•'.repeat(parts[1].length)}-${parts[2]}`;
}

/** info@domain.co.il → in••@domain.co.il */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '••';
  return `${local.slice(0, local.length > 2 ? 2 : 1)}••@${domain}`;
}

export const isClaimedRow = (b: { isClaimed: boolean; business: { ownerUserId: string | null } }) =>
  b.isClaimed || b.business.ownerUserId !== null;

/** Where the code goes for a method, from the listing's registered contacts. */
export function claimTarget(b: { phone: string | null; email: string | null }, method: ClaimMethod): { target: string; channel: OtpChannel } | null {
  if (method === 'mail') return b.email ? { target: b.email.trim().toLowerCase(), channel: 'email' } : null;
  if (!b.phone) return null;
  return { target: b.phone, channel: method === 'call' ? 'voice' : 'sms' };
}

function parseDays(raw: Prisma.JsonValue): DayHours[] {
  if (!Array.isArray(raw) || raw.length !== 7) return DEFAULT_DAYS;
  return raw.map((d, i) => {
    const o = (d && typeof d === 'object' && !Array.isArray(d) ? d : {}) as Record<string, unknown>;
    const from = typeof o.open === 'string' && TIME_RE.test(o.open) ? o.open : DEFAULT_DAYS[i].from;
    const to = typeof o.close === 'string' && TIME_RE.test(o.close) ? o.close : DEFAULT_DAYS[i].to;
    return { open: o.closed !== true, from, to };
  });
}

function toHit(b: BranchRow): ListingHit {
  const cats = [...b.categories].sort((x, y) => x.category.sortOrder - y.category.sortOrder);
  return {
    id: b.id,
    name: b.name,
    category: cats[0]?.category.name ?? '',
    city: b.cityName,
    phone: b.phone ? fromE164(b.phone) : '',
    img: b.coverUrl,
    imgAlt: b.coverAlt ?? '',
    claimed: isClaimedRow(b),
    targets: {
      sms: b.phone ? maskPhone(b.phone) : null,
      call: b.phone ? maskPhone(b.phone) : null,
      mail: b.email ? maskEmail(b.email) : null,
    },
    prefill: {
      address: b.address,
      phone: b.phone ? fromE164(b.phone) : '',
      whatsapp: b.whatsapp ? fromE164(b.whatsapp) : '',
      cats: cats.map(c => c.categorySlug),
      days: parseDays(b.hours),
    },
  };
}

/** Live listings matching every word of the query in name, city or category. */
export async function searchLiveBranches(q: string): Promise<ListingHit[]> {
  const words = q.trim().split(/[\s,]+/).filter(Boolean).slice(0, 5);
  const rows = await db.branch.findMany({
    where: {
      status: 'live',
      AND: words.map(w => ({
        OR: [
          { name: { contains: w, mode: 'insensitive' as const } },
          { cityName: { contains: w, mode: 'insensitive' as const } },
          { categories: { some: { category: { name: { contains: w, mode: 'insensitive' as const } } } } },
        ],
      })),
    },
    include: branchInclude,
    orderBy: { name: 'asc' },
    take: MAX_HITS,
  });
  return rows.map(toHit);
}

/** A live branch by id, with what the claim checks need. */
export function loadLiveBranch(id: string) {
  return db.branch.findFirst({ where: { id, status: 'live' }, include: branchInclude });
}
