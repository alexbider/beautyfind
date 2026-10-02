// How many city + category pages are empty, list one business or list two or more, under the old rule
// (primary category only) and the current one (every business that offers the category). Reads the
// database in DATABASE_URL and prints a Markdown table; --json prints the full report with per-page rows.
//
//   DATABASE_URL=... npm run seo:city-category-report
//   DATABASE_URL=... npm run seo:city-category-report -- --json > reports/city-category.json

import { cityCategoryReport } from '../src/lib/server/cityCategoryReport';

async function main() {
  const r = await cityCategoryReport();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(r, null, 1));
    return;
  }
  const row = (label: string, a: number, b: number) => `| ${label} | ${a} | ${b} |`;
  console.log(`City + category pages: ${r.pages} (${r.liveBranches} live listings, ${r.at})\n`);
  console.log('| Pages | Primary category only (before) | Any category (after) |\n|---|---|---|');
  console.log(row('Empty', r.primaryOnly.empty, r.anyCategory.empty));
  console.log(row('One business', r.primaryOnly.single, r.anyCategory.single));
  console.log(row('Two or more', r.primaryOnly.twoPlus, r.anyCategory.twoPlus));
  console.log(`\nPages that were empty and now have content: ${r.filled}. Pages that had one business and now have two or more: ${r.singleToMany}.`);
}

main()
  .catch(e => {
    console.error(e instanceof Error ? e.stack ?? e.message : e);
    process.exit(1);
  })
  .finally(() => process.exit());
