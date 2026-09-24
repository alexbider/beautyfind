import Link from 'next/link';
import type { ProfileView } from '@/app/[region]/biz/[slug]/data';
import { fromE164, telHref } from '@/lib/format';
import { ROUTES } from '@/lib/routes';
import type { PublicProfile } from '@/lib/server/public';
import { initials } from './format';
import styles from './Unclaimed.module.css';

/**
 * Listing that no owner has claimed yet (States design, "unclaimed"): says plainly the details
 * are unverified, shows basic info only, and offers ownership claim, a correction report and verified alternatives.
 */
export function UnclaimedProfile({ p, v }: { p: PublicProfile; v: ProfileView }) {
  const cats = v.cats.map(c => c.name).join(', ');
  const full = p.address.includes(p.cityName) ? p.address : `${p.address}, ${p.cityName}`;
  const verifiedHref = v.citySlug ? `/${p.regionSlug}/${v.citySlug}` : `/${p.regionSlug}`;
  const correction = `${ROUTES.contact}?reason=correction&page=${encodeURIComponent(p.href)}`;
  return (
    <main className={styles.bg}>
      <div className={styles.wrap}>
        <div className={styles.card}>
          <p className={styles.warn}>הכרטיס הזה אינו מנוהל על ידי העסק. הפרטים נאספו ממקורות פומביים וייתכן שאינם מעודכנים.</p>

          <div className={styles.id}>
            <span aria-hidden="true" className={styles.mono}>{initials(p.name)}</span>
            <div className={styles.idText}>
              <h1 className={styles.h1}>{p.name}</h1>
              <p className={styles.sub}>{[full, p.region.name, cats].filter(Boolean).join(' · ')}</p>
              <span className={styles.tag}>לא מאומת</span>
            </div>
          </div>

          <dl className={styles.fields}>
            <div className={styles.field}>
              <dt>טלפון</dt>
              {p.phone ? (
                <dd>
                  <a href={telHref(p.phone)} dir="ltr" className="ltr">{fromE164(p.phone)}</a>
                </dd>
              ) : (
                <dd data-tone="muted">לא ידוע</dd>
              )}
            </div>
            <div className={styles.field}>
              <dt>שעות פעילות</dt>
              {v.hoursRows ? (
                <dd>{v.todayRange ? <>היום <span dir="ltr" className="ltr" style={{ whiteSpace: 'nowrap' }}>{v.todayRange}</span></> : 'היום סגור'}</dd>
              ) : (
                <dd data-tone="muted">לא ידוע</dd>
              )}
            </div>
            <div className={styles.field}>
              <dt>מחירים</dt>
              <dd data-tone="muted">לא פורסמו</dd>
            </div>
            <div className={styles.field}>
              <dt>{v.responsible?.label ?? 'אחריות רפואית'}</dt>
              {v.responsible ? <dd>{v.responsible.name}</dd> : <dd data-tone="warn">לא הוצהרה</dd>}
            </div>
          </dl>

          <div className={styles.sugs}>
            <div className={styles.sug} data-main>
              <h2>זה העסק שלכם?</h2>
              <p>אפשר לקבל שליטה על הכרטיס, לעדכן טיפולים, מחירים ושעות, ולקבל פניות ישירות לעסק.</p>
              <Link href={ROUTES.claim} className={styles.go} data-main>אישור בעלות</Link>
            </div>
            <div className={styles.sug}>
              <h2>משהו כאן לא מדויק?</h2>
              <p>דיווח על פרט שגוי נבדק בתוך יום עסקים.</p>
              <Link href={correction} className={styles.go}>דיווח על תיקון</Link>
            </div>
            <div className={styles.sug}>
              <h2>מחפשים תור עכשיו?</h2>
              <p>עסקים מאומתים ב{p.cityName}, עם מחירים ופרטי קשר מעודכנים.</p>
              <Link href={verifiedHref} className={styles.go}>עסקים מאומתים</Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
