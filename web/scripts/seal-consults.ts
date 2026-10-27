// Seals the health answers of consultation requests stored before medical_enc existed (goal, previous
// injections, medical flags) and empties the plain columns. Idempotent: only rows without medical_enc that
// still hold answers. Runs in the Vercel build (scripts/vercel-prebuild.mjs); a failure leaves rows as they were.
import { PrismaClient } from '@prisma/client';
import { seal } from '../src/lib/server/seal-core';

async function main() {
  if (!process.env.DATA_KEY && process.env.NODE_ENV === 'production') return;
  const db = new PrismaClient();
  try {
    const rows = await db.consultRequest.findMany({
      where: { medicalEnc: null, OR: [{ goal: { not: '' } }, { priorInjections: { not: '' } }, { medicalFlags: { isEmpty: false } }] },
      select: { id: true, goal: true, priorInjections: true, medicalFlags: true },
      take: 5000,
    });
    let n = 0;
    for (const r of rows) {
      const res = await db.consultRequest.updateMany({
        where: { id: r.id, medicalEnc: null },
        data: { medicalEnc: seal({ goal: r.goal, prior: r.priorInjections, flags: r.medicalFlags }), goal: '', priorInjections: '', medicalFlags: [] },
      });
      n += res.count;
    }
    console.log(`[seal-consults] sealed ${n} of ${rows.length} requests`);
  } finally {
    await db.$disconnect();
  }
}

main().catch(e => console.error('[seal-consults] failed, nothing else changed:', e instanceof Error ? e.message : e));
