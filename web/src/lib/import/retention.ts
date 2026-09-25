// Deletes restricted data whose retention period has ended: cached Google display fields and any
// provider observation with an expiry. Runs before every Google lookup and at the start of each worker.

import type { PrismaClient } from '@prisma/client';

type Db = Pick<PrismaClient, 'googleDisplay' | 'fieldObservation'>;

export async function sweepExpired(db: Db, now = new Date()): Promise<{ google: number; observations: number }> {
  const g = await db.googleDisplay.deleteMany({ where: { expiresAt: { lt: now } } });
  const o = await db.fieldObservation.deleteMany({ where: { expiresAt: { lt: now } } });
  return { google: g.count, observations: o.count };
}
