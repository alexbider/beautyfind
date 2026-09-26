// Pure tests for the complete-profile enrichment (feature request §13, acceptance points 1 to 8 and 11):
// extraction of team, videos, languages and founding year; price states; social verification; YouTube
// validation against a loopback stand-in; the editorial checks and the deterministic template draft;
// coverage classification; hours with unknown days; the Maps Embed URL. No network, no database.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { PRICE_UNKNOWN, hoursKnown, openState, parseHours, servicePrice } from '../../src/components/profile/format';
import { mapQuery, mapsEmbedUrl } from '../../src/lib/mapsEmbed';
import { coverageOf, MANIFEST, manifestMarkdown, type CoverageInput } from '../../src/lib/import/coverage';
import { BANNED_PHRASES, buildPacket, checkOutput, countWords, packetHash, repairable, templateDraft, WORDS_MIN, type EvidencePacket } from '../../src/lib/import/editorial';
import { establishedFrom, languagesFrom, looksLikeName, teamFrom, videosFrom } from '../../src/lib/import/profileExtract';
import { extractPage } from '../../src/lib/import/siteExtract';
import { handleOf, publishableSocials, verifySocials } from '../../src/lib/import/socials';
import { channelUploads, chooseVideos, isoDuration, validateVideos } from '../../src/lib/import/youtube';

describe('team, videos, languages and founding year from a site', () => {
  const html = `<html><head><title>הצוות</title></head><body><h1>הצוות שלנו</h1>
    <article><h3>ד"ר יעל לוינסון</h3><p>מנהלת רפואית</p><p>רופאת עור עם ניסיון באסתטיקה רפואית, מפקחת על פרוטוקולי ההזרקות בקליניקה.</p></article>
    <article><h3>נועה בן דוד</h3><p>אחות מוסמכת</p><p>אחות מזריקה, מלווה את המטופלות לפני הטיפול ואחריו.</p></article>
    <p>הקליניקה פועלת מאז 2014 בלב תל אביב.</p><p>הצוות דובר עברית, אנגלית ורוסית.</p>
    <iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe><a href="https://youtu.be/lmnopqrstuv">סרטון</a><a href="https://www.youtube.com/@noaclinic">ערוץ</a>
    <p>פורסם ב-2021 על ידי המערכת</p></body></html>`;
  const f = extractPage(html, 'https://noa.co.il/הצוות', 'noa.co.il');
  it('reads name + role cards with the biography under them', () => {
    assert.deepEqual(f.team.map(t => [t.value.name, t.value.role]), [['ד"ר יעל לוינסון', 'מנהלת רפואית'], ['נועה בן דוד', 'אחות מוסמכת']]);
    assert.match(f.team[0].value.bio ?? '', /רופאת עור/);
    assert.ok(f.isTeamPage);
  });
  it('a single signature on a non-team page is not a staff member', () => {
    assert.deepEqual(teamFrom('תודה רבה!\nרונית כהן\nלקוחה מרוצה\n', 'https://x.co.il/'), []);
    assert.ok(!looksLikeName('צור קשר') && !looksLikeName('קוסמטיקאית') && looksLikeName('ד"ר יעל לוינסון'));
  });
  it('finds YouTube ids and channel links, nothing else', () => {
    assert.deepEqual(f.videos.map(v => v.value.id).sort(), ['abcdefghijk', 'lmnopqrstuv']);
    assert.deepEqual(f.channels.map(c => c.value), ['https://www.youtube.com/@noaclinic']);
    assert.deepEqual(videosFrom('<a href="https://vimeo.com/123">v</a>', 'u').videos, []);
  });
  it('languages only from an explicit statement, never the page language', () => {
    assert.deepEqual(f.languages?.value, ['עברית', 'אנגלית', 'רוסית']);
    assert.equal(languagesFrom('שיעורי אנגלית לילדים בשכונה', 'u'), null);
    assert.deepEqual(languagesFrom('We speak English and Russian', 'u')?.value, ['אנגלית', 'רוסית']);
  });
  it('founding year from "since" wording, not from post dates or experience', () => {
    assert.equal(f.establishedYear?.value, 2014);
    assert.equal(establishedFrom('15 שנות ניסיון בתחום', 'u'), null);
    assert.equal(establishedFrom('פורסם ב-2021', 'u'), null);
    assert.equal(establishedFrom('Established in 2009', 'u')?.value, 2009);
  });
  it('before/after images are kept apart from premises photos', () => {
    const g = extractPage('<h1>לפני ואחרי</h1><img src="/ba.jpg" width="900" height="600" alt="מילוי שפתיים"><img src="/room.jpg" width="900" height="600" alt="חדר">', 'https://noa.co.il/gallery', 'noa.co.il');
    assert.deepEqual(g.beforeAfter.map(x => x.value), ['https://noa.co.il/ba.jpg', 'https://noa.co.il/room.jpg']);
    assert.deepEqual(g.photos, []);
    const h = extractPage('<img src="/ba.jpg" width="900" height="600" alt="לפני ואחרי"><img src="/room.jpg" width="900" height="600" alt="חדר טיפולים">', 'https://noa.co.il/', 'noa.co.il');
    assert.deepEqual(h.beforeAfter.map(x => x.value), ['https://noa.co.il/ba.jpg']);
    assert.deepEqual(h.photos.map(x => x.value), ['https://noa.co.il/room.jpg']);
  });
});

describe('price states', () => {
  const f = extractPage('<p>פילינג כימי 400-600 ₪</p><p>הסרת שיער חבילת 6 מפגשים 1,800 ₪</p><p>ייעוץ ראשון ללא עלות</p><ul><li>מזותרפיה</li></ul>', 'https://noa.co.il/מחירון', 'noa.co.il');
  const by = (n: string) => f.services.find(s => s.value.name.startsWith(n))?.value;
  it('reads ranges, packages, published free services and unpriced services as their own types', () => {
    assert.deepEqual([by('פילינג כימי')?.priceType, by('פילינג כימי')?.priceNis, by('פילינג כימי')?.priceMaxNis], ['range', 400, 600]);
    assert.deepEqual([by('הסרת שיער')?.priceType, by('הסרת שיער')?.priceNis, by('הסרת שיער')?.priceNote], ['package', 1800, 'חבילת 6 מפגשים']);
    assert.deepEqual([by('ייעוץ')?.priceType, by('ייעוץ')?.priceNis], ['free', 0]);
    assert.deepEqual([by('מזותרפיה')?.priceType, by('מזותרפיה')?.priceNis], ['on_request', null]);
  });
  it('an unknown price never renders as a zero amount (acceptance 4)', () => {
    assert.deepEqual(servicePrice({ priceType: 'on_request', priceAgorot: null }), { kind: 'unknown' });
    assert.deepEqual(servicePrice({ priceType: 'fixed', priceAgorot: null }), { kind: 'unknown' });
    assert.deepEqual(servicePrice({ priceType: 'free', priceAgorot: 0 }), { kind: 'free' });
    const r = servicePrice({ priceType: 'range', priceAgorot: 40000, priceMaxAgorot: 60000 });
    assert.equal(r.kind === 'amount' ? r.amount : '', '₪400 עד ₪600');
    const pk = servicePrice({ priceType: 'package', priceAgorot: 180000, priceNote: '6 מפגשים' });
    assert.equal(pk.kind === 'amount' ? pk.post : '', ' (6 מפגשים)');
    assert.equal(PRICE_UNKNOWN, 'המחיר לא פורסם');
  });
});

describe('social account verification', () => {
  it('a backlink from the own site verifies; a provider-only same-name account does not', () => {
    const v = verifySocials([{ network: 'instagram', url: 'https://www.instagram.com/noa_clinic/', source: 'website' }, { network: 'facebook', url: 'https://www.facebook.com/noaclinic', source: 'dataforseo' }], 'noa.co.il');
    assert.equal(v.instagram?.via, 'backlink');
    assert.equal(v.facebook?.verified, false);
    assert.deepEqual(Object.keys(publishableSocials(v)), ['instagram']);
  });
  it('a handle equal to the site domain label counts as a second signal', () => {
    const v = verifySocials([{ network: 'tiktok', url: 'https://www.tiktok.com/@noaclinic', source: 'dataforseo' }], 'noaclinic.co.il');
    assert.equal(v.tiktok?.via, 'handle_matches_domain');
    assert.equal(handleOf('https://www.youtube.com/@Noa_Clinic'), 'noa_clinic');
  });
  it('owner entries always win', () => {
    const v = verifySocials([{ network: 'instagram', url: 'https://www.instagram.com/a/', source: 'dataforseo' }, { network: 'instagram', url: 'https://www.instagram.com/b/', source: 'owner' }], null);
    assert.equal(v.instagram?.url, 'https://www.instagram.com/b');
    assert.equal(v.instagram?.via, 'owner');
  });
});

describe('YouTube validation', () => {
  let base = '';
  const srv = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    if (u.pathname === '/oembed') {
      const id = u.searchParams.get('url')?.match(/v=([A-Za-z0-9_-]{11})/)?.[1];
      if (id === 'okvideo0001') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ title: 'סיור', author_name: 'הערוץ', thumbnail_url: 'https://i.ytimg.com/x.jpg' }));
      if (id === 'private0002') return void res.writeHead(401).end();
      return void res.writeHead(404).end();
    }
    if (u.pathname === '/videos') {
      const ids = (u.searchParams.get('id') ?? '').split(',');
      const items = ids.filter(id => id !== 'missing0003').map(id => ({ id, snippet: { title: `t-${id}`, channelId: 'UC1', channelTitle: 'ch', thumbnails: { medium: { url: 'https://i.ytimg.com/m.jpg' } } }, contentDetails: { duration: 'PT2M14S' }, status: { privacyStatus: id === 'private0002' ? 'private' : 'public', embeddable: id !== 'noembed0004' } }));
      return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ items }));
    }
    if (u.pathname === '/channels') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ items: [{ id: 'UC1', contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] }));
    if (u.pathname === '/playlistItems') return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ items: [{ contentDetails: { videoId: 'okvideo0001' } }, { contentDetails: { videoId: 'noembed0004' } }] }));
    res.writeHead(404).end();
  });
  before(async () => {
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>(r => srv.close(() => r())));

  it('without a key, oEmbed tells playable from private and missing (acceptance 5)', async () => {
    const { videos, quotaUsed } = await validateVideos(['okvideo0001', 'private0002', 'missing0003'], { oembedBase: `${base}/oembed`, allowPrivate: true }, 'website', 'https://x.co.il');
    assert.equal(quotaUsed, 0);
    assert.deepEqual(videos.map(v => [v.id, v.status, v.embeddable]), [['okvideo0001', 'ok', true], ['private0002', 'not_embeddable', false], ['missing0003', 'not_found', false]]);
    assert.equal(videos[0].title, 'סיור');
    assert.deepEqual(chooseVideos(videos, 3).map(v => v.id), ['okvideo0001']);
  });
  it('with a key, one videos.list call per 50 ids reads status and embeddability', async () => {
    const q: number[] = [];
    const { videos, quotaUsed } = await validateVideos(['okvideo0001', 'private0002', 'missing0003', 'noembed0004'], { apiKey: 'k', apiBase: base, allowPrivate: true, quota: u => (q.push(u), true) }, 'website', null);
    assert.equal(quotaUsed, 1);
    assert.deepEqual(q, [1]);
    assert.deepEqual(videos.map(v => v.status), ['ok', 'private', 'not_found', 'not_embeddable']);
    assert.equal(videos[0].durationSec, 134);
    assert.equal(isoDuration('PT1H2M3S'), 3723);
  });
  it('channel discovery needs the key, costs two units and respects the cap', async () => {
    assert.deepEqual(await channelUploads('https://www.youtube.com/@x', { oembedBase: base }), { ids: [], channelId: null, quotaUsed: 0 });
    const up = await channelUploads('https://www.youtube.com/@x', { apiKey: 'k', apiBase: base, allowPrivate: true });
    assert.deepEqual(up, { ids: ['okvideo0001', 'noembed0004'], channelId: 'UC1', quotaUsed: 2 });
    const refused = await channelUploads('https://www.youtube.com/@x', { apiKey: 'k', apiBase: base, allowPrivate: true, quota: () => false });
    assert.equal(refused.ids.length, 0);
  });
});

// ---------- editorial ----------

const RICH: EvidencePacket = {
  name: 'קליניקה לדוגמה', city: 'תל אביב', address: 'רחוב הדוגמה 12, תל אביב', categories: ['אסתטיקה רפואית', 'קוסמטיקה וטיפולי פנים'], businessType: 'clinic',
  services: [
    { name: 'בוטוקס אזור אחד', category: 'אסתטיקה רפואית', priceNis: 900, priceType: 'fixed', durationMin: null, isMedical: true },
    { name: 'בוטוקס שלושה אזורים', category: 'אסתטיקה רפואית', priceNis: 2200, priceType: 'fixed', durationMin: null, isMedical: true },
    { name: 'חומר מילוי', category: 'אסתטיקה רפואית', priceNis: 1600, priceType: 'per_ml', durationMin: null, isMedical: true },
    { name: 'ניקוי פנים עמוק', category: 'קוסמטיקה וטיפולי פנים', priceNis: 350, priceType: 'fixed', durationMin: 60, isMedical: false },
    { name: 'הידרו-פייסיאל', category: 'קוסמטיקה וטיפולי פנים', priceNis: 590, priceType: 'fixed', durationMin: 75, isMedical: false },
    { name: 'פילינג כימי', category: 'קוסמטיקה וטיפולי פנים', priceNis: 400, priceMaxNis: 600, priceType: 'range', durationMin: null, isMedical: false },
    { name: 'הסרת שיער בלייזר', category: 'הסרת שיער', priceNis: 1800, priceType: 'package', priceNote: 'חבילת 6 מפגשים', durationMin: null, isMedical: false },
    { name: 'מזותרפיה', category: 'אסתטיקה רפואית', priceNis: null, priceType: 'on_request', durationMin: null, isMedical: true },
    { name: 'הרמת ריסים', category: 'גבות וריסים', priceNis: null, priceType: 'on_request', durationMin: null, isMedical: false },
    { name: 'ייעוץ ראשון', category: null, priceNis: 0, priceType: 'free', durationMin: null, isMedical: false },
  ],
  hours: [
    { open: '09:00', close: '20:00', closed: false }, { open: '09:00', close: '20:00', closed: false }, { open: '09:00', close: '20:00', closed: false }, { open: '09:00', close: '20:00', closed: false },
    { open: '09:00', close: '20:00', closed: false }, { open: '09:00', close: '14:00', closed: false }, { open: '', close: '', closed: true },
  ],
  phone: true, email: true, whatsapp: true, website: 'clinic-demo.co.il', bookingOnline: false, bookingLink: false, socials: ['Instagram', 'YouTube'],
  team: [
    { name: 'ד"ר יעל לוינסון', role: 'מנהלת רפואית', bio: 'רופאת עור, מפקחת על פרוטוקולי ההזרקות והלייזר בקליניקה ומלווה כל מטופלת בייעוץ הראשון.' },
    { name: 'נועה בן דוד', role: 'אחות מוסמכת', bio: 'אחות מזריקה, מלווה את המטופלות לפני הטיפול ואחריו ומדריכה בטיפול הביתי.' },
    { name: 'שירה מזרחי', role: 'קוסמטיקאית פרא-רפואית', bio: 'מתמחה בטיפולי פנים מתקדמים, פילינג כימי והידרו-פייסיאל.' },
  ],
  languages: ['עברית', 'אנגלית', 'רוסית'], establishedYear: 2014, accessible: true, freeParking: true,
  sourceDescription: 'קליניקה לאסתטיקה רפואית וטיפולי פנים בהנהלת רופאה, הפועלת במרכז העיר עם צוות של אחיות מוסמכות וקוסמטיקאיות.',
  sourceFaqs: [{ q: 'האם צריך לקבוע תור?', a: 'כן, בטלפון או בוואטסאפ.' }], rating: { value: 4.8, count: 212 }, photos: 8, videos: 2, claimed: false,
};
const SPARSE: EvidencePacket = { ...RICH, services: [], hours: null, team: [], languages: [], establishedYear: null, accessible: null, freeParking: null, sourceDescription: null, sourceFaqs: [], rating: null, photos: 0, videos: 0, website: null, email: false, whatsapp: false, socials: [] };

describe('editorial checks and the template draft', () => {
  it('rich evidence gives 450 to 550 words and at least five FAQs (acceptance 2)', () => {
    const d = templateDraft(RICH);
    const words = countWords(d.description);
    assert.ok(words >= WORDS_MIN && words <= 620, `words ${words}`);
    assert.ok(d.faqs.length >= 5 && d.faqs.length <= 8);
    assert.equal(d.insufficientEvidence, false);
    assert.equal(d.heading, 'על הקליניקה');
    assert.deepEqual(checkOutput(d, RICH), []);
  });
  it('sparse evidence stays short and flagged instead of padded (acceptance 3)', () => {
    const d = templateDraft(SPARSE);
    assert.ok(countWords(d.description) < WORDS_MIN);
    assert.equal(d.insufficientEvidence, true);
    assert.ok(d.missing.includes('רשימת שירותים') && d.missing.includes('שעות פעילות'));
    assert.ok(d.faqs.length >= 5); // truthful "not published" answers, no invented facts
    assert.ok(d.faqs.every(f => !/מובטח|ללא עלות/.test(f.a)));
    const v = checkOutput(d, SPARSE);
    assert.ok(v.every(x => x.startsWith('short:')), v.join(','));
    assert.deepEqual(repairable(v), []);
  });
  it('catches invented numbers, people, dashes, first person and generic praise', () => {
    const base = templateDraft(RICH);
    const bad = { ...base, description: `${base.description} הקליניקה מובילים בתחום מאז 1999 – ד"ר משה כהן מטפל אצלנו.` };
    const v = checkOutput(bad, RICH);
    assert.ok(v.includes('dash') && v.includes('first_person') && v.includes('number:1999') && v.includes('person:משה כהן') && v.some(x => x.startsWith('phrase:')));
    assert.ok(repairable(v).length > 0);
    assert.ok(BANNED_PHRASES.includes('חוויה בלתי נשכחת'));
  });
  it('refuses a booking claim through the platform when native booking is off', () => {
    const d = templateDraft(RICH);
    const v = checkOutput({ ...d, faqs: [...d.faqs.slice(0, 4), { q: 'איך קובעים?', a: 'אפשר לקבוע תור דרך BeautyFind בלחיצה.', basis: 'x' }] }, RICH);
    assert.ok(v.includes('faq_booking_claim'));
  });
  it('the evidence hash changes only when the packet changes', () => {
    const a = packetHash(RICH);
    assert.equal(a, packetHash({ ...RICH }));
    assert.notEqual(a, packetHash({ ...RICH, phone: false }));
  });
  it('builds the packet from a record without leaking raw contact values', () => {
    const p = buildPacket({
      name: 'X', cityName: 'חיפה', address: 'רחוב 1, חיפה, ישראל', categories: ['nails'], businessType: null, treatments: [{ name: 'מניקור', priceNis: 120, priceType: 'fixed', category: 'nails', isMedical: false, durationMin: null }],
      hours: [], phone: '+97235551234', email: 'a@b.co.il', whatsapp: null, website: 'https://www.x.co.il/', websiteKind: 'own', bookingUrl: null, instagram: null, facebook: null, tiktok: null, youtube: null,
      team: [], languages: [], establishedYear: null, accessible: null, freeParking: null, description: null, faqs: null, googleRating: 4.5, googleReviewCount: 0, photoUrls: [], videos: [],
    });
    assert.equal(p.phone, true);
    assert.equal(p.website, 'x.co.il');
    assert.equal(p.address, 'רחוב 1, חיפה');
    assert.equal(p.hours, null);
    assert.equal(p.rating, null); // zero reviews is no rating
    assert.ok(!JSON.stringify(p).includes('+97235551234') && !JSON.stringify(p).includes('a@b.co.il'));
  });
});

// ---------- coverage, hours, map ----------

const COV: CoverageInput = {
  coverUrl: '/media/1', galleryCount: 5, logoUrl: '/media/2', hoursKnown: true, description: 'x', editorialWords: 500, editorialNeedsMore: false, services: 9, servicesPriced: 6, teamCount: 3, verifiedStaff: 0,
  videosPlayable: 2, faqs: 6, establishedYear: 2014, languages: 3, accessible: true, parking: true, phone: true, email: true, website: true, socialsVerified: 2, socialsUnverified: 0, rating: true, mapConfigured: true, placeId: true,
  conflicts: [], reviewReasons: [], claimed: false,
};

describe('template coverage and readiness (acceptance 1)', () => {
  it('every manifest section has a fallback and a test, and the doc is generated from it', () => {
    assert.ok(MANIFEST.length >= 21);
    assert.ok(MANIFEST.every(m => m.fallback && m.test && m.selector));
    assert.match(manifestMarkdown(), /h-services/);
  });
  it('a full profile is ready; gaps are disclosed; sparse needs the owner; conflicts need review', () => {
    const full = coverageOf(COV);
    assert.equal(full.status, 'ready');
    assert.equal(full.templateCoverage, 100);
    assert.ok(full.rows.every(r => r.state !== 'missing'));
    const gaps = coverageOf({ ...COV, videosPlayable: 0, establishedYear: null, languages: 0 });
    assert.equal(gaps.status, 'ready_with_disclosed_gaps');
    assert.ok(gaps.missing.includes('video'));
    const sparse = coverageOf({ ...COV, coverUrl: null, galleryCount: 0, hoursKnown: false, editorialWords: 120, editorialNeedsMore: true, services: 0, servicesPriced: 0, teamCount: 0, videosPlayable: 0, faqs: 5, establishedYear: null, languages: 0, accessible: null, parking: null });
    assert.equal(sparse.status, 'needs_owner_information');
    assert.equal(sparse.templateCoverage, 100); // every section still renders a truthful state
    assert.ok(sparse.readiness < 60);
    assert.equal(coverageOf({ ...COV, conflicts: ['phone'] }).status, 'needs_review');
    assert.equal(coverageOf({ ...COV, phone: false, email: false }).status, 'needs_review');
  });
});

describe('hours with unknown days', () => {
  const wk = [{ open: '09:00', close: '19:00', closed: false }, { open: '09:00', close: '19:00', closed: false }, { open: '09:00', close: '19:00', closed: false }, { open: '09:00', close: '19:00', closed: false }, { open: '09:00', close: '19:00', closed: false }, { open: '09:00', close: '14:00', closed: false }, { unknown: true }];
  it('an unknown day is neither closed nor open, and no state is claimed for it', () => {
    const h = parseHours(wk)!;
    assert.equal(h[6].unknown, true);
    assert.equal(h[6].closed, false);
    const sat = new Date('2026-09-26T09:00:00+03:00'); // Saturday in Israel
    assert.equal(openState(h, sat), null);
    const sun = new Date('2026-09-27T10:00:00+03:00');
    assert.deepEqual(openState(h, sun), { open: true, label: 'פתוח עד 19:00' });
  });
  it('no hours at all means unknown, not closed', () => {
    assert.equal(parseHours([]), null);
    assert.equal(hoursKnown(parseHours(Array.from({ length: 7 }, () => ({ unknown: true })))), false);
    assert.equal(openState(null, new Date()), null);
  });
});

describe('Google Maps Embed (acceptance 6)', () => {
  it('builds a place-mode URL with the place id, Hebrew and Israel', () => {
    const u = new URL(mapsEmbedUrl('KEY', mapQuery({ googlePlaceId: 'ChIJabc', name: 'X', address: 'רחוב 1', cityName: 'חיפה' })));
    assert.equal(u.origin + u.pathname, 'https://www.google.com/maps/embed/v1/place');
    assert.equal(u.searchParams.get('q'), 'place_id:ChIJabc');
    assert.equal(u.searchParams.get('language'), 'he');
    assert.equal(u.searchParams.get('region'), 'IL');
    assert.equal(u.searchParams.get('key'), 'KEY');
  });
  it('falls back to name and full address without a place id', () => {
    assert.equal(mapQuery({ googlePlaceId: null, name: 'X', address: 'רחוב 1', cityName: 'חיפה' }), 'X, רחוב 1, חיפה');
    assert.equal(mapQuery({ googlePlaceId: null, name: 'X', address: 'רחוב 1, חיפה', cityName: 'חיפה' }), 'X, רחוב 1, חיפה');
  });
});
