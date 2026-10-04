// Hebrew addresses for every listing. For each live branch with a Google place id, one Place Details call
// (languageCode he, essentials SKU) gives the Hebrew street, number and postal code; the display line is
// composed with the city already stored on the branch and the floor or building details of the original
// (src/lib/import/address.ts). Without a usable Google answer the street dictionary translates a Latin
// street, and an unknown street leaves the city alone. The original stays in address_raw; the linked import
// record gets the same Hebrew line so the writer's packet agrees with the page. Claimed listings whose owner
// entered the address (address_source owner, or an address that differs from the import record) are never
// changed. Read-only unless --confirm.
//
//   npm run import:hebrew-addresses                       dry run: Google calls, CSV, counts, 10 before/after samples
//   npm run import:hebrew-addresses -- --confirm          apply (calls Google again unless --from)
//   npm run import:hebrew-addresses -- --confirm --from reports/hebrew-addresses.csv
//                                                         apply exactly what an earlier dry run's CSV proposes, no Google calls
//   npm run import:hebrew-addresses -- --revert reports/hebrew-addresses.csv
//                                                         undo: put address_before back for the rows that were applied
//   options: --out reports/hebrew-addresses.csv  --fallbacks-out reports/hebrew-addresses-fallbacks.csv
//            --max-calls 1000  --concurrency 2  --rpm 90 (Google calls per minute, the per-minute quota)  --limit N (first N listings)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { addressProblems, composeHebrewAddress, type AddressSource, type GoogleAddress } from '../../src/lib/import/address';
import { ADDRESS_CALL_USD, fetchGoogleAddress, validPlaceId } from '../../src/lib/import/placesAddress';

const db = new PrismaClient();
const SOURCE = 'scripts/import/hebrewAddresses.ts';
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
/** A small CSV reader for our own files (quoted cells with commas, doubled quotes). */
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

const HEADER = ['branch_id', 'name', 'city', 'claimed', 'place_id', 'address_before', 'address_after', 'source', 'postal_code', 'google_formatted', 'action', 'problems_after', 'public_url'];
type Action = 'apply' | 'unchanged' | 'skipped_owner' | 'skipped_no_city';

interface Row {
  branchId: string;
  name: string;
  city: string;
  claimed: boolean;
  placeId: string;
  before: string;
  after: string;
  source: AddressSource;
  postalCode: string;
  googleFormatted: string;
  action: Action;
  problems: string[];
  url: string;
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

async function apply(rows: Row[], from: string | null) {
  let n = 0;
  for (const r of rows) {
    if (r.action !== 'apply') continue;
    await db.$transaction(async tx => {
      const cur = await tx.branch.findUnique({ where: { id: r.branchId }, select: { address: true, addressRaw: true } });
      if (!cur) return;
      await tx.branch.update({ where: { id: r.branchId }, data: { address: r.after, addressRaw: cur.addressRaw ?? cur.address, postalCode: r.postalCode || null, addressSource: r.source } });
      await tx.importPlace.updateMany({ where: { branchId: r.branchId }, data: { address: r.after } });
      await tx.auditLog.create({ data: { actorId: null, action: 'address_hebrew', subjectType: 'branch', subjectId: r.branchId, meta: { before: cur.address, after: r.after, source: r.source, postalCode: r.postalCode || null, script: SOURCE, from } } });
    });
    n++;
  }
  return n;
}

async function revert(path: string) {
  const rows = readCsv(path).filter(r => r.action === 'apply');
  let n = 0;
  for (const r of rows) {
    const cur = await db.branch.findUnique({ where: { id: r.branch_id }, select: { address: true } });
    if (!cur || cur.address !== r.address_after) continue; // changed since: leave it
    await db.$transaction(async tx => {
      await tx.branch.update({ where: { id: r.branch_id }, data: { address: r.address_before, postalCode: null, addressSource: null } });
      await tx.importPlace.updateMany({ where: { branchId: r.branch_id }, data: { address: r.address_before } });
      await tx.auditLog.create({ data: { actorId: null, action: 'address_revert', subjectType: 'branch', subjectId: r.branch_id, meta: { from: r.address_after, to: r.address_before, script: SOURCE, file: path } } });
    });
    n++;
  }
  console.log(`REVERTED ${n} of ${rows.length} applied rows (rows whose address changed since were left alone).`);
}

async function main() {
  const revertFile = arg('revert');
  if (revertFile) return revert(revertFile);
  const confirm = process.argv.includes('--confirm');
  const from = arg('from') ?? null;
  const out = arg('out') ?? 'reports/hebrew-addresses.csv';
  const fallbacksOut = arg('fallbacks-out') ?? 'reports/hebrew-addresses-fallbacks.csv';
  const maxCalls = Math.max(0, Number(arg('max-calls') ?? 1000));
  const concurrency = Math.max(1, Math.min(8, Number(arg('concurrency') ?? 2)));
  const rpm = Math.max(10, Math.min(600, Number(arg('rpm') ?? 90)));
  // A pacer: calls are spaced at least 60/rpm seconds apart across the pool, so the per-minute quota holds.
  let nextSlot = 0;
  const pace = async () => {
    const now = Date.now();
    const at = Math.max(now, nextSlot);
    nextSlot = at + Math.ceil(60_000 / rpm);
    if (at > now) await new Promise(r => setTimeout(r, at - now));
  };
  const limit = arg('limit') ? Math.max(1, Number(arg('limit'))) : null;

  if (from) {
    if (!confirm) throw new Error('--from needs --confirm');
    const rows: Row[] = readCsv(from).map(r => ({
      branchId: r.branch_id, name: r.name, city: r.city, claimed: r.claimed === 'yes', placeId: r.place_id, before: r.address_before, after: r.address_after,
      source: r.source as AddressSource, postalCode: r.postal_code, googleFormatted: r.google_formatted, action: r.action as Action, problems: r.problems_after ? r.problems_after.split(' | ') : [], url: r.public_url,
    }));
    const n = await apply(rows, from);
    writeCsv(out, HEADER, rows.map(r => [r.branchId, r.name, r.city, r.claimed ? 'yes' : 'no', r.placeId, r.before, r.after, r.source, r.postalCode, r.googleFormatted, r.action, r.problems.join(' | '), r.url]));
    console.log(`APPLIED ${n} addresses from ${from}. Undo: npm run import:hebrew-addresses -- --revert ${out}`);
    console.log(`SUMMARY applied=${n} csv=${out}`);
    return;
  }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) console.log('WARNING: GOOGLE_MAPS_API_KEY is not set; every listing falls back to the dictionary or the city alone.');

  const branches = await db.branch.findMany({
    where: { status: 'live' },
    select: { id: true, name: true, cityName: true, address: true, addressRaw: true, addressSource: true, postalCode: true, isClaimed: true, googlePlaceId: true, regionSlug: true, slug: true },
    orderBy: [{ regionSlug: 'asc' }, { cityName: 'asc' }, { name: 'asc' }],
    ...(limit ? { take: limit } : {}),
  });
  // The import record's address: a claimed listing whose address differs from it was edited by the owner.
  const places = await db.importPlace.findMany({ where: { branchId: { in: branches.map(b => b.id) } }, select: { branchId: true, address: true } });
  const importAddressOf = new Map(places.map(p => [p.branchId!, p.address]));

  const rows: Row[] = [];
  let calls = 0;
  let errors = 0;
  let noGoogle = 0;
  await pool(branches, concurrency, async b => {
    const city = b.cityName.trim();
    const importAddress = importAddressOf.get(b.id)?.trim();
    const ownerEdited = b.isClaimed && (b.addressSource === 'owner' || (!!importAddress && importAddress !== b.address.trim() && importAddress.replace(/,?\s*ישראל$/u, '') !== b.address.trim()));
    let google: GoogleAddress | null = null;
    let googleCalled = false;
    if (!ownerEdited && key && validPlaceId(b.googlePlaceId) && calls < maxCalls) {
      calls++;
      googleCalled = true;
      try {
        await pace();
        google = await fetchGoogleAddress(b.googlePlaceId, { key });
      } catch (e) {
        errors++;
        console.error(`google ${b.id}: ${e instanceof Error ? e.message : e}`);
      }
      if (!google?.route) noGoogle++;
    }
    const r = city ? composeHebrewAddress(google, b.address, city) : { address: b.address, postalCode: null, source: 'unchanged' as AddressSource };
    const changed = r.address !== b.address.trim() || (!!r.postalCode && r.postalCode !== b.postalCode);
    const action: Action = ownerEdited ? 'skipped_owner' : !city ? 'skipped_no_city' : changed ? 'apply' : 'unchanged';
    rows.push({
      branchId: b.id, name: b.name, city, claimed: b.isClaimed, placeId: b.googlePlaceId ?? '', before: b.address, after: action === 'apply' ? r.address : b.address,
      source: action === 'apply' ? r.source : (b.addressSource as AddressSource | null) ?? (googleCalled ? r.source : 'unchanged'), postalCode: action === 'apply' ? r.postalCode ?? '' : b.postalCode ?? '',
      googleFormatted: google?.formatted ?? '', action, problems: addressProblems(action === 'apply' ? r.address : b.address), url: `https://beautyfind.co.il/${b.regionSlug}/biz/${b.slug}`,
    });
  });
  rows.sort((a, b) => a.city.localeCompare(b.city, 'he') || a.name.localeCompare(b.name, 'he'));

  writeCsv(out, HEADER, rows.map(r => [r.branchId, r.name, r.city, r.claimed ? 'yes' : 'no', r.placeId, r.before, r.after, r.source, r.postalCode, r.googleFormatted, r.action, r.problems.join(' | '), r.url]));
  const fallbacks = rows.filter(r => r.action !== 'skipped_owner' && (r.source === 'dictionary' || r.source === 'city_only' || r.problems.length));
  writeCsv(fallbacksOut, HEADER, fallbacks.map(r => [r.branchId, r.name, r.city, r.claimed ? 'yes' : 'no', r.placeId, r.before, r.after, r.source, r.postalCode, r.googleFormatted, r.action, r.problems.join(' | '), r.url]));

  const count = (f: (r: Row) => boolean) => rows.filter(f).length;
  const applying = rows.filter(r => r.action === 'apply');
  console.log(`live listings: ${rows.length}; with a Google place id: ${count(r => validPlaceId(r.placeId))}; Google calls: ${calls} (errors ${errors}, no usable address ${noGoogle}), about ${(calls * ADDRESS_CALL_USD).toFixed(2)} USD at list price`);
  console.log(`Hebrew address from Google: ${count(r => r.source === 'google' && r.action !== 'skipped_owner')}`);
  console.log(`street from the dictionary: ${count(r => r.source === 'dictionary' && r.action !== 'skipped_owner')}`);
  console.log(`city only (street unknown): ${count(r => r.source === 'city_only' && r.action !== 'skipped_owner')}`);
  console.log(`already Hebrew, unchanged: ${count(r => r.source === 'unchanged' && r.action === 'unchanged')}`);
  console.log(`skipped (owner-entered address on a claimed listing): ${count(r => r.action === 'skipped_owner')}; skipped (no city): ${count(r => r.action === 'skipped_no_city')}`);
  console.log(`would change: ${applying.length}; still with Latin after the pass: ${count(r => r.problems.length > 0 && r.action !== 'skipped_owner')}`);

  // Ten before/after samples across the sources.
  const pick = (src: AddressSource, n: number) => applying.filter(r => r.source === src).slice(0, n);
  const samples = [...pick('google', 5), ...pick('dictionary', 3), ...pick('city_only', 2)];
  for (const r of [...samples, ...applying.filter(r => !samples.includes(r))].slice(0, 10)) console.log(`  [${r.source}] ${r.name} (${r.city}) | before: ${r.before} | after: ${r.after}${r.postalCode ? ` | postal ${r.postalCode}` : ''}`);
  console.log(`CSV: ${out} (${rows.length} rows); fallbacks for staff: ${fallbacksOut} (${fallbacks.length} rows)`);

  if (!confirm) {
    console.log(`SUMMARY dry_run google=${count(r => r.source === 'google' && r.action === 'apply')} dictionary=${count(r => r.source === 'dictionary' && r.action === 'apply')} city_only=${count(r => r.source === 'city_only' && r.action === 'apply')} unchanged=${count(r => r.action === 'unchanged')} skipped_owner=${count(r => r.action === 'skipped_owner')} would_change=${applying.length} calls=${calls}`);
    console.log('dry run: nothing changed (add --confirm, or run with --confirm --from <this CSV> to apply without new Google calls)');
    return;
  }
  const n = await apply(rows, null);
  console.log(`APPLIED ${n} addresses. Undo: npm run import:hebrew-addresses -- --revert ${out}`);
  console.log(`SUMMARY applied=${n} csv=${out}`);
}

main()
  .catch(e => {
    console.error(e instanceof Error ? e.stack ?? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
