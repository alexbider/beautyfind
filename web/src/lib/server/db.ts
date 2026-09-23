import 'server-only';
import { PrismaClient } from '@prisma/client';

// One client per process; Next dev hot-reload would otherwise open a new pool per edit.
const g = globalThis as unknown as { prisma?: PrismaClient };

// DATABASE_URL normally; POSTGRES_* when the database was connected on Vercel under those names.
const base = process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL;

// `next build` pre-renders many pages at once, and the build machine may be far from the database
// (Vercel builds in the US, the database is in Frankfurt): allow more connections and a longer wait then.
function withBuildPool(u: string | undefined) {
  if (!u || process.env.NEXT_PHASE !== 'phase-production-build') return u;
  try {
    const parsed = new URL(u);
    parsed.searchParams.set('connection_limit', '10');
    parsed.searchParams.set('pool_timeout', '60');
    return parsed.toString();
  } catch {
    return u;
  }
}
const url = withBuildPool(base);

export const db = g.prisma ?? new PrismaClient(url ? { datasourceUrl: url } : undefined);

if (process.env.NODE_ENV !== 'production') g.prisma = db;
