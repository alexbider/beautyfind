// Staff report: live listings that publish a medical treatment (isMedical) and have no medical responsible on
// record (branch.medicalResponsibleId) and no active doctor or nurse on the business's staff. The writer
// never presents such a listing as a medical clinic; staff decide whether to add the responsible person,
// unpublish the medical treatments or leave the listing as it is. Read-only.
//
//   npm run import:medical-report -- --out reports/medical-report.csv

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function main() {
  const out = arg('out') ?? 'reports/medical-report.csv';
  const branches = await db.branch.findMany({
    where: { status: 'live', treatments: { some: { isMedical: true, isPublished: true } } },
    select: {
      id: true, name: true, cityName: true, regionSlug: true, slug: true, isClaimed: true, medicalResponsibleId: true,
      categories: { select: { categorySlug: true, isPrimary: true } },
      treatments: { where: { isMedical: true, isPublished: true }, select: { name: true } },
      business: { select: { staff: { where: { status: 'active', profession: { in: ['doctor', 'nurse'] } }, select: { displayName: true, profession: true, branchIds: true } } } },
    },
    orderBy: [{ regionSlug: 'asc' }, { cityName: 'asc' }, { name: 'asc' }],
  });
  const rows = branches
    .map(b => {
      const staff = b.business.staff.filter(m => !m.branchIds.length || m.branchIds.includes(b.id));
      return { ...b, staff, covered: !!b.medicalResponsibleId || staff.length > 0 };
    })
    .filter(b => !b.covered);
  const header = ['branch_id', 'name', 'city', 'region', 'claimed', 'primary_category', 'categories', 'medical_treatments', 'medical_treatment_count', 'admin_url', 'public_url'];
  const lines = rows.map(b => [
    b.id, b.name, b.cityName, b.regionSlug, b.isClaimed ? 'yes' : 'no',
    b.categories.find(c => c.isPrimary)?.categorySlug ?? '', b.categories.map(c => c.categorySlug).join(' | '),
    b.treatments.map(t => t.name).join(' | '), b.treatments.length,
    `https://beautyfind.co.il/ops/businesses/branch/${b.id}`, `https://beautyfind.co.il/${b.regionSlug}/biz/${b.slug}`,
  ].map(csvCell).join(','));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `﻿${[header.join(','), ...lines].join('\n')}\n`);
  const claimed = rows.filter(r => r.isClaimed).length;
  console.log(`live listings with published medical treatments: ${branches.length}; without a medical responsible or a doctor or nurse on staff: ${rows.length} (claimed ${claimed}, unclaimed ${rows.length - claimed})`);
  const byCat = new Map<string, number>();
  for (const r of rows) {
    const k = r.categories.find(c => c.isPrimary)?.categorySlug ?? '(none)';
    byCat.set(k, (byCat.get(k) ?? 0) + 1);
  }
  for (const [k, n] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(6)}  ${k}`);
  console.log(`SUMMARY uncovered=${rows.length} csv=${out}`);
}

main()
  .catch(e => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
