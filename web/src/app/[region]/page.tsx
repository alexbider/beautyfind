import { BOOKING_LIVE } from '@/lib/features';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { REGION_CONTENT, regionFaqs } from '@/components/region/content';
import { ArrowForward } from '@/components/icons';
import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { BizTabs, type BizTab } from '@/components/treatments/BizTabs';
import { CATEGORY_CONTENT } from '@/components/treatments/content';
import { Faq } from '@/components/treatments/Faq';
import { BIZ, Count, JsonLd, breadcrumbLd, countText, faqLd, fmtInt, median, pctDelta } from '@/components/treatments/format';
import { InfoGlyph } from '@/components/treatments/InfoGlyph';
import { listingBreakdown, ratingMedians, regionFacts } from '@/components/treatments/queries';
import shared from '@/components/treatments/shared.module.css';
import { CATEGORIES, REGIONS, citiesOf, cityHref, regionBySlug, type RegionSlug } from '@/lib/catalog';
import { nis } from '@/lib/format';
import { PLAN_MONTHLY_NIS } from '@/lib/pricing';
import { listBranches, listingCounts, medianPrices } from '@/lib/server/public';
import styles from './page.module.css';

// Design: project/BeautyFind Region.dc.html

export const revalidate = 3600;

export function generateStaticParams() {
  return REGIONS.map(r => ({ region: r.slug }));
}

type Props = { params: Promise<{ region: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { region: slug } = await params;
  const region = regionBySlug(slug);
  if (!region) return {};
  const rc = REGION_CONTENT[region.slug];
  const counts = await listingCounts();
  const n = counts.region[region.slug] ?? 0;
  const cities = citiesOf(region.slug).length;
  const lead = n > 0 ? `${countText(n, 'עסק אחד', 'עסקים')} ב־14 תחומים, ${cities} ערים` : `${cities} ערים ו־14 תחומי טיפול`;
  return {
    title: `יופי ואסתטיקה ${rc.inName}`,
    description: `עסקי יופי ואסתטיקה ${rc.inName}: ${lead}, מחירים חציוניים בשקלים והעסקים המדורגים ביותר באזור.`,
    alternates: { canonical: `/${region.slug}` },
  };
}

export default async function RegionPage({ params }: Props) {
  const { region: slug } = await params;
  const region = regionBySlug(slug);
  if (!region) notFound();
  const r: RegionSlug = region.slug;
  const rc = REGION_CONTENT[r];
  const cities = citiesOf(r);

  const [counts, medRegion, medNational, breakdown, ratings, facts] = await Promise.all([
    listingCounts(),
    medianPrices(r),
    medianPrices(),
    listingBreakdown(),
    ratingMedians(),
    regionFacts(r),
  ]);

  const regionTotal = counts.region[r] ?? 0;
  const cityCount = (citySlug: string) => counts.city[citySlug] ?? 0;
  const citiesSorted = [...cities].sort((a, b) => cityCount(b.slug) - cityCount(a.slug));
  const tabCities = citiesSorted.filter(c => cityCount(c.slug) > 0).slice(0, 4);

  const [regionTop, ...cityTops] = await Promise.all([
    listBranches({ region: r, take: 6 }),
    ...tabCities.map(c => listBranches({ region: r, citySlug: c.slug, take: 4 })),
  ]);

  // Categories: regional counts and medians against the national median.
  const catCounts = breakdown.regionCat[r] ?? {};
  const catRows = CATEGORIES.map((c, i) => {
    const m = medRegion[c.slug] ?? null;
    const nat = medNational[c.slug] ?? null;
    return { ...c, order: i, count: catCounts[c.slug] ?? 0, median: m, national: nat, delta: m != null && nat != null ? pctDelta(m, nat) : null };
  }).sort((a, b) => b.count - a.count || a.order - b.order);
  const activeCats = catRows.filter(c => c.count > 0).length;
  const deltas = catRows.map(c => c.delta).filter((d): d is number => d != null);
  const regionDelta = median(deltas);

  const stats: Array<{ label: string; value: string; note: string }> = [
    { label: 'עסקים באינדקס', value: fmtInt(regionTotal), note: counts.total > 0 ? `${Math.round((regionTotal / counts.total) * 100)}% מהאינדקס` : 'בכל הארץ' },
    { label: 'ערים', value: fmtInt(cities.length), note: activeCats === CATEGORIES.length ? 'כל 14 התחומים' : activeCats > 0 ? `${countText(activeCats, 'תחום טיפול אחד', 'תחומי טיפול')} באזור` : 'בכל האזור' },
  ];
  const rating = ratings.region[r];
  if (rating != null) stats.push({ label: 'דירוג חציוני', value: rating.toFixed(1), note: 'מתוך 5 בגוגל' });
  if (regionDelta != null) {
    const d = Math.round(regionDelta);
    stats.push({ label: 'מול החציון הארצי', value: `${d > 0 ? '+' : ''}${d}%`, note: 'חציון הפער בין התחומים' });
  }

  const cardMeta = (c: { categories: Array<{ name: string }>; cityName: string }) => [c.categories[0]?.name, c.cityName].filter(Boolean).join(' · ');
  const tabs: BizTab[] = [
    {
      key: '',
      name: 'כל האזור',
      inName: rc.inName,
      allHref: `/search?region=${r}`,
      total: regionTop.total,
      items: regionTop.items.map(card => ({ card, meta: cardMeta(card) })),
    },
    ...tabCities.map((c, i) => ({
      key: c.slug,
      name: c.name,
      inName: `ב${c.name}`,
      allHref: cityHref(c),
      total: cityTops[i].total,
      items: cityTops[i].items.map(card => ({ card, meta: cardMeta(card) })),
    })),
  ];

  const pct = (n: number) => `${Math.round((n / facts.total) * 100)}%`;
  const factRows =
    facts.total > 0
      ? [
          { label: 'עסקים עם בעלות מאומתת', value: pct(facts.claimed) },
          ...(BOOKING_LIVE ? [{ label: 'קביעת תור אונליין', value: pct(facts.onlineBooking) }] : []),
          { label: 'נגישות לאנשים עם מוגבלות', value: pct(facts.accessible) },
          { label: 'חניה חינם במקום', value: pct(facts.freeParking) },
        ]
      : [];

  const faqs = [...(rc.faq ? [rc.faq] : []), ...regionFaqs(rc.inName)];

  return (
    <div className={shared.root}>
      <JsonLd data={breadcrumbLd([{ name: 'ראשי', path: '/' }, { name: region.name, path: `/${r}` }])} />
      <JsonLd data={faqLd(faqs)} />
      <SiteHeader variant="public" />

      <div className={styles.hero}>
        <div className={styles.heroCopy}>
          <nav aria-label="נתיב ניווט">
            <ol className={`${shared.crumbs} ${styles.crumbs}`}>
              <li><Link href="/">ראשי</Link></li>
              <li aria-hidden="true" className={shared.crumbSep}>/</li>
              <li aria-current="page" className={shared.crumbNow}>{region.name}</li>
            </ol>
          </nav>
          <h1 className={styles.h1}>
            יופי ואסתטיקה {rc.inName}<span className={shared.dot}>.</span>
          </h1>
          <p className={styles.lede}>
            {regionTotal > 0 ? (
              <>
                <Count n={regionTotal} {...BIZ} /> באינדקס, ב־<span className="ltr tnum">{cities.length}</span> ערים
                {activeCats === CATEGORIES.length ? (
                  ' ובכל 14 תחומי הטיפול'
                ) : activeCats > 0 ? (
                  <>
                    {' '}וב־<Count n={activeCats} one="תחום טיפול אחד" many="תחומי טיפול" />
                  </>
                ) : null}
                .{' '}
              </>
            ) : null}
            {rc.intro}
          </p>
          <div className={styles.heroCtas}>
            <Link href={`/search?region=${r}`} className={shared.btnPrimary}>
              <span>חיפוש עסקים באזור</span>
              <ArrowForward />
            </Link>
            <a href="#cities" className={shared.btnGhost}>לפי עיר</a>
          </div>
        </div>
        <figure className={styles.heroFig}>
          <Image src={`/assets/region-${r}.jpg`} alt={rc.imgAlt} fill priority sizes="(min-width:1180px) 42vw, 100vw" style={{ objectFit: 'cover' }} />
        </figure>
      </div>

      <section aria-label="נתוני האזור" className={styles.statsBand}>
        <dl className={styles.stats} data-cols={stats.length}>
          {stats.map(st => (
            <div key={st.label} className={styles.stat}>
              <dt>{st.label}</dt>
              <dd className={`${styles.statValue} ltr tnum`}>{st.value}</dd>
              <dd className={styles.statNote}>{st.note}</dd>
            </div>
          ))}
        </dl>
      </section>

      <main className={styles.main}>
        <section id="cities" aria-labelledby="h-cities" className={styles.cities}>
          <div className={`${shared.rowHead} ${shared.rowHeadRule}`}>
            <h2 id="h-cities" className={`${shared.h2} ${shared.h2Md}`}>
              <span className="ltr tnum">{cities.length}</span> ערים {rc.inName}<span className={shared.dot}>.</span>
            </h2>
            <span className={shared.rowHeadNote}>מספר העסקים בכל עיר</span>
          </div>
          <ul className={styles.cityGrid}>
            {citiesSorted.map(c => (
              <li key={c.slug}>
                <Link href={cityHref(c)} className={styles.cityCard}>
                  <span className={styles.cityName}>{c.name}</span>
                  <span className={styles.cityCount}>
                    <Count n={cityCount(c.slug)} {...BIZ} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="h-cats" className={styles.block}>
          <div className={`${shared.rowHead} ${shared.rowHeadRule}`}>
            <h2 id="h-cats" className={`${shared.h2} ${shared.h2Md}`}>
              תחומים באזור<span className={shared.dot}>.</span>
            </h2>
            <Link href="/treatments" className={shared.more}>
              <span>כל 14 התחומים</span>
              <ArrowForward size={14} className={shared.moreArrow} />
            </Link>
          </div>
          <div aria-hidden="true" className={styles.catHeader}>
            <span className={styles.cName}>תחום</span>
            <span className={styles.cMedian}>חציון באזור</span>
            <span className={styles.cDelta}>מול הארצי</span>
            <span className={styles.cCount}>עסקים</span>
            <span className={styles.cArrow} />
          </div>
          <ul className={styles.catList}>
            {catRows.map((c, i) => (
              <li key={c.slug} style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}>
                <Link href={`/search?region=${r}&t=${c.slug}`} className={styles.catRow}>
                  <span className={styles.cName}>
                    <span className={styles.catName}>{c.name}</span>
                    <span className={styles.catTop}>{CATEGORY_CONTENT[c.slug]?.examples}</span>
                  </span>
                  <span className={styles.cMedian}>
                    {c.median != null ? (
                      <span className={`${styles.median} ltr tnum`}>{nis(c.median)}</span>
                    ) : (
                      <span className={styles.na}>אין מספיק מחירים</span>
                    )}
                  </span>
                  <span className={styles.cDelta}>
                    {c.delta != null && c.national != null && (
                      <span className={`${styles.delta} ltr tnum`} data-up={c.delta >= 0 || undefined}>
                        {c.delta > 0 ? '+' : ''}
                        {c.delta}% מול {nis(c.national)}
                      </span>
                    )}
                  </span>
                  <span className={`${styles.cCount} ${styles.count}`}>
                    <span className="ltr tnum">{fmtInt(c.count)}</span>
                    <span className="sr-only"> עסקים</span>
                  </span>
                  <span aria-hidden="true" className={`${styles.cArrow} ${styles.arrow}`}>
                    <ArrowForward size={14} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className={shared.note}>
            חציון מתפריטי המחירים שהעסקים באזור מפרסמים. בשקלים, לא כולל מע״מ. הפער מחושב מול החציון הארצי באותו תחום, ותחום עם פחות משלושה מחירים מוצג בלי חציון.
          </p>
        </section>

        <div className={styles.block}>
          <BizTabs
            headingId="h-top"
            heading={
              <h2 id="h-top" className={`${shared.h2} ${shared.h2Md}`}>
                המדורגים ביותר {rc.inName}<span className={shared.dot}>.</span>
              </h2>
            }
            param="city"
            ariaLabel="עיר"
            tabs={tabs}
          />
        </div>

        <section aria-labelledby="h-local" className={`${shared.split} ${styles.block}`}>
          <div className={shared.splitCol}>
            <h2 id="h-local" className={`${shared.h2} ${shared.h2Md} ${styles.localH2}`}>
              מה כדאי לדעת על האזור<span className={shared.dot}>.</span>
            </h2>
            {rc.paras.map(p => (
              <p key={p} className={styles.para}>{p}</p>
            ))}
            <div className={`${shared.infoBox} ${styles.tip}`}>
              <InfoGlyph />
              <p>
                <strong>{rc.tip.title}</strong> {rc.tip.body}
              </p>
            </div>
          </div>
          <div className={shared.splitCol}>
            <h3 className={styles.factsTitle}>נתוני העסקים באזור</h3>
            {factRows.length > 0 ? (
              <ul className={styles.facts}>
                {factRows.map(f => (
                  <li key={f.label}>
                    <span className={styles.factLabel}>{f.label}</span>
                    <span className={`${styles.factValue} ltr tnum`}>{f.value}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.factsEmpty}>הנתונים יוצגו כשיירשמו עסקים באזור.</p>
            )}
            <p className={shared.note}>לפי מה שהעסקים באזור מציינים בפרופיל שלהם.</p>
          </div>
        </section>

        <section aria-labelledby="h-faq" className={`${shared.split} ${styles.block}`}>
          <div className={shared.splitCol}>
            <h2 id="h-faq" className={`${shared.h2} ${shared.h2Md} ${styles.faqH2}`}>
              שאלות נפוצות<span className={shared.dot}>.</span>
            </h2>
            <p className={`${shared.faqLede} ${styles.faqLede}`}>מה שאנשים שואלים לפני שהם מחפשים עסק {rc.inName}.</p>
          </div>
          <Faq items={faqs} variant="rules" />
        </section>

        <section aria-labelledby="h-near" className={`${styles.block} ${styles.near}`}>
          <div className={shared.rowHead}>
            <h2 id="h-near" className={`${shared.h2} ${shared.h2Sm}`}>אזורים סמוכים</h2>
            <span className={shared.rowHeadNote}>להשוואת מחירים וזמינות</span>
          </div>
          <ul className={shared.regionGrid}>
            {rc.near.map(n => (
              <li key={n}>
                <Link href={`/${n}`} className={shared.regionCard}>
                  <span className={shared.regionName}>{regionBySlug(n)!.name}</span>
                  <span className={shared.regionMeta}>
                    <Count n={counts.region[n] ?? 0} {...BIZ} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="h-cta" className={`${shared.cta} ${styles.block}`}>
          <div className={shared.ctaCopy}>
            <h2 id="h-cta">
              יש לכם עסק {rc.inName}<span className={shared.dotLight}>?</span>
            </h2>
            <p>
              {regionTotal > 0 ? (
                <>
                  <Count n={regionTotal} {...BIZ} /> באזור כבר באינדקס.{' '}
                </>
              ) : null}
              רישום כולל תפריט טיפולים עם מחירים, שעות פעילות, WhatsApp וקישור Waze. <span className="ltr tnum">{nis(PLAN_MONTHLY_NIS.basic)}</span> לחודש לסניף, לא כולל מע״מ, ללא התחייבות.
            </p>
          </div>
          <div className={shared.ctaActions}>
            <Link href="/for-business" className={shared.ctaPrimary}>
              <span>רישום עסק</span>
              <ArrowForward />
            </Link>
            <Link href="/for-business/claim" className={shared.ctaGhost}>אישור בעלות על עסק קיים</Link>
          </div>
        </section>
      </main>

      <SiteFooter wide note="מידע כללי בלבד, לא ייעוץ רפואי" />
    </div>
  );
}
