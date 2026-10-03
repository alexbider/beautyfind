// Proposes a corrected primary category for every live listing from the evidence we hold: the business
// name, Google's primary and additional types (the import record) and the published treatments per
// category. Writes a CSV for human review and prints counts. Nothing changes without --confirm.
//
//   npm run import:category-audit                       dry run: CSV + summary
//   npm run import:category-audit -- --confirm          apply the proposals to unclaimed listings
//   npm run import:category-audit -- --out path.csv     choose the CSV path (default reports/category-audit.csv)
//
// Claimed listings are reported but never changed: the owner picked their categories. Applying a proposal
// flags the proposed category as primary (adding the row when the listing lacks it), unflags the rest and
// writes an audit row per listing. The canonical profile URL of a changed listing moves to the new
// category; the old address redirects permanently (the profile page already does that).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { CATEGORIES, categoryBySlug } from '../../src/lib/catalog';
import { primaryCategory } from '../../src/lib/category';
import { categoriesFromName, rankCategories } from '../../src/lib/import/categoryRank';
import { GENERIC_TYPES, slugsForType, snake } from '../../src/lib/import/dataforseo';
import { matchService } from '../../src/lib/import/services';
import { isTreatmentName } from '../../src/lib/seo/treatmentHygiene';

const db = new PrismaClient();
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const KNOWN = new Set(CATEGORIES.map(c => c.slug));
const csvCell = (v: string | number | null | undefined) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

interface Row {
  branchId: string;
  businessId: string;
  name: string;
  city: string;
  claimed: boolean;
  current: string | null;
  proposed: string | null;
  reason: string;
  change: boolean;
}

async function main() {
  const confirm = process.argv.includes('--confirm');
  const out = arg('out') ?? 'reports/category-audit.csv';

  const branches = await db.branch.findMany({
    where: { status: 'live', business: { status: 'live' } },
    select: {
      id: true, businessId: true, name: true, cityName: true, isClaimed: true,
      categories: { select: { categorySlug: true, isPrimary: true } },
      treatments: { where: { isPublished: true }, select: { name: true, categorySlug: true, priceAgorot: true } },
    },
    orderBy: [{ regionSlug: 'asc' }, { cityName: 'asc' }, { name: 'asc' }],
  });
  const places = await db.importPlace.findMany({
    where: { branchId: { in: branches.map(b => b.id) } },
    select: { branchId: true, primaryType: true, types: true, categories: true },
  });
  const placeBy = new Map(places.map(p => [p.branchId!, p]));

  const rows: Row[] = branches.map(b => {
    const p = placeBy.get(b.id);
    const current = primaryCategory(b.categories);
    const candidates = b.categories.map(c => c.categorySlug).filter(c => KNOWN.has(c));
    const googlePrimary = p?.primaryType ? slugsForType(p.primaryType) : [];
    const googleGeneric = !!p?.primaryType && GENERIC_TYPES.has(snake(p.primaryType));
    // The stored types start with the primary type as a label ("Beauty salon" next to primaryType beauty_salon): compare by id so it is not scored twice.
    const isPrimary = (t: string) => !!p?.primaryType && snake(t) === snake(p.primaryType);
    const googleAdditional = (p?.types ?? []).filter(t => !isPrimary(t)).flatMap(slugsForType);
    const services: Record<string, { n: number; priced: number }> = {};
    for (const t of b.treatments) {
      // Only real treatment names count, and the matcher's reading of the name wins over the stored category
      // (an import may have filed a skin treatment under hair salons).
      if (!isTreatmentName(t.name)) continue;
      const cat = matchService(t.name)?.category ?? t.categorySlug;
      if (!cat || !KNOWN.has(cat)) continue;
      const s = (services[cat] ??= { n: 0, priced: 0 });
      s.n += 1;
      if (t.priceAgorot != null && t.priceAgorot > 0) s.priced += 1;
    }
    const ranked = rankCategories({ name: b.name, candidates, googlePrimary, googleAdditional, googleGeneric, services });
    const proposed = ranked[0] ?? current;

    const why: string[] = [];
    const nameHits = categoriesFromName(b.name);
    if (nameHits.length) why.push(`השם מעיד על ${nameHits.map(label).join(', ')}`);
    if (googlePrimary.length) why.push(`סוג ראשי בגוגל: ${p!.primaryType}${googleGeneric ? ' (כללי)' : ''} -> ${googlePrimary.map(label).join('/')}`);
    else if (p) why.push('אין סוג ראשי בגוגל');
    const extraTypes = (p?.types ?? []).filter(t => !isPrimary(t) && slugsForType(t).length);
    if (extraTypes.length) why.push(`סוגים נוספים בגוגל: ${extraTypes.map(t => `${t} -> ${slugsForType(t).map(label).join('/')}`).join(', ')}`);
    const top = Object.entries(services).sort((a, c) => c[1].n - a[1].n).slice(0, 2);
    if (top.length) why.push(`טיפולים: ${top.map(([c, s]) => `${label(c)} ${s.n}${s.priced ? ` (${s.priced} עם מחיר)` : ''}`).join(', ')}`);
    if (!p) why.push('ללא רשומת ייבוא');
    if (proposed && proposed !== current && !candidates.includes(proposed)) why.push('הקטגוריה המוצעת לא רשומה על העסק, תתווסף');
    if (b.isClaimed) why.push('עסק בבעלות מאומתת: לא ישונה אוטומטית');

    return { branchId: b.id, businessId: b.businessId, name: b.name, city: b.cityName, claimed: b.isClaimed, current, proposed, reason: why.join('; '), change: proposed != null && proposed !== current };
  });

  const header = ['business_id', 'branch_id', 'name', 'city', 'claimed', 'current_primary', 'proposed_primary', 'change', 'reason'];
  const csv = [header.join(','), ...rows.map(r => [r.businessId, r.branchId, r.name, r.city, r.claimed ? 'yes' : 'no', r.current ?? '', r.proposed ?? '', r.change ? 'yes' : 'no', r.reason].map(csvCell).join(','))].join('\n');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `﻿${csv}\n`);

  const changes = rows.filter(r => r.change);
  const byPair = new Map<string, number>();
  for (const r of changes) byPair.set(`${r.current ?? '-'} -> ${r.proposed}`, (byPair.get(`${r.current ?? '-'} -> ${r.proposed}`) ?? 0) + 1);
  for (const [k, n] of [...byPair.entries()].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(5)}  ${k}`);
  const applicable = changes.filter(r => !r.claimed);
  console.log(`SUMMARY listings=${rows.length} proposals=${changes.length} applicable=${applicable.length} claimed_skipped=${changes.length - applicable.length} csv=${out}`);
  if (!confirm) return console.log('dry run: nothing changed (review the CSV, then add --confirm)');

  let applied = 0;
  for (const r of applicable) {
    await db.$transaction(async tx => {
      await tx.branchCategory.updateMany({ where: { branchId: r.branchId }, data: { isPrimary: false } });
      await tx.branchCategory.upsert({
        where: { branchId_categorySlug: { branchId: r.branchId, categorySlug: r.proposed! } },
        create: { branchId: r.branchId, categorySlug: r.proposed!, isPrimary: true },
        update: { isPrimary: true },
      });
      await tx.auditLog.create({ data: { actorId: null, action: 'category_primary_update', subjectType: 'branch', subjectId: r.branchId, meta: { ref: r.name, from: r.current, to: r.proposed, reason: r.reason, source: 'scripts/import/categoryAudit.ts' } } });
    });
    applied += 1;
  }
  console.log(`APPLIED ${applied} listings. Redeploy or revalidate the site so the sitemap and the cards pick up the new addresses.`);
}

const label = (slug: string) => categoryBySlug(slug)?.name ?? slug;

main()
  .catch(e => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
