// Indexing policy (pure): which section a public path belongs to, which paths are private, and what the
// saved switches allow. The server reads the switches from platform settings (src/lib/server/indexing.ts).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { INDEX_SECTION_KEYS, OPEN_POLICY, PRIVATE_PREFIXES, isPrivatePath, pathIndexable, sectionOfPath } from '../../src/lib/indexing';

describe('indexing: private areas', () => {
  it('admin, dashboards, accounts, token pages and the API are private; public pages are not', () => {
    for (const p of ['/ops', '/ops/content?tab=indexing', '/ops/businesses/abc/branches/def', '/biz', '/biz/profile', '/clinic/booking/1', '/account', '/saved/compare', '/login', '/invite/tok', '/for-business/join', '/for-business/claim?branch=1', '/pay/sandbox/1', '/receipt/doc', '/unsubscribe/tok', '/b/tok', '/w/tok', '/review/tok', '/api/health']) {
      assert.equal(isPrivatePath(p.split('?')[0]), true, p);
      assert.equal(sectionOfPath(p), null, p);
    }
    for (const p of ['/', '/dan', '/dan/ramat-gan', '/treatments', '/for-business', '/about', '/bizarre-not-a-region']) assert.equal(isPrivatePath(p), false, p);
    // Prefixes that end with "/" match only below themselves, so /b or /w pages elsewhere are unaffected.
    assert.equal(isPrivatePath('/bio'), false);
    assert.equal(isPrivatePath('/waitlist/x'), false);
  });

  it('robots.txt disallows every private prefix including the admin, the dashboard and the clinic', () => {
    for (const p of ['/ops', '/biz', '/clinic', '/account', '/api']) assert.ok(PRIVATE_PREFIXES.includes(p), p);
  });
});

describe('indexing: public sections', () => {
  it('classifies every kind of public page', () => {
    assert.equal(sectionOfPath('/'), 'home');
    assert.equal(sectionOfPath('/regions'), 'regions');
    assert.equal(sectionOfPath('/dan'), 'regions');
    assert.equal(sectionOfPath('/dan/'), 'regions');
    assert.equal(sectionOfPath('/dan/ramat-gan'), 'cities');
    assert.equal(sectionOfPath('/dan/ramat-gan/facials'), 'cityCategories');
    assert.equal(sectionOfPath('/dan/facials/studio-lin'), 'profiles');
    assert.equal(sectionOfPath('/dan/biz/studio-lin'), 'profiles');
    assert.equal(sectionOfPath('/dan/facials/%D7%A1%D7%98%D7%95%D7%93%D7%99%D7%95'), 'profiles', 'percent-encoded Hebrew slug');
    assert.equal(sectionOfPath('/treatments'), 'categories');
    assert.equal(sectionOfPath('/treatments/facials'), 'categories');
    for (const p of ['/about', '/about/methodology', '/about/editorial', '/listing-standards', '/listing-standards/sponsorship', '/for-business', '/magazine', '/help', '/contact']) assert.equal(sectionOfPath(p), 'content', p);
    for (const p of ['/privacy', '/terms', '/accessibility']) assert.equal(sectionOfPath(p), 'legal', p);
    assert.equal(sectionOfPath('/magazine/botox'), 'content');
    assert.equal(sectionOfPath('/magazine/category/prices-and-costs'), 'content');
    assert.equal(sectionOfPath('/magazine/category/x/y'), null);
    assert.equal(sectionOfPath('/nowhere'), null);
    assert.equal(sectionOfPath('/dan/a/b/c'), null);
  });

  it('the open policy indexes every public page and nothing private', () => {
    for (const p of ['/', '/dan', '/dan/ramat-gan/facials', '/dan/facials/studio-lin', '/privacy']) assert.equal(pathIndexable(OPEN_POLICY, p), true, p);
    for (const p of ['/ops', '/biz/profile', '/clinic', '/nowhere']) assert.equal(pathIndexable(OPEN_POLICY, p), false, p);
  });

  it('the master switch, STAGING and a section switch each block their pages', () => {
    assert.equal(pathIndexable({ ...OPEN_POLICY, site: false }, '/'), false);
    assert.equal(pathIndexable({ ...OPEN_POLICY, staging: true }, '/'), false);
    const noProfiles = { ...OPEN_POLICY, sections: { ...OPEN_POLICY.sections, profiles: false } };
    assert.equal(pathIndexable(noProfiles, '/dan/facials/studio-lin'), false);
    assert.equal(pathIndexable(noProfiles, '/dan/ramat-gan/facials'), true, 'other sections stay indexable');
    assert.deepEqual(Object.keys(OPEN_POLICY.sections).sort(), [...INDEX_SECTION_KEYS].sort());
  });
});

describe('indexing: platform settings defaults', () => {
  it('a fresh database indexes everything', async () => {
    const { DEFAULT_PLATFORM_SETTINGS, PlatformSettingsSchema } = await import('../../src/lib/server/platformSettings');
    assert.equal(DEFAULT_PLATFORM_SETTINGS.indexSite, true);
    assert.deepEqual(DEFAULT_PLATFORM_SETTINGS.indexSections, {});
    const ok = PlatformSettingsSchema.safeParse({ indexSections: { profiles: false } });
    assert.ok(ok.success);
    assert.equal(ok.data.indexSections.profiles, false);
    assert.ok(!PlatformSettingsSchema.safeParse({ indexSections: { nope: false } }).success, 'unknown sections are rejected');
  });
});
