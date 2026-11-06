// Deleting and restoring a business from the admin (src/lib/server/businessDelete.ts). Only the master admin
// (ops role) may do either; everyone else gets 403 and nothing changes. A deleted business leaves the public
// listings, search, its profile and the sitemap; an active subscription, a running sponsored placement or an
// open marketing order blocks the delete; every delete and restore writes an audit row with a reason.
// Part 1 is pure, part 2 runs against a local database, part 3 checks the wiring in the source.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';

const URL_OK = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
const skip = URL_OK ? false : 'needs a local DATABASE_URL';

describe('business delete rules', () => {
  it('only the ops role is the master admin', async () => {
    const d = await import('../../src/lib/server/businessDelete');
    assert.equal(d.isMasterAdmin({ id: 'x', opsRole: 'ops' }), true);
    for (const role of ['verifier', 'moderator', 'support', 'legal'] as const) assert.equal(d.isMasterAdmin({ id: 'x', opsRole: role }), false, role);
    assert.equal(d.isMasterAdmin({ id: 'x', opsRole: null }), false, 'a business owner has no ops role');
    assert.equal(d.isMasterAdmin(null), false);
  });

  it('blocks on a live subscription, a running or pending sponsored placement, and an open marketing order', async () => {
    const d = await import('../../src/lib/server/businessDelete');
    const none = { subscription: null, campaigns: [], marketingOrders: [] };
    assert.deepEqual(d.deleteBlockers(none), []);
    assert.equal(d.deleteBlockers({ ...none, subscription: { status: 'active' } }).length, 1);
    assert.equal(d.deleteBlockers({ ...none, subscription: { status: 'past_due' } }).length, 1);
    for (const status of ['incomplete', 'hidden', 'cancelled']) assert.deepEqual(d.deleteBlockers({ ...none, subscription: { status } }), [], status);
    assert.equal(d.deleteBlockers({ ...none, campaigns: [{ ref: 'AD-1', status: 'approved', endedAt: null }] }).length, 1);
    assert.equal(d.deleteBlockers({ ...none, campaigns: [{ ref: 'AD-2', status: 'pending_review', endedAt: null }] }).length, 1);
    assert.deepEqual(d.deleteBlockers({ ...none, campaigns: [{ ref: 'AD-3', status: 'approved', endedAt: new Date() }, { ref: 'AD-4', status: 'rejected', endedAt: null }] }), []);
    for (const status of ['quote_requested', 'paid', 'in_progress', 'active', 'past_due']) assert.equal(d.deleteBlockers({ ...none, marketingOrders: [{ ref: 'MK-1', status }] }).length, 1, status);
    for (const status of ['completed', 'cancelled']) assert.deepEqual(d.deleteBlockers({ ...none, marketingOrders: [{ ref: 'MK-2', status }] }), [], status);
  });
});

describe('business delete against the database', { skip }, () => {
  let db: PrismaClient;
  const tag = `del-${Date.now()}`;
  const made = { users: [] as string[], businesses: [] as string[] };
  const users: Record<string, { id: string; opsRole: 'ops' | 'verifier' | 'moderator' | 'support' | 'legal' | null }> = {};
  let bizId = '';
  let branchSlug = '';
  let branchName = '';
  let branchPath = '';

  before(async () => {
    const { PrismaClient } = await import('@prisma/client');
    db = new PrismaClient();
    for (const role of ['ops', 'verifier', 'moderator', 'support', 'legal'] as const) {
      const u = await db.user.create({ data: { email: `${tag}-${role}@example.test`, fullName: role, opsRole: role } });
      made.users.push(u.id);
      users[role] = { id: u.id, opsRole: role };
    }
    const owner = await db.user.create({ data: { email: `${tag}-owner@example.test`, fullName: 'בעלים', kind: 'business' } });
    made.users.push(owner.id);
    users.owner = { id: owner.id, opsRole: null };
    const city = await db.city.findFirst({ select: { id: true, slug: true, name: true, regionSlug: true } });
    assert.ok(city, 'the catalog seed (prisma/seed.ts) must have run');
    const cat = await db.category.findFirst({ select: { slug: true } });
    const b = await db.business.create({ data: { status: 'live', type: 'cosmetics', ownerUserId: owner.id } });
    made.businesses.push(b.id);
    bizId = b.id;
    branchSlug = `${tag}-studio`;
    branchName = `סטודיו מחיקה ${tag.slice(-5)}`;
    await db.branch.create({ data: { businessId: b.id, name: branchName, slug: branchSlug, regionSlug: city.regionSlug, cityId: city.id, cityName: city.name, address: `רחוב הבדיקה 1, ${city.name}`, status: 'live', categories: { create: [{ categorySlug: cat!.slug, isPrimary: true }] } } });
    const { profileHref } = await import('../../src/lib/category');
    branchPath = profileHref({ regionSlug: city.regionSlug, slug: branchSlug, categories: [{ categorySlug: cat!.slug, isPrimary: true }] });
  });

  after(async () => {
    await db.auditLog.deleteMany({ where: { businessId: { in: made.businesses } } });
    await db.decision.deleteMany({ where: { subjectId: { in: made.businesses } } });
    await db.marketingOrder.deleteMany({ where: { businessId: { in: made.businesses } } });
    await db.subscription.deleteMany({ where: { businessId: { in: made.businesses } } });
    await db.branchCategory.deleteMany({ where: { branch: { businessId: { in: made.businesses } } } });
    await db.branch.deleteMany({ where: { businessId: { in: made.businesses } } });
    await db.business.deleteMany({ where: { id: { in: made.businesses } } });
    await db.user.deleteMany({ where: { id: { in: made.users } } });
    await db.$disconnect();
  });

  const publicNow = async () => {
    const pub = await import('../../src/lib/server/public');
    const listed = (await pub.listBranches({ q: branchName, take: 50 })).items.some(i => i.slug === branchSlug);
    const profile = await db.branch.findFirst({ where: { AND: [pub.PUBLIC_WHERE, { slug: branchSlug }] }, select: { id: true } });
    const { sitemapEntries } = await import('../../src/lib/server/sitemapEntries');
    const inSitemap = (await sitemapEntries()).some(e => e.path === branchPath);
    return { listed, profile: !!profile, inSitemap };
  };

  it('is public before the delete (listing, search, profile, sitemap)', async () => {
    assert.deepEqual(await publicNow(), { listed: true, profile: true, inSitemap: true });
  });

  it('ops staff and business owners get 403 and nothing changes', async () => {
    const d = await import('../../src/lib/server/businessDelete');
    for (const key of ['verifier', 'moderator', 'support', 'legal', 'owner'] as const) {
      const r = await d.deleteBusiness(users[key], { id: bizId, reason: 'בדיקת הרשאות', confirmName: branchName });
      assert.equal(r.status, 403, key);
      const back = await d.restoreBusiness(users[key], { id: bizId, reason: 'בדיקת הרשאות' });
      assert.equal(back.status, 403, key);
    }
    const signedOut = await d.deleteBusiness(null, { id: bizId, reason: 'בדיקת הרשאות', confirmName: branchName });
    assert.equal(signedOut.status, 403);
    const b = await db.business.findUniqueOrThrow({ where: { id: bizId } });
    assert.equal(b.deletedAt, null);
    assert.equal(b.status, 'live');
    assert.equal(await db.auditLog.count({ where: { businessId: bizId, action: { in: ['business_delete', 'business_restore'] } } }), 0);
  });

  it('needs a reason of 5 characters and the exact name', async () => {
    const d = await import('../../src/lib/server/businessDelete');
    assert.equal((await d.deleteBusiness(users.ops, { id: bizId, reason: 'קצר', confirmName: branchName })).status, 400);
    assert.equal((await d.deleteBusiness(users.ops, { id: bizId, reason: 'סיבה ארוכה מספיק', confirmName: `${branchName} ` })).status, 400);
    assert.equal((await db.business.findUniqueOrThrow({ where: { id: bizId } })).deletedAt, null);
  });

  it('an active subscription blocks the delete, with the reason', async () => {
    const d = await import('../../src/lib/server/businessDelete');
    const sub = await db.subscription.create({ data: { businessId: bizId, plan: 'basic', cycle: 'monthly', pricePerBranchAgorot: 14900, status: 'active' } });
    const r = await d.deleteBusiness(users.ops, { id: bizId, reason: 'העסק נסגר', confirmName: branchName });
    assert.equal(r.status, 409);
    assert.ok(!r.ok && r.blockers?.some(x => /מנוי פעיל/.test(x)), JSON.stringify(r));
    await db.subscription.update({ where: { id: sub.id }, data: { status: 'cancelled' } });
  });

  it('an open marketing order blocks the delete, with the reason', async () => {
    const d = await import('../../src/lib/server/businessDelete');
    const o = await db.marketingOrder.create({ data: { ref: `MK-${tag.slice(-6)}`, kind: 'quote', status: 'quote_requested', serviceSlug: 'seo', contactName: 'בדיקה', contactEmail: `${tag}@example.test`, contactPhone: '+972500000000', businessName: branchName, businessId: bizId, accessToken: `${tag}-token` } });
    const r = await d.deleteBusiness(users.ops, { id: bizId, reason: 'העסק נסגר', confirmName: branchName });
    assert.equal(r.status, 409);
    assert.ok(!r.ok && r.blockers?.some(x => /שירותי שיווק/.test(x)), JSON.stringify(r));
    await db.marketingOrder.update({ where: { id: o.id }, data: { status: 'cancelled' } });
  });

  it('the master admin deletes: hidden everywhere public, billing rows kept, audit written', async () => {
    const d = await import('../../src/lib/server/businessDelete');
    const r = await d.deleteBusiness(users.ops, { id: bizId, reason: 'העסק נסגר לצמיתות', confirmName: branchName });
    assert.equal(r.status, 200, JSON.stringify(r));
    const b = await db.business.findUniqueOrThrow({ where: { id: bizId }, include: { subscription: true, branches: true } });
    assert.ok(b.deletedAt);
    assert.equal(b.status, 'hidden');
    assert.equal(b.deletedFromStatus, 'live');
    assert.equal(b.deletedById, users.ops.id);
    assert.ok(b.subscription, 'the subscription row is kept');
    assert.equal(b.branches.length, 1, 'branches are kept');
    assert.deepEqual(await publicNow(), { listed: false, profile: false, inSitemap: false });
    const log = await db.auditLog.findFirst({ where: { businessId: bizId, action: 'business_delete' } });
    assert.ok(log);
    assert.equal(log.actorId, users.ops.id);
    assert.equal(log.subjectId, bizId);
    assert.ok(log.createdAt instanceof Date);
    assert.equal((log.meta as { reason?: string }).reason, 'העסק נסגר לצמיתות');
    assert.equal((await d.deleteBusiness(users.ops, { id: bizId, reason: 'שוב פעם', confirmName: branchName })).status, 409, 'already deleted');
  });

  it('a deleted business stays off the site even if its status is set to live', async () => {
    await db.business.update({ where: { id: bizId }, data: { status: 'live' } });
    assert.deepEqual(await publicNow(), { listed: false, profile: false, inSitemap: false });
    await db.business.update({ where: { id: bizId }, data: { status: 'hidden' } });
  });

  it('the master admin restores to the previous status, with an audit row', async () => {
    const d = await import('../../src/lib/server/businessDelete');
    assert.equal((await d.restoreBusiness(users.ops, { id: bizId, reason: 'קצר' })).status, 400);
    const r = await d.restoreBusiness(users.ops, { id: bizId, reason: 'נמחק בטעות' });
    assert.equal(r.status, 200, JSON.stringify(r));
    const b = await db.business.findUniqueOrThrow({ where: { id: bizId } });
    assert.equal(b.deletedAt, null);
    assert.equal(b.status, 'live');
    assert.deepEqual(await publicNow(), { listed: true, profile: true, inSitemap: true });
    const log = await db.auditLog.findFirst({ where: { businessId: bizId, action: 'business_restore' } });
    assert.ok(log);
    assert.equal(log.actorId, users.ops.id);
    assert.equal((log.meta as { reason?: string }).reason, 'נמחק בטעות');
    assert.equal((await d.restoreBusiness(users.ops, { id: bizId, reason: 'שוב פעם' })).status, 409, 'not deleted');
  });
});

describe('business delete wiring', () => {
  const read = (p: string) => readFileSync(join(__dirname, '../../src', p), 'utf8');

  it('the server actions pass the signed-in user to the role-checked core', () => {
    const s = read('app/ops/businesses/actions.ts');
    assert.match(s, /deleteBusiness\(await currentUser\(\)/);
    assert.match(s, /restoreBusiness\(await currentUser\(\)/);
  });

  it('the delete and restore controls render only for the master admin', () => {
    const s = read('app/ops/businesses/[id]/page.tsx');
    assert.match(s, /const master = isMasterAdmin\(user\)/);
    assert.match(s, /\{master \? \(/);
  });

  it('every public branch query excludes deleted businesses', () => {
    assert.match(read('lib/server/public.ts'), /PUBLIC_WHERE[^\n]*deletedAt: null/);
    assert.match(read('lib/server/booking.ts'), /deletedAt: null/);
    assert.match(read('app/pro/[id]/data.ts'), /deletedAt: null/);
    assert.match(read('app/for-business/claim/data.ts'), /business: \{ deletedAt: null \}/);
    assert.match(read('lib/server/sitemapEntries.ts'), /PUBLIC_WHERE/);
  });
});
