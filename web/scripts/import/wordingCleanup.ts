// Sitewide wording fix on stored content: descriptions, FAQs, meta titles and meta descriptions of live
// listings get the exact-phrase replacements of the wording brief (average wording instead of אמצעי, בגוגל
// instead of דירוג Google and ב־Google, the city spelling תל אביב-יפו with a hyphen, prices as "180 ₪").
// Claimed listings and listings whose text staff marked approved (editorial.ownerApproved) are never
// touched. Every change is written to an undo CSV (branch, field, before, after) and to the audit log, and
// --revert puts the "before" text back. Read-only unless --confirm.
//
//   npm run import:wording-cleanup                      dry run: counts per phrase, CSV of the listings
//   npm run import:wording-cleanup -- --confirm         apply, with the undo CSV
//   npm run import:wording-cleanup -- --revert <csv>    undo from an earlier run's undo CSV
//   options: --out reports/wording-cleanup.csv  --undo-out reports/wording-cleanup-undo.csv

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PrismaClient, type Prisma } from '@prisma/client';
import { isReferenceBranch } from '../../src/lib/import/reference';

const db = new PrismaClient();
const SOURCE = 'scripts/import/wordingCleanup.ts';
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const writeCsv = (path: string, header: string[], rows: unknown[][]) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `﻿${[header.join(','), ...rows.map(r => r.map(csvCell).join(','))].join('\n')}\n`);
};
function readCsv(path: string): Array<Record<string, string>> {
  if (!existsSync(path)) throw new Error(`file not found: ${path}`);
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [header, ...data] = rows;
  return data.filter(r => r.length > 1).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

/** The exact phrases of the brief (items 2 and 4), longest first so a longer phrase is never split by a shorter one. */
export const REPLACEMENTS: Array<{ from: string | RegExp; to: string; label: string }> = [
  { from: 'דירוג Google אמצעי', to: 'דירוג ממוצע בגוגל', label: 'דירוג Google אמצעי' },
  { from: 'דירוג אמצעי בגוגל', to: 'דירוג ממוצע בגוגל', label: 'דירוג אמצעי בגוגל' },
  { from: 'דירוג אמצעי', to: 'דירוג ממוצע בגוגל', label: 'דירוג אמצעי' },
  { from: 'מול המחיר האמצעי הארצי', to: 'מול המחיר הממוצע הארצי', label: 'מול המחיר האמצעי הארצי' },
  { from: 'המחירים האמצעיים', to: 'המחירים הממוצעים', label: 'המחירים האמצעיים' },
  { from: 'המחיר האמצעי', to: 'המחיר הממוצע', label: 'המחיר האמצעי' },
  { from: 'מחיר האמצעי', to: 'מחיר הממוצע', label: 'במחיר האמצעי' },
  { from: 'מחירים אמצעיים', to: 'מחירים ממוצעים', label: 'מחירים אמצעיים' },
  { from: 'מחיר אמצעי', to: 'מחיר ממוצע', label: 'מחיר אמצעי' },
  { from: 'דירוג Google', to: 'דירוג בגוגל', label: 'דירוג Google' },
  { from: 'ב־Google', to: 'בגוגל', label: 'ב־Google' },
  { from: 'ב-Google', to: 'בגוגל', label: 'ב-Google' },
  { from: 'תל אביב–יפו', to: 'תל אביב-יפו', label: 'תל אביב–יפו' },
  // "₪1,200" and "₪ 1,200" become "1,200 ₪"; the number keeps its own formatting.
  { from: /₪\s?(\d[\d,.]*)/gu, to: '$1 ₪', label: '₪ לפני המספר' },
];

export function applyWording(text: string): { out: string; hits: Record<string, number> } {
  let out = text;
  const hits: Record<string, number> = {};
  for (const r of REPLACEMENTS) {
    const before = out;
    if (typeof r.from === 'string') {
      const n = out.split(r.from).length - 1;
      if (n) {
        out = out.split(r.from).join(r.to);
        hits[r.label] = (hits[r.label] ?? 0) + n;
      }
    } else {
      const n = (out.match(r.from) ?? []).length;
      if (n) {
        out = out.replace(r.from, r.to);
        hits[r.label] = (hits[r.label] ?? 0) + n;
      }
    }
    if (before === out && hits[r.label]) delete hits[r.label];
  }
  return { out, hits };
}

type Field = 'description' | 'faqs' | 'metaTitle' | 'metaDescription';
interface Change {
  branchId: string;
  name: string;
  field: Field;
  before: string;
  after: string;
  hits: Record<string, number>;
}

async function revert(path: string) {
  const rows = readCsv(path);
  let n = 0;
  for (const r of rows) {
    const cur = await db.branch.findUnique({ where: { id: r.branch_id }, select: { description: true, faqs: true, metaTitle: true, metaDescription: true } });
    if (!cur) continue;
    const field = r.field as Field;
    const current = field === 'faqs' ? JSON.stringify(cur.faqs) : (cur[field] ?? '');
    if (current !== r.after) continue; // changed since: leave it
    const data: Prisma.BranchUpdateInput = field === 'faqs' ? { faqs: JSON.parse(r.before) as Prisma.InputJsonValue } : { [field]: r.before || null };
    await db.$transaction(async tx => {
      await tx.branch.update({ where: { id: r.branch_id }, data });
      await tx.auditLog.create({ data: { actorId: null, action: 'wording_revert', subjectType: 'branch', subjectId: r.branch_id, meta: { field, script: SOURCE, file: path } } });
    });
    n++;
  }
  console.log(`REVERTED ${n} of ${rows.length} rows (rows whose text changed since were left alone).`);
}

async function main() {
  const revertFile = arg('revert');
  if (revertFile) return revert(revertFile);
  const confirm = process.argv.includes('--confirm');
  const out = arg('out') ?? 'reports/wording-cleanup.csv';
  const undoOut = arg('undo-out') ?? 'reports/wording-cleanup-undo.csv';

  const branches = await db.branch.findMany({
    where: { status: 'live' },
    select: { id: true, name: true, isClaimed: true, editorial: true, description: true, faqs: true, metaTitle: true, metaDescription: true, regionSlug: true, slug: true },
    orderBy: [{ regionSlug: 'asc' }, { name: 'asc' }],
  });
  const changes: Change[] = [];
  let skippedClaimed = 0;
  let skippedApproved = 0;
  for (const b of branches) {
    const ownerApproved = (b.editorial as { ownerApproved?: boolean } | null)?.ownerApproved === true;
    const fields: Array<[Field, string]> = [
      ['description', b.description ?? ''],
      ['faqs', JSON.stringify(b.faqs ?? [])],
      ['metaTitle', b.metaTitle ?? ''],
      ['metaDescription', b.metaDescription ?? ''],
    ];
    const found = fields.map(([field, text]) => ({ field, text, ...applyWording(text) })).filter(f => f.out !== f.text);
    if (!found.length) continue;
    if (b.isClaimed) {
      skippedClaimed++;
      continue;
    }
    if (ownerApproved || isReferenceBranch(b.id)) {
      skippedApproved++;
      continue;
    }
    for (const f of found) changes.push({ branchId: b.id, name: b.name, field: f.field, before: f.text, after: f.out, hits: f.hits });
  }

  const perPhrase: Record<string, number> = {};
  for (const c of changes) for (const [k, n] of Object.entries(c.hits)) perPhrase[k] = (perPhrase[k] ?? 0) + n;
  const listings = new Set(changes.map(c => c.branchId)).size;
  console.log(`live listings scanned: ${branches.length}; listings with a change: ${listings}; field changes: ${changes.length}; skipped claimed: ${skippedClaimed}; skipped owner-approved or reference: ${skippedApproved}`);
  console.log('replacements per phrase:');
  for (const [k, n] of Object.entries(perPhrase).sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(6)}  ${k}`);
  const byField: Record<string, number> = {};
  for (const c of changes) byField[c.field] = (byField[c.field] ?? 0) + 1;
  console.log(`by field: ${Object.entries(byField).map(([k, n]) => `${k}=${n}`).join(' ')}`);

  const header = ['branch_id', 'name', 'field', 'phrases', 'before', 'after', 'public_url'];
  const line = (c: Change) => [c.branchId, c.name, c.field, Object.entries(c.hits).map(([k, n]) => `${k} x${n}`).join(' | '), c.before, c.after, `https://beautyfind.co.il/${(branches.find(b => b.id === c.branchId)!).regionSlug}/biz/${(branches.find(b => b.id === c.branchId)!).slug}`];
  writeCsv(out, header, changes.map(line));
  console.log(`CSV: ${out} (${changes.length} rows)`);
  if (!confirm) {
    console.log(`SUMMARY dry_run listings=${listings} changes=${changes.length} skipped_claimed=${skippedClaimed} skipped_approved=${skippedApproved}`);
    console.log('dry run: nothing changed (add --confirm to apply, with the undo CSV)');
    return;
  }
  writeCsv(undoOut, header, changes.map(line));
  let n = 0;
  const byBranch = new Map<string, Change[]>();
  for (const c of changes) byBranch.set(c.branchId, [...(byBranch.get(c.branchId) ?? []), c]);
  for (const [branchId, list] of byBranch) {
    const data: Prisma.BranchUpdateInput = {};
    for (const c of list) {
      if (c.field === 'faqs') data.faqs = JSON.parse(c.after) as Prisma.InputJsonValue;
      else data[c.field] = c.after;
    }
    await db.$transaction(async tx => {
      await tx.branch.update({ where: { id: branchId }, data });
      await tx.auditLog.create({ data: { actorId: null, action: 'wording_cleanup', subjectType: 'branch', subjectId: branchId, meta: { fields: list.map(c => c.field), phrases: list.flatMap(c => Object.keys(c.hits)), script: SOURCE, undo: undoOut } } });
    });
    n += list.length;
  }
  console.log(`APPLIED ${n} field changes on ${byBranch.size} listings. Undo list: ${undoOut} (npm run import:wording-cleanup -- --revert ${undoOut}).`);
  console.log(`SUMMARY applied=${n} listings=${byBranch.size} csv=${out}`);
}

main()
  .catch(e => {
    console.error(e instanceof Error ? e.stack ?? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
