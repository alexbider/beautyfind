import { BOOKING_LIVE } from '@/lib/features';
import type { Metadata } from 'next';
import { applySeo } from '@/lib/server/seo';
import { composeDescription, publicMetadata } from '@/lib/seo/meta';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cardExtras } from '@/app/search/extras';
import { ReadMore } from '@/components/content/ReadMore';
import { REGION_CONTENT, regionFaqs } from '@/components/region/content';
import { ArrowForward } from '@/components/icons';
import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { BizTabs, type BizTab } from '@/components/treatments/BizTabs';
import { CATEGORY_CONTENT } from '@/components/treatments/content';
import { Faq } from '@/components/treatments/Faq';
import { BIZ, Count, JsonLd, countText, fmtInt, pageLd } from '@/components/treatments/format';
import { headlineRange } from '@/lib/marketPrices';
import { marketPrices } from '@/lib/server/marketPrices';
import { businessCount } from '@/lib/seo/businessNoun';
import { InfoGlyph } from '@/components/treatments/InfoGlyph';
import { listingBreakdown, ratingMedians, regionFacts } from '@/components/treatments/queries';
import shared from '@/components/treatments/shared.module.css';
import { CATEGORIES, REGIONS, citiesOf, cityPageHref, regionBySlug, type RegionSlug } from '@/lib/catalog';
import { nis } from '@/lib/format';
import { PLAN_MONTHLY_NIS } from '@/lib/pricing';
import { listBranches, listingCounts } from '@/lib/server/public';
import styles from './page.module.css';

// Design: project/BeautyFind Region.dc.html

export const revalidate = 300;

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
  const lead = n > 0 ? `${businessCount(n)} ב־14 תחומים, ${cities} ערים` : `${cities} ערים ו־14 תחומי טיפול`;
  return applySeo(`/${region.slug}`, publicMetadata({
    path: `/${region.slug}`,
    title: `יופי ואסתטיקה ${rc.inName}: מחירים והשוואה`,
    description: composeDescription([`עסקי יופי ואסתטיקה ${rc.inName}: ${lead}.`, 'מחירים ממוצעים בשקלים לפי תחום, והעסקים המדורגים ביותר באזור.', 'השוו מחירים וקבעו תור.'], ['דירוג בגוגל וביקורות BeautyFind בנפרד.']),
    image: `/assets/region-${region.slug}.jpg`,
  }));
}

export default async function RegionPage({ params }: Props) {
  const { region: slug } = await params;
  const region = regionBySlug(slug);
  if (!region) notFound();
  const r: RegionSlug = region.slug;
  const rc = REGION_CONTENT[r];
  const cities = citiesOf(r);

  const [counts, market, breakdown, ratings, facts] = await Promise.all([
    listingCounts(),
    marketPrices(),
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

  // Categories: regional counts, with the market range of each category's most common treatment.
  const catCounts = breakdown.regionCat[r] ?? {};
  const catRows = CATEGORIES.map((c, i) => ({ ...c, order: i, count: catCounts[c.slug] ?? 0, range: headlineRange(market, c.slug) })).sort((a, b) => b.count - a.count || a.order - b.order);
  const activeCats = catRows.filter(c => c.count > 0).length;

  const stats: Array<{ label: string; value: string; note: string }> = [
    { label: 'עסקים באינדקס', value: fmtInt(regionTotal), note: counts.total > 0 ? `${Math.round((regionTotal / counts.total) * 100)}% מהאינדקס` : 'בכל הארץ' },
    { label: 'ערים', value: fmtInt(cities.length), note: activeCats === CATEGORIES.length ? 'כל 14 התחומים' : activeCats > 0 ? `${countText(activeCats, 'תחום טיפול אחד', 'תחומי טיפול')} באזור` : 'בכל האזור' },
  ];
  const rating = ratings.region[r];
  if (rating != null) stats.push({ label: 'דירוג ממוצע בגוגל', value: rating.toFixed(1), note: 'מתוך 5' });

  // WhatsApp and phone for the phone card's contact buttons.
  const contacts = await cardExtras([...regionTop.items, ...cityTops.flatMap(c => c.items)].map(c => c.id));
  const cardMeta = (c: { categories: Array<{ name: string }>; cityName: string }) => [c.categories[0]?.name, c.cityName].filter(Boolean).join(' · ');
  const tabs: BizTab[] = [
    {
      key: '',
      name: 'כל האזור',
      inName: rc.inName,
      allHref: `/search?region=${r}`,
      total: regionTop.total,
      items: regionTop.items.map(card => ({ card, meta: cardMeta(card), contact: contacts[card.id] })),
    },
    ...tabCities.map((c, i) => ({
      key: c.slug,
      name: c.name,
      inName: `ב${c.name}`,
      allHref: cityPageHref(c),
      total: cityTops[i].total,
      items: cityTops[i].items.map(card => ({ card, meta: cardMeta(card), contact: contacts[card.id] })),
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
      <JsonLd data={pageLd({ path: `/${r}`, type: 'CollectionPage', name: `יופי ואסתטיקה ${rc.inName}`, image: `/assets/region-${r}.jpg`, crumbs: [{ name: 'ראשי', path: '/' }, { name: region.name, path: `/${r}` }], faqs })} />
      <SiteHeader variant="public" title={region.name} backHref="/" />

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
            יופי ואסתטיקה {rc.inName}<span aria-hidden="true" className={shared.dot}>.</span>
          </h1>
          <p className={styles.lede}>
            {regionTotal > 0 ? (
              <>
                {businessCount(regionTotal)} באינדקס, ב־<span className="ltr tnum">{cities.length}</span> ערים
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
          <Image src={`/assets/region-${r}.jpg`} alt={rc.imgAlt} fill priority sizes="(min-width:1180px) 42vw, (min-width:768px) 100vw, 360px" style={{ objectFit: 'cover' }} />
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
              <span className="ltr tnum">{cities.length}</span> ערים {rc.inName}<span aria-hidden="true" className={shared.dot}>.</span>
            </h2>
            <span className={shared.rowHeadNote}>מספר העסקים בכל עיר</span>
          </div>
          <ul className={styles.cityGrid}>
            {citiesSorted.map(c => (
              <li key={c.slug}>
                <Link href={cityPageHref(c)} className={styles.cityCard}>
                  <span className={styles.cityName}>{c.name}</span>
                  <span className={styles.cityCount}>
                    {businessCount(cityCount(c.slug), c.slug)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="h-cats" className={styles.block}>
          <div className={`${shared.rowHead} ${shared.rowHeadRule}`}>
            <h2 id="h-cats" className={`${shared.h2} ${shared.h2Md}`}>
              תחומים באזור<span aria-hidden="true" className={shared.dot}>.</span>
            </h2>
            <Link href="/treatments" className={shared.more}>
              <span>כל 14 התחומים</span>
              <ArrowForward size={14} className={shared.moreArrow} />
            </Link>
          </div>
          <div aria-hidden="true" className={styles.catHeader}>
            <span className={styles.cName}>תחום</span>
            <span className={styles.cRange}>טווח מחיר בשוק</span>
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
                  <span className={styles.cRange}>
                    {c.range && (
                      <>
                        <bdi dir="ltr" className={`${styles.median} tnum`}>{c.range.text}</bdi>
                        <span className={styles.rangeLabel}>{c.range.label}</span>
                      </>
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
            טווח המחיר בשוק של הטיפול הנפוץ בכל תחום, בשקלים כולל מע״מ, מתוך מחירונים ציבוריים, כתבות צרכנות וסקרי מחירים בישראל. הטווח המלא לכל תחום נמצא בדף התחום. המחירים בפרופיל של כל עסק הם המחירים שהעסק פרסם.
          </p>
        </section>

        <div className={styles.block}>
          <BizTabs
            headingId="h-top"
            heading={
              <h2 id="h-top" className={`${shared.h2} ${shared.h2Md}`}>
                המדורגים ביותר {rc.inName}<span aria-hidden="true" className={shared.dot}>.</span>
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
              מה כדאי לדעת על האזור<span aria-hidden="true" className={shared.dot}>.</span>
            </h2>
            <ReadMore lineHeight="29px">
              {rc.paras.map(p => (
                <p key={p} className={styles.para}>{p}</p>
              ))}
            </ReadMore>
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
              שאלות נפוצות<span aria-hidden="true" className={shared.dot}>.</span>
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
                    {businessCount(counts.region[n] ?? 0)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="h-cta" className={`${shared.cta} ${styles.block}`}>
          <div className={shared.ctaCopy}>
            <h2 id="h-cta">
              יש לכם עסק {rc.inName}<span aria-hidden="true" className={shared.dotLight}>?</span>
            </h2>
            <p>
              {regionTotal > 0 ? (
                <>
                  {businessCount(regionTotal)} באזור כבר באינדקס.{' '}
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
            <Link href="/for-business/claim" rel="nofollow" className={shared.ctaGhost}>אישור בעלות על עסק קיים</Link>
          </div>
        </section>
      </main>

      <SiteFooter wide note="מידע כללי בלבד, לא ייעוץ רפואי" />
    </div>
  );
}
