// Re-seals every stored encrypted value with the current DATA_KEY, after a key rotation (see
// src/lib/server/seal-core.ts). Safe to run more than once: values already sealed with the current key are
// skipped, and each row is updated only if it still holds the value that was read.
//   npx tsx scripts/reseal.ts            report only
//   npx tsx scripts/reseal.ts --confirm  re-seal
import { PrismaClient } from '@prisma/client';
import { isCurrent, open, seal } from '../src/lib/server/seal-core';

const confirm = process.argv.includes('--confirm');
const db = new PrismaClient();

type Col = { table: string; idCol: string; col: string };
const COLUMNS: Col[] = [
  { table: 'health_declarations', idCol: 'id', col: 'answers_enc' },
  { table: 'bookings', idCol: 'id', col: 'clinical_enc' },
  { table: 'consult_requests', idCol: 'id', col: 'medical_enc' },
  { table: 'provider_connections', idCol: 'id', col: 'credentials_enc' },
  { table: 'platform_secrets', idCol: 'key', col: 'value_enc' },
];

async function main() {
  for (const c of COLUMNS) {
    const rows = await db.$queryRawUnsafe<Array<{ id: string; v: string }>>(`SELECT "${c.idCol}"::text AS id, "${c.col}" AS v FROM "${c.table}" WHERE "${c.col}" IS NOT NULL`);
    let stale = 0, done = 0, failed = 0;
    for (const r of rows) {
      if (isCurrent(r.v)) continue;
      stale++;
      if (!confirm) continue;
      try {
        const next = seal(open(r.v));
        const n = await db.$executeRawUnsafe(`UPDATE "${c.table}" SET "${c.col}" = $1 WHERE "${c.idCol}"::text = $2 AND "${c.col}" = $3`, next, r.id, r.v);
        done += n;
      } catch (e) {
        failed++;
        console.error(`[reseal] ${c.table} ${r.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
    console.log(`[reseal] ${c.table}.${c.col}: ${rows.length} sealed, ${stale} on an old key or format${confirm ? `, ${done} re-sealed, ${failed} failed` : ''}`);
  }
}

main().finally(() => db.$disconnect());
