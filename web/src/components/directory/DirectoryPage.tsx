import { BOOKING_LIVE } from '@/lib/features';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Fragment, type ReactNode } from 'react';
import { ArrowForward } from '@/components/icons';
import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { CITIES, categoryBySlug, regionBySlug, type Category, type City, type Region } from '@/lib/catalog';
import { ROUTES } from '@/lib/routes';
import { BIZ, CITIES_N, FIELDS_N, SEO_TERM, TRUST, countText, directoryFaqs, fmtNum, heDate, heMonth, isoDate } from './copy';
import { Count } from './Count';
import { getListings, getOverview, type DirectoryCard, type Overview } from './data';
import { EmptyCity } from './EmptyCity';
import { GuideExpander } from './GuideExpander';
import { ListingCard } from './ListingCard';
import { PAGE, dirHref, hasParams, parseQuery, type DirQuery } from './params';
import { ResultsShell } from './ResultsShell';
import { SidebarFaq } from './SidebarFaq';
import styles from './Directory.module.css';

// Design: project/BeautyFind Directory.dc.html (pageType=city and pageType=treatment).
// Empty city: project/BeautyFind States.dc.html → "אזור ללא עסקים".

/** Same origin as the root layout's metadataBase, so JSON-LD URLs match the canonical. */
const ORIGIN = 'https://beautyfind.co.il';

export type DirParams = Promise<{ region: string; city: string; category?: string }>;
export type DirSearch = Promise<Record<string, string | string[] | undefined>>;

interface Scope {
  region: Region;
  city: City;
  category?: Category;
  cityPath: string;
  path: string;
}

async function resolveScope(params: DirParams): Promise<Scope> {
  const p = await params;
  const region = regionBySlug(p.region);
  const city = CITIES.find(c => c.slug === p.city);
  if (!region || !city || city.region !== region.slug) notFound();
  let category: Category | undefined;
  if (p.category !== undefined) {
    category = categoryBySlug(p.category);
    if (!category) notFound();
  }
  const cityPath = `/${region.slug}/${city.slug}`;
  return { region, city, category, cityPath, path: category ? `${cityPath}/${category.slug}` : cityPath };
}

const N = ({ children }: { children: ReactNode }) => <span className="ltr">{children}</span>;
const nis = (n: number) => `₪${fmtNum(n)}`;

// ---------- metadata ----------

export async function directoryMetadata(params: DirParams, searchParams: DirSearch): Promise<Metadata> {
  const s = await resolveScope(params);
  const q = parseQuery(await searchParams);
  const o = await getOverview(s.region.slug, s.city.slug, s.category?.slug);
  const where = `ב${s.city.name}`;
  const title = s.category ? `${SEO_TERM[s.category.slug] ?? s.category.name} ${where}` : `מכוני יופי ואסתטיקה ${where}`;
  const description =
    o.total === 0
      ? s.category
        ? `עדיין אין עסקים ל${s.category.name} ${where}. עסקים בערים סמוכות באזור ${s.region.name}, ורישום עסק חדש ב־BeautyFind.`
        : `עדיין אין עסקים רשומים ${where}. עסקים בערים סמוכות באזור ${s.region.name}, ורישום עסק חדש ב־BeautyFind.`
      : `${countText(o.total, BIZ)}${s.category ? ` ל${s.category.name}` : ' ליופי, אסתטיקה וקוסמטיקה'} ${where}` +
        (o.verified === 0
          ? ''
          : o.total === 1
            ? ', מאומת'
            : o.verified === o.total
              ? ', כולם מאומתים'
              : o.verified === 1
                ? ', אחד מהם מאומת'
                : `, מתוכם ${fmtNum(o.verified)} מאומתים`) +
        `. דירוג Google וביקורות BeautyFind מאומתות בנפרד, מחירים חציוניים ${BOOKING_LIVE ? 'וקביעת תור אונליין' : 'ופנייה ישירה לעסק'}.`;
  return {
    title,
    description,
    alternates: { canonical: s.path },
    robots: o.total === 0 || hasParams(q) ? { index: false, follow: true } : undefined,
    openGraph: { title, description, url: s.path, locale: 'he_IL', type: 'website', images: [`/assets/region-${s.region.slug}.jpg`] },
  };
}

// ---------- JSON-LD ----------

function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}

function breadcrumbLd(s: Scope) {
  const trail = [
    { name: 'ראשי', url: `${ORIGIN}/` },
    { name: s.region.name, url: `${ORIGIN}/${s.region.slug}` },
    { name: s.city.name, url: `${ORIGIN}${s.cityPath}` },
    ...(s.category ? [{ name: s.category.name, url: `${ORIGIN}${s.path}` }] : []),
  ];
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: t.url })),
  };
}

function itemListLd(items: DirectoryCard[], name: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: items.length,
    itemListElement: items.map((c, i) => ({ '@type': 'ListItem', position: i + 1, url: `${ORIGIN}${c.href}`, name: c.name })),
  };
}

function faqLd(faqs: Array<{ q: string; a: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}

// ---------- page ----------

export async function DirectoryPage({ params, searchParams }: { params: DirParams; searchParams: DirSearch }) {
  const s = await resolveScope(params);
  const q = parseQuery(await searchParams);
  const [o, list] = await Promise.all([
    getOverview(s.region.slug, s.city.slug, s.category?.slug),
    getListings({ region: s.region.slug, city: s.city, category: s.category?.slug }, q),
  ]);

  const where = `ב${s.city.name}`;
  const title = s.category ? `${s.category.name} ${where}` : `מכוני יופי ואסתטיקה ${where}`;
  const faqs = directoryFaqs(s.city.name);
  const crumbs = [
    { name: 'ראשי', href: '/' },
    { name: s.region.name, href: `/${s.region.slug}` },
    ...(s.category ? [{ name: s.city.name, href: s.cityPath }] : []),
  ];
  const current = s.category ? s.category.name : s.city.name;

  const header = (
    <>
      <SiteHeader variant="public" />
      <nav aria-label="נתיב ניווט" className={styles.crumbs}>
        <ol>
          {crumbs.map(c => (
            <Fragment key={c.href}>
              <li>
                <Link href={c.href}>{c.name}</Link>
              </li>
              <li aria-hidden="true">/</li>
            </Fragment>
          ))}
          <li aria-current="page">{current}</li>
        </ol>
      </nav>
    </>
  );

  const hero = (
    <figure className={styles.hero}>
      <Image src={`/assets/region-${s.region.slug}.jpg`} alt={`נוף באזור ${s.region.name}`} fill priority sizes="(min-width:1080px) 36vw, 100vw" />
      <span aria-hidden="true" className={styles.ping} />
    </figure>
  );

  const eyebrow = s.category ? `${s.category.name} · ${s.city.name}` : `אינדקס עסקים · ${s.city.name}`;

  // ---------- empty city / empty category in city ----------
  if (o.total === 0) {
    const cityAll = s.category ? await getOverview(s.region.slug, s.city.slug, undefined) : null;
    return (
      <div className={styles.root}>
        <JsonLd data={breadcrumbLd(s)} />
        {header}
        <main>
          <div className={styles.wrap}>
            <div className={styles.intro}>
              <div className={styles.introText}>
                <span className={styles.eyebrow}>{eyebrow}</span>
                <h1 className={styles.h1}>
                  {title}
                  <span className={styles.dot}>.</span>
                </h1>
                <p className={styles.answer}>
                  {s.category
                    ? `עדיין אין ${where} עסקים רשומים ל${s.category.name}. ריכזנו כאן עסקים בתחום בערים סמוכות באזור ${s.region.name}.`
                    : `עדיין אין ${where} עסקים רשומים ב־BeautyFind. ריכזנו כאן את הערים הקרובות באזור ${s.region.name} שבהן יש כבר עסקים.`}
                </p>
              </div>
              {hero}
            </div>
            <EmptyCity
              region={s.region}
              city={s.city}
              category={s.category}
              siblings={o.siblings}
              regionTotal={o.regionTotal}
              cityTotal={cityAll?.total ?? 0}
            />
          </div>
          <div className={styles.spacer} />
        </main>
        <SiteFooter wide note="מידע כללי בלבד, לא ייעוץ רפואי" />
      </div>
    );
  }

  // ---------- listing ----------
  const matched = list.total;
  const shown = list.items.length;
  const topCat = [...o.cityCategories].sort((a, b) => b.count - a.count)[0];
  const ownPrice = s.category ? o.prices.find(p => p.slug === s.category!.slug) : undefined;
  const headlinePrice = s.category ? ownPrice : (o.prices.find(p => p.slug === topCat?.slug) ?? o.prices[0]);

  const answer = (
    <>
      {where}{' '}
      {o.total === 1 ? (
        <>רשום עסק אחד</>
      ) : (
        <>
          רשומים <N>{fmtNum(o.total)}</N> {s.category ? 'עסקים' : 'מכוני יופי, אסתטיקה וקוסמטיקה'}
        </>
      )}
      {s.category && ` ל${s.category.name}`}
      {o.medianGoogle != null && (
        <>
          , עם דירוג Google חציוני של <N>{o.medianGoogle.toFixed(1)}</N>
        </>
      )}
      .
      {!s.category && topCat && o.cityCategories.length > 1 && (
        <>
          {' '}
          התחום הנפוץ ביותר בעיר הוא {topCat.name}, עם <Count n={topCat.count} f={BIZ} />.
        </>
      )}
      {headlinePrice && (
        <>
          {' '}
          המחיר החציוני ל{headlinePrice.name} הוא <N>{nis(headlinePrice.price)}</N> לפני מע״מ
          {headlinePrice.fromRegion && ` (לפי חציון אזור ${s.region.name})`}.
        </>
      )}
    </>
  );

  const stats: Array<{ label: string; value: string | null }> = [
    { label: 'עסקים רשומים', value: fmtNum(o.total) },
    { label: 'דירוג Google חציוני', value: o.medianGoogle?.toFixed(1) ?? null },
    s.category ? { label: 'מחיר חציוני', value: ownPrice ? nis(ownPrice.price) : null } : { label: 'תחומי טיפול', value: fmtNum(o.cityCategories.length) },
    { label: 'עסקים מאומתים', value: fmtNum(o.verified) },
  ];

  const nFilters = q.filters.length;
  const resultCount =
    nFilters > 0 ? (
      <>
        <N>{fmtNum(matched)}</N> מתוך <Count n={o.total} f={BIZ} />
      </>
    ) : (
      <Count n={o.total} f={BIZ} />
    );

  const clearHref = dirHref(s.path, { ...q, filters: [], show: PAGE } satisfies DirQuery);
  const searchHref = `/search?region=${s.region.slug}&city=${s.city.slug}${s.category ? `&t=${s.category.slug}` : ''}`;
  const anyPrice = list.items.some(c => c.priceFromShekels != null);
  const few = o.total <= 3 && o.siblings.length > 0;
  const siblingHref = (c: City) => (s.category ? `/${c.region}/${c.slug}/${s.category.slug}` : `/${c.region}/${c.slug}`);

  return (
    <div className={styles.root}>
      <JsonLd data={breadcrumbLd(s)} />
      {list.items.length > 0 && <JsonLd data={itemListLd(list.items.slice(0, PAGE), title)} />}
      <JsonLd data={faqLd(faqs)} />
      {header}

      <main>
        <div className={styles.wrap}>
          <div className={styles.intro}>
            <div className={styles.introText}>
              <span className={styles.eyebrow}>{eyebrow}</span>
              <h1 className={styles.h1}>
                {title}
                <span className={styles.dot}>.</span>
              </h1>
              <p className={styles.answer}>{answer}</p>
              <p className={styles.lede}>
                הרשימה מסודרת לפי אימות הרישום, דירוג Google ומספר הביקורות, לא לפי תשלום. כל עסק מציג את תפריט הטיפולים עם מחירים ואת דרכי ההתקשרות הישירות אליו, ובעסקים עם טיפולים רפואיים גם את הרופא האחראי.
              </p>

              <div className={styles.meta}>
                {o.updatedAt && (
                  <span className={styles.metaItem}>
                    <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="#8A96A3" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="9" cy="9" r="6.6" />
                      <path d="M9 5.2V9l2.6 1.6" />
                    </svg>
                    עודכן <time dateTime={isoDate(o.updatedAt)}>{heDate(o.updatedAt)}</time>
                  </span>
                )}
                <a href="#method" className={styles.metaLink}>
                  <span>איך אנחנו מדרגים עסקים</span>
                </a>
              </div>

              <dl className={styles.stats}>
                {stats.map(st => (
                  <div key={st.label} className={styles.stat}>
                    <dt>{st.label}</dt>
                    <dd>{st.value != null ? <N>{st.value}</N> : 'אין עדיין'}</dd>
                  </div>
                ))}
              </dl>
            </div>
            {hero}
          </div>

          <div className={styles.main}>
            <div className={styles.col}>
              <section aria-labelledby="h-list">
                <div className={styles.listHead}>
                  <h2 id="h-list" className={styles.h2}>
                    {s.category ? `עסקים ל${s.category.name}` : 'העסקים המובילים'}
                    <span className={styles.dot}>.</span>
                  </h2>
                  <span className={styles.resultCount}>{resultCount}</span>
                </div>

                {/* TODO(sponsored): up to 2 "ממומן" slots per list go here, rendered apart from the ranked list,
                    once the campaigns table exists. Sponsored never changes the order below. */}
                <ResultsShell base={s.path} query={q} filterCounts={o.filterCounts} matched={matched} total={o.total} shown={shown} searchHref={searchHref}>
                  {list.items.length === 0 ? (
                    <div className={styles.none}>
                      <span className={styles.noneTitle}>אין עסקים שעומדים בכל הסינונים</span>
                      <span className={styles.noneText}>נסו להסיר אפשרות אחת, או לעיין בעיר סמוכה.</span>
                      <Link href={clearHref} scroll={false} className={styles.outlineBtn}>
                        נקו את כל הסינונים
                      </Link>
                    </div>
                  ) : (
                    <>
                      <ol className={styles.cards}>
                        {list.items.map((c, i) => (
                          <ListingCard key={c.id} c={c} delayIndex={i % PAGE} />
                        ))}
                      </ol>
                      {anyPrice && <p className={styles.vatNote}>המחירים בכרטיסים לפני מע״מ.</p>}
                    </>
                  )}
                </ResultsShell>

                {few && (
                  <div className={styles.nearby}>
                    <h3 className={styles.nearbyTitle}>עוד אפשרויות קרוב ל{s.city.name}</h3>
                    <p className={styles.nearbyText}>
                      {s.category ? `עסקים ל${s.category.name}` : 'עסקים'} בערים סמוכות באזור {s.region.name}:
                    </p>
                    <ul className={styles.pills}>
                      {o.siblings.slice(0, 6).map(sb => (
                        <li key={sb.city.slug}>
                          <Link href={siblingHref(sb.city)} className={styles.pill}>
                            {sb.city.name} <span className={`${styles.pillCount} ltr`}>{fmtNum(sb.count)}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>

              <Guide s={s} o={o} />

              <section aria-labelledby="h-related" className={styles.related}>
                <h2 id="h-related" className={styles.relatedH2}>
                  להמשיך לחקור<span className={styles.dot}>.</span>
                </h2>
                <div className={styles.relatedGrid}>
                  <div className={styles.relatedCol}>
                    <div className={styles.relatedHead}>
                      <h3 className={styles.relatedH3}>תחומי טיפול {where}</h3>
                      <span className={styles.relatedNote}><Count n={o.cityCategories.length} f={FIELDS_N} /></span>
                    </div>
                    <ul className={styles.pills}>
                      {s.category && (
                        <li>
                          <Link href={s.cityPath} className={styles.pill}>
                            כל העסקים {where}
                          </Link>
                        </li>
                      )}
                      {o.cityCategories.map(c => (
                        <li key={c.slug}>
                          <Link href={`${s.cityPath}/${c.slug}`} className={styles.pill} aria-current={c.slug === s.category?.slug ? 'page' : undefined}>
                            {c.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className={styles.relatedCol}>
                    <div className={styles.relatedHead}>
                      <h3 className={styles.relatedH3}>ערים נוספות ב{s.region.name}</h3>
                      {o.siblings.length > 0 && <span className={styles.relatedNote}><Count n={o.siblings.length} f={CITIES_N} /></span>}
                    </div>
                    <ul className={styles.rows}>
                      {o.siblings.slice(0, 6).map(sb => (
                        <li key={sb.city.slug}>
                          <Link href={siblingHref(sb.city)} className={styles.rowLink}>
                            <span>{sb.city.name}</span>
                            <span className={styles.rowEnd}>
                              <span className={`${styles.rowCount} ltr`}>{fmtNum(sb.count)}</span>
                              <ArrowForward size={13} />
                            </span>
                          </Link>
                        </li>
                      ))}
                      <li>
                        <Link href={`/${s.region.slug}`} className={styles.rowLink}>
                          <span>כל אזור {s.region.name}</span>
                          <span className={styles.rowEnd}>
                            <ArrowForward size={13} />
                          </span>
                        </Link>
                      </li>
                    </ul>
                  </div>
                </div>
              </section>
            </div>

            <aside aria-label="על האינדקס" className={styles.aside}>
              <div id="method" className={styles.trust}>
                <h2 className={styles.asideH2}>
                  למה לסמוך על BeautyFind<span className={styles.dot}>.</span>
                </h2>
                <p className={styles.trustLede}>עסקים אינם יכולים לשלם כדי לשנות את מקומם ברשימה הזו.</p>
                {TRUST.map(t => (
                  <div key={t.title} className={styles.trustRow}>
                    <span aria-hidden="true" className={styles.trustIcon}>
                      <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="#0B7A87" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        {t.icon.map(d => (
                          <path key={d} d={d} />
                        ))}
                      </svg>
                    </span>
                    <span className={styles.trustText}>
                      <span className={styles.trustTitle}>{t.title}</span>
                      <span className={styles.trustBody}>{t.body}</span>
                    </span>
                  </div>
                ))}
                <Link href={ROUTES.listingStandards} className={styles.method}>
                  <span>המתודולוגיה המלאה שלנו</span>
                  <ArrowForward size={13} />
                </Link>
              </div>

              <div className={styles.find}>
                <h2 className={styles.findH2}>מצאו עסק לידכם</h2>
                <form action="/search" method="get" role="search">
                  <label className={styles.search}>
                    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="#8A96A3" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" style={{ flex: 'none' }}>
                      <circle cx="8" cy="8" r="5.4" />
                      <path d="M12.2 12.2 16 16" />
                    </svg>
                    <input type="search" name="q" placeholder="שם עסק או טיפול" aria-label={`חיפוש עסק או טיפול ${where}`} enterKeyHint="search" />
                  </label>
                  <input type="hidden" name="region" value={s.region.slug} />
                  <input type="hidden" name="city" value={s.city.slug} />
                  {s.category && <input type="hidden" name="t" value={s.category.slug} />}
                </form>
                {o.siblings.length > 0 && (
                  <div className={styles.findChips}>
                    {o.siblings.slice(0, 6).map(sb => (
                      <Link key={sb.city.slug} href={siblingHref(sb.city)} className={styles.findChip}>
                        {sb.city.name}
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <section aria-labelledby="h-faq" className={styles.faq}>
                <h2 id="h-faq" className={styles.asideH2}>
                  {s.category ? `שאלות על ${s.category.name} ${where}` : `שאלות על מכוני יופי ${where}`}
                  <span className={styles.dot}>.</span>
                </h2>
                <SidebarFaq items={faqs} />
                <p className={styles.disclaimer}>מידע כללי בלבד, לא ייעוץ רפואי. התאמת טיפול נקבעת על ידי איש מקצוע מוסמך לאחר בדיקה.</p>
              </section>
            </aside>
          </div>
        </div>
        <div className={styles.spacer} />
      </main>

      <SiteFooter wide note="מידע כללי בלבד, לא ייעוץ רפואי" />
    </div>
  );
}

// ---------- local guide ----------

function Guide({ s, o }: { s: Scope; o: Overview }) {
  const where = `ב${s.city.name}`;
  const now = new Date();
  const fallback = o.prices.some(p => p.fromRegion);
  const citySample = o.prices.filter(p => !p.fromRegion).length;
  return (
    <section aria-labelledby="h-guide" className={styles.guide}>
      <span className={styles.eyebrow}>מדריך מקומי</span>
      <GuideExpander>
        <h2 id="h-guide" className={styles.guideH2}>
          {s.category ? `איך בוחרים עסק ל${s.category.name} ${where}` : `איך בוחרים מכון יופי ${where}`}
        </h2>
        <p className={styles.p}>
          שוק היופי והאסתטיקה {where} כולל קליניקות רפואיות, סטודיו בוטיק לטיפולי פנים, גבות וריסים, ורשתות לייזר עם כמה סניפים. המחירים והטכניקות משתנים מאוד ביניהם, ולכן ההשוואה המועילה היא כמעט תמיד לא מחיר המחירון.
        </p>
        <p className={styles.p}>
          חשוב להבדיל בין שני עולמות: טיפולי קוסמטיקה, כמו ניקוי פנים, פילינג וטיפוח, שקוסמטיקאית מוסמכת מבצעת, לבין טיפולים רפואיים כמו הזרקות בוטוקס וחומרי מילוי. בישראל הזרקות הן פעולה רפואית ומחייבות רופא או רופאה; שאלו מי מבצע את הטיפול בפועל ומי אחראי עליו.
        </p>
        <h3 className={styles.h3}>מה לשאול לפני שקובעים תור</h3>
        <ul className={styles.ul}>
          <li>איזה מכשיר או מוצר בשימוש, ומה גיל המכשיר?</li>
          <li>האם פגישת הייעוץ ללא עלות, והאם היא מול מי שיטפל בי בפועל?</li>
          <li>מה מספר המפגשים הכולל בהצעה, ולא רק המחיר למפגש?</li>
          <li>מה המדיניות לתיקון או השלמה בתוך שבועיים?</li>
          <li>מי הרופא או הרופאה האחראים, והאם הם נמצאים בקליניקה בשעות הטיפול?</li>
        </ul>

        <h3 className={styles.h3}>
          מחירים אופייניים {where}, {heMonth(now)}
        </h3>
        {o.prices.length === 0 ? (
          <p className={styles.p}>עדיין אין {where} או באזור {s.region.name} מספיק מחירים מפורסמים כדי להציג מחיר חציוני אמין.</p>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <caption>
                  {citySample > 0 ? `מחיר חציוני של הטיפולים שהעסקים ${where} מפרסמים, לפני מע״מ.` : `מחיר חציוני באזור ${s.region.name}, לפני מע״מ.`}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">תחום</th>
                    <th scope="col">מחיר חציוני</th>
                    <th scope="col">עסקים בעיר</th>
                  </tr>
                </thead>
                <tbody>
                  {o.prices.map(p => (
                    <tr key={p.slug} data-current={p.slug === s.category?.slug || undefined}>
                      <th scope="row">{p.name}</th>
                      <td>
                        <span className="ltr">{nis(p.price)}</span>
                        {p.fromRegion && (
                          <span className={styles.star} aria-label={`לפי חציון אזור ${s.region.name}`}>
                            *
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="ltr">{fmtNum(p.count)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {fallback && (
              <p className={styles.smallPrint}>
                * אין מספיק מחירים מפורסמים {where} בתחום הזה, ולכן מוצג החציון של אזור {s.region.name}. חציון מוצג רק כשיש לפחות שלושה מחירים.
              </p>
            )}
          </>
        )}
        <p className={`${styles.p} ${styles.lastP}`}>
          ביקורות מועילות במיוחד כשהן מזכירות שם של מטפל ושם של טיפול. ממוצע של חמישה כוכבים על <span className="ltr">400</span> ביקורות בעסק שעושה בעיקר טיפולי פנים לא אומר כמעט כלום על תוצאות הלייזר שלו. לכן אנחנו מציגים את דירוג Google ואת ביקורות BeautyFind המאומתות בנפרד.
        </p>
      </GuideExpander>
    </section>
  );
}

