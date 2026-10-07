import 'server-only';
import type { Article, ArticleCategory, ArticleStatus, ArticleTag, Author, MediaFile, Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { CATEGORIES, CITIES, REGIONS, cityHref, cityPageHref } from '@/lib/catalog';
import { analyzeArticleHtml, articleCanonical, articlePath, htmlToText, isValidSlug, parseJerusalemTime, sanitizeArticleHtml, slugify } from '@/lib/articleHtml';
import { db } from './db';
import { mediaUrl } from './articleMedia';
import { platformSettings } from './platformSettings';
import { PUBLIC_WHERE } from './public';
import { sitePages } from './seo';

// The magazine behind /magazine/<slug>: one service for the admin screens and the MCP tools, so a
// write from either goes through the same validation, the same sanitizer and the same audit rows.
// Callers pass the acting staff member (the server actions check the area level first). Articles are
// never hard-deleted: delete sets deletedAt and takes the page down.

export type Actor = { id: string; opsRole: string | null };
type Fail = { ok: false; error: string; fields?: Record<string, string>; [k: string]: unknown };

const uuid = z.string().uuid();
const nullableUuid = uuid.nullable();
const path = z.string().trim().regex(/^\/[^\s]*$/u, 'a site path starting with /').max(200);

export const FaqSchema = z.array(z.object({ q: z.string().trim().min(3).max(300), a: z.string().trim().min(3).max(2000) })).max(20);
// The medical review columns (reviewRequired, reviewerId, reviewedAt, reviewStatus) stay in the database but
// are no longer read, written or checked: the magazine has no reviewer gate. The disclaimer on every article
// page is the general-information notice.
const ROBOTS = /^(index|noindex),\s?(follow|nofollow)$/;

/** Every field a create or a patch may carry. Create requires a title; everything else has a default. */
export const ArticleFieldsSchema = z.object({
  slug: z.string().trim().min(1).max(120),
  title: z.string().trim().min(2).max(200),
  bodyHtml: z.string().max(400_000),
  excerpt: z.string().trim().max(500).nullable(),
  summary: z.array(z.string().trim().min(1).max(240)).max(10),
  faq: FaqSchema,
  authorId: nullableUuid,
  categoryId: nullableUuid,
  tagIds: z.array(uuid).max(20),
  featuredImageId: nullableUuid,
  parentPagePath: path.nullable(),
  relatedArticleIds: z.array(uuid).max(10),
  internalNotes: z.string().max(5000).nullable(),
  seoTitle: z.string().trim().max(120).nullable(),
  metaDescription: z.string().trim().max(320).nullable(),
  focusKeyword: z.string().trim().max(80).nullable(),
  canonicalUrl: z.string().trim().url().max(500).nullable(),
  robots: z.string().trim().regex(ROBOTS, 'index|noindex,follow|nofollow'),
  ogTitle: z.string().trim().max(120).nullable(),
  ogDescription: z.string().trim().max(320).nullable(),
  ogImageId: nullableUuid,
  twitterTitle: z.string().trim().max(120).nullable(),
  twitterDescription: z.string().trim().max(320).nullable(),
  jsonLd: z.array(z.record(z.string(), z.unknown())).max(10).describe('extra JSON-LD nodes for the page graph'),
});
export const ArticlePatchSchema = ArticleFieldsSchema.partial();
export const ArticleCreateSchema = ArticleFieldsSchema.partial().extend({ title: ArticleFieldsSchema.shape.title });
export type ArticlePatch = z.infer<typeof ArticlePatchSchema>;

type Row = Article & { author: Author | null; category: ArticleCategory | null; tags: ArticleTag[]; featuredImage: MediaFile | null };
const INCLUDE = { author: true, category: true, tags: true, featuredImage: true } as const;

const fieldErrors = (e: z.ZodError): Record<string, string> => Object.fromEntries(e.issues.map(i => [i.path.join('.') || '_', i.message]));
const audit = (actorId: string | null, action: string, subjectType: string, subjectId: string, meta: object) =>
  db.auditLog.create({ data: { actorId, action, subjectType, subjectId, meta: meta as Prisma.InputJsonValue } });

export const personView = (a: Author | null) => (a ? { id: a.id, slug: a.slug, name: a.name, title: a.title } : null);
export const imageView = (m: MediaFile | null) => (m ? { id: m.id, url: mediaUrl(m), alt: m.alt, title: m.title, caption: m.caption, width: m.width, height: m.height } : null);

/** The article as the tools and the admin see it. internalNotes is included: callers are staff. */
export function articleView(r: Row) {
  return {
    id: r.id, slug: r.slug, path: articlePath(r.slug), canonicalUrl: r.canonicalUrl ?? articleCanonical(r.slug), permalink: articleCanonical(r.slug),
    title: r.title, status: r.status, publishedAt: r.publishedAt, updatedAt: r.updatedAt, scheduledFor: r.scheduledFor, createdAt: r.createdAt, deletedAt: r.deletedAt,
    excerpt: r.excerpt, summary: r.summary, faq: r.faq as Array<{ q: string; a: string }>, bodyHtml: r.bodyHtml,
    author: personView(r.author), category: r.category ? { id: r.category.id, slug: r.category.slug, name: r.category.name, url: categoryUrl(r.category.slug), parentPagePath: r.category.parentPagePath } : null, tags: r.tags.map(t => ({ id: t.id, slug: t.slug, name: t.name })),
    featuredImage: imageView(r.featuredImage), parentPagePath: r.parentPagePath, relatedArticleIds: r.relatedArticleIds,
    readingTimeMinutes: r.readingTimeMinutes, wordCount: r.wordCount, internalNotes: r.internalNotes,
    seo: { seoTitle: r.seoTitle, metaDescription: r.metaDescription, focusKeyword: r.focusKeyword, canonicalUrl: r.canonicalUrl, robots: r.robots, ogTitle: r.ogTitle, ogDescription: r.ogDescription, ogImageId: r.ogImageId, twitterTitle: r.twitterTitle, twitterDescription: r.twitterDescription },
    jsonLd: r.jsonLdExtra as unknown[],
  };
}
export type ArticleView = ReturnType<typeof articleView>;

const summaryView = (r: Pick<Row, 'id' | 'title' | 'slug' | 'status' | 'publishedAt' | 'updatedAt' | 'scheduledFor' | 'wordCount' | 'parentPagePath' | 'focusKeyword' | 'canonicalUrl' | 'authorId' | 'categoryId'>) => ({
  id: r.id, title: r.title, slug: r.slug, path: articlePath(r.slug), canonicalUrl: r.canonicalUrl ?? articleCanonical(r.slug), status: r.status,
  publishedAt: r.publishedAt, updatedAt: r.updatedAt, scheduledFor: r.scheduledFor, wordCount: r.wordCount, parentPagePath: r.parentPagePath, focusKeyword: r.focusKeyword, authorId: r.authorId, categoryId: r.categoryId,
});

export const findArticle = (idOrSlug: string, opts: { includeDeleted?: boolean } = {}) =>
  db.article.findFirst({ where: { ...(uuid.safeParse(idOrSlug).success ? { id: idOrSlug } : { slug: idOrSlug }), ...(opts.includeDeleted ? {} : { deletedAt: null }) }, include: INCLUDE });

// ---------- listing ----------

export interface ArticleListFilter {
  status?: ArticleStatus | 'all';
  category?: string; // id or slug
  author?: string; // id or slug
  search?: string;
  from?: string;
  to?: string;
  includeDeleted?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listArticles(f: ArticleListFilter = {}) {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, f.pageSize ?? 25));
  const where: Prisma.ArticleWhereInput = {
    ...(f.includeDeleted ? {} : { deletedAt: null }),
    ...(f.status && f.status !== 'all' ? { status: f.status } : {}),
    ...(f.category ? (uuid.safeParse(f.category).success ? { categoryId: f.category } : { category: { slug: f.category } }) : {}),
    ...(f.author ? (uuid.safeParse(f.author).success ? { authorId: f.author } : { author: { slug: f.author } }) : {}),
    ...(f.search ? { OR: [{ title: { contains: f.search, mode: 'insensitive' } }, { slug: { contains: f.search, mode: 'insensitive' } }, { excerpt: { contains: f.search, mode: 'insensitive' } }, { focusKeyword: { contains: f.search, mode: 'insensitive' } }] } : {}),
    ...(f.from || f.to ? { updatedAt: { ...(f.from ? { gte: new Date(f.from) } : {}), ...(f.to ? { lte: new Date(f.to) } : {}) } } : {}),
  };
  const [total, rows] = await Promise.all([
    db.article.count({ where }),
    db.article.findMany({ where, orderBy: [{ updatedAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, title: true, slug: true, status: true, publishedAt: true, updatedAt: true, scheduledFor: true, wordCount: true, parentPagePath: true, focusKeyword: true, canonicalUrl: true, authorId: true, categoryId: true } }),
  ]);
  return { total, page, pageSize, items: rows.map(summaryView) };
}

/** Published articles for the public pages, newest first. Scheduled ones whose time has come are published first. */
export async function publishedArticles(opts: { category?: string; take?: number } = {}) {
  await publishDueArticles().catch(() => 0);
  return db.article.findMany({ where: { deletedAt: null, status: 'published', ...(opts.category ? { category: { slug: opts.category } } : {}) }, orderBy: { publishedAt: 'desc' }, take: opts.take ?? 200, include: INCLUDE });
}

// ---------- references and validation ----------

async function checkReferences(p: ArticlePatch, selfId: string | null): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  const [author, category, tags, image, og, related] = await Promise.all([
    p.authorId ? db.author.findUnique({ where: { id: p.authorId }, select: { id: true } }) : null,
    p.categoryId ? db.articleCategory.findUnique({ where: { id: p.categoryId }, select: { id: true } }) : null,
    p.tagIds?.length ? db.articleTag.findMany({ where: { id: { in: p.tagIds } }, select: { id: true } }) : [],
    p.featuredImageId ? db.mediaFile.findUnique({ where: { id: p.featuredImageId }, select: { id: true, isPrivate: true, alt: true } }) : null,
    p.ogImageId ? db.mediaFile.findUnique({ where: { id: p.ogImageId }, select: { id: true, isPrivate: true } }) : null,
    p.relatedArticleIds?.length ? db.article.findMany({ where: { id: { in: p.relatedArticleIds }, deletedAt: null }, select: { id: true } }) : [],
  ]);
  if (p.authorId && !author) errors.authorId = 'author not found';
  if (p.categoryId && !category) errors.categoryId = 'category not found';
  if (p.tagIds?.length && tags.length !== new Set(p.tagIds).size) errors.tagIds = 'unknown tag id';
  if (p.featuredImageId && (!image || image.isPrivate)) errors.featuredImageId = 'image not found';
  if (p.ogImageId && (!og || og.isPrivate)) errors.ogImageId = 'image not found';
  if (p.relatedArticleIds?.length) {
    if (related.length !== new Set(p.relatedArticleIds).size) errors.relatedArticleIds = 'unknown article id';
    if (selfId && p.relatedArticleIds.includes(selfId)) errors.relatedArticleIds = 'an article cannot relate to itself';
  }
  return errors;
}

export interface Issue { code: string; severity: 'error' | 'warning'; message: string; detail?: string }

const STATIC_PATHS = new Set<string>([
  ...sitePages().map(p => p.path), '/magazine', '/search', '/more', '/regions', '/treatments',
  ...CITIES.map(c => cityPageHref(c)),
  ...CITIES.flatMap(c => CATEGORIES.map(cat => `${cityHref(c)}/${cat.slug}`)),
]);
const REGION_SLUGS = new Set<string>(REGIONS.map(r => r.slug));

/** Whether an internal path exists: a fixed page, a region, city or category page, an article, or a live listing. */
export async function internalPathExists(p: string): Promise<boolean> {
  const clean = p.replace(/\/+$/, '') || '/';
  if (STATIC_PATHS.has(clean)) return true;
  if (clean.startsWith('/magazine/')) {
    const slug = clean.slice('/magazine/'.length);
    return !!(await db.article.findFirst({ where: { slug, deletedAt: null }, select: { id: true } }));
  }
  const seg = clean.slice(1).split('/');
  if (seg.length === 3 && REGION_SLUGS.has(seg[0])) {
    return !!(await db.branch.findFirst({ where: { slug: seg[2], regionSlug: seg[0] as never, ...PUBLIC_WHERE }, select: { id: true } }));
  }
  return false;
}

/** Rules a publish must pass (errors) and things worth fixing (warnings). Pure apart from the link checks. */
export async function validateArticleRow(r: Row, opts: { checkLinks?: boolean } = {}): Promise<Issue[]> {
  const issues: Issue[] = [];
  const err = (code: string, message: string, detail?: string) => issues.push({ code, severity: 'error', message, ...(detail ? { detail } : {}) });
  const warn = (code: string, message: string, detail?: string) => issues.push({ code, severity: 'warning', message, ...(detail ? { detail } : {}) });
  if (!r.title.trim()) err('missing_title', 'the article has no title');
  if (!isValidSlug(r.slug)) err('slug_invalid', 'the slug must be Hebrew or lowercase Latin letters and digits with single hyphens');
  const a = analyzeArticleHtml(r.bodyHtml);
  if (a.wordCount < 50) err('missing_body', `the body has ${a.wordCount} words`);
  if (a.h1Count > 0) err('multiple_h1', 'the body contains an H1; the title is the only H1');
  if (a.unclosed.length) warn('unclosed_tags', 'tags the parser had to close', a.unclosed.join(', '));
  for (const img of a.images) if (!img.alt || img.alt.trim().length < 3) err('missing_alt', 'an image without alt text', img.src);
  for (const img of a.images) if (!/^\/media\//.test(img.src)) warn('external_image', 'an image not uploaded through upload_media', img.src);
  if (!r.authorId) err('missing_author', 'no author');
  if (!r.featuredImageId) warn('missing_featured_image', 'no featured image');
  else if (!r.featuredImage?.alt) warn('featured_image_alt', 'the featured image has no alt text');
  if (!r.metaDescription?.trim()) warn('empty_meta_description', 'no meta description; the excerpt is used');
  else if (r.metaDescription.length < 70 || r.metaDescription.length > 160) warn('meta_description_length', `${r.metaDescription.length} characters; 70 to 160 is the aim`);
  if (!r.excerpt?.trim() && !r.metaDescription?.trim()) warn('empty_excerpt', 'no excerpt');
  const faq = (r.faq as Array<{ q: string; a: string }>) ?? [];
  if (faq.some(f => !f.q?.trim() || !f.a?.trim())) err('faq_incomplete', 'a FAQ item is missing its question or answer');
  if (opts.checkLinks !== false) {
    const internal = a.links.filter(l => l.internal && l.path);
    const seen = new Set<string>();
    for (const l of internal) {
      if (!l.path || seen.has(l.path)) continue;
      seen.add(l.path);
      if (l.path === articlePath(r.slug)) { warn('self_link', 'the article links to itself', l.href); continue; }
      if (!(await internalPathExists(l.path))) err('broken_internal_link', 'a link to a path that does not exist on the site', l.href);
    }
    for (const l of a.links) if (!l.internal && !/^https?:\/\//.test(l.href) && !/^(mailto|tel):/.test(l.href)) err('bad_link', 'a link that is neither a site path nor an http(s) URL', l.href);
    for (const l of a.links) if (!l.internal && /^https?:/.test(l.href) && !/nofollow/.test(l.rel ?? '')) err('external_rel', 'an external link without rel="nofollow noopener noreferrer"', l.href);
  }
  return issues;
}

export const blocking = (issues: Issue[]) => issues.filter(i => i.severity === 'error');

// ---------- create and update ----------

/** Turns a validated patch into Prisma data; the body is sanitized and measured here. */
function toData(p: ArticlePatch, actorId: string, mode: 'create' | 'update' = 'update'): { data: Prisma.ArticleUpdateInput; sanitizeErrors: string[] } {
  const d: Prisma.ArticleUpdateInput = { updatedBy: undefined } as Prisma.ArticleUpdateInput;
  const data = d as Record<string, unknown>;
  const sanitizeErrors: string[] = [];
  if (p.slug !== undefined) data.slug = p.slug;
  if (p.title !== undefined) data.title = p.title;
  if (p.bodyHtml !== undefined) {
    const s = sanitizeArticleHtml(p.bodyHtml);
    sanitizeErrors.push(...s.errors);
    const a = analyzeArticleHtml(s.html);
    data.bodyHtml = s.html;
    data.wordCount = a.wordCount;
    data.readingTimeMinutes = a.readingTimeMinutes;
    if (s.jsonLd.length && p.jsonLd === undefined) data.jsonLdExtra = s.jsonLd as Prisma.InputJsonValue;
  }
  if (p.jsonLd !== undefined) data.jsonLdExtra = p.jsonLd as Prisma.InputJsonValue;
  if (p.excerpt !== undefined) data.excerpt = p.excerpt || null;
  if (p.summary !== undefined) data.summary = p.summary;
  if (p.faq !== undefined) data.faq = p.faq as Prisma.InputJsonValue;
  if (p.authorId !== undefined) data.author = p.authorId ? { connect: { id: p.authorId } } : { disconnect: true };
  if (p.categoryId !== undefined) data.category = p.categoryId ? { connect: { id: p.categoryId } } : { disconnect: true };
  if (p.tagIds !== undefined) data.tags = mode === 'create' ? { connect: p.tagIds.map(id => ({ id })) } : { set: p.tagIds.map(id => ({ id })) };
  if (p.featuredImageId !== undefined) data.featuredImage = p.featuredImageId ? { connect: { id: p.featuredImageId } } : { disconnect: true };
  if (p.parentPagePath !== undefined) data.parentPagePath = p.parentPagePath || null;
  if (p.relatedArticleIds !== undefined) data.relatedArticleIds = [...new Set(p.relatedArticleIds)];
  if (p.internalNotes !== undefined) data.internalNotes = p.internalNotes || null;
  for (const k of ['seoTitle', 'metaDescription', 'focusKeyword', 'canonicalUrl', 'ogTitle', 'ogDescription', 'twitterTitle', 'twitterDescription'] as const) if (p[k] !== undefined) data[k] = p[k] || null;
  if (p.robots !== undefined) data.robots = p.robots.replace(/\s/g, '');
  if (p.ogImageId !== undefined) data.ogImageId = p.ogImageId;
  data.updatedById = actorId;
  delete data.updatedBy;
  return { data: d, sanitizeErrors };
}

const slugTaken = async (slug: string, exceptId?: string) => !!(await db.article.findFirst({ where: { slug, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } }));

function refresh(r: { slug: string; parentPagePath: string | null; category?: { slug: string } | null }, extra: string[] = []) {
  // The homepage (desktop at /, phones at /home/phone) shows the newest articles in its guides block and footer.
  const paths = [articlePath(r.slug), '/magazine', '/sitemap.xml', '/ops/magazine', '/', '/home/phone', ...(r.parentPagePath ? [r.parentPagePath] : []), ...(r.category ? [categoryUrl(r.category.slug)] : []), ...extra];
  for (const p of new Set(paths)) { try { revalidatePath(p); } catch { /* outside a request */ } }
  return [...new Set(paths)];
}

export type Saved = { ok: true; article: ArticleView; canonicalUrl: string; warnings: string[]; revalidated: string[] };

export async function createArticle(actor: Actor, input: unknown): Promise<Saved | Fail> {
  const p = ArticleCreateSchema.safeParse(input);
  if (!p.success) return { ok: false, error: 'invalid input', fields: fieldErrors(p.error) };
  const slug = p.data.slug ?? slugify(p.data.title);
  if (!isValidSlug(slug)) return { ok: false, error: 'slug must be Hebrew or lowercase Latin letters and digits with single hyphens', fields: { slug } };
  if (await slugTaken(slug)) return { ok: false, error: 'conflict: an article with this slug exists', code: 'conflict', fields: { slug } };
  const refs = await checkReferences(p.data, null);
  if (Object.keys(refs).length) return { ok: false, error: 'unknown reference', fields: refs };
  const parentFromCategory = p.data.parentPagePath === undefined && p.data.categoryId ? (await db.articleCategory.findUnique({ where: { id: p.data.categoryId }, select: { parentPagePath: true } }))?.parentPagePath ?? null : undefined;
  const { data, sanitizeErrors } = toData({ ...p.data, slug, bodyHtml: p.data.bodyHtml ?? '', ...(parentFromCategory ? { parentPagePath: parentFromCategory } : {}) }, actor.id, 'create');
  const row = await db.article.create({ data: { ...(data as Prisma.ArticleCreateInput), slug, title: p.data.title, createdById: actor.id }, include: INCLUDE });
  await audit(actor.id, 'article_create', 'article', row.id, { ref: row.slug, title: row.title, source: 'service' });
  return { ok: true, article: articleView(row), canonicalUrl: articleCanonical(row.slug), warnings: sanitizeErrors, revalidated: refresh(row) };
}

/** A partial update. `expectedUpdatedAt` (ISO) makes the write conditional: a stale value is refused with the current one. */
export async function updateArticle(actor: Actor, id: string, input: unknown, expectedUpdatedAt?: string | null): Promise<Saved | Fail> {
  const cur = await findArticle(id);
  if (!cur) return { ok: false, error: 'article not found' };
  if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== cur.updatedAt.getTime()) return { ok: false, error: 'stale: the article changed since you read it', code: 'stale', updatedAt: cur.updatedAt };
  const p = ArticlePatchSchema.safeParse(input);
  if (!p.success) return { ok: false, error: 'invalid input', fields: fieldErrors(p.error) };
  if (p.data.slug !== undefined && p.data.slug !== cur.slug) {
    if (!isValidSlug(p.data.slug)) return { ok: false, error: 'slug must be Hebrew or lowercase Latin letters and digits with single hyphens', fields: { slug: p.data.slug } };
    if (await slugTaken(p.data.slug, cur.id)) return { ok: false, error: 'conflict: an article with this slug exists', code: 'conflict', fields: { slug: p.data.slug } };
  }
  const refs = await checkReferences(p.data, cur.id);
  if (Object.keys(refs).length) return { ok: false, error: 'unknown reference', fields: refs };
  const { data, sanitizeErrors } = toData(p.data, actor.id);
  const row = await db.article.update({ where: { id: cur.id }, data, include: INCLUDE });
  await audit(actor.id, 'article_update', 'article', row.id, { ref: row.slug, fields: Object.keys(p.data), ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) });
  const extra = cur.slug !== row.slug ? [articlePath(cur.slug)] : [];
  return { ok: true, article: articleView(row), canonicalUrl: articleCanonical(row.slug), warnings: sanitizeErrors, revalidated: row.status === 'published' || cur.status === 'published' ? refresh(row, extra) : refresh(row, extra) };
}

// ---------- publishing ----------

/** Publishes inside a transaction (the approvals queue runs this too). Throws with the blocking issues when the article is not ready. */
export async function applyPublish(tx: Prisma.TransactionClient, actor: Actor, id: string, note?: string): Promise<Row> {
  const row = await tx.article.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
  if (!row) throw new Error('article not found');
  const issues = blocking(await validateArticleRow(row, { checkLinks: false }));
  if (issues.length) throw new Error(`not publishable: ${issues.map(i => `${i.code}${i.detail ? ` (${i.detail})` : ''}`).join('; ')}`);
  const now = new Date();
  const out = await tx.article.update({ where: { id }, data: { status: 'published', publishedAt: row.publishedAt ?? now, scheduledFor: null, updatedById: actor.id }, include: INCLUDE });
  await tx.auditLog.create({ data: { actorId: actor.id, action: 'article_publish', subjectType: 'article', subjectId: id, meta: { ref: out.slug, from: row.status, firstPublish: !row.publishedAt, ...(note ? { note } : {}) } } });
  return out;
}

export type PublishResult = Saved | { ok: true; queued: true; ref: string; canonicalUrl: string; article: ArticleView; note: string } | Fail;

/** Publishes now, or files a proposal when the magazinePublishApproval setting is on. */
export async function publishArticle(actor: Actor, id: string, opts: { note?: string; bypassApproval?: boolean; source?: string } = {}): Promise<PublishResult> {
  const cur = await findArticle(id);
  if (!cur) return { ok: false, error: 'article not found' };
  if (cur.status === 'published') return { ok: true, article: articleView(cur), canonicalUrl: articleCanonical(cur.slug), warnings: ['already published'], revalidated: [] };
  const issues = await validateArticleRow(cur);
  const errors = blocking(issues);
  if (errors.length) return { ok: false, error: `not publishable: ${errors.map(i => i.message).join('; ')}`, code: 'not_publishable', issues };
  const settings = await platformSettings();
  if (settings.magazinePublishApproval && !opts.bypassApproval) {
    const { proposeAiAction } = await import('./aiActions');
    const r = await proposeAiAction({ source: opts.source ?? 'service', action: 'publish_article', subjectType: 'article', subjectId: cur.id, subjectLabel: cur.title, reason: opts.note ?? `פרסום המאמר ״${cur.title}״`, params: { slug: cur.slug } });
    if (!r.ok) return r;
    await audit(actor.id, 'article_publish_proposed', 'article', cur.id, { ref: cur.slug, proposal: r.ref });
    return { ok: true, queued: true, ref: r.ref, canonicalUrl: articleCanonical(cur.slug), article: articleView(cur), note: 'ממתין לאישור אדם בתור האישורים (/ops/ai?tab=queue)' };
  }
  try {
    const row = await db.$transaction(tx => applyPublish(tx, actor, cur.id, opts.note));
    // Tell Google about the new article now instead of at the next scheduled run (src/lib/server/googleIndexing.ts).
    void import('./googleIndexing').then(m => m.indexSoon([articlePath(row.slug), '/magazine', ...(row.category ? [categoryUrl(row.category.slug)] : [])])).catch(() => undefined);
    return { ok: true, article: articleView(row), canonicalUrl: articleCanonical(row.slug), warnings: issues.filter(i => i.severity === 'warning').map(i => `${i.code}${i.detail ? ` (${i.detail})` : ''}`), revalidated: refresh(row) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function unpublishArticle(actor: Actor, id: string, reason?: string): Promise<Saved | Fail> {
  const cur = await findArticle(id);
  if (!cur) return { ok: false, error: 'article not found' };
  if (cur.status !== 'published' && cur.status !== 'scheduled') return { ok: false, error: `the article is ${cur.status}` };
  const row = await db.article.update({ where: { id: cur.id }, data: { status: 'unpublished', scheduledFor: null, updatedById: actor.id }, include: INCLUDE });
  await audit(actor.id, 'article_unpublish', 'article', row.id, { ref: row.slug, from: cur.status, ...(reason ? { reason } : {}) });
  return { ok: true, article: articleView(row), canonicalUrl: articleCanonical(row.slug), warnings: [], revalidated: refresh(row) };
}

/** Schedules publication. The time is Jerusalem wall time when it has no zone ("2026-10-20T09:30"). */
export async function scheduleArticle(actor: Actor, id: string, when: string): Promise<Saved | Fail> {
  const cur = await findArticle(id);
  if (!cur) return { ok: false, error: 'article not found' };
  const at = parseJerusalemTime(when);
  if (!at) return { ok: false, error: 'scheduled_for must be YYYY-MM-DDTHH:mm (Asia/Jerusalem) or an ISO date-time with a zone' };
  if (at.getTime() <= Date.now() + 30_000) return { ok: false, error: 'scheduled_for must be in the future; use publish_article to publish now' };
  if (cur.status === 'published') return { ok: false, error: 'the article is already published' };
  const errors = blocking(await validateArticleRow(cur));
  if (errors.length) return { ok: false, error: `not publishable: ${errors.map(i => i.message).join('; ')}`, code: 'not_publishable', issues: errors };
  const row = await db.article.update({ where: { id: cur.id }, data: { status: 'scheduled', scheduledFor: at, updatedById: actor.id }, include: INCLUDE });
  await audit(actor.id, 'article_schedule', 'article', row.id, { ref: row.slug, scheduledFor: at.toISOString() });
  return { ok: true, article: articleView(row), canonicalUrl: articleCanonical(row.slug), warnings: [], revalidated: refresh(row) };
}

/**
 * Publishes scheduled articles whose time has come. Called when the magazine, an article or the sitemap
 * renders (so a scheduled piece appears on the next render after its time) and by list_articles.
 */
export async function publishDueArticles(): Promise<number> {
  const due = await db.article.findMany({ where: { status: 'scheduled', deletedAt: null, scheduledFor: { lte: new Date() } }, select: { id: true, slug: true, scheduledFor: true, parentPagePath: true, category: { select: { slug: true } } } });
  for (const a of due) {
    await db.article.update({ where: { id: a.id }, data: { status: 'published', publishedAt: a.scheduledFor ?? new Date(), scheduledFor: null } });
    await audit(null, 'article_publish', 'article', a.id, { ref: a.slug, scheduled: true });
    refresh(a);
  }
  return due.length;
}

export async function deleteArticle(actor: Actor, id: string, reason?: string): Promise<{ ok: true; id: string; revalidated: string[] } | Fail> {
  const cur = await findArticle(id);
  if (!cur) return { ok: false, error: 'article not found' };
  const row = await db.article.update({ where: { id: cur.id }, data: { deletedAt: new Date(), status: 'unpublished', scheduledFor: null, updatedById: actor.id }, include: { category: true } });
  await audit(actor.id, 'article_delete', 'article', row.id, { ref: row.slug, from: cur.status, soft: true, ...(reason ? { reason } : {}) });
  return { ok: true, id: row.id, revalidated: refresh(row) };
}

// ---------- targeted edits and links ----------

/** A literal find and replace in the body. The result is sanitized again, so the rules still hold. */
export async function replaceInArticle(actor: Actor, id: string, find: string, replace: string, opts: { all?: boolean; expectedUpdatedAt?: string | null } = {}): Promise<(Saved & { replaced: number }) | Fail> {
  const cur = await findArticle(id);
  if (!cur) return { ok: false, error: 'article not found' };
  if (opts.expectedUpdatedAt && new Date(opts.expectedUpdatedAt).getTime() !== cur.updatedAt.getTime()) return { ok: false, error: 'stale: the article changed since you read it', code: 'stale', updatedAt: cur.updatedAt };
  if (!find) return { ok: false, error: 'find is empty' };
  const count = cur.bodyHtml.split(find).length - 1;
  if (count === 0) return { ok: false, error: 'find text not present in the body', code: 'not_found' };
  if (count > 1 && !opts.all) return { ok: false, error: `find text appears ${count} times; pass all=true or make it unique`, code: 'ambiguous', occurrences: count };
  const next = opts.all ? cur.bodyHtml.split(find).join(replace) : cur.bodyHtml.replace(find, () => replace);
  const r = await updateArticle(actor, cur.id, { bodyHtml: next }, null);
  if (!r.ok) return r;
  await audit(actor.id, 'article_replace', 'article', cur.id, { ref: cur.slug, find: find.slice(0, 200), replace: replace.slice(0, 200), count: opts.all ? count : 1 });
  return { ...r, replaced: opts.all ? count : 1 };
}

export async function articleLinks(id: string) {
  const cur = await findArticle(id);
  if (!cur) return { ok: false as const, error: 'article not found' };
  const a = analyzeArticleHtml(cur.bodyHtml);
  const outbound = await Promise.all(a.links.map(async l => ({ href: l.href, text: l.text, internal: l.internal, path: l.path, rel: l.rel, exists: l.internal && l.path ? await internalPathExists(l.path) : null })));
  const needle = articlePath(cur.slug);
  const inboundRows = await db.article.findMany({ where: { deletedAt: null, id: { not: cur.id }, OR: [{ bodyHtml: { contains: `"${needle}"` } }, { bodyHtml: { contains: `"${articleCanonical(cur.slug)}"` } }, { relatedArticleIds: { has: cur.id } }] }, select: { id: true, title: true, slug: true, status: true } });
  return { ok: true as const, id: cur.id, slug: cur.slug, path: needle, outbound: { internal: outbound.filter(l => l.internal), external: outbound.filter(l => !l.internal) }, inbound: inboundRows.map(r => ({ id: r.id, title: r.title, slug: r.slug, path: articlePath(r.slug), status: r.status, live: r.status === 'published' })) };
}

/** A dry run: the stored article, optionally with a patch applied in memory, against the publish rules. */
export async function validateArticle(id: string, patch?: unknown) {
  const cur = await findArticle(id);
  if (!cur) return { ok: false as const, error: 'article not found' };
  let row: Row = cur;
  let sanitizeErrors: string[] = [];
  if (patch && typeof patch === 'object' && Object.keys(patch).length) {
    const p = ArticlePatchSchema.safeParse(patch);
    if (!p.success) return { ok: false as const, error: 'invalid patch', fields: fieldErrors(p.error) };
    const s = p.data.bodyHtml !== undefined ? sanitizeArticleHtml(p.data.bodyHtml) : null;
    sanitizeErrors = s?.errors ?? [];
    row = {
      ...cur,
      ...(p.data.slug !== undefined ? { slug: p.data.slug } : {}), ...(p.data.title !== undefined ? { title: p.data.title } : {}), ...(s ? { bodyHtml: s.html } : {}),
      ...(p.data.excerpt !== undefined ? { excerpt: p.data.excerpt } : {}), ...(p.data.metaDescription !== undefined ? { metaDescription: p.data.metaDescription } : {}),
      ...(p.data.authorId !== undefined ? { authorId: p.data.authorId } : {}),
      // A patched featured image is loaded too, so the alt check reads the new image, not the stored one.
      ...(p.data.featuredImageId !== undefined ? { featuredImageId: p.data.featuredImageId, featuredImage: p.data.featuredImageId ? await db.mediaFile.findUnique({ where: { id: p.data.featuredImageId } }) : null } : {}),
      ...(p.data.faq !== undefined ? { faq: p.data.faq as Prisma.JsonValue } : {}),
    };
  }
  const issues = await validateArticleRow(row);
  const a = analyzeArticleHtml(row.bodyHtml);
  return { ok: true as const, id: cur.id, slug: row.slug, publishable: blocking(issues).length === 0, issues, sanitizer: sanitizeErrors, stats: { wordCount: a.wordCount, readingTimeMinutes: a.readingTimeMinutes, headings: a.headings.length, images: a.images.length, links: a.links.length, internalLinks: a.links.filter(l => l.internal).length } };
}

// ---------- authors ----------

export const AuthorInputSchema = z.object({
  id: uuid.optional(),
  slug: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(2).max(120),
  title: z.string().trim().max(160).nullable().optional(),
  bio: z.string().trim().max(2000).nullable().optional(),
  avatarId: nullableUuid.optional(),
  sameAs: z.array(z.string().url().max(300)).max(10).optional(),
  userId: nullableUuid.optional(),
  active: z.boolean().optional(),
});

export const authorView = (a: Author & { avatar?: MediaFile | null; _count?: { articles: number } }) => ({
  id: a.id, slug: a.slug, name: a.name, title: a.title, bio: a.bio, avatar: imageView(a.avatar ?? null), sameAs: a.sameAs, active: a.active, userId: a.userId,
  articles: a._count?.articles ?? null, createdAt: a.createdAt, updatedAt: a.updatedAt,
});

export async function listAuthors(opts: { includeInactive?: boolean } = {}) {
  const rows = await db.author.findMany({ where: opts.includeInactive ? {} : { active: true }, include: { avatar: true, _count: { select: { articles: { where: { deletedAt: null } } } } }, orderBy: { name: 'asc' } });
  return rows.map(authorView);
}

export async function getAuthor(idOrSlug: string) {
  const row = await db.author.findFirst({ where: uuid.safeParse(idOrSlug).success ? { id: idOrSlug } : { slug: idOrSlug }, include: { avatar: true, _count: { select: { articles: { where: { deletedAt: null } } } } } });
  return row ? authorView(row) : null;
}

export async function upsertAuthor(actor: Actor, input: unknown) {
  const p = AuthorInputSchema.safeParse(input);
  if (!p.success) return { ok: false as const, error: 'invalid input', fields: fieldErrors(p.error) };
  const d = p.data;
  if (d.avatarId) {
    const img = await db.mediaFile.findUnique({ where: { id: d.avatarId }, select: { isPrivate: true } });
    if (!img || img.isPrivate) return { ok: false as const, error: 'avatar image not found', fields: { avatarId: d.avatarId } };
  }
  const slug = d.slug ?? slugify(d.name);
  if (!isValidSlug(slug)) return { ok: false as const, error: 'slug must be Hebrew or lowercase Latin letters and digits with single hyphens', fields: { slug } };
  const existing = d.id ? await db.author.findUnique({ where: { id: d.id } }) : null;
  if (d.id && !existing) return { ok: false as const, error: 'author not found' };
  const clash = await db.author.findFirst({ where: { slug, ...(existing ? { id: { not: existing.id } } : {}) }, select: { id: true } });
  if (clash) return { ok: false as const, error: 'conflict: an author with this slug exists', code: 'conflict', fields: { slug } };
  const data = { slug, name: d.name, ...(d.title !== undefined ? { title: d.title } : {}), ...(d.bio !== undefined ? { bio: d.bio } : {}), ...(d.avatarId !== undefined ? { avatarId: d.avatarId } : {}), ...(d.sameAs !== undefined ? { sameAs: d.sameAs } : {}), ...(d.userId !== undefined ? { userId: d.userId } : {}), ...(d.active !== undefined ? { active: d.active } : {}) };
  const row = existing ? await db.author.update({ where: { id: existing.id }, data, include: { avatar: true } }) : await db.author.create({ data, include: { avatar: true } });
  await audit(actor.id, existing ? 'author_update' : 'author_create', 'author', row.id, { ref: row.slug, name: row.name });
  if (existing) {
    const touched = await db.article.findMany({ where: { deletedAt: null, status: 'published', authorId: row.id }, select: { slug: true, parentPagePath: true } });
    for (const t of touched) refresh(t);
  }
  return { ok: true as const, author: authorView(row), created: !existing };
}

// ---------- categories and tags ----------

export const categoryUrl = (slug: string) => `/magazine/category/${slug}`;
export const categoryPath = categoryUrl;
export const categoryView = (c: ArticleCategory & { _count?: { articles: number } }) => ({ id: c.id, slug: c.slug, name: c.name, description: c.description, parentPagePath: c.parentPagePath, count: c._count?.articles ?? null, url: categoryUrl(c.slug) });

export async function listCategories() {
  const rows = await db.articleCategory.findMany({ include: { _count: { select: { articles: { where: { deletedAt: null, status: 'published' } } } } }, orderBy: { name: 'asc' } });
  return rows.map(categoryView);
}

export const CategoryInputSchema = z.object({ id: uuid.optional(), slug: z.string().trim().min(1).max(80).optional(), name: z.string().trim().min(2).max(80), description: z.string().trim().max(500).nullable().optional(), parentPagePath: path.nullable().optional().describe('the treatment page articles of this category belong under, e.g. /treatments/nails; new articles default to it') });

export async function upsertCategory(actor: Actor, input: unknown) {
  const p = CategoryInputSchema.safeParse(input);
  if (!p.success) return { ok: false as const, error: 'invalid input', fields: fieldErrors(p.error) };
  const slug = p.data.slug ?? slugify(p.data.name);
  if (!isValidSlug(slug)) return { ok: false as const, error: 'slug must be Hebrew or lowercase Latin letters and digits with single hyphens', fields: { slug } };
  const existing = p.data.id ? await db.articleCategory.findUnique({ where: { id: p.data.id } }) : await db.articleCategory.findUnique({ where: { slug } });
  if (p.data.id && !existing) return { ok: false as const, error: 'category not found' };
  const clash = await db.articleCategory.findFirst({ where: { slug, ...(existing ? { id: { not: existing.id } } : {}) }, select: { id: true } });
  if (clash) return { ok: false as const, error: 'conflict: a category with this slug exists', code: 'conflict', fields: { slug } };
  if (p.data.parentPagePath && !STATIC_PATHS.has(p.data.parentPagePath.replace(/\/+$/, ''))) return { ok: false as const, error: 'parentPagePath must be an existing fixed page, e.g. /treatments/nails', fields: { parentPagePath: p.data.parentPagePath } };
  const data = { slug, name: p.data.name, ...(p.data.description !== undefined ? { description: p.data.description } : {}), ...(p.data.parentPagePath !== undefined ? { parentPagePath: p.data.parentPagePath } : {}) };
  const row = existing ? await db.articleCategory.update({ where: { id: existing.id }, data }) : await db.articleCategory.create({ data });
  await audit(actor.id, existing ? 'article_category_update' : 'article_category_create', 'article_category', row.id, { ref: row.slug, name: row.name });
  for (const r of ['/magazine', categoryUrl(row.slug), ...(existing && existing.slug !== row.slug ? [categoryUrl(existing.slug)] : [])]) { try { revalidatePath(r); } catch { /* outside a request */ } }
  return { ok: true as const, category: categoryView(row), created: !existing };
}

export async function listTags() {
  const rows = await db.articleTag.findMany({ include: { _count: { select: { articles: { where: { deletedAt: null, status: 'published' } } } } }, orderBy: { name: 'asc' } });
  return rows.map(t => ({ id: t.id, slug: t.slug, name: t.name, count: t._count.articles }));
}

export async function createTag(actor: Actor, input: { name: string; slug?: string }) {
  const name = String(input.name ?? '').trim();
  if (name.length < 2 || name.length > 60) return { ok: false as const, error: 'name between 2 and 60 characters' };
  const slug = (input.slug ?? slugify(name)).trim();
  if (!isValidSlug(slug)) return { ok: false as const, error: 'slug must be Hebrew or lowercase Latin letters and digits with single hyphens', fields: { slug } };
  const existing = await db.articleTag.findUnique({ where: { slug } });
  if (existing) return { ok: true as const, tag: { id: existing.id, slug: existing.slug, name: existing.name }, created: false };
  const row = await db.articleTag.create({ data: { slug, name } });
  await audit(actor.id, 'article_tag_create', 'article_tag', row.id, { ref: row.slug, name: row.name });
  return { ok: true as const, tag: { id: row.id, slug: row.slug, name: row.name }, created: true };
}

// ---------- helpers for the public pages ----------

/** The three newest published articles as homepage guide cards, or null while the magazine is empty (the placeholders stay). */
export async function homeGuides() {
  const { CATEGORY_IMAGE } = await import('@/components/home/content');
  const rows = await db.article.findMany({ where: { deletedAt: null, status: 'published' }, orderBy: { publishedAt: 'desc' }, take: 3, include: { category: true, featuredImage: true } });
  if (!rows.length) return null;
  return rows.map(a => ({
    kind: a.category?.name ?? 'מדריך', title: a.title, desc: a.excerpt ?? '', href: articlePath(a.slug),
    img: a.featuredImage ? mediaUrl(a.featuredImage) : CATEGORY_IMAGE[a.category?.slug ?? ''] ?? '/assets/art-choose.jpg',
    readTime: `${a.readingTimeMinutes} דקות קריאה`,
  }));
}

export const articleDescription = (r: Pick<Article, 'metaDescription' | 'excerpt' | 'bodyHtml'>) => r.metaDescription?.trim() || r.excerpt?.trim() || htmlToText(r.bodyHtml).slice(0, 155);
