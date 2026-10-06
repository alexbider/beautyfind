import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import content from '@/components/content/content.module.css';
import { ArticleCards } from '@/components/magazine/ArticleCards';
import { parentPageLabel } from '@/components/magazine/ArticleTemplate';
import mag from '@/components/magazine/article.module.css';
import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import shared from '@/components/treatments/shared.module.css';
import { articlePath } from '@/lib/articleHtml';
import { categoryPath, listCategories, publishedArticles } from '@/lib/server/articles';
import { db } from '@/lib/server/db';
import { applySeo } from '@/lib/server/seo';
import { SITE_NAME, SITE_ORIGIN } from '@/lib/seo/meta';
import { breadcrumbNode, graph, itemListNode, webPageNode } from '@/lib/seo/schema';
import styles from '../../page.module.css';

// /magazine/category/<slug>: the published articles of one category, server rendered and crawlable.
// A category with no published article renders (noindex, follow) so links to it never break; it joins the
// sitemap once it has an article (src/lib/server/sitemapEntries.ts), under the content section switch.

export const revalidate = 300;

type Params = Promise<{ slug: string }>;

async function load(rawSlug: string) {
  let slug: string;
  try { slug = decodeURIComponent(rawSlug); } catch { return null; }
  return db.articleCategory.findUnique({ where: { slug } });
}

const describe = (c: { name: string; description: string | null }) => c.description?.trim() || `מאמרי המגזין של BeautyFind בנושא ${c.name}: מדריכים, הסברים ומחירי שוק.`;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const c = await load(slug);
  if (!c) return { title: 'הקטגוריה לא נמצאה', robots: { index: false, follow: true } };
  const path = categoryPath(c.slug);
  const count = await db.article.count({ where: { categoryId: c.id, status: 'published', deletedAt: null } });
  const description = describe(c);
  return applySeo(path, {
    title: { absolute: `${c.name} | המגזין | ${SITE_NAME}` },
    description,
    alternates: { canonical: `${SITE_ORIGIN}/magazine/category/${encodeURIComponent(c.slug)}` },
    ...(count ? {} : { robots: { index: false, follow: true } }),
    openGraph: { type: 'website', locale: 'he_IL', siteName: SITE_NAME, url: path, title: `${c.name} | המגזין`, description },
  });
}

export default async function CategoryPage({ params }: { params: Params }) {
  const { slug } = await params;
  const c = await load(slug);
  if (!c) notFound();
  const path = categoryPath(c.slug);
  const [rows, categories] = await Promise.all([publishedArticles({ category: c.slug }), listCategories()]);
  const live = categories.filter(x => (x.count ?? 0) > 0);
  const description = describe(c);
  const crumbs = [{ name: 'בית', href: '/' }, { name: 'מגזין', href: '/magazine' }, { name: c.name }];
  const jsonLd = graph([
    webPageNode({ path, type: 'CollectionPage', name: `${c.name} | המגזין`, description, breadcrumb: true, ...(rows.length ? { mainEntityId: `${SITE_ORIGIN}${path}#list` } : {}) }),
    breadcrumbNode(path, [{ name: 'בית', path: '/' }, { name: 'מגזין', path: '/magazine' }, { name: c.name, path }]),
    ...(rows.length ? [itemListNode(path, c.name, rows.map(a => ({ path: articlePath(a.slug), name: a.title })))] : []),
  ]);

  return (
    <div className={shared.root}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <SiteHeader variant="public" title="מגזין" backHref="/magazine" />
      <nav aria-label="נתיב ניווט" className={content.crumbs}>
        <ol className={content.crumbList}>
          {crumbs.map((x, i) => {
            const last = i === crumbs.length - 1;
            return [
              i > 0 && <li key={`s${i}`} aria-hidden="true" className={content.crumbSep}>/</li>,
              <li key={x.name} className={last ? content.crumbCurrent : undefined} aria-current={last ? 'page' : undefined}>{!last && x.href ? <Link href={x.href}>{x.name}</Link> : x.name}</li>,
            ];
          })}
        </ol>
      </nav>
      <main id="main" className={styles.main}>
        <div className={mag.catHead}>
          <h1 className={styles.h1}>{c.name}<span aria-hidden="true" className={styles.dot}>.</span></h1>
          <p className={mag.catDesc}>{description}</p>
          {c.parentPagePath ? <Link href={c.parentPagePath} className={`${mag.parentLink} ${mag.catParent}`}>לעמוד {parentPageLabel(c.parentPagePath)}</Link> : null}
        </div>
        <nav aria-label="קטגוריות" className={mag.filters}>
          <Link href="/magazine" className={mag.filter}>הכול</Link>
          {(live.some(x => x.slug === c.slug) ? live : [...live, { slug: c.slug, name: c.name, url: path }]).map(x => <Link key={x.slug} href={x.url} className={mag.filter} aria-current={x.slug === c.slug ? 'page' : undefined}>{x.name}</Link>)}
        </nav>
        {rows.length ? <ArticleCards rows={rows} /> : <p className={styles.lede} style={{ marginTop: 24 }}>אין עדיין מאמרים בקטגוריה הזו. <Link href="/magazine">כל המאמרים</Link>.</p>}
      </main>
      <SiteFooter wide />
    </div>
  );
}
