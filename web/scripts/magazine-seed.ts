// Seeds the magazine's starting data (src/lib/magazineSeed.ts) through the same service the admin and the
// MCP tools use, so every row leaves its audit trail. Idempotent: existing slugs are updated, not duplicated.
//
//   DATABASE_URL=... npx tsx --conditions=react-server scripts/magazine-seed.ts --actor ops@example.com
//
// Needs a staff account with the ops role (the actor named in the audit rows). Never run against production
// from a laptop; production is seeded through the MCP tools or a GitHub Actions job.
import { PrismaClient } from '@prisma/client';
import { DEFAULT_AUTHOR, SEED_CATEGORIES, SEED_TAGS } from '../src/lib/magazineSeed';
import { createTag, upsertAuthor, upsertCategory } from '../src/lib/server/articles';

async function main() {
  const i = process.argv.indexOf('--actor');
  const email = i > 0 ? process.argv[i + 1] : process.env.SEED_ACTOR_EMAIL;
  if (!email) throw new Error('pass --actor <staff email>');
  const db = new PrismaClient();
  const user = await db.user.findFirst({ where: { email, opsRole: { not: null } } });
  if (!user) throw new Error(`no staff account for ${email}`);
  const actor = { id: user.id, opsRole: user.opsRole };
  const existingAuthor = await db.author.findUnique({ where: { slug: DEFAULT_AUTHOR.slug } });
  const author = await upsertAuthor(actor, { ...(existingAuthor ? { id: existingAuthor.id } : {}), slug: DEFAULT_AUTHOR.slug, name: DEFAULT_AUTHOR.name, active: true });
  if (!author.ok) throw new Error(`author: ${author.error}`);
  console.log(`author ${author.created ? 'created' : 'updated'}: ${author.author.id} ${author.author.name}`);
  for (const c of SEED_CATEGORIES) {
    const r = await upsertCategory(actor, c);
    if (!r.ok) throw new Error(`category ${c.slug}: ${r.error}`);
    console.log(`category ${r.created ? 'created' : 'updated'}: ${r.category.id} ${c.slug}`);
  }
  for (const name of SEED_TAGS) {
    const r = await createTag(actor, { name });
    if (!r.ok) throw new Error(`tag ${name}: ${r.error}`);
    console.log(`tag ${r.created ? 'created' : 'exists'}: ${r.tag.id} ${r.tag.slug}`);
  }
  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
