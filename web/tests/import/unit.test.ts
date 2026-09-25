// Pure tests: no database, no network beyond a loopback server. Run with `npm run test:import`.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { buildSearch, dfsCategoriesFor, googleMapsUrl, isFatalStatus, isTransientStatus, largerGoogleImage, mapItem } from '../../src/lib/import/dataforseo';
import { dfsRunMaxUsd, estimateFor } from '../../src/lib/import/estimate';
import { fieldMask, FieldMaskError, GOOGLE_FEATURES, retentionDays } from '../../src/lib/import/googleFields';
import { isStrong, nameSimilarity, normName, scoreMatch, DUPLICATE_AT } from '../../src/lib/import/match';
import { formatIlPhone, normalizeIlPhone } from '../../src/lib/import/phone';
import { dfsPageMaxUsd, pricing } from '../../src/lib/import/pricing';
import { qualify, type QualifyInput } from '../../src/lib/import/rules';
import { checkUrl, guardedLookup, isPrivateAddress, safeFetch, UnsafeUrlError } from '../../src/lib/import/safeFetch';
import { extractPage, rankEmails } from '../../src/lib/import/siteExtract';
import { imageInfo, usable } from '../../src/lib/import/imageInfo';
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
  it('conflicts go to review, never straight to publish', () => {
    const q = qualify({ ...base, phoneConflict: true, hoursConflict: true });
    assert.equal(q.status, 'needs_review');
    assert.ok(q.reasons.includes('phone_conflict') && q.reasons.includes('hours_conflict'));
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
    assert.deepEqual([by('החלקה אורגנית')?.priceNis, by('החלקה אורגנית')?.priceType], [800, 'from']);
  });
  it('lists known treatments without a price and ignores menus and sentences', () => {
    assert.equal(by('טיפול פנים קלאסי')?.priceNis, null);
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
