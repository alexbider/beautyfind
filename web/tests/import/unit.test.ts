// Pure tests: no database, no network beyond a loopback server. Run with `npm run test:import`.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { attributeFlags, buildSearch, dfsCategoriesFor, googleMapsUrl, providerServices, isFatalStatus, isTransientStatus, largerGoogleImage, mapItem } from '../../src/lib/import/dataforseo';
import { dfsRunMaxUsd, estimateFor } from '../../src/lib/import/estimate';
import { fieldMask, FieldMaskError, GOOGLE_FEATURES, retentionDays } from '../../src/lib/import/googleFields';
import { isStrong, nameSimilarity, normName, scoreMatch, DUPLICATE_AT } from '../../src/lib/import/match';
import { formatIlPhone, normalizeIlPhone } from '../../src/lib/import/phone';
import { dfsPageMaxUsd, pricing } from '../../src/lib/import/pricing';
import { qualify, type QualifyInput } from '../../src/lib/import/rules';
import { checkUrl, guardedLookup, isPrivateAddress, safeFetch, UnsafeUrlError } from '../../src/lib/import/safeFetch';
import { extractPage, hoursFromText, rankEmails } from '../../src/lib/import/siteExtract';
import { completeness, composeDescription } from '../../src/lib/import/completeness';
import { imageInfo, usable } from '../../src/lib/import/imageInfo';
import { categoriesFromName, rankCategories } from '../../src/lib/import/categoryRank';
import { slugBase, slugCandidates } from '../../src/lib/import/slug';
import { splitAtWords } from '../../src/components/profile/aboutSplit';
import { acceptPhoto, canonicalImageUrl, decorativeHint, dedupeVariants, dhash, hamming, logoScore, photoScore } from '../../src/lib/import/imageQuality';
import { matchService } from '../../src/lib/import/services';
import { mayPublish } from '../../src/lib/import/sourcePolicy';
import { classifyWebsite, siteBelongs } from '../../src/lib/import/websiteKind';
import { png } from '../../scripts/import/sim/fixtures';

describe('Israeli phone normalization', () => {
  it('normalizes common written forms to E.164', () => {
    assert.equal(normalizeIlPhone('03-555-1234'), '+97235551234');
    assert.equal(normalizeIlPhone('050-123-4567'), '+972501234567');
    assert.equal(normalizeIlPhone('+972 50 123 4567'), '+972501234567');
    assert.equal(normalizeIlPhone('00972-50-1234567'), '+972501234567');
    assert.equal(normalizeIlPhone('(03) 555.1234'), '+97235551234');
    assert.equal(normalizeIlPhone('1-700-500-500'), '+9721700500500');
  });
  it('rejects what is not an Israeli number', () => {
    assert.equal(normalizeIlPhone('123'), null);
    assert.equal(normalizeIlPhone(''), null);
    assert.equal(normalizeIlPhone(null), null);
    assert.equal(normalizeIlPhone('+1 212 555 0100'), null);
  });
  it('formats for screens', () => {
    assert.equal(formatIlPhone('+972501234567'), '050-123-4567');
    assert.equal(formatIlPhone('+97235551234'), '03-555-1234');
  });
});

describe('Hebrew name normalization and duplicates', () => {
  it('drops niqqud, quotes and generic words', () => {
    assert.equal(normName('סָלוֹן "יופי" של דנה'), 'דנה');
    assert.equal(normName('מכון היופי של רותי בע"מ'), normName('רותי'));
  });
  it('treats spelling variants as similar', () => {
    assert.ok(nameSimilarity('קליניקת ד״ר כהן', 'קליניקה דר כהן') >= 0.9);
  });
  it('does not merge numbered branches on name alone', () => {
    assert.ok(nameSimilarity('Nails 1', 'Nails 2') < 0.9);
  });
  it('same source id is an automatic duplicate', () => {
    const a = { name: 'A', lat: 32, lng: 34.8, phone: null, email: null, website: null, googlePlaceId: 'ChIJx' };
    const m = scoreMatch(a, { ...a, name: 'B' });
    assert.equal(m.score, 1);
    assert.ok(isStrong(m.reasons));
  });
  it('same phone and name nearby is a duplicate', () => {
    const a = { name: 'סלון דנה', lat: 32.08, lng: 34.78, phone: '+97235551234', email: null, website: null };
    const m = scoreMatch(a, { ...a, lat: 32.0801 });
    assert.ok(m.score >= DUPLICATE_AT && isStrong(m.reasons));
  });
  it('keeps chain branches apart: shared website and central phone, different names and towns', () => {
    const a = { name: 'רשת יופי תל אביב', lat: 32.08, lng: 34.78, phone: '+97235551234', email: null, website: 'https://chain.co.il' };
    const b = { name: 'רשת יופי חיפה', lat: 32.79, lng: 34.99, phone: '+97235551234', email: null, website: 'https://chain.co.il/haifa' };
    const m = scoreMatch(a, b);
    assert.ok(!(m.score >= DUPLICATE_AT && isStrong(m.reasons)), `score ${m.score} ${m.reasons}`);
  });
  it('a shared booking platform host is never evidence', () => {
    const a = { name: 'X', lat: null, lng: null, phone: null, email: null, website: 'https://www.facebook.com/x' };
    assert.ok(!scoreMatch(a, { ...a, name: 'Y', website: 'https://www.facebook.com/y' }).reasons.includes('same_website'));
  });
});

describe('DataForSEO mapping', () => {
  it('maps a full item', () => {
    const m = mapItem({
      title: 'סלון דוגמה', cid: '123', place_id: 'ChIJabc', phone: '+972 3-555-1234', url: 'https://example.test/', domain: 'www.example.test',
      latitude: 32.08, longitude: 34.78, address_info: { city: 'Tel Aviv-Yafo', country_code: 'IL' }, category: 'Beauty salon', category_ids: ['beauty_salon'],
      rating: { value: 4.6, votes_count: 12 }, contact_info: [{ type: 'mail', value: 'info@example.test' }],
      work_time: { work_hours: { timetable: { sunday: [{ open: { hour: 9, minute: 0 }, close: { hour: 18, minute: 30 } }], saturday: null } } },
      last_updated_time: '2026-09-01 10:00:00 +00:00',
    })!;
    assert.equal(m.sourceKey, 'ChIJabc');
    assert.equal(m.phone, '+97235551234');
    assert.equal(m.siteDomain, 'example.test');
    assert.deepEqual(m.emails, ['info@example.test']);
    assert.deepEqual(m.rating, { value: 4.6, count: 12 });
    assert.ok(m.hours && m.hours.length === 7);
    assert.equal(m.sourceUpdatedAt?.toISOString(), '2026-09-01T10:00:00.000Z');
  });
  it('survives nulls and unknown fields', () => {
    const m = mapItem({ title: 'X', cid: '9', phone: undefined, latitude: undefined, rating: undefined, work_time: undefined, contact_info: undefined, unknown_new_field: { a: 1 } } as never)!;
    assert.equal(m.sourceKey, 'dfs:cid:9');
    assert.equal(m.phone, null);
    assert.equal(m.lat, null);
    assert.equal(m.hours, null);
    assert.equal(m.rating, null);
  });
  it('rejects items without identity', () => {
    assert.equal(mapItem({ title: 'X' }), null);
    assert.equal(mapItem({ cid: '1' }), null);
  });
  it('builds a request within API limits', () => {
    const b = buildSearch({ categories: dfsCategoriesFor(['nails', 'facials']), lat: 32.08, lng: 34.78, radiusKm: 0.2, limit: 5000 });
    assert.ok((b.limit ?? 0) <= 1000 && (b.limit ?? 0) > 0);
    assert.ok((b.categories?.length ?? 0) <= 10);
    assert.match(b.location_coordinate!, /^32\.08\d*,34\.78\d*,\d+(\.\d+)?$/);
    assert.ok(Number(b.location_coordinate!.split(',')[2]) >= 1);
    assert.ok((b.filters?.length ?? 0) <= 8);
  });
  it('classifies status codes', () => {
    assert.ok(isFatalStatus(40100) && isFatalStatus(40200) && isFatalStatus(40210));
    assert.ok(!isFatalStatus(40202) && isTransientStatus(40202));
    assert.ok(isTransientStatus(50000) && !isFatalStatus(50000));
  });
});

describe('cost', () => {
  it('prices a page at request + items', () => {
    assert.ok(Math.abs(dfsPageMaxUsd(1000, pricing()) - 0.372) < 1e-9);
    assert.ok(Math.abs(dfsPageMaxUsd(100, pricing()) - 0.048) < 1e-9);
  });
  it('pilot maximum stays under the $1 ceiling', () => {
    assert.ok(dfsRunMaxUsd(100, 1000).usd < 1);
  });
  it('estimator scales with volume', () => {
    const a = estimateFor(100);
    const b = estimateFor(10_000);
    assert.ok(b.dfsUsd > a.dfsUsd && b.dfsRequests >= 11);
    assert.equal(a.googleUsd, 0); // Google off by default
  });
});

describe('Google field masks', () => {
  it('never allows a wildcard', () => {
    assert.throws(() => fieldMask(['*']), FieldMaskError);
    assert.throws(() => fieldMask(['places.*']), FieldMaskError);
    assert.throws(() => fieldMask([]), FieldMaskError);
    assert.throws(() => fieldMask(['id', 'reviews.text']), FieldMaskError);
  });
  it('bills at the highest-tier field', () => {
    assert.equal(fieldMask(['id']).sku, 'essentials_ids_only');
    assert.equal(fieldMask(['id', 'location']).sku, 'essentials');
    assert.equal(fieldMask(['id', 'displayName']).sku, 'pro');
    assert.equal(fieldMask(['id', 'displayName', 'rating']).sku, 'enterprise');
    assert.equal(fieldMask([...GOOGLE_FEATURES.verify]).sku, 'pro');
    assert.equal(fieldMask([...GOOGLE_FEATURES.rating]).sku, 'enterprise');
  });
  it('keeps only the place id permanently and location for 30 days', () => {
    assert.equal(retentionDays('id'), 'permanent');
    assert.equal(retentionDays('location'), 30);
    assert.equal(retentionDays('rating'), 0);
    assert.equal(retentionDays('displayName'), 0);
  });
  it('source policy keeps Google content and provider ratings out of listings', () => {
    assert.equal(mayPublish('google', 'rating'), false);
    assert.equal(mayPublish('google', 'phone'), false);
    assert.equal(mayPublish('dataforseo', 'rating'), false);
    assert.equal(mayPublish('dataforseo', 'rating', { publishProviderRatings: true }), true);
    assert.equal(mayPublish('dataforseo', 'photo'), false);
    assert.equal(mayPublish('website', 'logo'), false);
  });
});

const base: QualifyInput = {
  name: 'סלון', phone: '+97235551234', email: 'a@b.co.il', emailMx: true, emailTier: 'own', categories: ['nails'], businessStatus: null, citySlug: 'tel-aviv',
  notBeauty: false, extractionFailed: false, possibleExisting: false, sharedPhone: false, hasWebsite: true, hasLocation: true,
};

describe('qualification', () => {
  it('complete record is ready', () => assert.equal(qualify(base).status, 'ready'));
  it('a phone or hours that differ on the website are notices: the record stays ready with the Google value', () => {
    const q = qualify({ ...base, phoneConflict: true, hoursConflict: true });
    assert.equal(q.status, 'ready');
    assert.ok(q.reasons.includes('phone_conflict') && q.reasons.includes('hours_conflict'));
  });
  it('a medical category is a notice, not a hold; an unknown city still needs a person', () => {
    assert.equal(qualify({ ...base, categories: ['medical-aesthetics'] }).status, 'ready');
    assert.ok(qualify({ ...base, categories: ['medical-aesthetics'] }).reasons.includes('medical_without_doctor_info'));
    assert.equal(qualify({ ...base, citySlug: null }).status, 'needs_review');
  });
  it('maps English localities and coordinates inside a city to the catalog city', async () => {
    const { resolveCity } = await import('../../src/lib/import/geo');
    assert.equal(resolveCity('Tel Aviv-Yafo', 32.115, 34.797).citySlug, 'tel-aviv');
    assert.equal(resolveCity('Jerusalem', 31.78, 35.21).citySlug, 'jerusalem');
    assert.equal(resolveCity("Be'er Sheva", 31.25, 34.79).citySlug, 'beer-sheva');
    assert.equal(resolveCity('Somewhere', 32.115, 34.797).citySlug, 'tel-aviv'); // inside the city circle
    assert.equal(resolveCity('כפר קטן', 31.0, 35.4).citySlug, null); // far from every catalog city
  });
  it('a phone or an email is enough to publish (default rule)', () => {
    assert.equal(qualify({ ...base, email: null }).status, 'ready');
    assert.equal(qualify({ ...base, phone: null }).status, 'ready');
    assert.equal(qualify({ ...base, phone: null, hasWebsite: false }).status, 'ready');
    const none = qualify({ ...base, phone: null, email: null });
    assert.equal(none.status, 'incomplete');
    assert.ok(none.reasons.includes('no_contact'));
  });
  it('email can still be made mandatory in settings', () => {
    assert.equal(qualify({ ...base, email: null }, { requirePhoneOrEmail: true, requireEmail: true, requirePhoneOrWebsite: false }).status, 'incomplete');
  });
  it('no location blocks', () => assert.equal(qualify({ ...base, hasLocation: false }).status, 'incomplete'));
  it('closed businesses are closed', () => assert.equal(qualify({ ...base, businessStatus: 'CLOSED_PERMANENTLY' }).status, 'closed'));
});

describe('website extraction', () => {
  const html = `<html><body>
    <a href="mailto:info@salon.co.il">info@salon.co.il</a>
    <a href="tel:03-555-1234">03-555-1234</a>
    <a href="https://wa.me/972501234567">WhatsApp</a>
    <a href="https://www.instagram.com/salon_test/">IG</a>
    <a href="https://www.facebook.com/sharer.php?u=x">share</a>
    <p>טיפול פנים ₪250</p>
    <footer>האתר נבנה ע"י סטודיו פיקסל studio@pixel-agency.co.il</footer>
  </body></html>`;
  const f = extractPage(html, 'https://salon.co.il/צור-קשר', 'salon.co.il');
  it('keeps the business email and drops the site builder credit', () => {
    assert.deepEqual(f.emails.map(e => e.value), ['info@salon.co.il']);
    assert.deepEqual(f.agencyEmails, ['studio@pixel-agency.co.il']);
    assert.ok(f.emails[0].onContactPage);
    assert.ok(f.emails[0].evidence.length > 0);
  });
  it('takes phones, explicit WhatsApp links and real profile links only', () => {
    assert.deepEqual(f.phones.map(p => p.value), ['+97235551234']);
    assert.deepEqual(f.whatsapp.map(w => w.value), ['+972501234567']);
    assert.deepEqual(f.socials.map(s => s.value.url), ['https://www.instagram.com/salon_test']);
  });
  it('reads explicit prices with the source line', () => {
    assert.ok(f.services.some(s => s.value.priceNis === 250 && s.evidence.includes('₪250')));
  });
  it('ranks own-domain contact-page emails first', () => {
    const r = rankEmails([
      { value: 'x@gmail.com', url: 'u', evidence: '', onContactPage: true },
      { value: 'info@salon.co.il', url: 'u', evidence: '', onContactPage: true },
    ], 'https://salon.co.il');
    assert.equal(r[0].value, 'info@salon.co.il');
  });
});

describe('SSRF protection', () => {
  it('refuses private, loopback, metadata and odd forms', () => {
    for (const u of [
      'http://127.0.0.1/', 'http://localhost/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://[::1]/',
      'http://2130706433/', 'http://0x7f000001/', 'http://[::ffff:127.0.0.1]/', 'http://100.64.0.1/', 'http://metadata.internal/',
    ]) assert.throws(() => checkUrl(u), UnsafeUrlError, u);
  });
  it('refuses other schemes, ports and embedded credentials', () => {
    for (const u of ['file:///etc/passwd', 'ftp://example.com/', 'gopher://x/', 'http://example.com:8080/', 'https://user:pw@example.com/']) assert.throws(() => checkUrl(u), UnsafeUrlError, u);
    assert.doesNotThrow(() => checkUrl('https://example.com/path'));
  });
  it('test mode opens loopback and .test only', () => {
    assert.doesNotThrow(() => checkUrl('http://127.0.0.1:8080/', true));
    assert.doesNotThrow(() => checkUrl('http://site-1.test:8080/', true));
    for (const u of ['http://169.254.169.254/', 'http://10.0.0.1/', 'http://192.168.0.1/', 'http://metadata.internal/']) assert.throws(() => checkUrl(u, true), UnsafeUrlError, u);
    assert.throws(() => checkUrl('http://site-1.test/'), UnsafeUrlError);
  });
  it('classifies addresses', () => {
    assert.ok(isPrivateAddress('127.0.0.1') && isPrivateAddress('::1') && isPrivateAddress('fd00::1') && isPrivateAddress('169.254.1.1'));
    assert.ok(!isPrivateAddress('8.8.8.8') && !isPrivateAddress('2606:4700:4700::1111'));
  });
  it('fails DNS resolution to a private address at connect time', async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>(res => guardedLookup('localhost', {}, e => res(e)));
    assert.equal(err?.code, 'EUNSAFE');
  });
  it('re-checks every redirect and caps them', async () => {
    const srv = createServer((req, res) => {
      if (req.url === '/meta') return void res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }).end();
      if (req.url === '/file') return void res.writeHead(302, { location: 'file:///etc/passwd' }).end();
      if (req.url === '/creds') return void res.writeHead(302, { location: 'http://a:b@127.0.0.1/' }).end();
      res.writeHead(302, { location: `/loop${Math.random()}` }).end();
    });
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as AddressInfo).port;
    try {
      // allowPrivate only lets the test reach its own loopback server; redirect checks still apply.
      await assert.rejects(safeFetch(`http://127.0.0.1:${port}/meta`, { allowPrivate: true }), UnsafeUrlError);
      await assert.rejects(safeFetch(`http://127.0.0.1:${port}/file`, { allowPrivate: true }), UnsafeUrlError);
      await assert.rejects(safeFetch(`http://127.0.0.1:${port}/creds`, { allowPrivate: true }), UnsafeUrlError);
      await assert.rejects(safeFetch(`http://127.0.0.1:${port}/loop`, { allowPrivate: true, maxRedirects: 3 }), /too_many_redirects/);
      // Without the test flag the loopback server is refused before any request.
      await assert.rejects(safeFetch(`http://127.0.0.1:${port}/`), UnsafeUrlError);
    } finally {
      srv.close();
    }
  });
  it('caps the response size', async () => {
    const srv = createServer((_req, res) => res.end('x'.repeat(50_000)));
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as AddressInfo).port;
    try {
      const r = await safeFetch(`http://127.0.0.1:${port}/`, { allowPrivate: true, maxBytes: 1000 });
      assert.ok(r.truncated && r.body.length === 1000);
    } finally {
      srv.close();
    }
  });
});

describe('website classification', () => {
  const k = (u: string) => classifyWebsite(u);
  it('keeps own sites and social profiles', () => {
    assert.deepEqual(k('http://noa.co.il/he/'), { kind: 'own', url: 'http://noa.co.il/' });
    assert.equal(k('noa-beauty.com').kind, 'own');
    assert.equal(k('https://sites.google.com/view/noa').kind, 'own');
    assert.deepEqual(k('https://www.facebook.com/noa.studio/posts/123'), { kind: 'social', url: 'https://www.facebook.com/noa.studio', network: 'facebook' });
    assert.equal(k('https://facebook.com/profile.php?id=1000123').url, 'https://www.facebook.com/profile.php?id=1000123');
    assert.equal(k('https://www.instagram.com/noa_studio/?hl=he').url, 'https://www.instagram.com/noa_studio');
    assert.equal(k('https://linktr.ee/noa').kind, 'linkhub');
  });
  it('never keeps directories, maps or other third parties', () => {
    for (const u of ['https://www.easy.co.il/page/123', 'https://www.b144.co.il/b144_sip/x', 'https://www.d.co.il/80123/', 'https://www.google.com/maps/place/x', 'https://goo.gl/maps/x', 'https://g.page/noa', 'https://www.waze.com/ul?ll=1,2', 'https://www.doctors.co.il/doctor/x', 'https://www.maccabi4u.co.il/x', 'https://www.gov.il/he', 'https://www.tripadvisor.com/x', 'https://bit.ly/abc', 'https://x.com/noa', 'https://noa.business.site/'])
      assert.equal(k(u).kind, 'directory', u);
  });
  it('moves booking and WhatsApp links to their own fields', () => {
    assert.equal(k('https://tor4you.co.il/noa').kind, 'booking');
    assert.equal(k('https://www.fresha.com/a/noa').kind, 'booking');
    assert.deepEqual(k('https://wa.me/972501234567'), { kind: 'whatsapp', url: 'https://wa.me/972501234567', phone: '+972501234567' });
  });
  it('rejects posts, groups and junk', () => {
    for (const u of ['https://www.instagram.com/p/abc/', 'https://www.facebook.com/groups/123', 'https://www.facebook.com/sharer.php?u=x', 'mailto:a@b.c', 'javascript:alert(1)', 'not a url', '']) assert.equal(k(u).kind, 'invalid', u);
  });
});

describe('site ownership', () => {
  const p = { name: 'סטודיו נועה לקוסמטיקה', phone: '+97235551234' };
  it('a matching phone or name belongs', () => {
    assert.equal(siteBelongs(p, { phones: [{ value: '+97235551234' }], whatsapp: [], names: ['Home'] }, 'x.co.il'), 'yes');
    assert.equal(siteBelongs(p, { phones: [{ value: '+97249999999' }], whatsapp: [], names: ['נועה - קוסמטיקה ויופי'] }, 'x.co.il'), 'yes');
  });
  it('another business with its own phone and name does not', () => {
    assert.equal(siteBelongs(p, { phones: [{ value: '+97248123456' }], whatsapp: [], names: ['חנות רהיטים אחרת'] }, 'furniture.co.il'), 'no');
  });
  it('nothing to compare is unknown, not dropped', () => {
    assert.equal(siteBelongs(p, { phones: [], whatsapp: [], names: ['Welcome'] }, 'abc.co.il'), 'unknown');
  });
});

describe('services from websites', () => {
  const html = `<html><head><title>סטודיו נועה</title>
    <script type="application/ld+json">{"@type":"BeautySalon","name":"סטודיו נועה","hasOfferCatalog":{"itemListElement":[{"@type":"Offer","itemOffered":{"@type":"Service","name":"הרמת ריסים"},"price":"220","priceCurrency":"ILS"}]}}</script></head>
    <body><ul><li>טיפול פנים קלאסי</li><li>מיקרובליידינג</li><li>אודות</li><li>צור קשר</li></ul>
    <div>ניקוי עמוק</div><div>₪ 280</div>
    <p>פדיקור רפואי 60 דק׳ - 180 ש"ח</p><p>₪350 הסרת שיער בלייזר רגליים מלאות</p><p>בוטוקס החל מ-900 ₪</p><p>החלקה אורגנית 800-1,200 ₪</p>
    <p>אנחנו מזמינות אתכן ליהנות מטיפול פנים מפנק. קבעו תור עוד היום!</p></body></html>`;
  const f = extractPage(html, 'https://noa.co.il/', 'noa.co.il');
  const by = (n: string) => f.services.find(s => s.value.name === n)?.value;
  it('reads structured offers, prices before or after the name, card layouts and ranges', () => {
    assert.equal(by('הרמת ריסים')?.priceNis, 220);
    assert.equal(by('ניקוי עמוק')?.priceNis, 280);
    assert.deepEqual([by('פדיקור רפואי')?.priceNis, by('פדיקור רפואי')?.durationMin], [180, 60]);
    assert.equal(by('הסרת שיער בלייזר רגליים מלאות')?.priceNis, 350);
    assert.deepEqual([by('בוטוקס')?.priceNis, by('בוטוקס')?.priceType, by('בוטוקס')?.isMedical], [900, 'from', true]);
    assert.deepEqual([by('החלקה אורגנית')?.priceNis, by('החלקה אורגנית')?.priceMaxNis, by('החלקה אורגנית')?.priceType], [800, 1200, 'range']);
  });
  it('lists known treatments without a price and ignores menus and sentences', () => {
    assert.equal(by('טיפול פנים קלאסי')?.priceNis, null);
    assert.equal(by('טיפול פנים קלאסי')?.priceType, 'on_request');
    assert.equal(by('מיקרובליידינג')?.category, 'permanent-makeup');
    assert.ok(!by('אודות') && !by('צור קשר'));
    assert.ok(!f.services.some(s => s.value.name.includes('מזמינות')));
  });
  it('maps services to our categories', () => {
    assert.equal(by('הסרת שיער בלייזר רגליים מלאות')?.category, 'hair-removal');
    assert.equal(by('החלקה אורגנית')?.category, 'hair-salons');
    assert.equal(matchService('מניקור ג׳ל')?.category, 'nails');
    assert.equal(matchService('ספה תלת מושבית'), null);
  });
  it('reads the site name for the ownership check', () => assert.equal(f.siteName, 'סטודיו נועה'));
});

describe('images', () => {
  const html = `<head><meta property="og:image" content="https://static.wixstatic.com/media/abc~mv2.jpg"><link rel="apple-touch-icon" href="/apple-touch-icon.png"></head>
    <body><img class="site-logo" src="/logo.png" alt="לוגו"><img src="/uploads/room.jpg" width="800" height="600" alt="חדר">
    <img src="/icons/phone.png" width="24"><img src="/a.svg"><img data-src="/uploads/lazy.webp" alt="lazy"><img srcset="/s-400.jpg 400w, /s-1200.jpg 1200w" alt="set"><section style="background-image: url('/uploads/hero.jpg')"></section></body>`;
  const f = extractPage(html, 'https://noa.co.il/', 'noa.co.il');
  it('finds logo candidates', () => assert.deepEqual(f.logos.map(l => l.value), ['https://noa.co.il/logo.png', 'https://noa.co.il/apple-touch-icon.png']));
  it('finds photos, prefers large sources and skips icons and SVG', () => {
    const urls = f.photos.map(p => p.value);
    assert.ok(urls.includes('https://noa.co.il/uploads/room.jpg') && urls.includes('https://noa.co.il/uploads/lazy.webp') && urls.includes('https://noa.co.il/s-1200.jpg'));
    assert.ok(urls.includes('https://noa.co.il/uploads/hero.jpg'));
    assert.ok(!urls.some(u => /phone\.png|\.svg|s-400/.test(u)));
    assert.equal(urls.at(-1), 'https://static.wixstatic.com/media/abc~mv2.jpg'); // og:image last
  });
  it('reads real image sizes and rejects small ones', () => {
    const big = imageInfo(png(960, 640))!;
    assert.deepEqual(big, { mime: 'image/png', width: 960, height: 640 });
    assert.ok(usable(big, 'photo'));
    assert.ok(!usable(imageInfo(png(40, 40))!, 'logo'));
    assert.ok(usable(imageInfo(png(240, 240))!, 'logo'));
    assert.equal(imageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'.padEnd(64))), null);
  });
});

describe('primary category and listing slug', () => {
  it('a hair salon that Google calls a beauty salon is a hair salon first', () => {
    const r = rankCategories({ name: 'Ehud Elbaz Beauty Salon', candidates: ['facials'], googlePrimary: ['facials'], googleGeneric: true, services: { 'hair-salons': { n: 6, priced: 4 } } });
    assert.deepEqual(r, ['hair-salons', 'facials']);
    assert.deepEqual(rankCategories({ name: 'מספרת אהוד', candidates: ['facials'], googlePrimary: ['facials'], googleGeneric: true }), ['hair-salons', 'facials']);
    // A specific Google type beats a generic one and the name confirms it.
    assert.deepEqual(rankCategories({ name: 'נועה קליניק', candidates: ['facials', 'medical-aesthetics'], googlePrimary: ['medical-aesthetics'], googleAdditional: ['facials'] }), ['medical-aesthetics', 'facials']);
    // Without evidence the record's own order and the catalog order hold.
    assert.deepEqual(rankCategories({ name: 'סטודיו X', candidates: ['nails', 'brows-lashes'] }), ['nails', 'brows-lashes']);
    assert.deepEqual(categoriesFromName('מספרה ועיצוב שיער דנה'), ['hair-salons']);
    assert.deepEqual(categoriesFromName('סלון יופי'), []);
  });
  it('the provider mapping puts the evidenced category first', () => {
    const m = mapItem({ title: 'מספרת אהוד אלבז', cid: '77', category: 'Beauty salon', additional_categories: ['Hair salon'], latitude: 32.8, longitude: 34.99, address: 'חיפה' } as never)!;
    assert.equal(m.categories[0], 'hair-salons');
    assert.ok(m.categories.includes('facials'));
  });
  it('slugs are readable, Hebrew stays Hebrew, and uniqueness comes from the city or a counter', () => {
    assert.equal(slugBase('Ehud Elbaz Beauty Salon', 'x'), 'ehud-elbaz-beauty-salon');
    assert.equal(slugBase('Noa Clinic & Spa', 'x'), 'noa-clinic-and-spa');
    assert.equal(slugBase('סלון יופי אהוד אלבז', 'x'), 'סלון-יופי-אהוד-אלבז');
    assert.equal(slugBase('ד"ר רוני מוסקונה', 'x'), 'דר-רוני-מוסקונה');
    assert.equal(slugBase('!!', 'hair-salons-haifa'), 'hair-salons-haifa');
    assert.deepEqual(slugCandidates('noa-clinic', 'haifa').slice(0, 3), ['noa-clinic', 'noa-clinic-haifa', 'noa-clinic-2']);
    assert.deepEqual(slugCandidates('noa-clinic', null).slice(0, 2), ['noa-clinic', 'noa-clinic-2']);
  });
});

describe('image quality', () => {
  const photo = { url: 'https://x.co.il/wp-content/uploads/2024/clinic-room.jpg', width: 1600, height: 1067, bytes: 320_000, entropy: 7.4, hasAlpha: false };
  it('prefers a large sharp photograph over a small or flat graphic and rejects decoration', () => {
    const big = photoScore(photo);
    const small = photoScore({ ...photo, width: 640, height: 427, bytes: 60_000 });
    const flat = photoScore({ ...photo, entropy: 2.1, bytes: 12_000 });
    const cutout = photoScore({ ...photo, hasAlpha: true });
    assert.ok(big > small && small > flat && big > cutout);
    assert.ok(acceptPhoto(photo) && !acceptPhoto({ ...photo, entropy: 2.1 }) && !acceptPhoto({ ...photo, hasAlpha: true }));
    assert.ok(!acceptPhoto({ ...photo, url: 'https://x.co.il/img/stars-bg.png' }));
    assert.ok(decorativeHint('https://x.co.il/assets/certificate-2023.jpg') && decorativeHint('https://x.co.il/a.jpg', 'תעודת הסמכה') && !decorativeHint('https://x.co.il/uploads/reception-area.jpg', 'חדר הטיפולים'));
    assert.ok(acceptPhoto({ ...photo, entropy: 1 }, false)); // lenient mode for flat fixtures
    assert.ok(photoScore({ ...photo, entropy: null }) > 50); // no sharp: size and filename still rank
  });
  it('picks a mark over a photograph or a partner badge as the logo', () => {
    const mark = logoScore({ url: 'https://x.co.il/wp-content/uploads/logo.png', width: 400, height: 400, bytes: 20_000, hasAlpha: true, entropy: 3.5, rank: 0 });
    const wordmark = logoScore({ url: 'https://x.co.il/img/brand.png', width: 600, height: 200, bytes: 18_000, hasAlpha: true, entropy: 3, rank: 1 });
    const photo = logoScore({ url: 'https://lh3.googleusercontent.com/p/abc=s400', width: 400, height: 400, bytes: 60_000, hasAlpha: false, entropy: 7.6, rank: 2 });
    const badge = logoScore({ url: 'https://x.co.il/img/partner-visa.png', width: 300, height: 300, bytes: 9_000, hasAlpha: true, entropy: 3, rank: 3 });
    const tiny = logoScore({ url: 'https://x.co.il/favicon-96.png', width: 96, height: 96, bytes: 3_000, hasAlpha: true, entropy: 3, rank: 4 });
    assert.ok(mark > wordmark && wordmark > photo && mark > badge && mark > tiny);
  });
  it('treats size variants of one file as one picture, plain file first', () => {
    assert.equal(canonicalImageUrl('https://x.co.il/wp-content/uploads/2024/room-300x200.jpg'), canonicalImageUrl('https://x.co.il/wp-content/uploads/2024/room.jpg'));
    assert.equal(canonicalImageUrl('https://x.co.il/wp-content/uploads/2024/room-scaled.jpg?ver=3'), canonicalImageUrl('https://X.co.il/wp-content/uploads/2024/ROOM.jpg'));
    assert.equal(canonicalImageUrl('https://lh3.googleusercontent.com/p/abc=w408-h306-k-no'), canonicalImageUrl('https://lh3.googleusercontent.com/p/abc=w1600-h1200'));
    assert.notEqual(canonicalImageUrl('https://x.co.il/a.jpg'), canonicalImageUrl('https://x.co.il/b.jpg'));
    assert.deepEqual(dedupeVariants(['https://x.co.il/u/room-300x200.jpg', 'https://x.co.il/u/room.jpg', 'https://x.co.il/u/hall.jpg', 'https://x.co.il/u/room-768x512.jpg']), ['https://x.co.il/u/room.jpg', 'https://x.co.il/u/hall.jpg']);
  });
  it('perceptual hash: identical thumbnails match, a brightened copy is near, a different picture is far', () => {
    const a = Array.from({ length: 72 }, (_, i) => (i * 37) % 256);
    const b = a.map(v => Math.min(255, v + 20));
    const c = Array.from({ length: 72 }, (_, i) => (i * 91 + 7) % 256);
    assert.equal(hamming(dhash(a), dhash(a)), 0);
    assert.ok(hamming(dhash(a), dhash(b)) <= 6);
    assert.ok(hamming(dhash(a), dhash(c)) > 6);
  });
});

describe('Google profile data', () => {
  it('builds the Maps link from the cid, else the place id', () => {
    assert.equal(googleMapsUrl({ cid: '12345', place_id: 'ChIJx', title: 'X' }), 'https://www.google.com/maps?cid=12345');
    assert.equal(googleMapsUrl({ place_id: 'ChIJx', title: 'סלון' }), 'https://www.google.com/maps/search/?api=1&query=%D7%A1%D7%9C%D7%95%D7%9F&query_place_id=ChIJx');
    assert.equal(googleMapsUrl({ title: 'X' }), null);
  });
  it('asks Google for larger image renditions', () => {
    assert.equal(largerGoogleImage('https://lh5.googleusercontent.com/p/AF1Qip=w408-h306-k-no', 'photo'), 'https://lh5.googleusercontent.com/p/AF1Qip=w1600-h1200-k-no');
    assert.equal(largerGoogleImage('https://lh3.googleusercontent.com/abc=s44-p-k-no', 'logo'), 'https://lh3.googleusercontent.com/abc=s400-k-no');
    assert.equal(largerGoogleImage('https://noa.co.il/logo.png', 'logo'), 'https://noa.co.il/logo.png');
  });
  it('maps the profile link, images, rating and a provider email', () => {
    const m = mapItem({ title: 'X', cid: '77', latitude: 32, longitude: 34.8, logo: 'https://lh3.googleusercontent.com/l=s44', main_image: 'https://lh5.googleusercontent.com/p/m=w408-h306-k-no', rating: { value: 4.8, votes_count: 212 }, contact_info: [{ type: 'mail', value: 'Info@X.co.il' }] })!;
    assert.equal(m.googleMapsUrl, 'https://www.google.com/maps?cid=77');
    assert.equal(m.website, null);
    assert.ok(m.providerLogo && m.providerPhoto);
    assert.deepEqual(m.rating, { value: 4.8, count: 212 });
    assert.deepEqual(m.emails, ['Info@X.co.il']);
  });
  it('a Maps link typed as a website is still not a website of its own', () => assert.equal(classifyWebsite('https://www.google.com/maps?cid=77').kind, 'directory'));
  it('Google rating and profile images are publishable by default', () => {
    assert.equal(mayPublish('dataforseo', 'rating', { publishProviderRatings: true }), true);
    assert.equal(mayPublish('dataforseo', 'photo', { useProviderImages: true }), true);
    assert.equal(mayPublish('dataforseo', 'google_profile'), true);
  });
});

describe('template fields', () => {
  it('reads opening hours written as text, Hebrew and English', () => {
    const show = (t: string) => hoursFromText(t)?.value.map(d => (d.closed ? 'X' : `${d.open}-${d.close}`));
    assert.deepEqual(show("שעות פתיחה\nא'-ה' 09:00-19:00\nשישי 08:00-13:00\nשבת סגור"), ['09:00-19:00', '09:00-19:00', '09:00-19:00', '09:00-19:00', '09:00-19:00', '08:00-13:00', 'X']);
    assert.deepEqual(show('ראשון - חמישי: 10:00 עד 20:00\nיום ו׳ 9:00-14:00'), ['10:00-20:00', '10:00-20:00', '10:00-20:00', '10:00-20:00', '10:00-20:00', '09:00-14:00', 'X']);
    assert.deepEqual(show('Sun-Thu 09:00-18:00\nFri 09:00-13:00\nSat closed'), ['09:00-18:00', '09:00-18:00', '09:00-18:00', '09:00-18:00', '09:00-18:00', '09:00-13:00', 'X']);
    assert.equal(hoursFromText('טלפון 03-5551234\nמחיר 250 ₪'), null);
  });
  it('reads the description, FAQs, accessibility and parking from a site', () => {
    const html = `<meta name="description" content="סלון יופי שכונתי עם טיפולי פנים, ריסים וגבות, צוות מקצועי ויחס אישי.">
      <script type="application/ld+json">{"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"האם צריך לקבוע תור?","acceptedAnswer":{"@type":"Answer","text":"כן, בטלפון."}}]}</script>
      <p>הסלון נגיש לנכים</p><p>חניה חינם בחניון הבניין</p><footer><a href="/nagishut">הצהרת נגישות</a></footer>`;
    const f = extractPage(html, 'https://noa.co.il/', 'noa.co.il');
    assert.match(f.description!.value, /סלון יופי שכונתי/);
    assert.deepEqual(f.faqs.map(x => x.value), [{ q: 'האם צריך לקבוע תור?', a: 'כן, בטלפון.' }]);
    assert.equal(f.accessible?.value, true);
    assert.equal(f.freeParking?.value, true);
    const plain = extractPage('<footer><a>הצהרת נגישות</a></footer>', 'https://x.co.il/', 'x.co.il');
    assert.equal(plain.accessible, null);
  });
  it('maps Google attributes and services', () => {
    assert.deepEqual(attributeFlags({ available_attributes: { accessibility: ['has_wheelchair_accessible_entrance'], parking: ['has_free_parking_lot'] } }), { accessible: true, freeParking: true });
    assert.deepEqual(attributeFlags({ unavailable_attributes: { accessibility: ['has_wheelchair_accessible_entrance'] } }), { accessible: false, freeParking: null });
    assert.deepEqual(attributeFlags(undefined), { accessible: null, freeParking: null });
    const sv = providerServices([{ title: 'טיפול פנים', price: { current: 280, currency: 'ILS' } }, { title: 'Botox', price: { current: 100, currency: 'USD' } }, { title: '' }]);
    assert.deepEqual(sv.map(x => [x.name, x.priceNis, x.category]), [['טיפול פנים', 280, 'facials'], ['Botox', null, 'medical-aesthetics']]);
  });
  it('scores completeness and names what is missing', () => {
    const base = { name: 'X', address: 'רחוב 1', lat: 32, phone: '+97235551234', email: null, website: null, whatsapp: null, instagram: null, facebook: null, hours: [], logoUrl: null, photoUrls: [], description: null, categories: ['nails'], treatments: [], googleRating: 4.5, accessible: null, freeParking: null, faqs: null };
    const c = completeness(base);
    assert.ok(c.score > 0 && c.score < 50);
    assert.ok(c.missing.some(m => m.key === 'hours') && c.missing.some(m => m.key === 'logo') && !c.missing.some(m => m.key === 'phone'));
  });
  it('composes a factual description from the record only', () => {
    const d = composeDescription({ name: 'סלון נועה', cityName: 'חיפה', categories: ['nails', 'brows-lashes'], treatments: [{ name: 'מניקור' }, { name: 'הרמת ריסים' }], googleRating: 4.8, googleReviewCount: 52 });
    assert.equal(d, 'סלון נועה הוא עסק בתחום ציפורניים, מניקור ופדיקור, גבות וריסים בחיפה. בין השירותים: מניקור, הרמת ריסים. דירוג 4.8 ב־Google על סמך 52 ביקורות.');
    assert.equal(composeDescription({ name: 'X', cityName: null, categories: [], treatments: [], googleRating: null, googleReviewCount: null }), null);
  });
});

describe('about text preview', () => {
  it('keeps a short text whole and cuts a long one at 250 words, inside the crossing paragraph', () => {
    const w = (n: number) => Array.from({ length: n }, (_, i) => `מילה${i + 1}`).join(' ');
    assert.deepEqual(splitAtWords([w(120), w(100)]), { head: [w(120), w(100)], tail: [] });
    const { head, tail } = splitAtWords([w(200), w(100), w(50)]);
    assert.equal(head.length, 2);
    assert.equal(head[0], w(200));
    assert.equal(head[1].split(' ').length, 50);
    assert.equal(tail.length, 2);
    assert.equal(tail[0].split(' ').length, 50);
    assert.equal(tail[1], w(50));
    assert.equal([...head, ...tail].join(' ').split(' ').length, 350);
  });
});

describe('import coverage per city and category', async () => {
  const { coverageIndex, pairsToCount, summarize, countRequestUsd } = await import('../../src/lib/import/coverageCounts');
  const cells = [
    { city: 'haifa', category: 'nails', total: 100, checkedAt: '2026-09-20T00:00:00.000Z', found: 95, published: 40 },
    { city: 'haifa', category: 'facials', total: 50, checkedAt: '2026-09-20T00:00:00.000Z', found: 10, published: 0 },
    { city: 'akko', category: 'nails', total: null, checkedAt: null, found: 3, published: 1 },
  ];
  it('sums totals, found and published over the chosen pairs and says when a city is covered', () => {
    const index = coverageIndex(cells);
    const nails = summarize(index, ['haifa'], ['nails']);
    assert.equal(nails.total, 100);
    assert.equal(nails.found, 95);
    assert.equal(nails.done, true);
    const both = summarize(index, ['haifa'], ['nails', 'facials']);
    assert.equal(both.total, 150);
    assert.equal(both.found, 105);
    assert.equal(both.done, false); // facials at 10 of 50
    const akko = summarize(index, ['akko'], ['nails']);
    assert.equal(akko.counted, 0);
    assert.equal(akko.share, null);
    assert.equal(akko.found, 3);
    const mixed = summarize(index, ['haifa', 'akko'], ['nails']);
    assert.equal(mixed.counted, 1);
    assert.equal(mixed.pairs, 2);
    assert.equal(mixed.done, false); // one pair never counted
  });
  it('asks the provider only for pairs never counted or counted too long ago', () => {
    const stale = new Date('2026-09-01T00:00:00.000Z');
    assert.deepEqual(pairsToCount(cells, ['haifa', 'akko'], ['nails'], stale), [{ city: 'akko', category: 'nails' }]);
    assert.equal(pairsToCount(cells, ['haifa'], ['nails', 'facials'], new Date('2026-09-25T00:00:00.000Z')).length, 2);
    assert.equal(pairsToCount(cells, ['haifa'], ['nails'], stale, true).length, 1);
    assert.ok(countRequestUsd() > 0.01 && countRequestUsd() < 0.02);
  });
});

describe('listing page title', async () => {
  const { listingTitle, nameSays } = await import('../../src/lib/seo/listingTitle');
  it('puts the name, the city and the main category first, then prices and reviews, within 60 characters', () => {
    const t = listingTitle({ name: 'סלון אהוד אלבז', city: 'חיפה', category: 'מספרות ועיצוב שיער' });
    assert.ok(t.startsWith('סלון אהוד אלבז חיפה: מספרות ועיצוב שיער'), t);
    assert.ok(t.length <= 60, t);
    assert.ok(/מחירים/.test(t), t);
  });
  it('does not repeat a city or category the name already carries, and shortens long names', () => {
    assert.ok(nameSays('מספרת חיפה', 'חיפה'));
    assert.ok(nameSays('קליניקה בחיפה', 'חיפה'));
    assert.ok(!nameSays('מספרת חיפאי', 'חיפה'));
    assert.ok(nameSays('קוסמטיקה רפואית ד"ר לוי', 'קוסמטיקה וטיפולי פנים'));
    const t = listingTitle({ name: 'מספרת חיפה', city: 'חיפה', category: 'מספרות ועיצוב שיער' });
    assert.ok(!/חיפה.*חיפה/.test(t), t);
    const long = listingTitle({ name: 'המרכז הבינלאומי לרפואה אסתטית ולכירורגיה פלסטית של פרופסור ישראלי', city: 'תל אביב–יפו', category: 'כירורגיה פלסטית' });
    assert.ok(long.length <= 60, long);
    assert.ok(long.startsWith('המרכז הבינלאומי'), long);
    assert.equal(listingTitle({ name: 'Nail Bar', city: null, category: null }), 'Nail Bar | מחירים, ביקורות ושעות פתיחה');
  });
});

describe('route parameters', async () => {
  const { decodeParam } = await import('../../src/lib/params');
  it('decodes a percent-encoded Hebrew slug and keeps a malformed value as typed', () => {
    assert.equal(decodeParam('%D7%90%D7%A8%D7%99%D7%90%D7%9C-%D7%9E%D7%A1%D7%A4%D7%A8%D7%94'), 'אריאל-מספרה');
    assert.equal(decodeParam('ehud-elbaz-beauty-salon'), 'ehud-elbaz-beauty-salon');
    assert.equal(decodeParam('%E0%A4%A'), '%E0%A4%A');
  });
});

describe('provider text safety', async () => {
  const { cleanText, cutText, cleanDeep } = await import('../../src/lib/import/text');
  it('drops a lone surrogate and control characters, and cuts by code points', () => {
    const emoji = 'מספרה 💇‍♀️ יפה';
    assert.equal(cleanText(emoji), emoji);
    assert.equal(cleanText('abc\uD83Ddef\u0000g'), 'abcdefg');
    const cut = 'שלום 😀 עולם'.slice(0, 6); // ends inside the emoji
    assert.ok(/[\uD800-\uDBFF]$/.test(cut));
    assert.equal(cutText('שלום 😀 עולם', 6), 'שלום 😀');
    assert.equal(cutText('abc', 10), 'abc');
    assert.deepEqual(cleanDeep({ a: 'x\uD83D', b: ['y\u0001', 2, null], c: { d: 'ok' } }), { a: 'x', b: ['y', 2, null], c: { d: 'ok' } });
    const d = new Date();
    assert.equal(cleanDeep({ d }).d, d);
  });
});

describe('chains and franchises', async () => {
  const { chainKeyOf, sameChain } = await import('../../src/lib/import/chain');
  const { chainTotal } = await import('../../src/lib/pricing');
  it('keys a chain by its own website domain and recognises branch names of one chain', () => {
    assert.equal(chainKeyOf({ website: 'https://www.proportsia.co.il/haifa', websiteKind: 'own', siteDomain: 'proportsia.co.il' }), 'proportsia.co.il');
    assert.equal(chainKeyOf({ website: 'https://proportsia.co.il/', websiteKind: 'own', siteDomain: null }), 'proportsia.co.il');
    assert.equal(chainKeyOf({ website: 'https://www.facebook.com/salon', websiteKind: 'social' }), null);
    assert.equal(chainKeyOf({ website: 'https://www.google.com/maps?cid=1', websiteKind: 'google_profile' }), null);
    assert.equal(chainKeyOf({ website: null }), null);
    assert.ok(sameChain('פרופורציה תל אביב', 'פרופורציה חיפה'));
    assert.ok(sameChain('פרופורציה', 'פרופורציה רמת גן'));
    assert.ok(!sameChain('מספרת דנה', 'קליניקת רותי'));
  });
  it('bills every branch and gives 25% off from the fourth', () => {
    assert.deepEqual(chainTotal(1, 149), { total: 149, fullPrice: 1, discounted: 0, discount: 0 });
    assert.deepEqual(chainTotal(3, 149), { total: 447, fullPrice: 3, discounted: 0, discount: 0 });
    const five = chainTotal(5, 149);
    assert.equal(five.fullPrice, 3);
    assert.equal(five.discounted, 2);
    assert.equal(five.discount, 74.5);
    assert.equal(five.total, 447 + 2 * 149 * 0.75);
    assert.equal(chainTotal(0, 149).total, 0);
  });
});

describe('emails on business websites', async () => {
  const { extractEmails, sameDomain, pickEmail } = await import('../../src/lib/import/email');
  const { extractPage } = await import('../../src/lib/import/siteExtract');
  it('treats a mailbox on the same name spelled differently as the business address', () => {
    assert.ok(sameDomain('info@proportzia.co.il', 'https://proportsia.co.il/'));
    assert.ok(sameDomain('office@salon-dana.co.il', 'https://www.salondana.co.il/'));
    assert.ok(!sameDomain('x@gmail.com', 'https://proportsia.co.il/'));
    assert.ok(!sameDomain('studio@pixel-agency.co.il', 'https://salon.co.il/'));
    assert.equal(pickEmail(['info@proportzia.co.il'], 'https://proportsia.co.il/')?.tier, 'own');
  });
  it('reads addresses split across tags, spaced around the @, and written with "at"', () => {
    const html = '<footer><span>info@</span><span>proportzia.co.il</span> · office @ salon.co.il · hello at studio [dot] co [dot] il</footer>';
    const got = extractEmails(html).sort();
    assert.deepEqual(got, ['hello@studio.co.il', 'info@proportzia.co.il', 'office@salon.co.il']);
  });
  it('keeps the contact-block address even when a builder credit sits next to it on another domain', () => {
    const html = `<html><body><footer><h4>פרטי התקשרות</h4><p>*5599</p><p><a href="mailto:info@proportzia.co.il">info@proportzia.co.il</a></p><p>בניית אתרים: סטודיו X</p></footer></body></html>`;
    const f = extractPage(html, 'https://proportsia.co.il/', 'proportsia.co.il');
    assert.deepEqual(f.emails.map(e => e.value), ['info@proportzia.co.il']);
    assert.deepEqual(f.agencyEmails, []);
  });
});

describe('chain websites: branches page and menu', async () => {
  const { extractLocations, pickLocation, citiesIn, BRANCHES_LINK } = await import('../../src/lib/import/locations');
  const { extractPage } = await import('../../src/lib/import/siteExtract');
  const { missingTemplateFields } = await import('../../scripts/import/crawl');
  const branchesHtml = `<html><body>
    <header><nav class="main-menu"><a href="/">ראשי</a><a href="/סניפים/">סניפים</a><a href="/מחירון/">מחירון</a><a href="/about/">אודות</a></nav></header>
    <h1>הסניפים שלנו</h1>
    <h2>אמריקן לייזר תל אביב</h2>
    <p>כתובת: רחוב הברזל 12, תל אביב</p>
    <p>טלפון: 03-6001234</p>
    <p>tlv@care.co.il</p>
    <p>ראשון-חמישי 09:00-20:00</p>
    <h2>אמריקן לייזר חיפה</h2>
    <p>כתובת: שדרות ההסתדרות 5, חיפה</p>
    <p>טלפון: 04-8001234</p>
    <p>haifa@care.co.il</p>
    <h2>אמריקן לייזר באר שבע</h2>
    <p>כתובת: רחוב הנרייטה סולד 8, באר שבע</p>
    <p>טלפון: 08-6401234</p>
    <footer>*5599 · info@care.co.il</footer>
  </body></html>`;
  const f = extractPage(branchesHtml, 'https://www.care.co.il/סניפים/', 'care.co.il');
  it('reads one block per location with its own address, phone, email and hours', () => {
    assert.ok(f.locations.length >= 3, `blocks: ${f.locations.length}`);
    const tlv = f.locations.find(b => b.cities.includes('tel-aviv'));
    assert.ok(tlv);
    assert.equal(tlv.phones[0], '+97236001234');
    assert.deepEqual(tlv.emails, ['tlv@care.co.il']);
    assert.match(tlv.address ?? '', /הברזל 12/);
    assert.ok(tlv.hours && tlv.hours[0].open === '09:00');
    assert.deepEqual(citiesIn('מרכז קריית ים, ליד קניון'), ['kiryat-yam']);
  });
  it('picks the block of the record\'s city, or its name suffix, never the central number', () => {
    const b = pickLocation(f.locations, { citySlug: 'haifa', cityName: 'חיפה', name: 'אמריקן לייזר', address: '' });
    assert.equal(b?.phones[0], '+97248001234');
    const byName = pickLocation(f.locations, { citySlug: null, cityName: null, name: 'אמריקן לייזר- באר שבע', address: '' });
    assert.equal(byName?.phones[0], '+97286401234');
    assert.equal(pickLocation(f.locations, { citySlug: 'eilat', cityName: 'אילת', name: 'אמריקן לייזר', address: '' }), null);
    assert.equal(pickLocation(f.locations.slice(0, 1), { citySlug: 'tel-aviv', cityName: 'תל אביב', name: 'x', address: '' }), null);
  });
  it('collects the site menu and asks the crawler for the branches page while none was read', () => {
    assert.ok(f.menuLinks.some(l => /סניפים/.test(decodeURIComponent(l))));
    assert.ok(f.menuLinks.some(l => /about/.test(l)));
    assert.ok(BRANCHES_LINK.test('/סניפים/') && BRANCHES_LINK.test('/locations') && !BRANCHES_LINK.test('/prices'));
    const home = extractPage('<html><body><nav><a href="/סניפים/">סניפים</a></nav><p>03-6001234 info@care.co.il</p></body></html>', 'https://www.care.co.il/', 'care.co.il');
    assert.ok(missingTemplateFields([home]).includes('locations'));
    assert.ok(!missingTemplateFields([home, f]).includes('locations'));
  });
});
