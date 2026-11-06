// Permanent delete of a business from the admin (src/lib/server/businessDelete.ts). Only the master admin
// (ops role) may do it; everyone else gets 403 and nothing changes. The business and its data leave the
// database and the public site; payments stay; a live subscription, a running sponsored placement, an open
// marketing order, gift cards with value or upcoming bookings block it; an audit row keeps a snapshot.
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
    for (const status of ['active', 'partially_redeemed', 'scheduled', 'pending_payment']) assert.equal(d.deleteBlockers({ ...none, giftCards: [{ status }] }).length, 1, status);
    for (const status of ['redeemed', 'refunded', 'expired']) assert.deepEqual(d.deleteBlockers({ ...none, giftCards: [{ status }] }), [], status);
    assert.equal(d.deleteBlockers({ ...none, upcomingBookings: 2 }).length, 1);
  });
});

describe('business delete against the database', { skip }, () => {
  let db: PrismaClient;
  const tag = `del-${Date.now()}`;
  const made = { users: [] as string[], businesses: [] as string[], payments: [] as string[], runs: [] as string[] };
  const users: Record<string, { id: string; opsRole: 'ops' | 'verifier' | 'moderator' | 'support' | 'legal' | null }> = {};
  let bizId = '';
  let branchId = '';
  let branchSlug = '';
  let branchName = '';
  let branchPath = '';
  let pastBookingId = '';
  let paymentId = '';
  let placeId = '';

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
    const city = await db.city.findFirst({ select: { id: true, name: true, regionSlug: true } });
    assert.ok(city, 'the catalog seed (prisma/seed.ts) must have run');
    const cat = await db.category.findFirst({ select: { slug: true } });
    const b = await db.business.create({ data: { status: 'live', type: 'cosmetics', ownerUserId: owner.id } });
    made.businesses.push(b.id);
    bizId = b.id;
    branchSlug = `${tag}-studio`;
    branchName = `סטודיו מחיקה ${tag.slice(-5)}`;
    const br = await db.branch.create({ data: { businessId: b.id, name: branchName, slug: branchSlug, regionSlug: city.regionSlug, cityId: city.id, cityName: city.name, address: `רחוב הבדיקה 1, ${city.name}`, status: 'live', categories: { create: [{ categorySlug: cat!.slug, isPrimary: true }] } } });
    branchId = br.id;
    const { profileHref } = await import('../../src/lib/category');
    branchPath = profileHref({ regionSlug: city.regionSlug, slug: branchSlug, categories: [{ categorySlug: cat!.slug, isPrimary: true }] });
    // Data under the business: staff, a past booking with its payment, a consultation request, a lead, a file, an import record.
    await db.staffMember.create({ data: { businessId: b.id, userId: owner.id, displayName: 'בעלים', profession: 'management', isOwner: true, preset: 'owner' } });
    const past = await db.booking.create({ data: { ref: `BF-${tag.slice(-7)}`, branchId: br.id, clientName: 'לקוחה', clientPhone: '+972500000001', startsAt: new Date(Date.now() - 7 * 86_400_000), durationMin: 30, status: 'completed', policyShown: {} } });
    pastBookingId = past.id;
    const pay = await db.payment.create({ data: { payee: 'business', businessId: b.id, bookingId: past.id, payerName: 'לקוחה', purpose: 'deposit', netAgorot: 8475, vatAgorot: 1525, grossAgorot: 10000, provider: 'sandbox' } });
    paymentId = pay.id;
    made.payments.push(pay.id);
    await db.consultRequest.create({ data: { ref: `R-${tag.slice(-7)}`, branchId: br.id, clientName: 'פונה', clientPhone: '+972500000002', goal: 'בדיקה', priorInjections: 'never', format: 'clinic', status: 'new' } });
    await db.lead.create({ data: { businessId: b.id, branchId: br.id, name: 'ליד', source: 'form' } });
    await db.mediaFile.create({ data: { ownerId: owner.id, businessId: b.id, key: `public/${tag}.jpg`, mime: 'image/jpeg', bytes: 1 } });
    const run = await db.importRun.create({ data: { label: tag, scope: {}, maxRequests: 0 } });
    made.runs.push(run.id);
    placeId = `${tag}-place`;
    await db.importPlace.create({ data: { placeId, runId: run.id, name: branchName, address: 'כתובת', lat: 32, lng: 34.8, status: 'approved', branchId: br.id } });
  });

  after(async () => {
    await db.auditLog.deleteMany({ where: { businessId: { in: made.businesses } } });
    await db.decision.deleteMany({ where: { subjectId: { in: made.businesses } } });
    await db.marketingOrder.deleteMany({ where: { businessId: { in: made.businesses } } });
    await db.payment.deleteMany({ where: { id: { in: made.payments } } });
    if (placeId) await db.importPlace.deleteMany({ where: { placeId } });
    await db.importRun.deleteMany({ where: { id: { in: made.runs } } });
    // Only reached when a test failed before the delete.
    await db.giftCard.deleteMany({ where: { businessId: { in: made.businesses } } });
    await db.booking.deleteMany({ where: { branch: { businessId: { in: made.businesses } } } });
    await db.consultRequest.deleteMany({ where: { branch: { businessId: { in: made.businesses } } } });
    await db.lead.deleteMany({ where: { businessId: { in: made.businesses } } });
    await db.mediaFile.deleteMany({ where: { businessId: { in: made.businesses } } });
    await db.business.deleteMany({ where: { id: { in: made.businesses } } });
    await db.user.deleteMany({ where: { id: { in: made.users } } });
    await db.$disconnect();
  });

  const publicNow = async () => {
    const pub = await import('../../src/lib/server/public');
    const listed = (await pub.listBranches({ q: branchName, take: 50 })).items.some(i => i.slug === branchSlug);
    const profile = !!(await pub.getProfile(branchPath.split('/')[1], branchSlug));
    const { sitemapEntries } = await import('../../src/lib/server/sitemapEntries');
    const inSitemap = (await sitemapEntries()).some(e => e.path === branchPath);
    return { listed, profile, inSitemap };
  };

  it('is public before the delete (listing, search, profile, sitemap)', async () => {
    assert.deepEqual(await publicNow(), { listed: true, profile: true, inSitemap: true });
  });

  it('ops staff and business owners get 403 and nothing changes', async () => {
    const d = await import('../../src/lib/server/businessDelete');
    for (const key of ['verifier', 'moderator', 'support', 'legal', 'owner'] as const) {
      const r = await d.deleteBusiness(users[key], { id: bizId, reason: 'בדיקת הרשאות', confirmName: branchName });
      assert.equal(r.status, 403, key);
    }
    assert.equal((await d.deleteBusiness(null, { id: bizId, reason: 'בדיקת הרשאות', confirmName: branchName })).status, 403, 'signed out');
    assert.ok(await db.business.findUnique({ where: { id: bizId } }));
    assert.equal(await db.auditLog.count({ where: { businessId: bizId, action: 'business_delete' } }), 0);
  });

  it('needs a reason of 5 characters and the exact name', async () => {
    const d = await import('../../src/lib/server/businessDelete');
    assert.equal((await d.deleteBusiness(users.ops, { id: bizId, reason: 'קצר', confirmName: branchName })).status, 400);
    assert.equal((await d.deleteBusiness(users.ops, { id: bizId, reason: 'סיבה ארוכה מספיק', confirmName: `${branchName} ` })).status, 400);
    assert.ok(await db.business.findUnique({ where: { id: bizId } }));
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

  it('an upcoming booking and an unused gift card block the delete', async () => {
    const d = await import('../../src/lib/server/businessDelete');
    const next = await db.booking.create({ data: { ref: `BF-${tag.slice(-6)}n`, branchId, clientName: 'לקוחה', clientPhone: '+972500000003', startsAt: new Date(Date.now() + 3 * 86_400_000), durationMin: 30, status: 'confirmed', policyShown: {} } });
    const gift = await db.giftCard.create({ data: { code: `T-${tag.slice(-8)}`.toUpperCase(), businessId: bizId, kind: 'amount', valueAgorot: 10000, balanceAgorot: 10000, buyerName: 'קונה', buyerPhone: '+972500000004', recipientName: 'מקבלת', recipientChannel: 'self', sendAt: new Date(), expiresAt: new Date(Date.now() + 5 * 365 * 86_400_000), status: 'active' } });
    const r = await d.deleteBusiness(users.ops, { id: bizId, reason: 'העסק נסגר', confirmName: branchName });
    assert.equal(r.status, 409);
    assert.ok(!r.ok && r.blockers?.some(x => /תור עתידי/.test(x)) && r.blockers?.some(x => /שובר מתנה/.test(x)), JSON.stringify(r));
    await db.booking.update({ where: { id: next.id }, data: { status: 'cancelled_clinic' } });
    await db.giftCard.update({ where: { id: gift.id }, data: { status: 'redeemed', balanceAgorot: 0 } });
  });

  it('the master admin deletes: the business and its data are gone, payments stay, audit kept', async () => {
    const d = await import('../../src/lib/server/businessDelete');
    const r = await d.deleteBusiness(users.ops, { id: bizId, reason: 'העסק נסגר לצמיתות', confirmName: branchName });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(await db.business.findUnique({ where: { id: bizId } }), null);
    assert.equal(await db.branch.count({ where: { id: branchId } }), 0);
    assert.equal(await db.subscription.count({ where: { businessId: bizId } }), 0);
    assert.equal(await db.staffMember.count({ where: { businessId: bizId } }), 0);
    assert.equal(await db.booking.count({ where: { branchId } }), 0);
    assert.equal(await db.consultRequest.count({ where: { branchId } }), 0);
    assert.equal(await db.lead.count({ where: { businessId: bizId } }), 0);
    assert.equal(await db.mediaFile.count({ where: { businessId: bizId } }), 0);
    assert.equal(await db.giftCard.count({ where: { businessId: bizId } }), 0);
    assert.equal(await db.marketingOrder.count({ where: { businessId: bizId } }), 1, 'the closed marketing order is kept');
    const pay = await db.payment.findUnique({ where: { id: paymentId } });
    assert.ok(pay, 'the payment is kept');
    assert.equal(pay.grossAgorot, 10000);
    assert.equal(pay.bookingId, null, 'its link to the deleted booking is cleared');
    assert.ok(pastBookingId);
    const place = await db.importPlace.findUniqueOrThrow({ where: { placeId } });
    assert.equal(place.status, 'rejected', 'the import will not create it again');
    assert.equal(place.branchId, null);
    assert.deepEqual(await publicNow(), { listed: false, profile: false, inSitemap: false });
    const log = await db.auditLog.findFirst({ where: { businessId: bizId, action: 'business_delete' } });
    assert.ok(log);
    assert.equal(log.actorId, users.ops.id);
    assert.equal(log.subjectId, bizId);
    assert.ok(log.createdAt instanceof Date);
    const meta = log.meta as { reason?: string; name?: string; subscription?: { status: string } | null; branches?: unknown[] };
    assert.equal(meta.reason, 'העסק נסגר לצמיתות');
    assert.equal(meta.name, branchName);
    assert.equal(meta.subscription?.status, 'cancelled', 'the subscription is kept in the snapshot');
    assert.equal(meta.branches?.length, 1);
    assert.equal(await db.decision.count({ where: { subjectId: bizId, action: 'business_delete' } }), 1);
    assert.equal((await d.deleteBusiness(users.ops, { id: bizId, reason: 'שוב פעם', confirmName: branchName })).status, 404, 'already gone');
  });
});

describe('business delete wiring', () => {
  const read = (p: string) => readFileSync(join(__dirname, '../../src', p), 'utf8');

  it('the server action passes the signed-in user to the role-checked core', () => {
    assert.match(read('app/ops/businesses/actions.ts'), /deleteBusiness\(await currentUser\(\)/);
  });

  it('the delete control renders only for the master admin', () => {
    const s = read('app/ops/businesses/[id]/page.tsx');
    assert.match(s, /const master = isMasterAdmin\(user\)/);
    assert.match(s, /\{master \? \(/);
  });
});
