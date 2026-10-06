import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ARTICLES, CATEGORY_IMAGE } from '@/components/home/content';
import mag from '@/components/magazine/article.module.css';
import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import shared from '@/components/treatments/shared.module.css';
import { articlePath, dateHe } from '@/lib/articleHtml';
import { ROUTES } from '@/lib/routes';
import { mediaUrl } from '@/lib/server/articleMedia';
import { listCategories, publishedArticles } from '@/lib/server/articles';
import { applySeo } from '@/lib/server/seo';
import { breadcrumbNode, graph, itemListNode, webPageNode } from '@/lib/seo/schema';
import styles from './page.module.css';

// The magazine index: published articles (src/lib/server/articles.ts), newest first, with a category
// filter (?category=slug). Until the first article is published the page shows what is coming and the
// reference pages that exist today, and stays out of the index.

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

const DESCRIPTION = 'מדריכים של BeautyFind לבחירת מכון יופי או קליניקה, להבנת מחירי טיפולים ולהכנה לפגישת ייעוץ.';

export async function generateMetadata({ searchParams }: { searchParams: SP }): Promise<Metadata> {
  const category = one((await searchParams).category);
  const rows = await publishedArticles({ take: 1 });
  const base: Metadata = {
    title: 'המגזין',
    description: DESCRIPTION,
    alternates: { canonical: '/magazine' },
    ...(rows.length && !category ? {} : { robots: { index: false, follow: true } }), // filtered views and the empty index stay out
    openGraph: { type: 'website', locale: 'he_IL', siteName: 'BeautyFind', url: '/magazine', title: 'המגזין', description: DESCRIPTION },
  };
  return applySeo('/magazine', base);
}

const NOW = [
  { href: ROUTES.treatments, title: 'תחומי טיפול', sub: 'מה כולל כל תחום, טווחי מחירים בשוק ועסקים לפי אזור' },
  { href: ROUTES.listingStandards, title: 'תקן הרישום', sub: 'מה בודקים לפני שעסק עולה לאתר' },
  { href: `${ROUTES.methodology}#ranking`, title: 'איך מדרגים', sub: 'סדר ההצגה, ביקורות ודירוג בגוגל' },
];

export default async function MagazinePage({ searchParams }: { searchParams: SP }) {
  const category = one((await searchParams).category);
  const [rows, categories] = await Promise.all([publishedArticles({ category: category || undefined }), listCategories()]);
  const live = categories.filter(c => c.count > 0);
  const jsonLd = rows.length ? graph([
    webPageNode({ path: '/magazine', type: 'CollectionPage', name: 'המגזין', description: DESCRIPTION, breadcrumb: true, mainEntityId: `https://beautyfind.co.il/magazine#list` }),
    breadcrumbNode('/magazine', [{ name: 'בית', path: '/' }, { name: 'מגזין', path: '/magazine' }]),
    itemListNode('/magazine', 'מאמרי המגזין', rows.map(a => ({ path: articlePath(a.slug), name: a.title }))),
  ]) : null;

  return (
    <div className={shared.root}>
      {jsonLd ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} /> : null}
      <SiteHeader variant="public" title="מגזין" backHref="/" />
      <main id="main" className={styles.main}>
        <h1 className={styles.h1}>המגזין<span aria-hidden="true" className={styles.dot}>.</span></h1>
        <p className={styles.lede}>{rows.length || category ? 'מדריכים והסברים על טיפולי יופי ואסתטיקה בישראל: איך לבחור, מה לשאול ומה המחירים בשוק. כל מאמר עם כותב, תאריך עדכון ובמאמרים רפואיים גם סוקר.' : 'המדריכים הראשונים נכתבים עכשיו ויעלו כאן בקרוב, כל אחד עם תאריך עדכון גלוי.'}</p>

        {live.length > 1 ? (
          <nav aria-label="קטגוריות" className={mag.filters}>
            <Link href="/magazine" className={mag.filter} aria-current={!category ? 'page' : undefined}>הכול</Link>
            {live.map(c => <Link key={c.slug} href={c.url} className={mag.filter} aria-current={category === c.slug ? 'page' : undefined}>{c.name}</Link>)}
          </nav>
        ) : null}

        {rows.length ? (
          <ul className={mag.cards} style={{ listStyle: 'none', padding: 0 }}>
            {rows.map(a => (
              <li key={a.id}>
                <Link href={articlePath(a.slug)} className={mag.card}>
                  <span className={mag.cardImg}>
                    {a.featuredImage ? (
                      <img src={mediaUrl(a.featuredImage)} alt="" width={a.featuredImage.width ?? 800} height={a.featuredImage.height ?? 500} loading="lazy" decoding="async" />
                    ) : (
                      <img src={CATEGORY_IMAGE.facials} alt="" width={800} height={500} loading="lazy" decoding="async" />
                    )}
                  </span>
                  <span className={mag.cardKind}>{a.category?.name ?? 'מדריך'}</span>
                  <h2 className={mag.cardH}>{a.title}</h2>
                  {a.excerpt ? <p className={mag.cardDesc}>{a.excerpt}</p> : null}
                  <span className={mag.cardMeta}>{a.author ? `${a.author.name} · ` : ''}{dateHe(a.publishedAt ?? a.createdAt)} · <span className="ltr tnum">{a.readingTimeMinutes}</span> דק׳ קריאה</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : category ? (
          <p className={styles.lede}>אין עדיין מאמרים בקטגוריה הזו. <Link href="/magazine">כל המאמרים</Link>.</p>
        ) : (
          <div className={styles.grid}>
            {ARTICLES.map(a => (
              <article key={a.title} className={styles.card}>
                <span className={styles.img}><Image src={a.img} alt="" fill sizes="(min-width: 1024px) 400px, 100vw" className={styles.cover} /></span>
                <span className={styles.kind}>{a.kind} · בקרוב</span>
                <h2 className={styles.h2}>{a.title}</h2>
                <p className={styles.desc}>{a.desc}</p>
              </article>
            ))}
          </div>
        )}

        <h2 className={styles.nowTitle}>{rows.length ? 'עוד באתר' : 'בינתיים אפשר לקרוא'}</h2>
        <div className={styles.now}>
          {NOW.map(n => (
            <Link key={n.href} href={n.href} className={styles.nowLink}>
              <strong>{n.title}</strong>
              <span>{n.sub}</span>
            </Link>
          ))}
        </div>
      </main>
      <SiteFooter wide />
    </div>
  );
}
