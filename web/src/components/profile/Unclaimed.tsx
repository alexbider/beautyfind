import Link from 'next/link';
import type { ProfileView } from '@/app/[region]/biz/[slug]/data';
import { fromE164, telHref } from '@/lib/format';
import { ROUTES } from '@/lib/routes';
import type { PublicProfile } from '@/lib/server/public';
import { initials } from './format';
import { Gallery } from './Gallery';
import { Price, Services } from './Services';
import styles from './Unclaimed.module.css';

/**
 * Listing that no owner has claimed yet (States design, "unclaimed"): says plainly the details
 * are unverified and were collected from public sources, shows what is known (photos and logo from the
 * business's own website, its services and prices, links), and offers ownership claim, a correction
 * report and verified alternatives.
 */
export function UnclaimedProfile({ p, v }: { p: PublicProfile; v: ProfileView }) {
  const cats = v.cats.map(c => c.name).join(', ');
  const full = p.address.includes(p.cityName) ? p.address : `${p.address}, ${p.cityName}`;
  const verifiedHref = v.citySlug ? `/${p.regionSlug}/${v.citySlug}` : `/${p.regionSlug}`;
  const correction = `${ROUTES.contact}?reason=correction&page=${encodeURIComponent(p.href)}`;
  const amount = (x: { amount: string }) => Number(x.amount.replace(/[^\d.]/g, '')) || Infinity;
  const lowest = v.services.map(g => g.from).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => amount(a) - amount(b))[0] ?? null;
  const insta = p.instagram ? (p.instagram.startsWith('http') ? p.instagram : `https://www.instagram.com/${p.instagram.replace(/^@/, '')}`) : null;
  const site = p.websiteUrl && p.websiteUrl !== insta ? p.websiteUrl : null;
  const siteLabel = site
    ? /google\.[a-z.]+\/maps/.test(site) ? 'פרופיל Google' : /facebook\.com/.test(site) ? 'פייסבוק' : /instagram\.com/.test(site) ? 'אינסטגרם' : site.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
    : null;
  return (
    <main className={styles.bg}>
      <div className={styles.wrap}>
        <div className={styles.card}>
          <p className={styles.warn}>הכרטיס הזה אינו מנוהל על ידי העסק. הפרטים נאספו ממקורות פומביים וייתכן שאינם מעודכנים.</p>

          {v.photos.length > 0 && (
            <div className={styles.photos}>
              <Gallery photos={v.photos} />
            </div>
          )}

          <div className={styles.id}>
            <span aria-hidden="true" className={styles.mono}>{p.logoUrl ? <img src={p.logoUrl} alt="" /> : initials(p.name)}</span>
            <div className={styles.idText}>
              <h1 className={styles.h1}>{p.name}</h1>
              <p className={styles.sub}>{[full, p.region.name, cats].filter(Boolean).join(' · ')}</p>
              <span className={styles.tag}>לא מאומת</span>
              {v.google ? (
                <p className={styles.rating}>
                  <a href={v.googleHref} target="_blank" rel="noopener nofollow">
                    <span aria-hidden="true">★</span> <bdi>{v.google.rating.toFixed(1)}</bdi> · <bdi>{v.google.count.toLocaleString('he-IL')}</bdi> ביקורות ב־<bdi>Google</bdi>
                  </a>
                </p>
              ) : null}
              {site || insta ? (
                <p className={styles.links}>
                  {site ? <a href={site} target="_blank" rel="noopener nofollow" dir={siteLabel?.startsWith('פרופיל') ? undefined : 'ltr'} className={siteLabel?.startsWith('פרופיל') ? undefined : 'ltr'}>{siteLabel}</a> : null}
                  {insta ? <a href={insta} target="_blank" rel="noopener nofollow">אינסטגרם</a> : null}
                </p>
              ) : null}
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
              {lowest ? <dd><Price p={lowest} /></dd> : <dd data-tone="muted">לא פורסמו</dd>}
            </div>
            <div className={styles.field}>
              <dt>{v.responsible?.label ?? 'אחריות רפואית'}</dt>
              {v.responsible ? <dd>{v.responsible.name}</dd> : <dd data-tone="warn">לא הוצהרה</dd>}
            </div>
          </dl>

          {v.services.length > 0 && (
            <section aria-labelledby="h-un-services" className={styles.services}>
              <h2 id="h-un-services" className={styles.h2}>שירותים ומחירים</h2>
              <p className={styles.note}>נאספו מאתר העסק ועשויים להשתנות. המחירים לא כוללים מע״מ. בעל העסק יכול לעדכן אותם אחרי אישור בעלות.</p>
              <Services groups={v.services} contact={false} />
            </section>
          )}

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
