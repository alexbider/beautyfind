import Link from 'next/link';
import type { Article, ArticleCategory, Author, MediaFile } from '@prisma/client';
import { CATEGORY_IMAGE } from '@/components/home/content';
import { articlePath, dateHe } from '@/lib/articleHtml';
import { mediaUrl } from '@/lib/server/articleMedia';
import styles from './article.module.css';

// The article card grid of the magazine index and the category pages.

export type CardRow = Pick<Article, 'id' | 'slug' | 'title' | 'excerpt' | 'publishedAt' | 'createdAt' | 'readingTimeMinutes'> & { author: Author | null; category: ArticleCategory | null; featuredImage: MediaFile | null };

export function ArticleCards({ rows }: { rows: CardRow[] }) {
  return (
    <ul className={styles.cards} style={{ listStyle: 'none', padding: 0 }}>
      {rows.map(a => (
        <li key={a.id}>
          <Link href={articlePath(a.slug)} className={styles.card}>
            <span className={styles.cardImg}>
              {a.featuredImage ? (
                <img src={mediaUrl(a.featuredImage)} alt="" width={a.featuredImage.width ?? 800} height={a.featuredImage.height ?? 500} loading="lazy" decoding="async" />
              ) : (
                <img src={CATEGORY_IMAGE[a.category?.slug ?? ''] ?? CATEGORY_IMAGE.facials} alt="" width={800} height={500} loading="lazy" decoding="async" />
              )}
            </span>
            <span className={styles.cardKind}>{a.category?.name ?? 'מדריך'}</span>
            <h2 className={styles.cardH}>{a.title}</h2>
            {a.excerpt ? <p className={styles.cardDesc}>{a.excerpt}</p> : null}
            <span className={styles.cardMeta}>{a.author ? `${a.author.name} · ` : ''}{dateHe(a.publishedAt ?? a.createdAt)} · <span className="ltr tnum">{a.readingTimeMinutes}</span> דק׳ קריאה</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
