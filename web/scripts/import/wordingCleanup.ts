// Sitewide wording fix on stored content: descriptions, FAQs, meta titles and meta descriptions of live
// listings get the exact-phrase replacements of the wording brief (average wording instead of אמצעי, בגוגל
// instead of דירוג Google and ב־Google, the city spelling תל אביב-יפו with a hyphen, prices as "180 ₪").
// Claimed listings and listings whose text staff marked approved (editorial.ownerApproved) are never
// touched. Every change is written to an undo CSV (record, field, before, after) and to the audit log, and
// --revert puts the "before" text back. Read-only unless --confirm.
//
// A second pass aligns the stored city spelling with the catalog: the city name on every branch and import
// record, the catalog city rows, and the cover and gallery alt texts that were built from the old spelling
// (fields cityName, coverAlt, city.name, importPlace.cityName, media.alt). Those values are the catalog's,
// not the owner's text, so this pass covers claimed listings too; its rows sit in the same CSVs, and the
// record id column holds the id of the record the field belongs to.
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

/** A stored city name in the catalog's spelling: the en dash of "תל אביב–יפו" becomes a hyphen. */
export const cityNameSpelling = (name: string) => name.replace(/–/g, '-');
/** The old city spelling inside an alt text (the city alone changes; a dash elsewhere stays). */
export const altSpelling = (text: string) => text.split('תל אביב–יפו').join('תל אביב-יפו');
const CITY_LABEL = 'תל אביב–יפו';

type Field = 'description' | 'faqs' | 'metaTitle' | 'metaDescription';
type SpellingField = 'cityName' | 'coverAlt' | 'city.name' | 'importPlace.cityName' | 'media.alt';
const BRANCH_FIELDS = new Set<string>(['description', 'faqs', 'metaTitle', 'metaDescription', 'cityName', 'coverAlt']);
interface Change {
  recordId: string; // branch id, or the id of the city, import record or media file for the spelling pass
  name: string;
  field: Field | SpellingField;
  before: string;
  after: string;
  hits: Record<string, number>;
}

/** The spelling pass: every record whose stored city name or alt text still carries the old spelling. */
async function citySpellingChanges(): Promise<Change[]> {
  const out: Change[] = [];
  const row = (recordId: string, name: string, field: SpellingField, before: string, after: string) => {
    if (before !== after) out.push({ recordId, name, field, before, after, hits: { [CITY_LABEL]: before.split('–').length - 1 } });
  };
  for (const c of await db.city.findMany({ where: { name: { contains: '–' } }, select: { id: true, name: true } })) row(c.id, c.name, 'city.name', c.name, cityNameSpelling(c.name));
  const branches = await db.branch.findMany({
    where: { OR: [{ cityName: { contains: '–' } }, { coverAlt: { contains: CITY_LABEL } }] },
    select: { id: true, name: true, cityName: true, coverAlt: true },
  });
  for (const b of branches) {
    row(b.id, b.name, 'cityName', b.cityName, cityNameSpelling(b.cityName));
    if (b.coverAlt) row(b.id, b.name, 'coverAlt', b.coverAlt, altSpelling(b.coverAlt));
  }
  for (const p of await db.importPlace.findMany({ where: { cityName: { contains: '–' } }, select: { id: true, name: true, cityName: true } })) row(p.id, p.name, 'importPlace.cityName', p.cityName ?? '', cityNameSpelling(p.cityName ?? ''));
  for (const m of await db.mediaFile.findMany({ where: { alt: { contains: CITY_LABEL } }, select: { id: true, key: true, alt: true } })) row(m.id, m.key, 'media.alt', m.alt ?? '', altSpelling(m.alt ?? ''));
  return out;
}

/** Writes one field of one record; the caller decides the direction (apply or revert). */
async function writeField(tx: Prisma.TransactionClient, recordId: string, field: Field | SpellingField, value: string, action: 'wording_cleanup' | 'wording_revert', meta: Prisma.InputJsonObject) {
  if (BRANCH_FIELDS.has(field)) {
    const data: Prisma.BranchUpdateInput = field === 'faqs' ? { faqs: JSON.parse(value) as Prisma.InputJsonValue } : field === 'cityName' ? { cityName: value } : { [field]: value || null };
    await tx.branch.update({ where: { id: recordId }, data });
    await tx.auditLog.create({ data: { actorId: null, action, subjectType: 'branch', subjectId: recordId, meta: { field, script: SOURCE, ...meta } } });
    return;
  }
  if (field === 'city.name') await tx.city.update({ where: { id: recordId }, data: { name: value } });
  else if (field === 'importPlace.cityName') await tx.importPlace.update({ where: { id: recordId }, data: { cityName: value } });
  else if (field === 'media.alt') await tx.mediaFile.update({ where: { id: recordId }, data: { alt: value || null } });
  await tx.auditLog.create({ data: { actorId: null, action, subjectType: field.split('.')[0], subjectId: recordId, meta: { field, script: SOURCE, ...meta } } });
}

/** The current value of a field, in the CSV's representation, or null when the record is gone. */
async function currentValue(recordId: string, field: Field | SpellingField): Promise<string | null> {
  if (BRANCH_FIELDS.has(field)) {
    const b = await db.branch.findUnique({ where: { id: recordId }, select: { description: true, faqs: true, metaTitle: true, metaDescription: true, cityName: true, coverAlt: true } });
    if (!b) return null;
    if (field === 'faqs') return JSON.stringify(b.faqs);
    return b[field as Exclude<Field | 'cityName' | 'coverAlt', 'faqs'>] ?? '';
  }
  if (field === 'city.name') return (await db.city.findUnique({ where: { id: recordId }, select: { name: true } }))?.name ?? null;
  if (field === 'importPlace.cityName') {
    const p = await db.importPlace.findUnique({ where: { id: recordId }, select: { cityName: true } });
    return p ? p.cityName ?? '' : null;
  }
  const m = await db.mediaFile.findUnique({ where: { id: recordId }, select: { alt: true } });
  return m ? m.alt ?? '' : null;
}

async function revert(path: string) {
  const rows = readCsv(path);
  let n = 0;
  for (const r of rows) {
    const id = r.record_id || r.branch_id; // the first runs named the column branch_id
    const field = r.field as Field | SpellingField;
    const current = await currentValue(id, field);
    if (current == null || current !== r.after) continue; // gone, or changed since: leave it
    await db.$transaction(tx => writeField(tx, id, field, r.before, 'wording_revert', { file: path }));
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
    for (const f of found) changes.push({ recordId: b.id, name: b.name, field: f.field, before: f.text, after: f.out, hits: f.hits });
  }
  const spelling = await citySpellingChanges();

  const perPhrase: Record<string, number> = {};
  for (const c of changes) for (const [k, n] of Object.entries(c.hits)) perPhrase[k] = (perPhrase[k] ?? 0) + n;
  const listings = new Set(changes.map(c => c.recordId)).size;
  console.log(`live listings scanned: ${branches.length}; listings with a change: ${listings}; field changes: ${changes.length}; skipped claimed: ${skippedClaimed}; skipped owner-approved or reference: ${skippedApproved}`);
  console.log('replacements per phrase:');
  for (const [k, n] of Object.entries(perPhrase).sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(6)}  ${k}`);
  const byField: Record<string, number> = {};
  for (const c of changes) byField[c.field] = (byField[c.field] ?? 0) + 1;
  console.log(`by field: ${Object.entries(byField).map(([k, n]) => `${k}=${n}`).join(' ')}`);
  const spellingBy: Record<string, number> = {};
  for (const c of spelling) spellingBy[c.field] = (spellingBy[c.field] ?? 0) + 1;
  console.log(`city spelling (תל אביב–יפו to תל אביב-יפו, every record): ${spelling.length} rows: ${Object.entries(spellingBy).map(([k, n]) => `${k}=${n}`).join(' ') || 'none'}`);

  const all = [...changes, ...spelling];
  const byId = new Map(branches.map(b => [b.id, b]));
  const header = ['record_id', 'name', 'field', 'phrases', 'before', 'after', 'public_url'];
  const line = (c: Change) => {
    const b = byId.get(c.recordId);
    return [c.recordId, c.name, c.field, Object.entries(c.hits).map(([k, n]) => `${k} x${n}`).join(' | '), c.before, c.after, b ? `https://beautyfind.co.il/${b.regionSlug}/biz/${b.slug}` : ''];
  };
  writeCsv(out, header, all.map(line));
  console.log(`CSV: ${out} (${all.length} rows)`);
  if (!confirm) {
    console.log(`SUMMARY dry_run listings=${listings} changes=${changes.length} spelling=${spelling.length} skipped_claimed=${skippedClaimed} skipped_approved=${skippedApproved}`);
    console.log('dry run: nothing changed (add --confirm to apply, with the undo CSV)');
    return;
  }
  writeCsv(undoOut, header, all.map(line));
  let n = 0;
  for (const c of all) {
    await db.$transaction(tx => writeField(tx, c.recordId, c.field, c.after, 'wording_cleanup', { phrases: Object.keys(c.hits), undo: undoOut }));
    n++;
  }
  console.log(`APPLIED ${n} field changes (${changes.length} content, ${spelling.length} city spelling) on ${new Set(all.map(c => c.recordId)).size} records. Undo list: ${undoOut} (npm run import:wording-cleanup -- --revert ${undoOut}).`);
  console.log(`SUMMARY applied=${n} listings=${listings} spelling=${spelling.length} csv=${out}`);
}

// Runs only as a script; the tests import the pure helpers above.
if (/wordingCleanup/.test(process.argv[1] ?? '')) {
  main()
    .catch(e => {
      console.error(e instanceof Error ? e.stack ?? e.message : e);
      process.exit(1);
    })
    .finally(() => db.$disconnect());
}
