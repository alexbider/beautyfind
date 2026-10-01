// Master admin tests: role permissions (pure), platform settings parsing (pure), sponsored content
// checks (pure), and with a local database the AI approvals executor and staff invite links.
// Run with `npm run test:import`; the database suites skip without a local DATABASE_URL.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { AREAS, DEFAULT_PERMISSIONS, firstArea, levelOf, permissionMatrix } from '../../src/components/ops/roles';
import { contentChecks, discountPctFor, nextWeekStart, SPONSORED_LINE_MAX } from '../../src/lib/sponsoredChecks';

const URL_OK = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
const skip = URL_OK ? false : 'needs a local DATABASE_URL';

describe('role permissions', () => {
  it('uses the handoff defaults and keeps ops full everywhere', () => {
    assert.equal(levelOf('ops', 'settings'), 'full');
    assert.equal(levelOf('verifier', 'verification'), 'edit');
    assert.equal(levelOf('verifier', 'accounting'), 'none');
    assert.equal(levelOf('support', 'clients'), 'view');
    assert.equal(levelOf('legal', 'disputes'), 'edit');
    assert.equal(levelOf('nobody', 'overview'), 'none');
    for (const a of AREAS) assert.equal(DEFAULT_PERMISSIONS.ops[a], 'full');
  });
  it('applies overrides except on ops, and ignores garbage levels', () => {
    const o = { verifier: { accounting: 'view' as const, businesses: 'edit' as const }, ops: { settings: 'none' as const } };
    assert.equal(levelOf('verifier', 'accounting', o), 'view');
    assert.equal(levelOf('verifier', 'businesses', o), 'edit');
    assert.equal(levelOf('ops', 'settings', o), 'full');
    assert.equal(levelOf('verifier', 'accounting', { verifier: { accounting: 'admin' as never } }), 'none');
  });
  it('builds the full matrix and finds a landing area', () => {
    const m = permissionMatrix({ support: { overview: 'none' } });
    assert.equal(Object.keys(m).length, 5);
    assert.equal(Object.keys(m.support).length, AREAS.length);
    assert.equal(m.support.overview, 'none');
    assert.equal(firstArea('support', { support: { overview: 'none' } }), 'businesses');
    assert.equal(firstArea('ops'), 'overview');
    assert.equal(firstArea('support', Object.fromEntries([['support', Object.fromEntries(AREAS.map(a => [a, 'none']))]])), null);
  });
});

describe('platform settings schema', () => {
  it('parses defaults from the code constants and rejects bad values', async () => {
    const { PlatformSettingsSchema, DEFAULT_PLATFORM_SETTINGS } = await import('../../src/lib/server/platformSettings');
    assert.equal(DEFAULT_PLATFORM_SETTINGS.basicMonthlyNis, 149);
    assert.equal(DEFAULT_PLATFORM_SETTINGS.advancedMonthlyNis, 249);
    assert.equal(DEFAULT_PLATFORM_SETTINGS.vatRatePct, 18);
    assert.equal(DEFAULT_PLATFORM_SETTINGS.maintenanceMode, false);
    assert.deepEqual(DEFAULT_PLATFORM_SETTINGS.rolePermissions, {});
    const ok = PlatformSettingsSchema.safeParse({ basicMonthlyNis: 199, rolePermissions: { support: { bookings: 'edit' } } });
    assert.ok(ok.success);
    assert.equal(ok.data.basicMonthlyNis, 199);
    assert.equal(ok.data.advancedMonthlyNis, 249);
    assert.ok(!PlatformSettingsSchema.safeParse({ giftCardMinYears: 2 }).success, 'gift cards must be valid five years by law');
    assert.ok(!PlatformSettingsSchema.safeParse({ rolePermissions: { support: { bookings: 'owner' } } }).success);
  });
});

describe('sponsored content checks', () => {
  it('flags forbidden promises and long lines, accepts a plain line', () => {
    assert.ok(contentChecks('טיפול ללא כאב, תוצאה מובטחת').some(c => c.result === 'bad'));
    assert.ok(contentChecks('א'.repeat(SPONSORED_LINE_MAX + 1)).some(c => c.result === 'bad'));
    assert.ok(contentChecks('').some(c => c.result === 'bad'));
    const plain = contentChecks('מניקור ג׳ל בלב רמת גן');
    assert.ok(plain.every(c => c.result === 'ok'));
  });
  it('discount and week start follow the data model', () => {
    assert.equal(discountPctFor(3), 0);
    assert.equal(discountPctFor(4), 10);
    const ws = nextWeekStart(new Date('2026-09-30T10:00:00Z'));
    assert.ok(ws.getTime() > new Date('2026-09-30T10:00:00Z').getTime());
  });
});

describe('AI approvals executor', { skip }, () => {
  let db: PrismaClient;
  let ai: typeof import('../../src/lib/server/aiActions');
  const made: { biz: string[]; users: string[] } = { biz: [], users: [] };
  let actor: { id: string; opsRole: string | null };

  before(async () => {
    const { PrismaClient } = await import('@prisma/client');
    db = new PrismaClient();
    ai = await import('../../src/lib/server/aiActions');
    const u = await db.user.create({ data: { email: `ops-test-${Date.now()}@example.test`, fullName: 'בדיקה', opsRole: 'ops' } });
    made.users.push(u.id);
    actor = { id: u.id, opsRole: 'ops' };
  });
  after(async () => {
    await db.aiAction.deleteMany({ where: { subjectId: { in: made.biz } } });
    await db.decision.deleteMany({ where: { subjectId: { in: made.biz } } });
    await db.auditLog.deleteMany({ where: { OR: [{ businessId: { in: made.biz } }, { actorId: { in: made.users } }] } });
    await db.business.deleteMany({ where: { id: { in: made.biz } } });
    await db.user.deleteMany({ where: { id: { in: made.users } } });
    await db.$disconnect();
  });

  async function business() {
    const biz = await db.business.create({ data: { status: 'live', type: 'salon' } });
    made.biz.push(biz.id);
    await db.branch.create({ data: { businessId: biz.id, name: 'סלון בדיקה', slug: `ai-test-${biz.id.slice(0, 8)}`, regionSlug: 'dan', cityName: 'רמת גן', address: 'רחוב 1', lat: 32.08, lng: 34.81, status: 'live', isClaimed: false } });
    return biz;
  }

  it('files a proposal with a ref and the business label, and refuses unknown actions', async () => {
    const biz = await business();
    const r = await ai.proposeAiAction({ source: 'assistant', action: 'hide_business', businessId: biz.id, reason: 'כתובת לא קיימת לפי שתי ביקורות' });
    assert.ok(r.ok);
    assert.match(r.ref, /^Q-\d{3,}$/);
    const row = await db.aiAction.findUniqueOrThrow({ where: { id: r.id } });
    assert.equal(row.status, 'proposed');
    assert.equal(row.subjectLabel, 'סלון בדיקה');
    const bad = await ai.proposeAiAction({ source: 'assistant', action: 'charge_card', businessId: biz.id, reason: 'x' });
    assert.ok(!bad.ok);
    const missing = await ai.proposeAiAction({ source: 'assistant', action: 'hide_business', businessId: '00000000-0000-0000-0000-000000000000', reason: 'x' });
    assert.ok(!missing.ok);
  });

  it('approving hides the business with a decision and audit rows, and cannot run twice', async () => {
    const biz = await business();
    const r = await ai.proposeAiAction({ source: 'assistant', action: 'hide_business', businessId: biz.id, reason: 'בדיקה' });
    assert.ok(r.ok);
    const d = await ai.decideAiAction(actor, r.id, 'approve', 'מאושר');
    assert.ok(d.ok, JSON.stringify(d));
    assert.equal((await db.business.findUniqueOrThrow({ where: { id: biz.id } })).status, 'hidden');
    const row = await db.aiAction.findUniqueOrThrow({ where: { id: r.id } });
    assert.equal(row.status, 'executed');
    assert.equal(row.decidedById, actor.id);
    assert.equal(await db.decision.count({ where: { subjectId: biz.id, action: 'status_hidden' } }), 1);
    const audits = await db.auditLog.findMany({ where: { subjectId: r.id } });
    assert.deepEqual(audits.map(a => a.action).sort(), ['ai_action_decide', 'ai_action_execute']);
    const again = await ai.decideAiAction(actor, r.id, 'approve');
    assert.ok(!again.ok && again.error === 'already_decided');
    // Restore brings it back live.
    const r2 = await ai.proposeAiAction({ source: 'assistant', action: 'restore_business', businessId: biz.id, reason: 'תוקן' });
    assert.ok(r2.ok);
    assert.ok((await ai.decideAiAction(actor, r2.id, 'approve')).ok);
    assert.equal((await db.business.findUniqueOrThrow({ where: { id: biz.id } })).status, 'live');
  });

  it('rejecting changes nothing and keeps the note', async () => {
    const biz = await business();
    const r = await ai.proposeAiAction({ source: 'mcp:claude', action: 'hide_business', businessId: biz.id, reason: 'בדיקה' });
    assert.ok(r.ok);
    const d = await ai.decideAiAction(actor, r.id, 'reject', 'לא מספיק ראיות');
    assert.ok(d.ok);
    assert.equal((await db.business.findUniqueOrThrow({ where: { id: biz.id } })).status, 'live');
    const row = await db.aiAction.findUniqueOrThrow({ where: { id: r.id } });
    assert.equal(row.status, 'rejected');
    assert.equal(row.result, 'לא מספיק ראיות');
    assert.equal(await db.decision.count({ where: { subjectId: biz.id } }), 0);
  });
});

describe('staff invite links', { skip }, () => {
  let db: PrismaClient;
  let setup: typeof import('../../src/app/ops/setup/state');
  let crypto: typeof import('../../src/lib/server/crypto');
  const users: string[] = [];
  const envBackup = { email: process.env.OPS_BOOTSTRAP_EMAIL, hash: process.env.OPS_SETUP_TOKEN_HASH };

  before(async () => {
    const { PrismaClient } = await import('@prisma/client');
    db = new PrismaClient();
    setup = await import('../../src/app/ops/setup/state');
    crypto = await import('../../src/lib/server/crypto');
    delete process.env.OPS_BOOTSTRAP_EMAIL;
    delete process.env.OPS_SETUP_TOKEN_HASH;
  });
  after(async () => {
    process.env.OPS_BOOTSTRAP_EMAIL = envBackup.email;
    process.env.OPS_SETUP_TOKEN_HASH = envBackup.hash;
    await db.auditLog.deleteMany({ where: { subjectType: 'user', subjectId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  });

  async function invite(expiresInMs: number) {
    const email = `invite-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;
    const u = await db.user.create({ data: { email, fullName: 'מוזמנת', opsRole: 'support' } });
    users.push(u.id);
    const token = crypto.randomToken(24);
    await db.auditLog.create({ data: { action: 'staff_invite', subjectType: 'user', subjectId: u.id, meta: { email, role: 'support', tokenHash: crypto.sha256(token), expiresAt: new Date(Date.now() + expiresInMs).toISOString() } } });
    return { u, email, token };
  }

  it('a fresh invite resolves to its account, once', async () => {
    const { u, email, token } = await invite(86_400_000);
    const s = await setup.setupState(token);
    assert.ok(s.ok);
    assert.equal(s.email, email);
    assert.equal(s.reset, false);
    assert.ok(!(await setup.setupState('not-a-token')).ok);
    await db.auditLog.create({ data: { actorId: u.id, action: 'staff_password_setup', subjectType: 'user', subjectId: u.id, meta: { tokenHash: s.tokenHash, reset: false } } });
    assert.ok(!(await setup.setupState(token)).ok, 'a spent token is refused');
  });

  it('an expired invite or a removed role is refused', async () => {
    const a = await invite(-1000);
    assert.ok(!(await setup.setupState(a.token)).ok);
    const b = await invite(86_400_000);
    await db.user.update({ where: { id: b.u.id }, data: { opsRole: null } });
    assert.ok(!(await setup.setupState(b.token)).ok);
  });
});
