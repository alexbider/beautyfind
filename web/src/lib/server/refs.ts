import 'server-only';
import { db } from './db';

/** Next sequential human ref for a prefix: BIZ-0001, CLM-1107 ... */
export async function nextRef(prefix: string, pad = 4): Promise<string> {
  const row = await db.refCounter.upsert({
    where: { prefix },
    create: { prefix, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${prefix}-${String(row.value).padStart(pad, '0')}`;
}
