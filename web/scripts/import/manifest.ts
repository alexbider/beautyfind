// Writes docs/coverage-manifest.md from the manifest in src/lib/import/coverage.ts.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { manifestMarkdown } from '../../src/lib/import/coverage';

const out = join(process.cwd(), 'docs', 'coverage-manifest.md');
writeFileSync(out, manifestMarkdown());
console.log(`written ${out}`);
