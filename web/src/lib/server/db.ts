import 'server-only';
import { PrismaClient } from '@prisma/client';

// One client per process; Next dev hot-reload would otherwise open a new pool per edit.
const g = globalThis as unknown as { prisma?: PrismaClient };

// DATABASE_URL normally; POSTGRES_* when the database was connected on Vercel under those names.
const url = process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL;

export const db = g.prisma ?? new PrismaClient(url ? { datasourceUrl: url } : undefined);

if (process.env.NODE_ENV !== 'production') g.prisma = db;
