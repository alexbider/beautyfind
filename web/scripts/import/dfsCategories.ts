// Checks the category ids in src/lib/import/dataforseo.ts against DataForSEO's own category list
// (GET /v3/business_data/business_listings/categories). Run once with real credentials before the
// first live pilot. The call may be billed by DataForSEO, so it needs --confirm.
//
//   DATAFORSEO_LOGIN=... DATAFORSEO_PASSWORD=... npm run import:dfs-categories -- --confirm

import { DFS_CATEGORY_MAP } from '../../src/lib/import/dataforseo';

const BASE = process.env.DATAFORSEO_BASE_URL || 'https://api.dataforseo.com';
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

async function main() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    console.error('Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD (never commit them).');
    process.exit(1);
  }
  if (!process.argv.includes('--confirm')) {
    console.error('This calls DataForSEO once and may be billed. Re-run with --confirm.');
    process.exit(1);
  }
  const res = await fetch(`${BASE}/v3/business_data/business_listings/categories`, {
    headers: { Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json()) as { status_code?: number; status_message?: string; cost?: number; tasks?: Array<{ status_code?: number; status_message?: string; result?: Array<{ category_name?: string; business_count?: number }> }> };
  const task = json.tasks?.[0];
  if (json.status_code !== 20000 || task?.status_code !== 20000) {
    console.error(`DataForSEO ${task?.status_code ?? json.status_code}: ${task?.status_message ?? json.status_message}`);
    process.exit(1);
  }
  console.log(`cost reported: $${json.cost ?? 'n/a'}`);
  const known = new Map((task.result ?? []).filter(r => r.category_name).map(r => [norm(r.category_name!), r]));
  let missing = 0;
  for (const [slug, ids] of Object.entries(DFS_CATEGORY_MAP)) {
    for (const id of ids) {
      const hit = known.get(norm(id));
      if (hit) console.log(`ok       ${slug.padEnd(20)} ${id} (${hit.business_count ?? '?'} businesses worldwide)`);
      else {
        missing++;
        const near = [...known.keys()].filter(k => k.includes(norm(id).split('_')[0])).slice(0, 5);
        console.log(`MISSING  ${slug.padEnd(20)} ${id}${near.length ? `  close: ${near.join(', ')}` : ''}`);
      }
    }
  }
  console.log(missing ? `\n${missing} id(s) not found. Fix DFS_CATEGORY_MAP before a live run.` : '\nAll mapped ids exist.');
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
