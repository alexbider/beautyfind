// Runs in the Vercel build after migrations. Makes sure the master admin account exists with the
// "ops" staff role. It never sets or changes a password: the owner chooses one once at /ops/setup
// with the single-use link (OPS_SETUP_TOKEN_HASH), and after that the link stops working.
import { PrismaClient } from '@prisma/client';

const email = (process.env.OPS_BOOTSTRAP_EMAIL ?? '').trim().toLowerCase();

async function main() {
  if (!email) return;
  const db = new PrismaClient();
  try {
    const user = await db.user.upsert({
      where: { email },
      create: { email, fullName: 'מנהל BeautyFind', kind: 'business', opsRole: 'ops', emailVerifiedAt: new Date() },
      update: { opsRole: 'ops' },
    });
    console.log(`[ops-bootstrap] ${email} is ops staff${user.passwordHash ? '' : ' (password not set yet: use the /ops/setup link)'}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch(e => {
  // Never block a deploy over this; the admin can be fixed on the next build.
  console.warn('[ops-bootstrap] skipped:', e instanceof Error ? e.message : e);
});
