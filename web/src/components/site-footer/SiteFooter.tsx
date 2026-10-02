import Link from 'next/link';
import { CATEGORIES, MENU_REGION_ORDER, regionBySlug } from '@/lib/catalog';
import { relFor } from '@/lib/routes';
import { Wordmark } from '../Wordmark';
import styles from './SiteFooter.module.css';

const GROUPS: Array<{ name: string; links: Array<{ name: string; href: string }> }> = [
  { name: 'אזורים', links: MENU_REGION_ORDER.map(s => ({ name: regionBySlug(s)!.name, href: `/${s}` })) },
  // Every category, so each hub is one click from every public page.
  { name: 'תחומי טיפול', links: CATEGORIES.map(c => ({ name: c.name, href: `/treatments/${c.slug}` })) },
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
      { name: 'צרו קשר', href: '/contact' },
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
          <p>אינדקס היופי והאסתטיקה של ישראל: עסקים מאומתים מסומנים בתג, ביקורות אחרי ביקור ותפריטי טיפולים שאפשר להשוות.</p>
        </div>
        {GROUPS.map(g => (
          <nav key={g.name} aria-label={g.name} className={styles.group}>
            <div className={styles.groupName}>{g.name}</div>
            <div className={styles.links}>
              {g.links.map(l => (
                <Link key={l.href} href={l.href} rel={relFor(l.href)} className={styles.link}>{l.name}</Link>
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
