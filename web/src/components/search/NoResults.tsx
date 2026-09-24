import Link from 'next/link';
import { BizCount } from './Plural';
import s from './search.module.css';

export interface Rescue {
  key: string;
  name: string;
  note: string;
  href: string;
  n: number;
}

/**
 * No-results state (Search design box + States "אין תוצאות"): what to do next, each way out
 * with the real number of businesses it leads to, and a way to browse by treatment instead.
 * Every exit is a plain link, so it works before hydration and is crawlable.
 */
export function NoResults({ rescues, categories, hasFilters }: { rescues: Rescue[]; categories: Array<{ slug: string; name: string }>; hasFilters: boolean }) {
  return (
    <div className={s.noRes}>
      <h3 className={s.noResTitle}>אין עסקים שמתאימים לכל התנאים</h3>
      <p className={s.noResLine}>
        {hasFilters
          ? 'נסו להסיר סינון אחד, להרחיב לאזור שלם, או לחפש בכל הארץ. לרוב מספיק לשנות דבר אחד.'
          : 'לא מצאנו עסק שהשם, העיר או הטיפולים שלו תואמים את החיפוש. נסו מילה אחרת, או עיינו לפי תחום טיפול.'}
      </p>

      {rescues.length > 0 && (
        <>
          <p className={s.noResSub}>נסו להרחיב את החיפוש</p>
          <div className={s.widenGrid}>
            {rescues.map(r => (
              <Link key={r.key} href={r.href} className={s.widen} scroll={false}>
                <span className={s.widenText}>
                  <span className={s.widenName}>{r.name}</span>
                  <span className={s.widenNote}>{r.note}</span>
                </span>
                <span className={s.widenN}>
                  <BizCount n={r.n} />
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      <p className={s.noResSub}>או עיינו לפי תחום טיפול</p>
      <div className={s.noResCats}>
        {categories.map(c => (
          <Link key={c.slug} href={`/treatments/${c.slug}`} className={s.noResCat}>
            {c.name}
          </Link>
        ))}
        <Link href="/treatments" className={s.noResAll}>
          כל תחומי הטיפול
        </Link>
      </div>
    </div>
  );
}
