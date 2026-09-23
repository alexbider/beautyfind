import Link from 'next/link';
import type { Category, City, Region } from '@/lib/catalog';
import { ROUTES } from '@/lib/routes';
import { BIZ, CITIES_N, countText, fmtNum } from './copy';
import styles from './Directory.module.css';

interface Props {
  region: Region;
  city: City;
  category?: Category;
  siblings: Array<{ city: City; count: number }>; // in scope (category-aware), most listings first
  regionTotal: number; // in scope
  cityTotal: number; // all categories, only used on a category page
}

/**
 * Empty city (States design, "אזור ללא עסקים"): we never pad a page with unverified businesses.
 * Point to what exists nearby and invite a listing.
 */
export function EmptyCity({ region, city, category, siblings, regionTotal, cityTotal }: Props) {
  const scoped = (c: City) => (category ? `/${c.region}/${c.slug}/${category.slug}` : `/${c.region}/${c.slug}`);
  const cards: Array<{ key: string; name: string; note: string; n: number; href: string }> = [];

  if (category && cityTotal > 0) {
    cards.push({ key: 'city', name: `כל העסקים ב${city.name}`, note: 'בתחומי טיפול אחרים', n: cityTotal, href: `/${region.slug}/${city.slug}` });
  }
  for (const s of siblings.slice(0, cards.length ? 1 : 2)) {
    cards.push({ key: s.city.slug, name: s.city.name, note: category ? `${category.name}, באותו אזור` : 'עיר סמוכה באותו אזור', n: s.count, href: scoped(s.city) });
  }
  if (regionTotal > 0) {
    cards.push({ key: 'region', name: `כל אזור ${region.name}`, note: `${countText(siblings.length, CITIES_N)} עם עסקים`, n: regionTotal, href: `/${region.slug}` });
  }

  const what = category ? `עסקים ל${category.name}` : 'עסקים';

  return (
    <section aria-labelledby="h-empty" className={styles.empty}>
      <div className={styles.emptyHead}>
        <span className={styles.building}>{category ? 'תחום בהקמה בעיר' : 'עיר בהקמה'}</span>
        <h2 id="h-empty" className={styles.emptyH2}>
          עדיין אין {what} ב{city.name}
        </h2>
        <p className={styles.emptyP}>
          {cards.length > 0
            ? 'אנחנו לא מציגים עסקים שלא עברו בדיקה, גם במחיר של עמוד ריק. עד שיצטרפו, הנה מה שיש בסביבה הקרובה.'
            : 'אנחנו לא מציגים עסקים שלא עברו בדיקה, גם במחיר של עמוד ריק. האזור עדיין בהקמה, ואפשר לחפש בכל הארץ.'}
        </p>
      </div>

      {cards.length > 0 ? (
        <div className={styles.sug} data-n={cards.length}>
          {cards.map(c => (
            <Link key={c.key} href={c.href} className={styles.sugCard}>
              <span className={styles.sugText}>
                <span className={styles.sugName}>{c.name}</span>
                <span className={styles.sugNote}>{c.note}</span>
              </span>
              <span className={`${styles.sugN} ltr`} aria-label={countText(c.n, BIZ)}>
                {fmtNum(c.n)}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className={styles.sug} data-n={1}>
          <Link href={ROUTES.home} className={styles.sugCard}>
            <span className={styles.sugText}>
              <span className={styles.sugName}>כל האזורים</span>
              <span className={styles.sugNote}>חיפוש בכל הארץ</span>
            </span>
          </Link>
        </div>
      )}

      <div className={styles.sug} data-n={2}>
        <div className={styles.cta}>
          <h3 className={styles.ctaH3}>יש לכם עסק ב{city.name}?</h3>
          <p className={styles.ctaP}>העסק שלכם יכול להיות הראשון שמופיע כאן. הרישום לוקח כמה דקות, והכרטיס עולה לאוויר אחרי אימות.</p>
          <Link href={ROUTES.forBusiness} className={styles.ctaPrimary}>
            רישום העסק
          </Link>
        </div>
        <div className={styles.cta} data-alt="">
          <h3 className={styles.ctaH3}>מכירים עסק טוב ב{city.name}?</h3>
          <p className={styles.ctaP}>ספרו לנו והצוות יפנה אליו. אנחנו בונים את המדריך מלמטה למעלה.</p>
          <Link href={ROUTES.contact} className={styles.ctaSecondary}>
            המלצה על עסק
          </Link>
        </div>
      </div>
    </section>
  );
}
