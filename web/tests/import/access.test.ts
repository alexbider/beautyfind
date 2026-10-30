// Who may write in the business backend (src/lib/server/access.ts): only a paid subscription (active, or past_due
// while Stripe retries); the CRM, the clinic system and payments only on the advanced plan. Billing stays open.
// Part 1 is pure, part 2 runs against a local database (unpaid and active owners on each plan, and the
// "Sharon B" case: basic, incomplete, no Stripe customer), part 3 checks every owner action calls a guard.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';

const URL_OK = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
const skip = URL_OK ? false : 'needs a local DATABASE_URL';
const LISTING_AREAS = ['overview', 'profile', 'menu', 'reviews'] as const;

describe('access rules', () => {
  it('only active and past_due can write; incomplete, hidden, cancelled and no subscription cannot', async () => {
    const a = await import('../../src/lib/server/access');
    for (const status of ['active', 'past_due'] as const) assert.equal(a.canWrite({ plan: 'basic', status }), true, status);
    for (const status of ['incomplete', 'hidden', 'cancelled'] as const) assert.equal(a.canWrite({ plan: 'advanced', status }), false, status);
    assert.equal(a.canWrite(null), false);
    assert.equal(a.canWrite(undefined), false);
  });

  it('the advanced plan counts only when paid', async () => {
    const a = await import('../../src/lib/server/access');
    assert.equal(a.hasAdvanced({ plan: 'advanced', status: 'active' }), true);
    assert.equal(a.hasAdvanced({ plan: 'advanced', status: 'past_due' }), true);
    assert.equal(a.hasAdvanced({ plan: 'advanced', status: 'incomplete' }), false, 'unpaid advanced is not advanced');
    assert.equal(a.hasAdvanced({ plan: 'advanced', status: 'hidden' }), false);
    assert.equal(a.hasAdvanced({ plan: 'basic', status: 'active' }), false);
  });

  it('dashboard areas: listing areas need a paid plan, the CRM needs advanced, billing is always open', async () => {
    const a = await import('../../src/lib/server/access');
    const unpaid = { plan: 'basic' as const, status: 'incomplete' as const };
    const basic = { plan: 'basic' as const, status: 'active' as const };
    const advanced = { plan: 'advanced' as const, status: 'active' as const };
    for (const area of LISTING_AREAS) {
      assert.match(a.areaWriteBlock(area, unpaid) ?? '', /המנוי עדיין לא פעיל/, area);
      assert.equal(a.areaWriteBlock(area, basic), null, area);
      assert.equal(a.areaWriteBlock(area, advanced), null, area);
    }
    assert.match(a.areaWriteBlock('leads', unpaid) ?? '', /המנוי עדיין לא פעיל/);
    assert.match(a.areaWriteBlock('leads', basic) ?? '', /במסלול המתקדם/);
    assert.equal(a.areaWriteBlock('leads', advanced), null);
    for (const sub of [null, unpaid, { plan: 'advanced' as const, status: 'cancelled' as const }]) assert.equal(a.areaWriteBlock('billing', sub), null);
  });
});

describe('access against the database', { skip }, () => {
  let db: PrismaClient;
  const tag = `acc${Date.now()}`;
  const made = { users: [] as string[], businesses: [] as string[] };
  const biz: Record<string, string> = {};
  const owner: Record<string, string> = {};

  async function make(key: string, plan: 'basic' | 'advanced' | null, status: 'incomplete' | 'active' | 'past_due' | 'hidden' | 'cancelled' | null) {
    const u = await db.user.create({ data: { email: `${tag}-${key}@example.test`, fullName: key, kind: 'business' } });
    made.users.push(u.id);
    const b = await db.business.create({ data: { status: 'pending', type: 'cosmetics', ownerUserId: u.id } });
    made.businesses.push(b.id);
    await db.staffMember.create({ data: { businessId: b.id, userId: u.id, displayName: key, profession: 'management', isOwner: true, preset: 'owner' } });
    if (plan && status) await db.subscription.create({ data: { businessId: b.id, plan, cycle: 'monthly', pricePerBranchAgorot: plan === 'basic' ? 14900 : 24900, status } });
    biz[key] = b.id;
    owner[key] = u.id;
  }

  before(async () => {
    const { PrismaClient } = await import('@prisma/client');
    db = new PrismaClient();
    await make('sharon', 'basic', 'incomplete'); // the "Sharon B" record: basic, incomplete, no Stripe customer
    await make('unpaidAdvanced', 'advanced', 'incomplete');
    await make('activeBasic', 'basic', 'active');
    await make('activeAdvanced', 'advanced', 'active');
    await make('pastDue', 'advanced', 'past_due');
    await make('hidden', 'advanced', 'hidden');
    await make('noSub', null, null);
  });

  after(async () => {
    await db.staffMember.deleteMany({ where: { businessId: { in: made.businesses } } });
    await db.subscription.deleteMany({ where: { businessId: { in: made.businesses } } });
    await db.business.deleteMany({ where: { id: { in: made.businesses } } });
    await db.user.deleteMany({ where: { id: { in: made.users } } });
    await db.$disconnect();
  });

  it('Sharon B (basic, incomplete, no Stripe customer) is refused every write, listing and advanced alike', async () => {
    const a = await import('../../src/lib/server/access');
    await assert.rejects(a.assertWritable(biz.sharon), (e: unknown) => e instanceof a.WriteBlockedError && /המנוי עדיין לא פעיל/.test(e.reason));
    await assert.rejects(a.assertWritable(biz.sharon, 'advanced'), a.WriteBlockedError);
    const sub = await a.subscriptionOf(biz.sharon);
    for (const area of [...LISTING_AREAS, 'leads'] as const) assert.ok(a.areaWriteBlock(area, sub), area);
    assert.equal(a.areaWriteBlock('billing', sub), null, 'Sharon can still pay');
    // isAdvanced (clinic.ts) is hasAdvanced on this row; clinic.ts itself loads the request context, so it is checked in part 3.
    const isAdvanced = async (id: string) => a.hasAdvanced(await a.subscriptionOf(id));
    assert.equal(await isAdvanced(biz.sharon), false);
    assert.match((await a.userWriteBlock(owner.sharon)) ?? '', /המנוי עדיין לא פעיל/, 'and cannot order marketing services');
  });

  it('an unpaid advanced plan opens nothing: no listing edits, no CRM, no clinic system', async () => {
    const a = await import('../../src/lib/server/access');
    // isAdvanced (clinic.ts) is hasAdvanced on this row; clinic.ts itself loads the request context, so it is checked in part 3.
    const isAdvanced = async (id: string) => a.hasAdvanced(await a.subscriptionOf(id));
    await assert.rejects(a.assertWritable(biz.unpaidAdvanced), a.WriteBlockedError);
    assert.equal(await isAdvanced(biz.unpaidAdvanced), false, 'clinic actions (requireClinic) and payments refuse');
  });

  it('an active basic owner edits the listing but not the CRM or the clinic system', async () => {
    const a = await import('../../src/lib/server/access');
    // isAdvanced (clinic.ts) is hasAdvanced on this row; clinic.ts itself loads the request context, so it is checked in part 3.
    const isAdvanced = async (id: string) => a.hasAdvanced(await a.subscriptionOf(id));
    await a.assertWritable(biz.activeBasic);
    await assert.rejects(a.assertWritable(biz.activeBasic, 'advanced'), (e: unknown) => e instanceof a.WriteBlockedError && /במסלול המתקדם/.test(e.reason));
    const sub = await a.subscriptionOf(biz.activeBasic);
    for (const area of LISTING_AREAS) assert.equal(a.areaWriteBlock(area, sub), null, area);
    assert.ok(a.areaWriteBlock('leads', sub));
    assert.equal(await isAdvanced(biz.activeBasic), false);
    assert.equal(await a.userWriteBlock(owner.activeBasic), null);
  });

  it('an active advanced owner has full access', async () => {
    const a = await import('../../src/lib/server/access');
    // isAdvanced (clinic.ts) is hasAdvanced on this row; clinic.ts itself loads the request context, so it is checked in part 3.
    const isAdvanced = async (id: string) => a.hasAdvanced(await a.subscriptionOf(id));
    await a.assertWritable(biz.activeAdvanced, 'advanced');
    const sub = await a.subscriptionOf(biz.activeAdvanced);
    for (const area of [...LISTING_AREAS, 'leads', 'billing'] as const) assert.equal(a.areaWriteBlock(area, sub), null, area);
    assert.equal(await isAdvanced(biz.activeAdvanced), true);
  });

  it('past_due keeps working while Stripe retries; hidden for debt, or no subscription at all, is blocked', async () => {
    const a = await import('../../src/lib/server/access');
    // isAdvanced (clinic.ts) is hasAdvanced on this row; clinic.ts itself loads the request context, so it is checked in part 3.
    const isAdvanced = async (id: string) => a.hasAdvanced(await a.subscriptionOf(id));
    await a.assertWritable(biz.pastDue, 'advanced');
    assert.equal(await isAdvanced(biz.pastDue), true);
    await assert.rejects(a.assertWritable(biz.hidden), a.WriteBlockedError);
    assert.equal(await isAdvanced(biz.hidden), false);
    await assert.rejects(a.assertWritable(biz.noSub), a.WriteBlockedError);
  });

  for (const plan of ['basic', 'advanced'] as const) {
    it(`an approved claim on the ${plan} plan gets that plan, unpaid, and the new owner is blocked until the first payment`, async () => {
      const a = await import('../../src/lib/server/access');
      const { decide } = await import('../../src/lib/server/verification');
      const ops = await db.user.create({ data: { email: `${tag}-ops-${plan}@example.test`, fullName: 'צוות', opsRole: 'ops' } });
      const claimant = await db.user.create({ data: { email: `${tag}-claim-${plan}@example.test`, fullName: 'טוענת', kind: 'business' } });
      made.users.push(ops.id, claimant.id);
      const b = await db.business.create({ data: { status: 'live', type: 'cosmetics' } });
      made.businesses.push(b.id);
      const branch = await db.branch.create({ data: { businessId: b.id, name: 'סלון לבעלות', slug: `${tag}-claim-${plan}`, regionSlug: 'haifa', cityName: 'חיפה', address: 'רחוב 1, חיפה', lat: 32.8, lng: 34.99, status: 'live' } });
      const req = await db.verificationRequest.create({
        data: { ref: `CLM-${tag.slice(-6)}${plan[0]}`, kind: 'claim', businessId: b.id, branchId: branch.id, submittedById: claimant.id, checks: [], slaDueAt: new Date(Date.now() + 86_400_000),
          submitted: { branch: { id: branch.id }, details: { name: 'סלון לבעלות' }, plan } },
      });
      const r = await decide({ requestId: req.id, actor: { id: ops.id, opsRole: 'ops' }, action: 'approve' });
      assert.equal(r.ok, true);
      const sub = await db.subscription.findUnique({ where: { businessId: b.id } });
      assert.equal(sub?.plan, plan);
      assert.equal(sub?.status, 'incomplete');
      assert.equal(sub?.pricePerBranchAgorot, plan === 'basic' ? 14900 : 24900);
      await assert.rejects(a.assertWritable(b.id), a.WriteBlockedError);
      // The webhook marks it paid: the chosen level opens.
      await db.subscription.update({ where: { businessId: b.id }, data: { status: 'active' } });
      await a.assertWritable(b.id);
      if (plan === 'advanced') await a.assertWritable(b.id, 'advanced');
      else await assert.rejects(a.assertWritable(b.id, 'advanced'), a.WriteBlockedError);
      await db.verificationRequest.deleteMany({ where: { id: req.id } });
      await db.decision.deleteMany({ where: { subjectId: req.id } });
      await db.auditLog.deleteMany({ where: { actorId: ops.id } });
      await db.staffMember.deleteMany({ where: { businessId: b.id } });
      await db.branch.deleteMany({ where: { businessId: b.id } });
    });
  }

  it('a visitor with no business is not affected by the marketing gate', async () => {
    const a = await import('../../src/lib/server/access');
    const u = await db.user.create({ data: { email: `${tag}-visitor@example.test`, fullName: 'מבקר' } });
    made.users.push(u.id);
    assert.equal(await a.userWriteBlock(u.id), null);
  });
});

// Every server action an owner can reach must go through a guard that checks the subscription. A new action
// that skips it fails here.
describe('every owner write action calls a guard', () => {
  const root = join(__dirname, '../../src');
  // file → the calls that count as its guard (each one ends in requireArea edit, requireOwner, requireClinic,
  // isAdvanced or writeBlockReason; see the guards themselves).
  const FILES: Record<string, string[]> = {
    'app/biz/profile/actions.ts': ["requireArea('profile', 'edit')"],
    'app/biz/profile/upload/route.ts': ["requireArea('profile', 'edit')"],
    'app/biz/menu/actions.ts': ["requireArea('menu', 'edit')"],
    'app/biz/reviews/actions.ts': ['ownReview('],
    'app/biz/leads/actions.ts': ['editCtx('],
    'app/biz/team/actions.ts': ['ownerCtx('],
    'app/biz/sponsored/actions.ts': ['editor('],
    'app/biz/payments/actions.ts': ['guard('],
    'app/biz/billing/actions.ts': ['guard('],
    'app/clinic/booking/[id]/actions.ts': ['actor('],
    'app/clinic/consults/actions.ts': ['run(', 'actor('],
    'app/clinic/gift-cards/actions.ts': ['guard('],
    'app/clinic/waitlist/actions.ts': ['manage('],
  };
  const GUARD_BODIES: Record<string, RegExp> = {
    'app/biz/reviews/actions.ts': /requireArea\('reviews', 'edit'\)/,
    'app/biz/leads/actions.ts': /requireArea\('leads', 'edit'\)/,
    'app/biz/team/actions.ts': /requireOwner\(\)/,
    'app/biz/sponsored/actions.ts': /writeBlockReason\(ctx\.business\.subscription\)/,
    'app/biz/payments/actions.ts': /isAdvanced\(ctx\.business\.id\)/,
    'app/clinic/consults/actions.ts': /requireClinic\('consults', 'manage'\)/,
    'app/clinic/gift-cards/actions.ts': /requireClinic\('giftcards', need\)/,
    'app/clinic/waitlist/actions.ts': /requireClinic\('waitlist', 'manage'\)/,
  };

  for (const [file, guards] of Object.entries(FILES)) {
    it(file, () => {
      const src = readFileSync(join(root, file), 'utf8');
      if (GUARD_BODIES[file]) assert.match(src, GUARD_BODIES[file], `${file}: its guard checks access`);
      const fns = src.split(/\nexport async function /).slice(1);
      assert.ok(fns.length, `${file} has exported actions`);
      for (const fn of fns) {
        const name = fn.slice(0, fn.indexOf('('));
        const body = fn.split(/\n(?:export |async function |function |const [A-Z])/)[0];
        assert.ok(guards.some(g => body.includes(g)), `${file}: ${name} calls no guard`);
      }
    });
  }

  it('the clinic booking actions refuse without a paid advanced plan', () => {
    const src = readFileSync(join(root, 'app/clinic/booking/transitions.ts'), 'utf8');
    assert.match(src, /!a\.advanced/);
    const clinic = readFileSync(join(root, 'lib/server/clinic.ts'), 'utf8');
    assert.match(clinic, /return hasAdvanced\(/, 'isAdvanced requires a paid subscription');
  });

  it('marketing orders refuse unpaid owners', () => {
    const src = readFileSync(join(root, 'app/for-business/marketing/actions.ts'), 'utf8');
    assert.equal(src.match(/userWriteBlock\(user\.id\)/g)?.length, 2, 'requestQuote and beginCheckout');
  });
});
