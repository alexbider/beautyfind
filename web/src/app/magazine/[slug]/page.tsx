import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArticleTemplate, type RelatedRow } from '@/components/magazine/ArticleTemplate';
import { articleCanonical, articlePath } from '@/lib/articleHtml';
import { mediaUrl } from '@/lib/server/articleMedia';
import { articleDescription, publishDueArticles } from '@/lib/server/articles';
import { db } from '@/lib/server/db';
import { applySeo } from '@/lib/server/seo';
import { DEFAULT_OG_IMAGE, SITE_NAME } from '@/lib/seo/meta';
import { absoluteUrl, articleId, articleNode, breadcrumbNode, faqNode, graph, webPageNode } from '@/lib/seo/schema';

// /magazine/<slug>: one published article. Server-rendered title, description, canonical, robots, Open
// Graph (type article) and Twitter card from the article's SEO fields, and one JSON-LD graph: WebPage,
// Article (or BlogPosting), BreadcrumbList, FAQPage only when the page shows a FAQ, plus any extra nodes
// the writer stored. Publisher and Organization are references to the site's @id, never a second copy.
// Drafts, scheduled and unpublished articles answer 404; a scheduled article whose time has come is
// published on the way in.

export const revalidate = 300;

type Params = Promise<{ slug: string }>;
const INCLUDE = { author: { include: { avatar: true } }, reviewer: { include: { avatar: true } }, category: true, featuredImage: true } as const;

async function load(rawSlug: string) {
  let slug: string;
  try { slug = decodeURIComponent(rawSlug); } catch { return null; }
  await publishDueArticles().catch(() => 0);
  return db.article.findFirst({ where: { slug, status: 'published', deletedAt: null }, include: INCLUDE });
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const a = await load(slug);
  if (!a) return { title: 'המאמר לא נמצא', robots: { index: false, follow: true } };
  const path = articlePath(a.slug);
  const description = articleDescription(a);
  const title = a.seoTitle?.trim() || a.title;
  const og = a.ogImageId ? await db.mediaFile.findUnique({ where: { id: a.ogImageId } }) : a.featuredImage;
  const image = og && !og.isPrivate ? { url: absoluteUrl(mediaUrl(og)), ...(og.width ? { width: og.width } : {}), ...(og.height ? { height: og.height } : {}), alt: og.alt ?? '' } : { url: absoluteUrl(DEFAULT_OG_IMAGE) };
  const [index, follow] = a.robots.split(',').map(s => s.trim());
  const base: Metadata = {
    title: { absolute: `${title} | ${SITE_NAME}` },
    description,
    alternates: { canonical: a.canonicalUrl ?? articleCanonical(a.slug) },
    robots: { index: index !== 'noindex', follow: follow !== 'nofollow' },
    openGraph: {
      type: 'article', locale: 'he_IL', siteName: SITE_NAME, url: articleCanonical(a.slug),
      title: a.ogTitle?.trim() || title, description: a.ogDescription?.trim() || description, images: [image],
      publishedTime: (a.publishedAt ?? a.createdAt).toISOString(), modifiedTime: a.updatedAt.toISOString(),
      ...(a.author ? { authors: [a.author.name] } : {}), ...(a.category ? { section: a.category.name } : {}),
    },
    twitter: { card: 'summary_large_image', title: a.twitterTitle?.trim() || a.ogTitle?.trim() || title, description: a.twitterDescription?.trim() || a.ogDescription?.trim() || description, images: [image.url] },
  };
  const out = await applySeo(path, base);
  // A noindex the writer set wins over the section switch's default, and the switch wins when it is off.
  if (index === 'noindex') out.robots = { index: false, follow: follow !== 'nofollow' };
  return out;
}

export default async function ArticlePage({ params }: { params: Params }) {
  const { slug } = await params;
  const a = await load(slug);
  if (!a) notFound();
  const path = articlePath(a.slug);
  const description = articleDescription(a);
  const faq = (a.faq as Array<{ q: string; a: string }>) ?? [];
  const relatedIds = a.relatedArticleIds.length ? a.relatedArticleIds : [];
  let related: RelatedRow[] = relatedIds.length ? await db.article.findMany({ where: { id: { in: relatedIds }, status: 'published', deletedAt: null }, select: { id: true, slug: true, title: true, excerpt: true, category: true } }) : [];
  if (relatedIds.length) related = relatedIds.map(id => related.find(r => r.id === id)).filter((r): r is RelatedRow => !!r);
  if (!related.length) related = await db.article.findMany({ where: { id: { not: a.id }, status: 'published', deletedAt: null, ...(a.categoryId ? { categoryId: a.categoryId } : {}) }, orderBy: { publishedAt: 'desc' }, take: 2, select: { id: true, slug: true, title: true, excerpt: true, category: true } });

  const image = a.featuredImage ? { url: mediaUrl(a.featuredImage), width: a.featuredImage.width, height: a.featuredImage.height, caption: a.featuredImage.caption ?? a.featuredImage.alt } : null;
  const crumbs = [{ name: 'בית', path: '/' }, { name: 'מגזין', path: '/magazine' }, ...(a.category ? [{ name: a.category.name, path: `/magazine?category=${encodeURIComponent(a.category.slug)}` }] : []), { name: a.title, path }];
  const person = (p: NonNullable<typeof a.author>) => ({ name: p.name, jobTitle: p.title, sameAs: p.sameAs, image: p.avatar ? mediaUrl(p.avatar) : null });
  const jsonLd = graph([
    webPageNode({ path, name: a.seoTitle?.trim() || a.title, description, image: image?.url, mainEntityId: articleId(path), breadcrumb: true, datePublished: (a.publishedAt ?? a.createdAt).toISOString(), dateModified: a.updatedAt.toISOString() }),
    articleNode({
      path, type: a.category || a.reviewer ? 'Article' : 'BlogPosting', headline: a.title, description, image,
      datePublished: (a.publishedAt ?? a.createdAt).toISOString(), dateModified: a.updatedAt.toISOString(),
      author: a.author ? person(a.author) : null, reviewedBy: a.reviewer ? person(a.reviewer) : null,
      wordCount: a.wordCount, keywords: a.focusKeyword ? [a.focusKeyword] : [], section: a.category?.name ?? null,
    }),
    breadcrumbNode(path, crumbs),
    ...(faq.length ? [faqNode(path, faq)] : []),
    ...((Array.isArray(a.jsonLdExtra) ? a.jsonLdExtra : []) as object[]),
  ]);

  return <ArticleTemplate article={a} related={related} jsonLd={jsonLd} authorAvatar={a.author?.avatar ?? null} reviewerAvatar={a.reviewer?.avatar ?? null} />;
}
