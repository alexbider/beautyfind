// Reads the hand-written reference profiles (src/lib/import/reference.ts) from the database and writes them
// as the writer's gold examples: for each, the evidence packet it was written from (built the same way the
// worker builds it) and the published description, FAQs and meta description. The output is committed to
// src/lib/import/goldExamples.json and embedded in the system prompt.
//
//   npm run import:gold-examples -- --out reports/gold-examples.json

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { buildPacket, countWords, lengthTier } from '../../src/lib/import/editorial';
import { REFERENCE_BRANCH_IDS } from '../../src/lib/import/reference';

const db = new PrismaClient();
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const out = arg('out') ?? 'reports/gold-examples.json';
  const ids = [...REFERENCE_BRANCH_IDS];
  const branches = await db.branch.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, isClaimed: true, description: true, faqs: true, metaDescription: true, metaTitle: true, editorial: true, treatments: { where: { isPublished: true }, select: { name: true } } } });
  const places = await db.importPlace.findMany({ where: { branchId: { in: ids } } });
  const examples = [];
  for (const id of ids) {
    const b = branches.find(x => x.id === id);
    const p = places.find(x => x.branchId === id);
    if (!b || !p) {
      console.log(`SKIP ${id}: ${!b ? 'no branch' : 'no import record'}`);
      continue;
    }
    const packet = buildPacket(p, { claimed: b.isClaimed, publishedTreatments: b.treatments.map(t => t.name) });
    const faqs = (Array.isArray(b.faqs) ? (b.faqs as Array<{ q: string; a: string }>) : []).map(f => ({ q: f.q, a: f.a }));
    const heading = (b.editorial as { heading?: string } | null)?.heading ?? null;
    const words = countWords(b.description ?? '');
    examples.push({ branchId: id, tier: lengthTier(packet), words, packet, output: { heading, description: b.description ?? '', faqs, metaTitle: b.metaTitle ?? '', metaDescription: b.metaDescription ?? '' } });
    console.log(`${id} ${b.name}: tier=${lengthTier(packet)} words=${words} faqs=${faqs.length} services=${packet.services.length}`);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(examples, null, 1)}\n`);
  console.log(`WROTE ${examples.length} example(s): ${out}`);
}

main()
  .catch(e => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
