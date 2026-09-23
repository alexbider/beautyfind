import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowForward } from '@/components/icons';
import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { CATEGORY_CONTENT, CONTENT_UPDATED, TREATMENTS_FAQS } from '@/components/treatments/content';
import { Faq } from '@/components/treatments/Faq';
import { BIZ, Count, JsonLd, breadcrumbLd, countText, faqLd, fmtInt } from '@/components/treatments/format';
import { ratingMedians } from '@/components/treatments/queries';
import shared from '@/components/treatments/shared.module.css';
import { TreatmentsBrowser, type TreatmentRow } from '@/components/treatments/TreatmentsBrowser';
import { CATEGORIES, CITIES, GROUP_ORDER, MENU_REGION_ORDER, citiesOf, regionBySlug } from '@/lib/catalog';
import { nis } from '@/lib/format';
import { PLAN_MONTHLY_NIS } from '@/lib/pricing';
import { listingCounts, medianPrices } from '@/lib/server/public';
import styles from './page.module.css';

// Design: project/BeautyFind Treatments.dc.html

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const counts = await listingCounts();
  const lead = counts.total > 0 ? `${countText(counts.total, 'עסק אחד', 'עסקים')} ב־7 אזורים` : '7 אזורים';
  return {
    title: '14 תחומי טיפול',
    description: `14 תחומי הטיפול באינדקס BeautyFind: ${lead}, מחירים חציוניים בשקלים ומי מורשה לבצע כל טיפול בישראל.`,
    alternates: { canonical: '/treatments' },
  };
}

export default async function TreatmentsPage() {
  const [counts, medians, ratings] = await Promise.all([listingCounts(), medianPrices(), ratingMedians()]);

  const rows: TreatmentRow[] = CATEGORIES.map(c => {
    const body = CATEGORY_CONTENT[c.slug];
    return {
      slug: c.slug,
      name: c.name,
      group: c.group,
      isMedical: c.isMedical,
      blurb: body?.blurb ?? '',
      tags: body?.tags ?? [],
      img: body?.img ?? '/assets/biz-facial.jpg',
      freq: body?.freq ?? '',
      median: medians[c.slug] ?? null,
      count: counts.category[c.slug] ?? 0,
    };
  });
  // Group order as in the design: medical first.
  const groupOrder = [GROUP_ORDER[1], GROUP_ORDER[0], ...GROUP_ORDER.slice(2)];
  const popular = rows
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => b.count - a.count || a.i - b.i)
    .slice(0, 4);

  const stats = [
    { label: 'תחומי טיפול', value: String(CATEGORIES.length) },
    { label: 'עסקים באינדקס', value: fmtInt(counts.total) },
    { label: 'אזורים', value: '7' },
    ratings.national != null ? { label: 'דירוג חציוני בגוגל', value: ratings.national.toFixed(1) } : { label: 'ערים', value: `${CITIES.length}` },
  ];

  return (
    <div className={shared.root}>
      <JsonLd data={breadcrumbLd([{ name: 'ראשי', path: '/' }, { name: 'תחומי טיפול', path: '/treatments' }])} />
      <JsonLd data={faqLd(TREATMENTS_FAQS)} />
      <SiteHeader variant="public" title="תחומי טיפול" backHref="/search" />

      <nav aria-label="נתיב ניווט" className={shared.crumbBar}>
        <ol className={shared.crumbs}>
          <li><Link href="/">ראשי</Link></li>
          <li aria-hidden="true" className={shared.crumbSep}>/</li>
          <li aria-current="page" className={shared.crumbNow}>תחומי טיפול</li>
        </ol>
      </nav>

      <section aria-labelledby="h-title" className={styles.intro}>
        <div className={styles.introInner}>
          <div className={styles.introCopy}>
            <span className={shared.eyebrow}>
              <span aria-hidden="true" className={shared.eyebrowLine} />
              אינדקס התחומים · כל הארץ
            </span>
            <h1 id="h-title" className={styles.h1}>
              14 תחומי טיפול<span className={shared.dot}>.</span>
            </h1>
            <p className={styles.lede}>
              {counts.total > 0 ? (
                <>
                  <Count n={counts.total} {...BIZ} /> ב־7 אזורים, מחולקים ל־14 תחומים.{' '}
                </>
              ) : null}
              לכל תחום מחיר חציוני בשקלים, תדירות טיפול אופיינית, ומי מורשה על פי חוק לבצע אותו, כי בכמה מהתחומים הגבול בין קוסמטיקה לרפואה הוא רגולטורי ולא אסתטי.
            </p>
            <div className={styles.metaRow}>
              <span className={styles.updated}>
                <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="#8A96A3" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="9" cy="9" r="6.6" />
                  <path d="M9 5.2V9l2.6 1.6" />
                </svg>
                עודכן <time dateTime={CONTENT_UPDATED.iso}>{CONTENT_UPDATED.label}</time>
              </span>
            </div>
          </div>

          <dl className={styles.stats}>
            {stats.map(st => (
              <div key={st.label} className={styles.stat}>
                <dt>{st.label}</dt>
                <dd className="ltr tnum">{st.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <main className={styles.main}>
        <section aria-labelledby="h-popular">
          <div className={shared.rowHead}>
            <h2 id="h-popular" className={`${shared.h2} ${shared.h2Sm}`}>
              התחומים המבוקשים<span className={shared.dot}>.</span>
            </h2>
            <span className={shared.rowHeadNote}>לפי מספר העסקים הרשומים</span>
          </div>
          <ul className={styles.popular}>
            {popular.map((c, i) => (
              <li key={c.slug} style={{ animationDelay: `${i * 60}ms` }}>
                <Link href={`/treatments/${c.slug}`} className={styles.popCard}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- decorative background */}
                  <img src={c.img} alt="" loading="lazy" decoding="async" className={styles.popImg} />
                  <span aria-hidden="true" className={styles.popShade} />
                  <span className={styles.popText}>
                    <span className={styles.popName}>{c.name}</span>
                    <span className={styles.popMeta}>
                      <Count n={c.count} {...BIZ} />
                      {c.median != null && (
                        <>
                          {' '}· חציון <span className="ltr tnum">{nis(c.median)}</span>
                        </>
                      )}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <div className={styles.browser}>
          <TreatmentsBrowser rows={rows} groupOrder={groupOrder} />
        </div>

        <section aria-labelledby="h-regions" className={styles.regions}>
          <div className={shared.rowHead}>
            <h2 id="h-regions" className={`${shared.h2} ${shared.h2Rg}`}>
              לפי אזור<span className={shared.dot}>.</span>
            </h2>
            <span className={styles.regionsNote}>
              7 אזורים · <span className="ltr tnum">{CITIES.length}</span> ערים
            </span>
          </div>
          <ul className={shared.regionGrid}>
            {MENU_REGION_ORDER.map(slug => (
              <li key={slug}>
                <Link href={`/${slug}`} className={shared.regionCard}>
                  <span className={shared.regionName}>{regionBySlug(slug)!.name}</span>
                  <span className={shared.regionMeta}>
                    <Count n={counts.region[slug] ?? 0} {...BIZ} /> · <span className="ltr tnum">{citiesOf(slug).length}</span> ערים
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="h-faq" className={`${shared.split} ${styles.block}`}>
          <div className={shared.splitCol}>
            <h2 id="h-faq" className={`${shared.h2} ${shared.h2Lg} ${styles.faqH2}`}>
              שאלות נפוצות<span className={shared.dot}>.</span>
            </h2>
            <p className={shared.faqLede}>איך לקרוא את האינדקס, ומה חשוב לבדוק לפני שקובעים תור בכל תחום.</p>
          </div>
          <Faq items={TREATMENTS_FAQS} />
        </section>

        <section aria-labelledby="h-cta" className={`${shared.cta} ${styles.block}`}>
          <div className={shared.ctaCopy}>
            <h2 id="h-cta">
              מנהלים עסק באחד התחומים<span className={shared.dotLight}>?</span>
            </h2>
            <p>
              רישום עסק כולל תפריט טיפולים עם מחירים, שעות פעילות, WhatsApp וקישור Waze. <span className="ltr tnum">{nis(PLAN_MONTHLY_NIS.basic)}</span> לחודש לסניף, לא כולל מע״מ, ללא התחייבות.
            </p>
          </div>
          <div className={shared.ctaActions}>
            <Link href="/for-business" className={shared.ctaPrimary}>
              <span>רישום עסק</span>
              <ArrowForward />
            </Link>
            <Link href="/listing-standards" className={shared.ctaGhost}>תקן הרישום</Link>
          </div>
        </section>
      </main>

      <SiteFooter wide note="מידע כללי בלבד, לא ייעוץ רפואי" />
    </div>
  );
}
