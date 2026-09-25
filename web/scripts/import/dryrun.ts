// Credential-free cost preview. No network, no database.
//   npm run import:dryrun
//   npm run import:dryrun -- --website-share 0.5 --google-calls 0.2

import { DEFAULT_ASSUMPTIONS, dfsRunMaxUsd, estimateFor, type EstimateAssumptions } from '../../src/lib/import/estimate';
import { pricing } from '../../src/lib/import/pricing';
import { DEFAULT_SETTINGS } from '../../src/lib/import/settings';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : undefined;
};
const a: EstimateAssumptions = {
  ...DEFAULT_ASSUMPTIONS,
  websiteShare: arg('website-share') ?? DEFAULT_ASSUMPTIONS.websiteShare,
  googleCallsPerRecord: arg('google-calls') ?? DEFAULT_ASSUMPTIONS.googleCallsPerRecord,
  llmShare: arg('llm-share') ?? DEFAULT_ASSUMPTIONS.llmShare,
  usableShare: arg('usable-share') ?? DEFAULT_ASSUMPTIONS.usableShare,
};
const p = pricing();
const usd = (n: number) => `$${n.toFixed(n > 0 && n < 0.01 ? 5 : n < 1 ? 4 : 2)}`;

console.log('DRY RUN: estimate only. Nothing was sent to any provider.\n');
console.log(`Pricing version ${p.version}`);
console.log(`  DataForSEO Business Listings Search: ${usd(p.dataforseo.businessListingsSearch.perRequestUsd)} per request + ${usd(p.dataforseo.businessListingsSearch.perItemUsd)} per record (checked ${p.dataforseo.checked}; ${p.dataforseo.note})`);
console.log(`  Google Place Details per 1,000: ${Object.entries(p.google.placeDetailsPer1000).map(([k, v]) => `${k} $${v}`).join(', ')} (${p.google.note})`);
console.log(`\nAssumptions: ${JSON.stringify(a)}\n`);
console.log('businesses | DFS requests | DFS records | DFS cost | website requests | Google | LLM | total | usable | per usable');
for (const n of [100, 1000, 10000]) {
  const r = estimateFor(n, a);
  console.log([r.businesses, r.dfsRequests, r.dfsRecords, usd(r.dfsUsd), r.websiteRequests, usd(r.googleUsd + r.photoUsd), usd(r.llmUsd), usd(r.totalUsd), r.usable, usd(r.perUsableUsd)].join(' | '));
}
const pilot = dfsRunMaxUsd(DEFAULT_SETTINGS.pilotRecordLimit, DEFAULT_SETTINGS.pilotRecordLimit);
console.log(`\nPilot (${DEFAULT_SETTINGS.pilotRecordLimit} records, ceiling $${DEFAULT_SETTINGS.pilotBudgetUsd}): at most ${pilot.pages} request(s), ${usd(pilot.usd)} gross before tax or minimum top-up.`);
console.log('Website requests have no vendor charge. Google and the LLM are off by default (0 above unless you pass --google-calls / --llm-share).');
