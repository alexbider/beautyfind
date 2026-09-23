import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { FaqAccordion } from '@/components/faq/FaqAccordion';
import { ClinicRail } from '@/components/home/ClinicRail';
import {
  ARTICLES, CATEGORY_TEASER, FAQS, FEATURED_SLUG, PROV_POINTS, REGION_IMAGE, STANDARDS, WHAT_ROWS, bizCountText,
} from '@/components/home/content';
import { FindBizLink } from '@/components/home/HomeActions';
import { HomeFooter } from '@/components/home/HomeFooter';
import { HomeHeader, type HeaderRegion } from '@/components/home/HomeHeader';
import { HeroSearch } from '@/components/home/HeroSearch';
import { IsraelMap } from '@/components/home/IsraelMap';
import type { RegionChoice } from '@/components/home/regionStore';
import { ArrowForward, PathIcon } from '@/components/icons';
import { CATEGORIES, CITIES, REGIONS, citiesOf, cityHref, type Category } from '@/lib/catalog';
import { nis } from '@/lib/format';
import { ROUTES } from '@/lib/routes';
import { listBranches, listingCounts, medianPrices, type ListingCard } from '@/lib/server/public';
import styles from './page.module.css';

// Design: project/BeautyFind Homepage.dc.html. Server component; the header, hero search,
// business carousel and region map are client islands. Every count, rating and price is read
// from lib/server/public.ts (live listings only).

const SITE = 'https://beautyfind.co.il';
const TITLE = 'BeautyFind: אינדקס מכוני יופי, אסתטיקה ובריאות בישראל';
const DESCRIPTION =
  'BeautyFind הוא אינדקס לאיתור מכוני יופי, אסתטיקה רפואית, קוסמטיקה, מספרות וספא בכל רחבי ישראל, מהצפון ועד אילת. השוו בין עסקים, גלו טיפולים וקבעו את הפגישה הבאה שלכם.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: { type: 'website', locale: 'he_IL', url: '/', siteName: 'BeautyFind', title: TITLE, description: DESCRIPTION, images: ['/assets/hero-clinic.jpg'] },
};

// Counts and cards change as listings go live; refresh the cached page every 5 minutes.
export const revalidate = 300;

const CARDS_PER_TAB = 10;

const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${SITE}/#website`,
      url: `${SITE}/`,
      name: 'BeautyFind',
      inLanguage: 'he-IL',
      publisher: { '@id': `${SITE}/#organization` },
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${SITE}/search?q={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': 'Organization',
      '@id': `${SITE}/#organization`,
      name: 'BeautyFind',
      url: `${SITE}/`,
      description: DESCRIPTION,
      areaServed: { '@type': 'Country', name: 'Israel' },
    },
  ],
};

const Arrow = () => <ArrowForward size={14} className={styles.arrow} />;
const Dot = ({ ch = '.' }: { ch?: string }) => <span className={styles.dot}>{ch}</span>;

function CountBadge({ n }: { n: number }) {
  return n === 1 ? <>עסק אחד</> : <><span className="ltr">{n}</span> עסקים</>;
}

/** Listing count and median price line for a category tile. The median is hidden when null (fewer than 3 prices). */
function CatMeta({ n, median, onDark }: { n: number; median: number | null | undefined; onDark?: boolean }) {
  return (
    <div className={onDark ? styles.catMetaDark : styles.catMeta}>
      <span><CountBadge n={n} /></span>
      {median != null && (
        <span>
          מחיר חציוני <span className="ltr">{nis(median)}</span>
          <span className={styles.vatNote}>, לא כולל מע״מ</span>
        </span>
      )}
    </div>
  );
}

export default async function HomePage() {
  const [counts, medians, all, ...perRegion] = await Promise.all([
    listingCounts(),
    medianPrices(),
    listBranches({ take: CARDS_PER_TAB }),
    ...REGIONS.map(r => listBranches({ region: r.slug, take: CARDS_PER_TAB })),
  ]);

  const regionCount = (slug: string) => counts.region[slug as keyof typeof counts.region] ?? 0;
  const cityCount = (slug: string) => counts.city[slug] ?? 0;
  // Cities with the most live listings first (stable, so catalog order breaks ties).
  const topCities = (slug: (typeof REGIONS)[number]['slug'], n: number) =>
    [...citiesOf(slug)].sort((a, b) => cityCount(b.slug) - cityCount(a.slug)).slice(0, n);

  const lists = { all: all.items } as Record<RegionChoice, ListingCard[]>;
  const totals = { all: counts.total } as Record<RegionChoice, number>;
  REGIONS.forEach((r, i) => {
    lists[r.slug] = perRegion[i].items;
    totals[r.slug] = perRegion[i].total;
  });

  const headerRegions: HeaderRegion[] = REGIONS.map(r => ({
    slug: r.slug,
    name: r.name,
    count: regionCount(r.slug),
    cities: topCities(r.slug, 5).map(c => ({ name: c.name, href: cityHref(c) })),
  }));

  const featured = CATEGORIES.find(c => c.slug === FEATURED_SLUG)!;
  const rest = CATEGORIES.filter(c => c.slug !== FEATURED_SLUG);
  const teaser = (c: Category) => CATEGORY_TEASER[c.slug];

  return (
    <div className={styles.root}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <a href="#main" className={styles.skip}>דלגו לתוכן</a>
      <HomeHeader regions={headerRegions} total={counts.total} />

      <main id="main">
        {/* ---------- Hero ---------- */}
        <section aria-labelledby="hero-h1" className={styles.hero}>
          <div className={styles.heroClip} aria-hidden="true"><div className={styles.heroGlow} /></div>
          <div className={styles.heroInner}>
            <div className={styles.heroCopy}>
              <div className={styles.eyebrow}>
                <span className={styles.eyebrowLineAnim} aria-hidden="true" />
                אינדקס היופי, האסתטיקה והבריאות של ישראל
              </div>
              <h1 id="hero-h1" className={styles.h1}>
                <span style={{ animationDelay: '.05s' }}>מצאו את מיטב</span>
                <br />
                <span style={{ animationDelay: '.2s' }}>מכוני היופי</span>
                <br />
                <span style={{ animationDelay: '.35s' }}>שלידכם<Dot /></span>
              </h1>
              <p className={styles.lede}>
                מכוני אסתטיקה רפואית, קוסמטיקה, מספרות, ספא ועיצוב הגוף, מקריית שמונה ועד אילת. גלו תחומי טיפול, השוו בין עסקים וקבעו את הפגישה הבאה שלכם.
              </p>
              <div className={styles.heroSearch}>
                <HeroSearch regionCounts={counts.region} cityCounts={counts.city} />
                <div className={styles.regionLine} aria-hidden="true">
                  {REGIONS.map(r => r.name).join(' · ')}
                </div>
              </div>
            </div>

            <div className={styles.heroArt} aria-hidden="true">
              <div className={styles.heroGrid}>
                <figure className={`${styles.fig} ${styles.figWide}`}>
                  <span className={styles.figImgWide}>
                    {/* Hidden below 1000px, so small screens request only the smallest variant. */}
                    <Image src="/assets/hero-clinic.jpg" alt="" fill preload fetchPriority="high" sizes="(min-width: 1000px) 524px, 1px" className={styles.cover} />
                  </span>
                </figure>
                <figure className={`${styles.fig} ${styles.figA}`}>
                  <span className={styles.figImgSq}>
                    <Image src="/assets/hero-skin.jpg" alt="" fill sizes="(min-width: 1000px) 254px, 1px" className={styles.cover} />
                  </span>
                </figure>
                <figure className={`${styles.fig} ${styles.figB}`}>
                  <span className={styles.figImgSq}>
                    <Image src="/assets/hero-consult.jpg" alt="" fill sizes="(min-width: 1000px) 254px, 1px" className={styles.cover} />
                  </span>
                </figure>
              </div>
              <div className={styles.heroDot} />
            </div>
          </div>
        </section>

        {/* ---------- Businesses by region ---------- */}
        <section aria-labelledby="h-clinics" className={styles.clinics}>
          <ClinicRail
            lists={lists}
            totals={totals}
            heading={
              <div className={styles.stack10}>
                <h2 id="h-clinics" className={styles.h2}>מכוני יופי באזור שלכם<Dot /></h2>
                <p className={styles.sub}>העסקים המדורגים ביותר בכל אזור בישראל</p>
              </div>
            }
          />
        </section>

        {/* ---------- What is BeautyFind + region map ---------- */}
        <section aria-labelledby="h-what" className={styles.what}>
          <div className={styles.whatInner}>
            <div className={styles.whatCopy}>
              <div className={styles.stack16}>
                <span className={styles.kicker}><span className={styles.kickerLine} aria-hidden="true" />על הפלטפורמה</span>
                <h2 id="h-what" className={styles.h2What}>מה זה BeautyFind<Dot ch="?" /></h2>
                <p className={styles.whatLede}>
                  פלטפורמת גילוי לעולם היופי, האסתטיקה והבריאות בישראל: פרופילי עסקים, מידע על תחומי טיפול ואינדקסים לפי אזור ועיר, הכול במקום אחד.
                </p>
              </div>
              <dl className={styles.whatRows}>
                <div className={styles.whatRow}>
                  <dt><span className={styles.rowDot} aria-hidden="true" />איפה אנחנו מכסים</dt>
                  <dd>
                    שבעה אזורים בישראל ו־<span className="ltr">{CITIES.length}</span> ערים, לעיון לפי אזור, עיר ועסק. כרגע{' '}
                    {counts.total === 1 ? 'עסק אחד' : <><span className="ltr">{counts.total}</span> עסקים</>} באינדקס.
                  </dd>
                </div>
                {WHAT_ROWS.map(r => (
                  <div key={r.label} className={styles.whatRow} data-muted={r.muted || undefined}>
                    <dt><span className={styles.rowDot} aria-hidden="true" />{r.label}</dt>
                    <dd>{r.value}</dd>
                  </div>
                ))}
              </dl>
              <div className={styles.whatCtas}>
                <Link href="/about" className={styles.btnNavy}><span>אודות BeautyFind</span><Arrow /></Link>
                <a href="#h-how" className={styles.underlineBtn}>איך הרישום באינדקס עובד</a>
              </div>
            </div>
            <div className={styles.mapCol}>
              <IsraelMap counts={counts.region} />
            </div>
          </div>
        </section>

        {/* ---------- Regions ---------- */}
        <section aria-labelledby="h-region" className={styles.regions}>
          <div className={styles.container}>
            <div className={styles.sectionHead}>
              <h2 id="h-region" className={styles.h2}>מצאו טיפול קרוב לבית<Dot /></h2>
              <p className={styles.regionsLede}>
                שבעה אזורים ו־<span className="ltr">{CITIES.length}</span> ערים. לכל אזור אינדקס עסקים משלו.
              </p>
            </div>
            <div className={styles.regionList}>
              {REGIONS.map(r => (
                <article key={r.slug} className={styles.regionRow}>
                  <Link href={`/${r.slug}`} tabIndex={-1} aria-hidden="true" className={styles.regionImg}>
                    <Image src={REGION_IMAGE(r.slug)} alt="" fill sizes="(min-width: 760px) 30vw, 100vw" className={styles.cover} />
                  </Link>
                  <div className={styles.regionBody}>
                    <div className={styles.regionMeta}>
                      <span className={styles.pill}><CountBadge n={regionCount(r.slug)} /></span>
                      <span dir="ltr" className={styles.path}>/{r.slug}</span>
                    </div>
                    <h3 className={styles.regionName}><Link href={`/${r.slug}`}>{r.name}</Link></h3>
                    <div className={styles.regionCities}>
                      {topCities(r.slug, 4).map(c => (
                        <Link key={c.slug} href={cityHref(c)} className={styles.cityLink}>{c.name}</Link>
                      ))}
                    </div>
                  </div>
                  <Link href={`/${r.slug}`} className={styles.roundBtn} aria-label={`לעיון באזור ${r.name}, ${bizCountText(regionCount(r.slug))}`}>
                    <ArrowForward size={20} />
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- Treatments bento ---------- */}
        <section aria-labelledby="h-treat" className={styles.treat}>
          <div className={styles.sectionHead}>
            <div>
              <h2 id="h-treat" className={styles.h2}><span className="ltr">{CATEGORIES.length}</span> תחומי טיפול<Dot /></h2>
              <p className={styles.treatLede}>התחילו מתחום שאתם מכירים, או גלו תחום שתרצו ללמוד עליו יותר.</p>
            </div>
            <Link href="/treatments" className={styles.btnGhost}><span>כל תחומי הטיפול</span><Arrow /></Link>
          </div>
          <div className={styles.bento}>
            <article className={styles.feature}>
              <span className={styles.featureStripes} aria-hidden="true" />
              <span className={styles.featureGlow} aria-hidden="true" />
              <span className={styles.featureIcon} aria-hidden="true">
                <PathIcon paths={teaser(featured).icon} size={30} stroke="#7ED7E1" />
              </span>
              <span className={styles.featureKicker}>התחום המבוקש ביותר</span>
              <h3 className={styles.featureName}><Link href={`/treatments/${featured.slug}`}>{featured.name}</Link></h3>
              <p className={styles.featureText}>{teaser(featured).short}</p>
              <CatMeta n={counts.category[featured.slug] ?? 0} median={medians[featured.slug]} onDark />
              <div>
                <FindBizLink category={featured.slug} className={styles.featureBtn}>מצאו עסקים</FindBizLink>
              </div>
            </article>
            {rest.map(c => (
              <article key={c.slug} className={styles.tile}>
                <div className={styles.tileTop}>
                  <span className={styles.tileGroup}>{c.group}</span>
                  <span className={styles.tileIcon} aria-hidden="true"><PathIcon paths={teaser(c).icon} size={22} /></span>
                </div>
                <div className={styles.tileBody}>
                  <h3 className={styles.tileName}><Link href={`/treatments/${c.slug}`}>{c.name}</Link></h3>
                  <p className={styles.tileText}>{teaser(c).short}</p>
                  <CatMeta n={counts.category[c.slug] ?? 0} median={medians[c.slug]} />
                </div>
                <div>
                  <FindBizLink category={c.slug} className={styles.tileFind}>
                    מצאו עסקים<span className="sr-only"> בתחום {c.name}</span>
                  </FindBizLink>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ---------- Listing standards ---------- */}
        <section aria-labelledby="h-how" className={styles.how}>
          <div className={styles.container}>
            <div className={styles.split}>
              <div className={styles.stack14}>
                <span className={styles.kicker}><span className={styles.kickerLine} aria-hidden="true" />שקיפות</span>
                <h2 id="h-how" className={styles.h2}>איך הרישום באינדקס עובד<Dot /></h2>
              </div>
              <div className={styles.stack16}>
                <p className={styles.howLede}>כל פרופיל עסק בנוי באותו מבנה, כדי שתוכלו להשוות תפוחים לתפוחים. הנה מה שכולל פרופיל ומאיפה המידע מגיע.</p>
                <div className={styles.row10}>
                  <Link href={ROUTES.listingStandards} className={styles.btnNavySm}><span>תקן הרישום שלנו</span><Arrow /></Link>
                  <Link href={ROUTES.sponsorship} className={styles.btnOutline}>איך עובד פרסום ממומן</Link>
                </div>
              </div>
            </div>
            <ol className={styles.standards}>
              {STANDARDS.map(s => (
                <li key={s.n} className={styles.std}>
                  <span className={styles.stdBar} aria-hidden="true" />
                  <span className={styles.stdNum} aria-hidden="true">{s.n}</span>
                  <span className={styles.stdTag}><span className={styles.stdDot} aria-hidden="true" />{s.tag}</span>
                  <h3 className={styles.stdTitle}>{s.title}</h3>
                  <p className={styles.stdBody}>{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------- FAQ ---------- */}
        <section aria-labelledby="h-faq" className={styles.faq}>
          <div className={styles.faqInner}>
            <div className={styles.stack14}>
              <span className={styles.kicker}><span className={styles.kickerLine} aria-hidden="true" />שאלות נפוצות</span>
              <h2 id="h-faq" className={styles.h2}>מה שואלים אותנו<Dot /></h2>
              <p className={styles.faqLede}>תשובות קצרות וישירות על מה זה BeautyFind ואיך משתמשים בו.</p>
              <Link href="/about" className={styles.textLink}><span>עוד על הפלטפורמה</span><Arrow /></Link>
            </div>
            <FaqAccordion items={FAQS} />
          </div>
        </section>

        {/* ---------- Guides (TODO(cms)) ---------- */}
        <section aria-labelledby="h-res" className={styles.res}>
          <div className={styles.container}>
            <div className={styles.sectionHead}>
              <h2 id="h-res" className={styles.h2Res}>קצת ידע. החלטה מושכלת יותר<Dot /></h2>
              <Link href="/magazine" className={styles.btnGhostWhite}><span>לכל המדריכים</span><Arrow /></Link>
            </div>
            <div className={styles.articles}>
              {ARTICLES.map(a => (
                <article key={a.title} className={styles.article}>
                  <Link href={a.href} tabIndex={-1} aria-hidden="true" className={styles.articleImg}>
                    <Image src={a.img} alt="" fill sizes="(min-width: 760px) 30vw, 100vw" className={styles.cover} />
                  </Link>
                  <div className={styles.articleBody}>
                    <span className={styles.articleKind}>{a.kind}</span>
                    <h3 className={styles.articleTitle}><Link href={a.href}>{a.title}</Link></h3>
                    <p className={styles.articleDesc}>{a.desc}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- For businesses ---------- */}
        <section aria-labelledby="h-prov" className={styles.prov}>
          <div className={styles.provCard}>
            <span className={styles.provGlow} aria-hidden="true" />
            <span className={styles.provRing} aria-hidden="true" />
            <div className={styles.provCopy}>
              <span className={styles.kicker}><span className={styles.kickerLine} aria-hidden="true" />לבעלי עסקים</span>
              <h2 id="h-prov" className={styles.h2Prov}>עזרו ללקוחות למצוא את העסק שלכם<Dot /></h2>
              <p className={styles.provLede}>הציגו את השירותים שלכם, הכירו את הצוות ושמרו על פרטי העסק מעודכנים, בעברית ולקהל הישראלי.</p>
              <div className={styles.provCtas}>
                <Link href={ROUTES.claim} className={styles.btnNavyLg}><span>אישור בעלות על העסק</span><Arrow /></Link>
                <Link href={ROUTES.forBusiness} className={styles.btnOutlineLg}>מסלולי רישום</Link>
              </div>
            </div>
            <ul className={styles.provList}>
              {PROV_POINTS.map(p => (
                <li key={p.title} className={styles.provItem}>
                  <span className={styles.provCheck} aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#0B7A87" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 9.5 7 13l7.5-8" /></svg>
                  </span>
                  <span className={styles.provText}><strong>{p.title}</strong><span>{p.body}</span></span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <HomeFooter />
    </div>
  );
}
