import Link from 'next/link';
import { CATEGORIES, REGIONS } from '@/lib/catalog';
import { ROUTES } from '@/lib/routes';
import { Wordmark } from '../Wordmark';
import type { HomeGuide } from './content';
import { BackToSearchButton } from './HomeActions';
import styles from './HomeFooter.module.css';

// The homepage footer differs from the shared SiteFooter (closing search CTA, guides column,
// full disclaimer and legal row), so it is built here from BeautyFind Homepage.dc.html.
// In the app shell only the disclaimer and copyright show; the links are on the "עוד" tab.

const groups = (guides: HomeGuide[]) => [
  { name: 'אזורים', links: REGIONS.map(r => ({ name: r.name, href: `/${r.slug}` })) },
  {
    name: 'תחומי טיפול',
    links: [
      ...CATEGORIES.map(c => ({ name: c.name, href: `/treatments/${c.slug}` })),
      { name: 'כל תחומי הטיפול', href: '/treatments' },
    ],
  },
  // The newest articles, or the placeholders (which point at /magazine) until the first one is published.
  { name: 'מדריכים', links: [...guides.map(a => ({ name: a.title, href: a.href })), { name: 'כל המדריכים', href: '/magazine' }] },
  {
    name: 'החברה',
    links: [
      { name: 'אודות', href: '/about' },
      { name: 'מרכז עזרה', href: ROUTES.help },
      { name: 'צרו קשר', href: ROUTES.contact },
      { name: 'לעסקים', href: ROUTES.forBusiness },
      { name: 'תקן הרישום', href: ROUTES.listingStandards },
      { name: 'מידע על פרסום', href: ROUTES.sponsorship },
    ],
  },
];

export function HomeFooter({ guides }: { guides: HomeGuide[] }) {
  const GROUPS = groups(guides);
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.cta}>
          <p className={styles.ctaLine}>
            התחילו מטיפול או ממקום<span aria-hidden="true" className={styles.dot}>.</span> אנחנו נראה לכם את העסקים.
          </p>
          <BackToSearchButton className={styles.ctaBtn}>
            חזרה לחיפוש
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 12V2M3 6l4-4 4 4" />
            </svg>
          </BackToSearchButton>
        </div>

        <div className={styles.grid}>
          <div className={styles.brand}>
            <Wordmark size={26} onDark />
            <p>אינדקס לאיתור מכוני יופי, אסתטיקה רפואית, קוסמטיקה, מספרות וספא בכל רחבי ישראל.</p>
          </div>
          {GROUPS.map(g => (
            <nav key={g.name} aria-label={g.name}>
              <div className={styles.groupName}>{g.name}</div>
              <div className={styles.links}>
                {g.links.map(l => (
                  <Link key={l.name} href={l.href} className={styles.link}>{l.name}</Link>
                ))}
              </div>
            </nav>
          ))}
        </div>

        <div className={styles.bottom}>
          <p className={styles.disclaimer}>
            BeautyFind הוא אינדקס לאיתור עסקים. אנחנו מציגים עסקים ומידע על תחומי טיפול כדי לעזור לכם לבחון את האפשרויות, ואיננו נותנים ייעוץ רפואי. התאמת טיפול לגופכם צריכה להיבחן מול איש מקצוע מוסמך.
          </p>
          <div className={styles.legalRow}>
            <span>© <span className="ltr">{new Date().getFullYear()}</span> BeautyFind · Israfind Group</span>
            <nav aria-label="מידע משפטי" className={styles.legal}>
              <Link href={ROUTES.privacy}>מדיניות פרטיות</Link>
              <Link href={ROUTES.terms}>תנאי שימוש</Link>
              <Link href={ROUTES.listingStandards}>תקן הרישום</Link>
              <Link href={ROUTES.accessibility}>הצהרת נגישות</Link>
            </nav>
          </div>
        </div>
      </div>
    </footer>
  );
}
