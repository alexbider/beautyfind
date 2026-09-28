// The import reset: removes the listings the import created and every trace of earlier runs, keeps
// claimed listings, listings with customer activity and listings that existed before the import
// (merged records), and refuses while a worker holds a run.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';

const URL_OK = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
const skip = URL_OK ? false : 'needs a local DATABASE_URL';

describe('import reset', { skip }, () => {
  let db: PrismaClient;
  let ops: typeof import('../../src/lib/server/importOps');
  const made: { businesses: string[]; users: string[] } = { businesses: [], users: [] };
  const tag = `reset-${Date.now()}`;

  before(async () => {
    process.env.STORAGE_ADAPTER = 'local';
    process.env.UPLOAD_DIR = `/tmp/bf-reset-test-${Date.now()}`;
    ({ db } = await import('../../src/lib/server/db'));
    ops = await import('../../src/lib/server/importOps');
  });
  after(async () => {
    await db.consultRequest.deleteMany({ where: { branch: { businessId: { in: made.businesses } } } }); // no cascade, by design
    await db.business.deleteMany({ where: { id: { in: made.businesses } } });
    await db.user.deleteMany({ where: { id: { in: made.users } } });
    await db.$disconnect();
  });

  async function listing(name: string, opts: { claimed?: boolean; owner?: boolean; consult?: boolean } = {}) {
    let ownerUserId: string | null = null;
    if (opts.owner) {
      const u = await db.user.create({ data: { email: `${tag}-${made.users.length}@example.test` } });
      made.users.push(u.id);
      ownerUserId = u.id;
    }
    const biz = await db.business.create({ data: { status: 'live', type: 'salon', ownerUserId } });
    made.businesses.push(biz.id);
    const b = await db.branch.create({ data: { businessId: biz.id, name, slug: `${tag}-${made.businesses.length}`, regionSlug: 'north', cityName: 'חיפה', address: 'רחוב 1', lat: 32.8, lng: 34.99, status: 'live', isClaimed: !!opts.claimed } });
    if (opts.consult) await db.consultRequest.create({ data: { branchId: b.id, ref: `R-${tag.slice(-6)}`, clientName: 'לקוח', clientPhone: '+972501234567', areas: ['face'], goal: 'x', priorInjections: 'never', format: 'clinic', preferredTimes: ['morning'], status: 'new' } });
    return { biz, b };
  }

  it('deletes what the import created and keeps everything people touched', async () => {
    // The state before: no live worker. Existing rows from other tests are cleaned like real data would be.
    const run = await db.importRun.create({ data: { label: tag, provider: 'dataforseo', scope: {}, maxRequests: 0, status: 'done' } });
    const created = await listing('נוצר בייבוא');
    const claimed = await listing('נתבע', { claimed: true });
    const owned = await listing('יש בעלים', { owner: true });
    const merged = await listing('היה קיים');
    const busy = await listing('עם פנייה', { consult: true }).catch(() => null);
    const mk = (name: string, status: 'approved' | 'merged', branchId: string) =>
      db.importPlace.create({ data: { runId: run.id, placeId: `${tag}:${name}`, provider: 'dataforseo', name, address: 'רחוב 1', lat: 32.8, lng: 34.99, status, branchId, categories: ['nails'] } });
    await mk('a', 'approved', created.b.id);
    await mk('b', 'approved', claimed.b.id);
    await mk('c', 'approved', owned.b.id);
    await mk('d', 'merged', merged.b.id);
    if (busy) await mk('e', 'approved', busy.b.id);
    await db.mediaFile.create({ data: { ownerId: created.biz.id, businessId: created.biz.id, key: `public/${tag}.webp`, mime: 'image/webp', bytes: 10 } });
    await db.siteFetch.create({ data: { domain: `${tag}.test`, status: 'ok', fetchedAt: new Date(), nextCheckAt: new Date() } });
    await db.providerBudget.createMany({ data: [{ key: `apify:run:${run.id}`, limitMicros: 1n }, { key: `apify:month:${tag}`, limitMicros: 1n }], skipDuplicates: true });

    const pv = await ops.resetPreview();
    assert.ok(pv.listings >= 1);
    assert.ok(pv.claimedKept >= 2);
    if (busy) assert.ok(pv.activeKept >= 1);
    assert.equal(pv.running, false);

    const actor = (await db.user.findFirst({ select: { id: true } })) ?? (await db.user.create({ data: {}, select: { id: true } }));
    const r = await ops.resetImport(actor);
    assert.equal(r.ok, true);
    assert.equal(await db.branch.findUnique({ where: { id: created.b.id } }), null);
    assert.equal(await db.business.findUnique({ where: { id: created.biz.id } }), null);
    assert.ok(await db.branch.findUnique({ where: { id: claimed.b.id } }));
    assert.ok(await db.branch.findUnique({ where: { id: owned.b.id } }));
    assert.ok(await db.branch.findUnique({ where: { id: merged.b.id } }));
    if (busy) assert.ok(await db.branch.findUnique({ where: { id: busy.b.id } }));
    assert.equal(await db.importPlace.count(), 0);
    assert.equal(await db.importRun.count(), 0);
    assert.equal(await db.spendEntry.count(), 0);
    assert.equal(await db.siteFetch.count(), 0);
    assert.equal(await db.mediaFile.count({ where: { key: `public/${tag}.webp` } }), 0);
    assert.equal(await db.providerBudget.count({ where: { key: `apify:run:${run.id}` } }), 0);
    assert.equal(await db.providerBudget.count({ where: { key: `apify:month:${tag}` } }), 1); // monthly caps stay
    await db.providerBudget.deleteMany({ where: { key: `apify:month:${tag}` } });
    const log = await db.auditLog.findFirst({ where: { action: 'import_reset', actorId: actor.id }, orderBy: { createdAt: 'desc' } });
    assert.ok(log);
    const after2 = await ops.resetPreview();
    assert.equal(after2.listings + after2.places + after2.runs, 0);
  });

  it('refuses while a worker holds a run', async () => {
    const run = await db.importRun.create({ data: { label: `${tag} live`, provider: 'dataforseo', scope: {}, maxRequests: 0, status: 'running', lockedBy: 'test', lockedUntil: new Date(Date.now() + 600_000) } });
    const actor = (await db.user.findFirst({ select: { id: true } }))!;
    const r = await ops.resetImport(actor);
    assert.deepEqual(r, { ok: false, error: 'running' });
    assert.equal((await ops.resetPreview()).running, true);
    await db.importRun.delete({ where: { id: run.id } });
  });
});
