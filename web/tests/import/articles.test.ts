// The magazine: the pure HTML rules (sanitizer, analysis, slugs, Jerusalem time) and, with a local
// database, the article service behind the MCP tools and the admin: create, conflict, validation,
// medical review gate, publish, schedule, replace, links, soft delete, the approvals queue and the
// token scope and rate limit of the MCP server.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  analyzeArticleHtml, articleCanonical, articlePath, fileSlug, formatJerusalem, isValidSlug, parseJerusalemTime, sanitizeArticleHtml, slugify, withHeadingIds,
} from '../../src/lib/articleHtml';
import { articleNode, duplicateIds, faqNode, graph, webPageNode } from '../../src/lib/seo/schema';

const URL_OK = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
const skip = URL_OK ? false : 'needs a local DATABASE_URL';

describe('articles: html rules', () => {
  it('keeps the allowed tags, drops scripts and handlers, marks external links and keeps internal ones clean', () => {
    const r = sanitizeArticleHtml('<h1>לא</h1><h2>פתיחה</h2><p onclick="x()" style="color:red">שלום <a href="https://ex.com/a" target="_self">חוץ</a> <a href="/treatments/nails" rel="nofollow" target="_blank">פנים</a> <a href="javascript:alert(1)">רע</a></p><img src="/media/abc/x.webp"><script>alert(1)</script><iframe src="x"></iframe><table><tr><th>א</th><td>1</td></tr></table>');
    assert.ok(!/<h1/.test(r.html) && /<h2 id="לא">לא<\/h2>/.test(r.html), 'an h1 in the body becomes an h2');
    assert.ok(!/onclick|style=|<script|<iframe|javascript:/.test(r.html));
    assert.match(r.html, /<a>רע<\/a>/, 'a javascript: link keeps its text and nothing else');
    assert.match(r.html, /<a href="https:\/\/ex\.com\/a" rel="nofollow noopener noreferrer" target="_blank">חוץ<\/a>/);
    assert.match(r.html, /<a href="\/treatments\/nails">פנים<\/a>/, 'internal links lose rel and target');
    assert.match(r.html, /<img src="\/media\/abc\/x\.webp" alt="" loading="lazy" \/>/);
    assert.match(r.html, /<table><tr><th>א<\/th><td>1<\/td><\/tr><\/table>/);
    assert.deepEqual(r.errors, ['script removed']);
    assert.equal(sanitizeArticleHtml(r.html).html, r.html, 'sanitizing twice changes nothing');
  });

  it('pulls JSON-LD scripts out of the body and reports invalid ones', () => {
    const r = sanitizeArticleHtml('<p>x</p><script type="application/ld+json">{"@type":"Thing","name":"a"}</script><script type="application/ld+json">[{"@type":"A"},{"@type":"B"}]</script><script type="application/ld+json">{bad</script>');
    assert.equal(r.html, '<p>x</p>');
    assert.deepEqual(r.jsonLd.map(n => (n as { '@type': string })['@type']), ['Thing', 'A', 'B']);
    assert.deepEqual(r.errors, ['invalid JSON-LD script removed']);
  });

  it('gives headings stable unique ids and reads words, headings, images, links and open tags', () => {
    assert.equal(withHeadingIds('<h2>שלב א</h2><h2>שלב א</h2><h3 id="k">k</h3>'), '<h2 id="שלב-א">שלב א</h2><h2 id="שלב-א-2">שלב א</h2><h3 id="k">k</h3>');
    const a = analyzeArticleHtml('<h1>כותרת</h1><h2 id="a">שלב</h2><p>אחת שתיים שלוש</p><img src="/media/1" alt="תמונה"><img src="/x.png"><a href="/dan">אזור</a><a href="https://e.com">חוץ</a><p>פתוח<div>עוד');
    assert.equal(a.h1Count, 1);
    assert.equal(a.wordCount, 9);
    assert.equal(a.readingTimeMinutes, 1);
    assert.deepEqual(a.headings, [{ level: 2, id: 'a', text: 'שלב' }]);
    assert.deepEqual(a.images, [{ src: '/media/1', alt: 'תמונה' }, { src: '/x.png', alt: null }]);
    assert.deepEqual(a.links.map(l => [l.internal, l.path]), [[true, '/dan'], [false, null]]);
    assert.deepEqual(a.unclosed, ['p', 'div']);
    assert.deepEqual(analyzeArticleHtml('<p>a</p><ul><li>b</li></ul>').unclosed, []);
  });

  it('slugs: Hebrew or lowercase Latin with single hyphens; file names Latin only', () => {
    assert.equal(slugify('איך לבחור מכון יופי? 2026'), 'איך-לבחור-מכון-יופי-2026');
    assert.equal(slugify('How To Choose a Clinic!'), 'how-to-choose-a-clinic');
    assert.ok(isValidSlug('איך-לבחור') && isValidSlug('botox-prices-2026'));
    assert.ok(!isValidSlug('Hello') && !isValidSlug('a--b') && !isValidSlug('-a') && !isValidSlug('מכון יופי') && !isValidSlug('mixed-עברית'));
    assert.equal(fileSlug('My Photo.JPG', 'x'), 'my-photo');
    assert.equal(fileSlug('תמונה', 'image-1'), 'image-1');
    assert.equal(articlePath('בוטוקס'), '/magazine/בוטוקס');
    assert.equal(articleCanonical('בוטוקס'), 'https://beautyfind.co.il/magazine/%D7%91%D7%95%D7%98%D7%95%D7%A7%D7%A1');
    assert.equal(articleCanonical('botox'), 'https://beautyfind.co.il/magazine/botox');
  });

  it('reads Jerusalem wall time in summer and winter and accepts zoned ISO strings', () => {
    assert.equal(parseJerusalemTime('2026-10-20T09:30')?.toISOString(), '2026-10-20T06:30:00.000Z');
    assert.equal(parseJerusalemTime('2026-01-20T09:30')?.toISOString(), '2026-01-20T07:30:00.000Z');
    assert.equal(parseJerusalemTime('2026-10-20T09:30:00+03:00')?.toISOString(), '2026-10-20T06:30:00.000Z');
    assert.equal(parseJerusalemTime('2026-10-20T06:30:00Z')?.toISOString(), '2026-10-20T06:30:00.000Z');
    assert.equal(parseJerusalemTime('tomorrow'), null);
    assert.equal(formatJerusalem(new Date('2026-10-20T06:30:00Z')), '2026-10-20T09:30:00+03:00');
  });

  it('builds one article graph with the page, the article, the breadcrumb and a FAQ, with no duplicate ids and no second Organization', () => {
    const path = '/magazine/botox';
    const g = graph([
      webPageNode({ path, name: 'בוטוקס', breadcrumb: true, mainEntityId: `https://beautyfind.co.il${path}#article`, datePublished: '2026-10-01T00:00:00.000Z', dateModified: '2026-10-02T00:00:00.000Z' }),
      articleNode({ path, type: 'Article', headline: 'בוטוקס', datePublished: '2026-10-01T00:00:00.000Z', dateModified: '2026-10-02T00:00:00.000Z', author: { name: 'נועה', jobTitle: 'עורכת' }, reviewedBy: { name: 'ד״ר כהן' }, image: { url: '/media/1/x.webp', width: 1600, height: 900 }, wordCount: 900 }),
      faqNode(path, [{ q: 'כמה?', a: 'תלוי' }]),
    ]);
    const nodes = g['@graph'] as Array<Record<string, unknown>>;
    assert.deepEqual(nodes.map(n => n['@type']), ['WebPage', 'Article', 'FAQPage']);
    assert.deepEqual(duplicateIds(nodes), []);
    const art = nodes[1];
    assert.equal(art.inLanguage, 'he-IL');
    assert.deepEqual(art.publisher, { '@id': 'https://beautyfind.co.il/#organization' });
    assert.deepEqual(art.mainEntityOfPage, { '@id': `https://beautyfind.co.il${path}#webpage` });
    assert.equal((art.reviewedBy as { name: string }).name, 'ד״ר כהן');
    assert.equal((art.image as { url: string }).url, 'https://beautyfind.co.il/media/1/x.webp');
    assert.ok(!JSON.stringify(g).includes('"@type":"Organization"'));
  });
});

const LONG = Array.from({ length: 12 }, (_, i) => `<p>פסקה ${i + 1}: טיפולי יופי בישראל משתנים לפי אזור, מטפל ומספר מפגשים, ולכן כדאי להשוות הצעות מחיר לפני שמתחייבים.</p>`).join('');

describe('articles: service and tools', { skip }, () => {
  let db: PrismaClient;
  let svc: typeof import('../../src/lib/server/articles');
  let media: typeof import('../../src/lib/server/articleMedia');
  let mcp: typeof import('../../src/lib/server/mcp');
  let tools: typeof import('../../src/lib/server/mcpTools');
  let actorCtx: typeof import('../../src/lib/server/actorContext');
  let settings: typeof import('../../src/lib/server/platformSettings');
  let aiActions: typeof import('../../src/lib/server/aiActions');
  const made = { users: [] as string[], articles: [] as string[], authors: [] as string[], categories: [] as string[], tags: [] as string[], media: [] as string[], aiActions: [] as string[] };
  let user: { id: string; opsRole: 'ops' };
  let approvalBefore = false;

  before(async () => {
    const { createRequire } = await import('node:module');
    const { join } = await import('node:path');
    const cache = createRequire(join(process.cwd(), 'package.json'))('next/cache') as { revalidatePath: unknown };
    cache.revalidatePath = () => undefined;
    const { PrismaClient } = await import('@prisma/client');
    db = new PrismaClient();
    svc = await import('../../src/lib/server/articles');
    media = await import('../../src/lib/server/articleMedia');
    mcp = await import('../../src/lib/server/mcp');
    tools = await import('../../src/lib/server/mcpTools');
    actorCtx = await import('../../src/lib/server/actorContext');
    settings = await import('../../src/lib/server/platformSettings');
    aiActions = await import('../../src/lib/server/aiActions');
    const u = await db.user.create({ data: { email: `mag-${Date.now()}@example.test`, fullName: 'כותבת', opsRole: 'ops' } });
    made.users.push(u.id);
    user = { id: u.id, opsRole: 'ops' };
    approvalBefore = (await settings.platformSettings()).magazinePublishApproval;
  });
  after(async () => {
    await settings.savePlatformSettings(user.id, { magazinePublishApproval: approvalBefore }).catch(() => undefined);
    await db.aiAction.deleteMany({ where: { id: { in: made.aiActions } } });
    await db.article.deleteMany({ where: { id: { in: made.articles } } });
    await db.author.deleteMany({ where: { id: { in: made.authors } } });
    await db.articleCategory.deleteMany({ where: { id: { in: made.categories } } });
    await db.articleTag.deleteMany({ where: { id: { in: made.tags } } });
    const files = await db.mediaFile.findMany({ where: { id: { in: made.media } } });
    const { storage } = await import('../../src/lib/vendors/storage');
    for (const f of files) await storage().del(f.key).catch(() => undefined);
    await db.mediaFile.deleteMany({ where: { id: { in: made.media } } });
    await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: made.users } }, { subjectId: { in: [...made.articles, ...made.authors, ...made.media] } }] } });
    await db.user.deleteMany({ where: { id: { in: made.users } } });
    await db.$disconnect();
  });

  const track = <T extends { ok: boolean }>(r: T, bucket: keyof typeof made, pick: (r: T) => string | undefined) => { const id = r.ok ? pick(r) : undefined; if (id) made[bucket].push(id); return r; };
  const stamp = () => Date.now().toString(36);

  it('authors, categories, tags and an uploaded image', async () => {
    const author = track(await svc.upsertAuthor(user, { name: `נועה לוי ${stamp()}`, title: 'עורכת תוכן' }), 'authors', r => (r as { author: { id: string } }).author.id);
    assert.ok(author.ok, JSON.stringify(author));
    const bare = track(await svc.upsertAuthor(user, { name: `קורל קרדי ${stamp()}` }), 'authors', r => (r as { author: { id: string } }).author.id);
    assert.ok(bare.ok && (bare as { author: { title: string | null; bio: string | null } }).author.title === null && (bare as { author: { bio: string | null } }).author.bio === null, 'role and bio stay empty when not given');
    assert.ok(!('isMedicalReviewer' in (bare as { author: object }).author), 'no reviewer fields on the author view');
    const dup = await svc.upsertAuthor(user, { name: (author as { author: { name: string } }).author.name });
    assert.ok(!dup.ok && dup.code === 'conflict', 'the same slug twice is a conflict');

    const cat = track(await svc.upsertCategory(user, { name: `מדריכים ${stamp()}`, parentPagePath: '/treatments/nails' }), 'categories', r => (r as { category: { id: string } }).category.id);
    assert.ok(cat.ok && (cat as { category: { url: string } }).category.url.startsWith('/magazine/category/'), JSON.stringify(cat));
    assert.equal((cat as { category: { parentPagePath: string } }).category.parentPagePath, '/treatments/nails');
    const badParent = await svc.upsertCategory(user, { name: `שגוי ${stamp()}`, parentPagePath: '/treatments/nope' });
    assert.ok(!badParent.ok && (badParent.fields as Record<string, string> | undefined)?.parentPagePath, 'a parent page must exist');
    const tag = track(await svc.createTag(user, { name: `בוטוקס ${stamp()}` }), 'tags', r => (r as { tag: { id: string } }).tag.id);
    assert.ok(tag.ok && tag.created);
    const again = await svc.createTag(user, { name: (tag as { tag: { name: string } }).tag.name });
    assert.ok(again.ok && !again.created, 'an existing tag is returned, not duplicated');

    const sharp = (await import('sharp')).default;
    const png = await sharp({ create: { width: 640, height: 400, channels: 3, background: '#c86' } }).png().toBuffer();
    const bad = await media.uploadArticleImage(user, { base64: png.toString('base64'), alt: 'no hebrew here' });
    assert.ok(!bad.ok && bad.fields?.alt, 'alt must be Hebrew');
    const notImage = await media.uploadArticleImage(user, { base64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'.padEnd(64)).toString('base64'), alt: 'תמונה של קליניקה' });
    assert.ok(!notImage.ok && /not a JPEG/.test(notImage.error));
    const up = track(await media.uploadArticleImage(user, { base64: `data:image/png;base64,${png.toString('base64')}`, alt: 'חדר טיפולים בקליניקה', title: 'Treatment Room', caption: 'חדר טיפולים' }), 'media', r => (r as { media: { id: string } }).media.id);
    assert.ok(up.ok, JSON.stringify(up));
    const m = (up as { media: { url: string; width: number; height: number; mime: string; filename: string }; converted: boolean }).media;
    assert.equal(m.width, 640);
    assert.equal(m.height, 400);
    assert.equal(m.mime, 'image/webp');
    assert.match(m.filename, /^treatment-room(-\d+)?$/);
    assert.match(m.url, /^\/media\/[0-9a-f-]{36}\/treatment-room(-\d+)?\.webp$/);
    const listed = await media.listMedia({ q: 'חדר' });
    assert.ok(listed.items.some(x => x.url === m.url));
    const upd = await media.updateMedia(user, m.url.split('/')[2], { alt: 'חדר טיפולים מעודכן' });
    assert.ok(upd.ok && upd.media.alt === 'חדר טיפולים מעודכן');
  });

  it('create, conflict, sanitizer, validation, publish and the audit trail; no reviewer gate', async () => {
    const author = (await svc.listAuthors()).find(a => made.authors.includes(a.id))!;
    const category = (await svc.listCategories()).find(c => made.categories.includes(c.id) && c.parentPagePath)!;
    const image = (await media.listMedia()).items.find(x => made.media.includes(x.id))!;
    const title = `איך לבחור קליניקה לבוטוקס ${stamp()}`;
    const body = `${LONG}<h2>טבלת מחירים</h2><table><thead><tr><th>טיפול</th><th>טווח</th></tr></thead><tbody><tr><td>בוטוקס</td><td dir="ltr">900–1,800 ₪</td></tr></tbody></table><p>עוד על <a href="/treatments/medical-aesthetics">אסתטיקה רפואית</a> ועל <a href="https://www.health.gov.il/">משרד הבריאות</a>.</p><img src="${image.url}" alt="חדר טיפולים"><script type="application/ld+json">{"@type":"Thing","name":"x"}</script>`;
    const created = track(await svc.createArticle(user, { title, bodyHtml: body, excerpt: 'מה לבדוק לפני שבוחרים.', summary: ['בודקים רישיון', 'משווים מחירים'], faq: [{ q: 'כמה עולה בוטוקס?', a: 'בין 900 ל־1,800 שקלים לאזור.' }], authorId: author.id, categoryId: category.id, featuredImageId: image.id, focusKeyword: 'בוטוקס' }), 'articles', r => (r as { article: { id: string } }).article.id);
    assert.ok(created.ok, JSON.stringify(created));
    const a = (created as { article: typeof created extends { article: infer A } ? A : never; canonicalUrl: string }).article as ReturnType<typeof svc.articleView>;
    assert.equal(a.slug, slugify(title));
    assert.equal(a.status, 'draft');
    assert.equal(a.parentPagePath, '/treatments/nails', 'the parent page defaults from the category');
    assert.ok(!('medicalReview' in a), 'no medical review block on the article view');
    assert.equal((created as { canonicalUrl: string }).canonicalUrl, articleCanonical(a.slug));
    assert.match(a.bodyHtml, /rel="nofollow noopener noreferrer" target="_blank">משרד הבריאות/);
    assert.ok(!a.bodyHtml.includes('<script'));
    assert.deepEqual(a.jsonLd, [{ '@type': 'Thing', name: 'x' }], 'JSON-LD from the body is stored apart');
    assert.ok(a.wordCount > 50 && a.readingTimeMinutes >= 1);
    assert.ok((await db.auditLog.findFirst({ where: { actorId: user.id, action: 'article_create', subjectId: a.id } })));

    const conflict = await svc.createArticle(user, { title, bodyHtml: '<p>x</p>' });
    assert.ok(!conflict.ok && conflict.code === 'conflict');
    const badSlug = await svc.createArticle(user, { title: 'x y', slug: 'Bad Slug!' });
    assert.ok(!badSlug.ok && badSlug.fields?.slug);

    const v = await svc.validateArticle(a.id);
    assert.ok(v.ok && v.publishable, JSON.stringify(v));
    assert.ok(v.ok && !JSON.stringify(v.issues).includes('medical'), 'nothing about medical review');
    const ignored = await svc.updateArticle(user, a.id, { medicalReview: { required: true, reviewerId: author.id } } as never);
    assert.ok(ignored.ok && !('medicalReview' in ignored.article), 'medicalReview is ignored: not a known field any more');
    assert.equal((await db.article.findUnique({ where: { id: a.id } }))!.reviewRequired, false, 'the unused column is not written');
    const broken = await svc.validateArticle(a.id, { bodyHtml: `${LONG}<p><a href="/magazine/does-not-exist">x</a> <img src="/media/x"></p>` });
    assert.ok(broken.ok && !broken.publishable);
    assert.deepEqual(broken.ok ? broken.issues.filter(i => i.severity === 'error').map(i => i.code).sort() : [], ['broken_internal_link', 'missing_alt']);

    const stale = await svc.updateArticle(user, a.id, { excerpt: 'x' }, new Date(0).toISOString());
    assert.ok(!stale.ok && stale.code === 'stale');
    // A stale reviewRequired flag in the database (from before the gate was removed) changes nothing.
    await db.article.update({ where: { id: a.id }, data: { reviewRequired: true } });
    const published = await svc.publishArticle(user, a.id);
    assert.ok(published.ok && !('queued' in published), JSON.stringify(published));
    const row = await db.article.findUnique({ where: { id: a.id } });
    assert.equal(row!.status, 'published');
    assert.ok(row!.publishedAt);
    assert.ok(published.ok && published.revalidated.includes('/treatments/nails') && published.revalidated.includes(`/magazine/category/${category.slug}`), 'the parent page and the category page are refreshed');
    assert.ok(await db.auditLog.findFirst({ where: { actorId: user.id, action: 'article_publish', subjectId: a.id } }));
    const again = await svc.publishArticle(user, a.id);
    assert.ok(again.ok && 'warnings' in again && again.warnings.includes('already published'));
  });

  it('replace_in_article, links in both directions, scheduling, unpublish and soft delete', async () => {
    const first = await db.article.findFirst({ where: { id: { in: made.articles }, status: 'published' } });
    assert.ok(first);
    const author = (await svc.listAuthors()).find(a => made.authors.includes(a.id))!;
    const second = track(await svc.createArticle(user, { title: `שאלות לפני ייעוץ ${stamp()}`, slug: `consult-questions-${stamp()}`, bodyHtml: `${LONG}<p>קראו גם על בחירת קליניקה.</p>`, authorId: author.id }), 'articles', r => (r as { article: { id: string } }).article.id);
    assert.ok(second.ok);
    const b = (second as { article: ReturnType<typeof svc.articleView> }).article;

    const missing = await svc.replaceInArticle(user, b.id, 'לא קיים', 'x');
    assert.ok(!missing.ok && missing.code === 'not_found');
    const ambiguous = await svc.replaceInArticle(user, b.id, 'פסקה', 'x');
    assert.ok(!ambiguous.ok && ambiguous.code === 'ambiguous');
    const linked = await svc.replaceInArticle(user, b.id, 'בחירת קליניקה', `<a href="${articlePath(first!.slug)}">בחירת קליניקה</a>`);
    assert.ok(linked.ok && linked.replaced === 1, JSON.stringify(linked));
    assert.match(linked.ok ? linked.article.bodyHtml : '', new RegExp(`<a href="${articlePath(first!.slug).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">בחירת קליניקה</a>`));

    const links = await svc.articleLinks(first!.id);
    assert.ok(links.ok);
    if (links.ok) {
      assert.ok(links.outbound.internal.some(l => l.path === '/treatments/medical-aesthetics' && l.exists === true));
      assert.ok(links.outbound.external.some(l => /health\.gov\.il/.test(l.href) && /nofollow/.test(l.rel ?? '')));
      const inbound = links.inbound.find(i => i.id === b.id);
      assert.ok(inbound && inbound.live === false, 'a draft that links here is inbound but not live');
    }
    const bLinks = await svc.articleLinks(b.id);
    assert.ok(bLinks.ok && bLinks.outbound.internal.some(l => l.path === articlePath(first!.slug) && l.exists === true));

    const past = await svc.scheduleArticle(user, b.id, '2020-01-01T10:00');
    assert.ok(!past.ok && /future/.test(past.error));
    const bogus = await svc.scheduleArticle(user, b.id, 'next week');
    assert.ok(!bogus.ok);
    const sched = await svc.scheduleArticle(user, b.id, '2030-06-01T09:30');
    assert.ok(sched.ok && sched.article.status === 'scheduled' && sched.article.scheduledFor?.toISOString() === '2030-06-01T06:30:00.000Z', JSON.stringify(sched));
    await db.article.update({ where: { id: b.id }, data: { scheduledFor: new Date(Date.now() - 60_000) } });
    assert.ok((await svc.publishDueArticles()) >= 1);
    const due = await db.article.findUnique({ where: { id: b.id } });
    assert.equal(due!.status, 'published');
    assert.ok(due!.publishedAt && due!.publishedAt.getTime() < Date.now());
    assert.ok((await svc.articleLinks(first!.id)).ok && ((await svc.articleLinks(first!.id)) as { inbound: Array<{ id: string; live: boolean }> }).inbound.find(i => i.id === b.id)?.live === true);

    const down = await svc.unpublishArticle(user, b.id, 'בדיקה');
    assert.ok(down.ok && down.article.status === 'unpublished');
    const del = await svc.deleteArticle(user, b.id);
    assert.ok(del.ok);
    assert.equal(await svc.findArticle(b.id), null);
    assert.ok(await svc.findArticle(b.id, { includeDeleted: true }));
    const listed = await svc.listArticles({ status: 'all' });
    assert.ok(!listed.items.some(i => i.id === b.id));
    assert.ok((await svc.listArticles({ status: 'all', includeDeleted: true })).items.some(i => i.id === b.id));
  });

  it('with the approvals setting on, publish files a proposal and the approval publishes', async () => {
    const author = (await svc.listAuthors()).find(a => made.authors.includes(a.id))!;
    const c = track(await svc.createArticle(user, { title: `מחירי טיפולי פנים ${stamp()}`, bodyHtml: LONG, authorId: author.id }), 'articles', r => (r as { article: { id: string } }).article.id);
    assert.ok(c.ok);
    const id = (c as { article: { id: string } }).article.id;
    await settings.savePlatformSettings(user.id, { magazinePublishApproval: true });
    try {
      const queued = await svc.publishArticle(user, id, { source: 'mcp:claude' });
      assert.ok(queued.ok && 'queued' in queued && queued.ref.startsWith('Q-'), JSON.stringify(queued));
      assert.equal((await db.article.findUnique({ where: { id } }))!.status, 'draft');
      const proposal = await db.aiAction.findFirst({ where: { ref: (queued as { ref: string }).ref } });
      assert.ok(proposal && proposal.action === 'publish_article' && proposal.subjectType === 'article' && proposal.subjectId === id);
      made.aiActions.push(proposal!.id);
      const decided = await aiActions.decideAiAction(user, proposal!.id, 'approve');
      assert.ok(decided.ok, JSON.stringify(decided));
      assert.equal((await db.article.findUnique({ where: { id } }))!.status, 'published');
      assert.equal((await db.aiAction.findUnique({ where: { id: proposal!.id } }))!.status, 'executed');
    } finally {
      await settings.savePlatformSettings(user.id, { magazinePublishApproval: approvalBefore });
    }
  });

  it('the MCP tools act as the token owner, a magazine scope narrows the catalog, and the rate limit holds', async () => {
    const create = tools.MCP_TOOLS.find(t => t.name === 'create_article')!;
    const ctx = { proposals: [], source: 'mcp:claude', actor: user };
    const author = (await svc.listAuthors()).find(a => made.authors.includes(a.id))!;
    const r = (await actorCtx.withActor({ id: user.id, opsRole: 'ops' } as never, () => create.run({ title: `דרך ה־MCP ${stamp()}`, bodyHtml: LONG, authorId: author.id }, ctx))) as { ok: boolean; article?: { id: string; slug: string }; canonicalUrl?: string };
    assert.ok(r.ok, JSON.stringify(r));
    made.articles.push(r.article!.id);
    assert.equal(r.canonicalUrl, articleCanonical(r.article!.slug));
    // Outside a request and without the actor context there is no staff member: the action refuses (or, with no request store at all, throws before it can).
    let refused = false;
    try { refused = ((await create.run({ title: 'בלי משתמש' }, ctx)) as { ok: boolean }).ok === false; } catch { refused = true; }
    assert.ok(refused, 'no actor, no write');
    const get = tools.MCP_TOOLS.find(t => t.name === 'get_article')!;
    const got = (await actorCtx.withActor({ id: user.id, opsRole: 'ops' } as never, () => get.run({ article: r.article!.slug }, ctx))) as { ok: boolean; article: { id: string } };
    assert.ok(got.ok && got.article.id === r.article!.id);
    const pages = (await tools.MCP_TOOLS.find(t => t.name === 'list_pages')!.run({}, ctx)) as { magazine: { articleUrlPattern: string } };
    assert.equal(pages.magazine.articleUrlPattern, '/magazine/{slug}');
    const site = (await tools.MCP_TOOLS.find(t => t.name === 'get_site_settings')!.run({}, ctx)) as { locale: string; timezone: string; organizationId: string };
    assert.deepEqual([site.locale, site.timezone, site.organizationId], ['he-IL', 'Asia/Jerusalem', 'https://beautyfind.co.il/#organization']);

    const magazine = tools.MCP_TOOLS.filter(t => t.area === 'magazine');
    assert.ok(magazine.length >= 23, `expected the article tool set, got ${magazine.length}`);
    assert.ok(!tools.MCP_TOOLS.some(t => t.name === 'list_medical_reviewers'), 'the reviewer tool is gone');
    assert.ok(!JSON.stringify(tools.MCP_TOOLS.map(t => t.description)).includes('סקירה רפואית'), 'no tool description mentions medical review');
    for (const n of ['list_authors', 'get_author', 'upsert_author', 'list_categories', 'upsert_category', 'list_tags', 'create_tag', 'upload_media', 'update_media', 'list_media', 'list_articles', 'get_article', 'create_article', 'update_article', 'publish_article', 'unpublish_article', 'schedule_article', 'delete_article', 'replace_in_article', 'get_article_links', 'validate_article', 'get_sitemap_urls', 'get_site_settings']) assert.ok(magazine.some(t => t.name === n), n);
    const byName = (n: string) => tools.MCP_TOOLS.find(t => t.name === n)!;
    assert.ok(mcp.scopeAllows('magazine', byName('publish_article')) && mcp.scopeAllows('magazine', byName('list_branches')) && mcp.scopeAllows('magazine', byName('search_businesses')) && mcp.scopeAllows('magazine', byName('revalidate_pages')));
    assert.ok(!mcp.scopeAllows('magazine', byName('get_business')) && !mcp.scopeAllows('magazine', byName('billing_overview')) && !mcp.scopeAllows('magazine', byName('list_clients')));
    assert.ok(mcp.scopeAllows(null, byName('get_business')));

    const t0 = Date.now();
    const key = `test-${stamp()}`;
    for (let i = 0; i < mcp.RATE_LIMIT.writes; i++) assert.ok(mcp.rateCheck(key, true, t0).ok, `write ${i + 1} allowed`);
    const over = mcp.rateCheck(key, true, t0);
    assert.ok(!over.ok && over.retryAfterSec > 0, 'one write over the limit is refused');
    assert.ok(mcp.rateCheck(key, false, t0).ok, 'reads still pass under the call limit');
    assert.ok(mcp.rateCheck(key, true, t0 + mcp.RATE_LIMIT.windowMs).ok, 'the next window starts clean');
  });
});
