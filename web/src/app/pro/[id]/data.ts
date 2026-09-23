import 'server-only';
import { cache } from 'react';
import { db } from '@/lib/server/db';
import { PUBLIC_WHERE, profileHref } from '@/lib/server/public';

const PRACTITIONER_PROFESSIONS = ['doctor', 'nurse', 'cosmetician', 'technician'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Public practitioner: an active StaffMember with a practitioner profession, whose business is live
 * and who works at one or more public branches of it. Null → 404.
 */
export const getPractitioner = cache(async (id: string) => {
  if (!UUID_RE.test(id)) return null;
  const s = await db.staffMember.findFirst({
    where: { id, status: 'active', profession: { in: [...PRACTITIONER_PROFESSIONS] }, business: { status: 'live' } },
    select: {
      id: true, displayName: true, profession: true, branchIds: true, businessId: true,
      license: { select: { kind: true, number: true, status: true, specialty: true, verifiedAt: true, source: true } },
    },
  });
  if (!s || s.branchIds.length === 0) return null;

  const branches = await db.branch.findMany({
    where: { AND: [PUBLIC_WHERE, { id: { in: s.branchIds }, businessId: s.businessId }] },
    include: {
      city: { select: { slug: true } },
      region: { select: { name: true } },
      treatments: { where: { isPublished: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], include: { category: { select: { name: true, isMedical: true } } } },
      medicalResponsible: { select: { id: true, displayName: true, profession: true, license: { select: { kind: true, status: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (branches.length === 0) return null;

  const ids = branches.map(b => b.id);
  const reviewWhere = { branchId: { in: ids }, status: 'published' as const };
  const [reviews, agg] = await Promise.all([
    db.review.findMany({ where: reviewWhere, orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, authorName: true, rating: true, title: true, body: true, treatmentName: true, createdAt: true, branchId: true } }),
    db.review.aggregate({ where: reviewWhere, _avg: { rating: true }, _count: { _all: true } }),
  ]);

  return {
    ...s,
    branches: branches.map(b => ({ ...b, href: profileHref(b) })),
    reviews,
    reviewStats: agg._count._all > 0 ? { rating: Math.round((agg._avg.rating ?? 0) * 10) / 10, count: agg._count._all } : null,
  };
});

export type Practitioner = NonNullable<Awaited<ReturnType<typeof getPractitioner>>>;
