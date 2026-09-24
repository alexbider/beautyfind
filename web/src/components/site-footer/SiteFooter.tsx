import Link from 'next/link';
import { categoryBySlug, regionBySlug } from '@/lib/catalog';
import { Wordmark } from '../Wordmark';
import styles from './SiteFooter.module.css';

const GROUPS: Array<{ name: string; links: Array<{ name: string; href: string }> }> = [
  { name: 'אזורים', links: (['dan', 'sharon', 'haifa', 'jerusalem', 'shfela'] as const).map(s => ({ name: regionBySlug(s)!.name, href: `/${s}` })) },
  {
    name: 'תחומי טיפול',
    links: ['facials', 'medical-aesthetics', 'brows-lashes', 'makeup', 'permanent-makeup'].map(s => ({ name: categoryBySlug(s)!.name, href: `/treatments/${s}` })),
  },
  {
    name: 'לעסקים',
    links: [
      { name: 'רישום עסק', href: '/for-business' },
      { name: 'אישור בעלות', href: '/for-business/claim' },
      { name: 'מחירים', href: '/for-business#pricing' },
      { name: 'תקן הרישום', href: '/listing-standards' },
    ],
  },
  {
    name: 'החברה',
    links: [
      { name: 'אודות', href: '/about' },
      { name: 'מרכז עזרה', href: '/help' },
      { name: 'צור קשר', href: '/contact' },
      { name: 'מדיניות פרטיות', href: '/privacy' },
      { name: 'תנאי שימוש', href: '/terms' },
      { name: 'הצהרת נגישות', href: '/accessibility' },
    ],
  },
];

/**
 * `note` is the right-hand line in the bottom bar (public pages: a medical disclaimer). `wide` = 1320px pages.
 * In the app shell only the bottom line shows; the link columns are on the "עוד" tab (spec §2.1).
 */
export function SiteFooter({ note, wide = false }: { note?: string; wide?: boolean } = {}) {
  return (
    <footer className={styles.footer}>
      <div className={styles.grid} data-wide={wide || undefined}>
        <div className={styles.about}>
          <Wordmark size={26} onDark />
          <p>אינדקס היופי והאסתטיקה של ישראל: עסקים מאומתים, ביקורות מאומתות ותפריטי טיפולים שאפשר להשוות.</p>
        </div>
        {GROUPS.map(g => (
          <nav key={g.name} aria-label={g.name} className={styles.group}>
            <div className={styles.groupName}>{g.name}</div>
            <div className={styles.links}>
              {g.links.map(l => (
                <Link key={l.href} href={l.href} className={styles.link}>{l.name}</Link>
              ))}
            </div>
          </nav>
        ))}
      </div>
      <div className={styles.bottom} data-wide={wide || undefined}>
        <span>© {new Date().getFullYear()} BeautyFind · Israfind Group</span>
        {note && <span>{note}</span>}
      </div>
    </footer>
  );
}
