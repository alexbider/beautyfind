// Import settings from the command line, for the one row the admin's /ops/import form edits
// (import_settings, id 1). Values are parsed with the same schema as the form, so a bad value falls back
// to the default rather than being stored.
//
//   npm run import:settings                              show every setting and the worker's last status
//   npm run import:settings -- --set llmProvider=anthropic   change one setting (audit row: import_settings)
//   npm run import:settings -- --set editorialBudgetUsd=5 --set llmConcurrency=4
//
// The audit row carries no actor (actorId null) and names this script as the source.

import { PrismaClient, type Prisma } from '@prisma/client';
import { ImportSettingsSchema, parseSettings } from '../../src/lib/import/settings';

const db = new PrismaClient();

/** Command-line text as the setting's value: numbers and booleans by their spelling, anything else as text. */
function coerce(_key: string, raw: string): unknown {
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw === 'true' || raw === 'false') return raw === 'true';
  return raw;
}

async function main() {
  const sets: Array<[string, string]> = [];
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--set' && process.argv[i + 1]) {
      const [k, ...rest] = process.argv[++i].split('=');
      sets.push([k.trim(), rest.join('=').trim()]);
    }
  }
  const row = await db.importSettings.findUnique({ where: { id: 1 } });
  const current = parseSettings(row?.values);

  if (sets.length) {
    const patch: Record<string, unknown> = {};
    for (const [k, v] of sets) {
      if (!(k in ImportSettingsSchema.shape)) throw new Error(`unknown setting: ${k}`);
      if (k === 'workerStatus') throw new Error('workerStatus is written by the worker, not by hand');
      const one = (ImportSettingsSchema.shape as Record<string, { safeParse: (v: unknown) => { success: boolean; error?: { message: string } } }>)[k].safeParse(coerce(k, v));
      if (!one.success) throw new Error(`bad value for ${k}: ${v} (${one.error?.message.slice(0, 120)})`);
      patch[k] = coerce(k, v);
    }
    const merged = parseSettings({ ...current, ...patch });
    await db.$transaction(async tx => {
      await tx.importSettings.upsert({ where: { id: 1 }, create: { id: 1, values: merged as unknown as Prisma.InputJsonValue }, update: { values: merged as unknown as Prisma.InputJsonValue } });
      await tx.auditLog.create({ data: { actorId: null, action: 'import_settings', subjectType: 'import_settings', subjectId: '00000000-0000-0000-0000-000000000001', meta: { changed: patch, before: Object.fromEntries(Object.keys(patch).map(k => [k, (current as Record<string, unknown>)[k]])), source: 'scripts/import/settings.ts' } as Prisma.InputJsonValue } });
    });
    for (const [k] of sets) console.log(`SET ${k}: ${JSON.stringify((current as Record<string, unknown>)[k])} -> ${JSON.stringify((merged as Record<string, unknown>)[k])}`);
    return;
  }

  const { workerStatus, ...rest } = current;
  for (const [k, v] of Object.entries(rest)) console.log(`${k} = ${JSON.stringify(v)}`);
  console.log(`workerStatus = ${workerStatus ? JSON.stringify(workerStatus) : '(the worker has not reported yet)'}`);
}

main()
  .catch(e => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
