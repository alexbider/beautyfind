// Runs before `next build` (npm run build). On Vercel it applies database migrations and, on test
// deployments, loads demo data. Locally (no VERCEL env) it does nothing.
import { execSync } from 'node:child_process';

if (process.env.VERCEL !== '1') process.exit(0);

const env = { ...process.env };
// Neon on Vercel sets DATABASE_URL / DATABASE_URL_UNPOOLED; other setups use POSTGRES_* names.
env.DATABASE_URL ||= env.POSTGRES_PRISMA_URL || env.POSTGRES_URL;
env.DATABASE_URL_UNPOOLED ||= env.POSTGRES_URL_NON_POOLING || env.DATABASE_URL;
if (!env.DATABASE_URL) {
  console.error('[prebuild] No database URL. Connect the Neon database to this project (Storage tab), then redeploy.');
  process.exit(1);
}

const run = cmd => execSync(cmd, { stdio: 'inherit', env });

console.log('[prebuild] applying database migrations');
run('npx prisma migrate deploy');

console.log(`[prebuild] STAGING=${env.STAGING ?? '(not set)'} SEED_DEMO=${env.SEED_DEMO ?? '(not set)'}`);
if (env.SEED_DEMO === '1' && env.STAGING !== '1') console.warn('[prebuild] SEED_DEMO is ignored because STAGING is not 1');
run('node scripts/staging-seed.mjs');
