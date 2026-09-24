// Runs during the Vercel build, only on test deployments (STAGING=1):
//  - always syncs the catalog; SEED_DEMO=1 also loads the fictional demo clinics (safe to repeat)
//  - OPS_EMAILS="a@x.com,b@y.com" makes those existing accounts BeautyFind ops staff
// Real deployments never run this: without STAGING=1 it does nothing.
import { execSync } from 'node:child_process';

if (process.env.STAGING !== '1') process.exit(0);

const run = cmd => execSync(cmd, { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development' } });

// The catalog (regions, cities, categories) is always kept in sync; demo clinics only with SEED_DEMO=1.
console.log(`[staging-seed] catalog${process.env.SEED_DEMO === '1' ? ' and demo clinics' : ''}`);
run('npx tsx prisma/seed.ts');
if (process.env.SEED_DEMO === '1') run('npx tsx prisma/seed-demo.ts');

for (const email of (process.env.OPS_EMAILS ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
  try {
    run(`npx tsx scripts/grant-ops.ts ${JSON.stringify(email)} ops`);
  } catch {
    console.warn(`[staging-seed] ${email}: no account yet. Sign up at /login?role=biz, then redeploy.`);
  }
}
