import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cardExtras } from '@/app/search/extras';
import { ReadMore } from '@/components/content/ReadMore';
import { REGION_CONTENT } from '@/components/region/content';
import { ArrowForward } from '@/components/icons';
import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { BizTabs, type BizTab } from '@/components/treatments/BizTabs';
import { CATEGORY_CONTENT, CONTENT_UPDATED, priceFaq } from '@/components/treatments/content';
import { Faq } from '@/components/treatments/Faq';
import { BIZ, Count, JsonLd, breadcrumbLd, countText, faqLd, fmtInt, pctDelta } from '@/components/treatments/format';
import { InfoGlyph } from '@/components/treatments/InfoGlyph';
import { listingBreakdown, ratingMedians } from '@/components/treatments/queries';
import shared from '@/components/treatments/shared.module.css';
import { CATEGORIES, CITIES, MENU_REGION_ORDER, categoryBySlug, regionBySlug } from '@/lib/catalog';
import { nis } from '@/lib/format';
import { listBranches, listingCounts, medianPrices } from '@/lib/server/public';
import styles from './page.module.css';

// Design: project/BeautyFind Treatment Category.dc.html (prop `category`: one page per catalog category)

export const revalidate = 3600;

export function generateStaticParams() {
  return CATEGORIES.map(c => ({ category: c.slug }));
}

type Props = { params: Promise<{ category: string }> };

/** Everyday services where a "not in the סל" note would read oddly. */
const NON_AESTHETIC = new Set(['hair-salons', 'nails', 'makeup', 'spa-massage', 'tanning']);
const CITY_LINKS = 16;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category: slug } = await params;
  const cat = categoryBySlug(slug);
  if (!cat) return {};
  const counts = await listingCounts();
  const n = counts.category[cat.slug] ?? 0;
  return {
    title: `${cat.name} בישראל`,
    description:
      `${cat.name} בישראל: מה כולל התחום, מחירים חציוניים, מי מורשה לבצע, והעסקים המדורגים ביותר בכל אזור.` +
      (n > 0 ? ` ${countText(n, 'עסק אחד', 'עסקים')} ב־7 אזורים.` : ''),
    alternates: { canonical: `/treatments/${cat.slug}` },
  };
}

export default async function TreatmentCategoryPage({ params }: Props) {
  const { category: slug } = await params;
  const cat = categoryBySlug(slug);
  const body = cat && CATEGORY_CONTENT[cat.slug];
  if (!cat || !body) notFound();

  const [counts, national, breakdown, ratings, byRegion, top, ...regionTops] = await Promise.all([
    listingCounts(),
    medianPrices(),
    listingBreakdown(),
    ratingMedians(),
    Promise.all(MENU_REGION_ORDER.map(r => medianPrices(r))),
    listBranches({ category: cat.slug, take: 4 }),
    ...MENU_REGION_ORDER.map(r => listBranches({ region: r, category: cat.slug, take: 4 })),
  ]);

  const count = counts.category[cat.slug] ?? 0;
  const medianNat = national[cat.slug] ?? null;
  const rating = ratings.category[cat.slug] ?? null;
  const regionCount = (r: string) => breakdown.regionCat[r]?.[cat.slug] ?? 0;
  const activeRegions = MENU_REGION_ORDER.filter(r => regionCount(r) > 0).length;
  const aesthetic = !NON_AESTHETIC.has(cat.slug);

  const stats: Array<{ label: string; value: ReactNode }> = [{ label: 'עסקים רשומים', value: <span className="ltr tnum">{fmtInt(count)}</span> }];
  if (rating != null) stats.push({ label: 'דירוג חציוני בגוגל', value: <span className="ltr tnum">{rating.toFixed(1)}</span> });
  if (medianNat != null) stats.push({ label: 'מחיר חציוני', value: <span className="ltr tnum">{nis(medianNat)}</span> });
  stats.push({ label: 'אזורים', value: <span className="ltr tnum">{activeRegions}</span> });

  const priceRows = MENU_REGION_ORDER.map((r, i) => ({
    slug: r,
    name: regionBySlug(r)!.name,
    median: byRegion[i][cat.slug] ?? null,
    count: regionCount(r),
  }));

  // WhatsApp and phone for the phone card's contact buttons.
  const contacts = await cardExtras([...top.items, ...regionTops.flatMap(r => r.items)].map(c => c.id));
  const tabs: BizTab[] = [
    {
      key: '',
      name: 'כל הארץ',
      inName: 'בכל הארץ',
      allHref: `/search?t=${cat.slug}`,
      total: top.total,
      items: top.items.map(card => ({ card, meta: card.cityName, contact: contacts[card.id] })),
    },
    ...MENU_REGION_ORDER.map((r, i) => ({
      key: r,
      name: regionBySlug(r)!.name,
      inName: REGION_CONTENT[r].inName,
      allHref: `/search?region=${r}&t=${cat.slug}`,
      total: regionTops[i].total,
      items: regionTops[i].items.map(card => ({ card, meta: card.cityName, contact: contacts[card.id] })),
    })),
  ];

  const cityLinks = Object.entries(breakdown.cityCat)
    .map(([key, cats]) => {
      const [region, city] = key.split('/');
      const c = CITIES.find(x => x.region === region && x.slug === city);
      return c ? { ...c, n: cats[cat.slug] ?? 0 } : null;
    })
    .filter((c): c is NonNullable<typeof c> => !!c && c.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, CITY_LINKS);

  const faqs = [...body.faqs, priceFaq(aesthetic)];
  const related = body.related.map(s => categoryBySlug(s)).filter((c): c is NonNullable<typeof c> => !!c);

  return (
    <div className={shared.root}>
      <JsonLd
        data={breadcrumbLd([
          { name: 'ראשי', path: '/' },
          { name: 'תחומי טיפול', path: '/treatments' },
          { name: cat.name, path: `/treatments/${cat.slug}` },
        ])}
      />
      <JsonLd data={faqLd(faqs)} />
      <SiteHeader variant="public" title={cat.name} backHref="/treatments" />

      <nav aria-label="נתיב ניווט" className={shared.crumbBar}>
        <ol className={shared.crumbs}>
          <li><Link href="/">ראשי</Link></li>
          <li aria-hidden="true" className={shared.crumbSep}>/</li>
          <li><Link href="/treatments">תחומי טיפול</Link></li>
          <li aria-hidden="true" className={shared.crumbSep}>/</li>
          <li aria-current="page" className={shared.crumbNow}>{cat.name}</li>
        </ol>
      </nav>

      <main className={styles.main}>
        <div className={styles.intro}>
          <div className={styles.introCopy}>
            <span className={shared.eyebrow}>
              <span aria-hidden="true" className={shared.eyebrowLine} />
              תחום טיפול · כל הארץ
            </span>
            <h1 className={styles.h1}>
              {cat.name} בישראל<span className={shared.dot}>.</span>
            </h1>
            <p className={styles.answer}>
              {body.answer}{' '}
              {count > 0 ? (
                <>
                  באינדקס רשומים <Count n={count} {...BIZ} /> בתחום
                  {medianNat != null ? (
                    <>
                      , והמחיר החציוני הוא <span className="ltr tnum">{nis(medianNat)}</span>, לא כולל מע״מ
                    </>
                  ) : null}
                  .
                </>
              ) : (
                'עדיין אין עסקים רשומים בתחום.'
              )}
            </p>

            <div className={styles.metaRow}>
              <span className={styles.resp} data-kind={cat.isMedical ? 'medical' : 'professional'}>
                {cat.isMedical ? 'אחריות רפואית' : 'איש מקצוע אחראי'}
              </span>
              <span className={styles.updated}>
                <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="#8A96A3" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="9" cy="9" r="6.6" />
                  <path d="M9 5.2V9l2.6 1.6" />
                </svg>
                עודכן <time dateTime={CONTENT_UPDATED.iso}>{CONTENT_UPDATED.label}</time>
              </span>
            </div>

            <dl className={styles.stats} data-cols={stats.length}>
              {stats.map(st => (
                <div key={st.label} className={styles.stat}>
                  <dt>{st.label}</dt>
                  <dd>{st.value}</dd>
                </div>
              ))}
            </dl>

            <div className={styles.ctas}>
              <Link href={`/search?t=${cat.slug}`} className={`${shared.btnPrimary} ${styles.ctaMain}`}>
                <span>מצאו עסקים בתחום</span>
                <ArrowForward />
              </Link>
              <a href="#prices" className={`${shared.btnGhost} ${styles.ctaGhost}`}>למחירים</a>
            </div>
          </div>

          <figure className={styles.heroFig}>
            <Image src={body.img} alt={cat.name} fill priority sizes="(min-width:1100px) 36vw, 100vw" style={{ objectFit: 'cover' }} />
            <span aria-hidden="true" className={styles.ping} />
          </figure>
        </div>

        <section aria-labelledby="h-what" className={`${shared.split} ${styles.block}`}>
          <div className={shared.splitCol}>
            <h2 id="h-what" className={`${shared.h2} ${shared.h2Lg} ${styles.whatH2}`}>
              מה התחום כולל<span className={shared.dot}>.</span>
            </h2>
            <ReadMore lineHeight="29px">
              {body.paras.map(p => (
                <p key={p} className={styles.para}>{p}</p>
              ))}
            </ReadMore>
            <div className={`${shared.infoBox} ${styles.reg}`}>
              <InfoGlyph />
              <p>
                <strong>{body.regTitle}</strong> {body.regBody}
              </p>
            </div>
            <p className={styles.regNote}>
              {cat.isMedical
                ? 'בפרופיל של כל עסק בתחום מוצג הרופא בעל האחריות הרפואית, ורישיונו נבדק מול משרד הבריאות.'
                : 'בפרופיל של כל עסק בתחום מוצג איש המקצוע האחראי.'}
            </p>
          </div>
          <div className={shared.splitCol}>
            <h3 className={styles.listTitle}>הטיפולים הנפוצים בתחום</h3>
            <ul className={styles.dotList}>
              {body.subs.map(sb => (
                <li key={sb.name}>
                  <span aria-hidden="true" className={styles.bullet} />
                  <span className={styles.itemText}>
                    <span className={styles.itemName}>{sb.name}</span>
                    <span className={styles.itemBody}>{sb.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="h-before" className={`${shared.split} ${styles.block}`}>
          <div className={shared.splitCol}>
            <h2 id="h-before" className={`${shared.h2} ${shared.h2Lg} ${styles.whatH2}`}>
              לפני שקובעים תור<span className={shared.dot}>.</span>
            </h2>
            <h3 className={styles.listTitle}>מה לשאול את העסק</h3>
            <ol className={styles.askList}>
              {body.ask.map((a, i) => (
                <li key={a}>
                  <span aria-hidden="true" className={`${styles.askNum} ltr tnum`}>{i + 1}</span>
                  <span className={styles.itemBody}>{a}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className={shared.splitCol}>
            <h3 className={styles.listTitle}>תופעות לוואי וסיכונים אפשריים</h3>
            <ul className={styles.dotList}>
              {body.risks.map(r => (
                <li key={r}>
                  <span aria-hidden="true" className={styles.bullet} data-tone="warn" />
                  <span className={styles.itemBody}>{r}</span>
                </li>
              ))}
            </ul>
            <p className={shared.note}>המידע כללי ואינו ייעוץ רפואי. לשאלות על המצב שלכם פנו לרופא או לאיש המקצוע המטפל.</p>
          </div>
        </section>

        <section id="prices" aria-labelledby="h-prices" className={`${styles.prices} ${styles.block}`}>
          <div className={shared.rowHead}>
            <h2 id="h-prices" className={`${shared.h2} ${shared.h2Lg}`}>
              מחירים חציוניים<span className={shared.dot}>.</span>
            </h2>
            <span className={styles.pricesNote}>
              תדירות אופיינית: {body.freq} · בשקלים, לא כולל מע״מ
            </span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className="sr-only">מחיר חציוני ומספר עסקים לפי אזור, {cat.name}</caption>
              <thead>
                <tr>
                  <th scope="col">אזור</th>
                  <th scope="col">מחיר חציוני</th>
                  <th scope="col">מול הארצי</th>
                  <th scope="col">עסקים</th>
                </tr>
              </thead>
              <tbody>
                <tr className={styles.totalRow}>
                  <th scope="row">כל הארץ</th>
                  <td className={styles.tdMedian}>{medianNat != null ? <span className="ltr tnum">{nis(medianNat)}</span> : <span className={styles.na}>אין מספיק מחירים</span>}</td>
                  <td className={styles.tdMuted} />
                  <td className={styles.tdMuted}><span className="ltr tnum">{fmtInt(count)}</span></td>
                </tr>
                {priceRows.map(row => {
                  const d = row.median != null && medianNat != null ? pctDelta(row.median, medianNat) : null;
                  return (
                    <tr key={row.slug}>
                      <th scope="row">
                        <Link href={`/search?region=${row.slug}&t=${cat.slug}`}>{row.name}</Link>
                      </th>
                      <td className={styles.tdMedian}>{row.median != null ? <span className="ltr tnum">{nis(row.median)}</span> : <span className={styles.na}>אין מספיק מחירים</span>}</td>
                      <td className={styles.tdMuted}>{d != null && <span className="ltr tnum">{`${d > 0 ? '+' : ''}${d}%`}</span>}</td>
                      <td className={styles.tdMuted}><span className="ltr tnum">{fmtInt(row.count)}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className={styles.priceFoot}>
            המחירים נמסרים על ידי העסקים ומשקפים את מה שפורסם בתפריטים שלהם. החציון מוצג רק כשיש לפחות שלושה מחירים, והוא אינו הצעת מחיר ואינו מחייב אף עסק.
            {aesthetic ? ' טיפולים אסתטיים אלקטיביים אינם בסל הבריאות.' : ''}
          </p>
        </section>

        <div className={styles.block}>
          <BizTabs
            headingId="h-top"
            heading={
              <h2 id="h-top" className={`${shared.h2} ${shared.h2Lg}`}>
                העסקים המדורגים ביותר<span className={shared.dot}>.</span>
              </h2>
            }
            param="region"
            ariaLabel="אזור"
            tabs={tabs}
            size={96}
            variant="category"
          />
        </div>

        {cityLinks.length > 0 && (
          <section aria-labelledby="h-cities" className={`${styles.block} ${styles.ruled}`}>
            <h2 id="h-cities" className={`${shared.h2} ${shared.h2Rg} ${styles.citiesH2}`}>{cat.name} לפי עיר</h2>
            <ul className={styles.pills}>
              {cityLinks.map(c => (
                <li key={`${c.region}/${c.slug}`}>
                  <Link href={`/${c.region}/${c.slug}/${cat.slug}`} className={styles.pill}>
                    {c.name}
                    <span className={`${styles.pillCount} ltr tnum`}>{fmtInt(c.n)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="h-faq" className={`${shared.split} ${styles.block}`}>
          <div className={shared.splitCol}>
            <h2 id="h-faq" className={`${shared.h2} ${shared.h2Lg} ${styles.faqH2}`}>
              שאלות נפוצות<span className={shared.dot}>.</span>
            </h2>
            <p className={shared.faqLede}>מה שאנשים שואלים לפני שהם קובעים תור בתחום הזה.</p>
          </div>
          <Faq items={faqs} />
        </section>

        {related.length > 0 && (
          <section aria-labelledby="h-related" className={`${styles.block} ${styles.ruled}`}>
            <div className={shared.rowHead}>
              <h2 id="h-related" className={`${shared.h2} ${shared.h2Rg}`}>תחומים קרובים</h2>
              <Link href="/treatments" className={shared.more}>
                <span>כל 14 התחומים</span>
                <ArrowForward size={14} className={shared.moreArrow} />
              </Link>
            </div>
            <ul className={styles.related}>
              {related.map(rc => (
                <li key={rc.slug}>
                  <Link href={`/treatments/${rc.slug}`} className={styles.relCard}>
                    <span className={styles.relGroup}>{rc.group}</span>
                    <span className={styles.relName}>{rc.name}</span>
                    <span className={styles.relMeta}>
                      <Count n={counts.category[rc.slug] ?? 0} {...BIZ} /> בישראל
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <SiteFooter wide note="מידע כללי בלבד, לא ייעוץ רפואי" />
    </div>
  );
}
