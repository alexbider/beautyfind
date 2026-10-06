import Link from 'next/link';
import type { Article, ArticleCategory, Author, MediaFile } from '@prisma/client';
import { ContentFaq } from '@/components/content/ContentFaq';
import content from '@/components/content/content.module.css';
import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import shared from '@/components/treatments/shared.module.css';
import { analyzeArticleHtml, articlePath, dateHe } from '@/lib/articleHtml';
import { mediaUrl } from '@/lib/server/articleMedia';
import styles from './article.module.css';

// The magazine article page: breadcrumb, header with byline (author, medical reviewer, dates, reading
// time), featured image, the "בקצרה" summary list, a table of contents from the h2s, the sanitized body,
// the visible FAQ and related reading. The body HTML was sanitized when saved (src/lib/articleHtml.ts);
// here tables only get a scrolling wrapper so wide tables stay readable on phones.

export type ArticleRow = Article & { author: Author | null; reviewer: Author | null; category: ArticleCategory | null; featuredImage: MediaFile | null };
export type RelatedRow = Pick<Article, 'id' | 'slug' | 'title' | 'excerpt'> & { category: ArticleCategory | null };

const wrapTables = (html: string) => html.replace(/<table\b/g, `<div class="${styles.tableScroll}" role="region" aria-label="טבלה" tabindex="0"><table`).replace(/<\/table>/g, '</table></div>');

function PersonIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="9" r="3.6" />
      <path d="M5.2 19.4c1.3-3.1 3.8-4.6 6.8-4.6s5.5 1.5 6.8 4.6" />
    </svg>
  );
}

function Person({ a, avatar, label }: { a: Author; avatar: MediaFile | null; label?: string }) {
  return (
    <span className={styles.person}>
      {avatar ? <img className={styles.avatar} src={mediaUrl(avatar)} alt="" width={40} height={40} loading="lazy" decoding="async" /> : <span className={styles.avatarFallback} aria-hidden="true"><PersonIcon /></span>}
      <span>
        <span className={styles.personName}>{label ? `${label} ` : ''}{a.name}</span>
        {a.title ? <span className={styles.personRole}>{a.title}</span> : null}
      </span>
    </span>
  );
}

export function ArticleTemplate({ article: r, related, jsonLd, authorAvatar, reviewerAvatar }: { article: ArticleRow; related: RelatedRow[]; jsonLd: object; authorAvatar: MediaFile | null; reviewerAvatar: MediaFile | null }) {
  const path = articlePath(r.slug);
  const headings = analyzeArticleHtml(r.bodyHtml).headings.filter(h => h.level === 2 && h.id);
  const faq = (r.faq as Array<{ q: string; a: string }>) ?? [];
  const published = r.publishedAt ?? r.createdAt;
  const updated = r.updatedAt.getTime() - published.getTime() > 86_400_000 ? r.updatedAt : null;
  const crumbs = [{ name: 'בית', href: '/' }, { name: 'מגזין', href: '/magazine' }, ...(r.category ? [{ name: r.category.name, href: `/magazine?category=${encodeURIComponent(r.category.slug)}` }] : []), { name: r.title }];
  const toc = headings.length >= 3 ? headings : [];

  return (
    <div className={`${shared.root} ${styles.wrap}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <SiteHeader variant="public" title="מגזין" backHref="/magazine" />

      <nav aria-label="נתיב ניווט" className={content.crumbs}>
        <ol className={content.crumbList}>
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return [
              i > 0 && <li key={`s${i}`} aria-hidden="true" className={content.crumbSep}>/</li>,
              <li key={c.name} className={last ? content.crumbCurrent : undefined} aria-current={last ? 'page' : undefined}>
                {!last && c.href ? <Link href={c.href}>{c.name}</Link> : c.name}
              </li>,
            ];
          })}
        </ol>
      </nav>

      <main id="main">
        <article className={styles.article} aria-labelledby="h-title">
          <header className={styles.head}>
            <span className={styles.kicker}>
              <span aria-hidden="true" className={styles.kickerLine} />
              {r.category ? <Link href={`/magazine?category=${encodeURIComponent(r.category.slug)}`}>{r.category.name}</Link> : 'מגזין'}
              <span aria-hidden="true">·</span>
              <span><span className="ltr tnum">{r.readingTimeMinutes}</span> דק׳ קריאה</span>
            </span>
            <h1 id="h-title" className={styles.h1}>{r.title}</h1>
            {r.excerpt ? <p className={styles.dek}>{r.excerpt}</p> : null}
            <div className={styles.byline}>
              {r.author ? <Person a={r.author} avatar={authorAvatar} /> : null}
              {r.reviewer ? <span className={styles.reviewed}><Person a={r.reviewer} avatar={reviewerAvatar} label="נבדק רפואית:" /></span> : null}
              <span className={styles.dates}>
                <span>פורסם <time dateTime={published.toISOString()}>{dateHe(published)}</time></span>
                {updated ? <span>עודכן <time dateTime={updated.toISOString()}>{dateHe(updated)}</time></span> : null}
              </span>
            </div>
          </header>

          {r.featuredImage ? (
            <figure className={styles.hero}>
              <img src={mediaUrl(r.featuredImage)} alt={r.featuredImage.alt ?? ''} width={r.featuredImage.width ?? undefined} height={r.featuredImage.height ?? undefined} fetchPriority="high" decoding="async" sizes="(min-width: 1320px) 1040px, 100vw" />
              {r.featuredImage.caption ? <figcaption>{r.featuredImage.caption}</figcaption> : null}
            </figure>
          ) : null}

          <div className={styles.grid}>
            <aside className={styles.rail} aria-label="תוכן העניינים">
              {toc.length ? (
                <>
                  <div className={styles.railTitle}>בעמוד הזה</div>
                  <ol className={styles.toc}>
                    {toc.map((h, i) => (
                      <li key={h.id}><a href={`#${h.id}`} className={styles.tocLink}><span className={`${styles.tocNum} ltr`}>{String(i + 1).padStart(2, '0')}</span><span>{h.text}</span></a></li>
                    ))}
                  </ol>
                </>
              ) : null}
            </aside>

            <div>
              {r.summary.length ? (
                <aside className={styles.summary} aria-labelledby="h-summary">
                  <h2 id="h-summary">בקצרה</h2>
                  <ul>{r.summary.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </aside>
              ) : null}

              {toc.length ? (
                <details className={styles.mobileToc}>
                  <summary>תוכן העניינים</summary>
                  <ol className={styles.toc}>
                    {toc.map((h, i) => (
                      <li key={h.id}><a href={`#${h.id}`} className={styles.tocLink}><span className={`${styles.tocNum} ltr`}>{String(i + 1).padStart(2, '0')}</span><span>{h.text}</span></a></li>
                    ))}
                  </ol>
                </details>
              ) : null}

              <div className={styles.prose} dangerouslySetInnerHTML={{ __html: wrapTables(r.bodyHtml) }} />

              {faq.length ? (
                <section className={styles.section} aria-labelledby="h-faq">
                  <h2 id="h-faq" className={styles.h2}>שאלות ותשובות</h2>
                  <ContentFaq faqs={faq} />
                </section>
              ) : null}

              {related.length ? (
                <section className={styles.section} aria-labelledby="h-related">
                  <h2 id="h-related" className={styles.h2}>קריאה נוספת</h2>
                  <ul className={styles.related}>
                    {related.map(a => (
                      <li key={a.id}>
                        <Link href={articlePath(a.slug)} className={styles.relCard}>
                          <span className={styles.relKind}>{a.category?.name ?? 'מגזין'}</span>
                          <span className={styles.relTitle}>{a.title}</span>
                          {a.excerpt ? <span className={styles.relDesc}>{a.excerpt}</span> : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <p className={styles.fine}>המידע במאמר כללי ואינו תחליף לייעוץ רפואי או מקצועי. טווחי מחירים, כשמופיעים, הם טווחי שוק ואינם הצעת מחיר של עסק. <Link href="/about/editorial">מדיניות העריכה</Link>.</p>
            </div>
          </div>
        </article>
      </main>
      <SiteFooter wide note="מידע כללי בלבד, לא ייעוץ רפואי" />
      <span hidden>{path}</span>
    </div>
  );
}
