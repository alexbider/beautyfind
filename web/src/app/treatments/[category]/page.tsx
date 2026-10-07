import type { Metadata } from 'next';
import { applySeo } from '@/lib/server/seo';
import { composeDescription, fitTitle, publicMetadata } from '@/lib/seo/meta';
import { SEO_TERM } from '@/lib/seo/terms';
import { businessCount } from '@/lib/seo/businessNoun';
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
import { JsonLd, fmtInt, pageLd } from '@/components/treatments/format';
import { InfoGlyph } from '@/components/treatments/InfoGlyph';
import { MarketPrices } from '@/components/treatments/MarketPrices';
import { listingBreakdown, ratingMedians } from '@/components/treatments/queries';
import shared from '@/components/treatments/shared.module.css';
import { CATEGORIES, CITIES, MENU_REGION_ORDER, categoryBySlug, regionBySlug } from '@/lib/catalog';
import { marketPricesFor } from '@/lib/server/marketPrices';
import { listBranches, listingCounts } from '@/lib/server/public';
import { STATIC_IMAGE_ALT } from '@/lib/siteImages';
import styles from './page.module.css';

// Design: project/BeautyFind Treatment Category.dc.html (prop `category`: one page per catalog category)

export const revalidate = 600;

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
  const body = CATEGORY_CONTENT[cat.slug];
  return applySeo(`/treatments/${cat.slug}`, publicMetadata({
    path: `/treatments/${cat.slug}`,
    title: fitTitle([`${SEO_TERM[cat.slug] ?? cat.name} בישראל: מחירים והשוואה`, `${SEO_TERM[cat.slug] ?? cat.name} בישראל: מחירים`, `${SEO_TERM[cat.slug] ?? cat.name} בישראל`]),
    description: composeDescription(
      [`${cat.name} בישראל: מה כולל התחום, טווחי מחירים בשוק ומי מורשה לבצע.`, n > 0 ? `${businessCount(n, cat.slug)} ב־7 אזורים.` : null, 'העסקים המדורגים ביותר בכל אזור.', 'השוו מחירים וקבעו תור.'],
      ['דירוג בגוגל וביקורות BeautyFind בנפרד.'],
    ),
    image: body?.img ?? null,
  }));
}

export default async function TreatmentCategoryPage({ params }: Props) {
  const { category: slug } = await params;
  const cat = categoryBySlug(slug);
  const body = cat && CATEGORY_CONTENT[cat.slug];
  if (!cat || !body) notFound();

  const [counts, breakdown, ratings, market, top, ...regionTops] = await Promise.all([
    listingCounts(),
    listingBreakdown(),
    ratingMedians(),
    marketPricesFor(cat.slug),
    listBranches({ category: cat.slug, take: 4 }),
    ...MENU_REGION_ORDER.map(r => listBranches({ region: r, category: cat.slug, take: 4 })),
  ]);

  const count = counts.category[cat.slug] ?? 0;
  const rating = ratings.category[cat.slug] ?? null;
  const regionCount = (r: string) => breakdown.regionCat[r]?.[cat.slug] ?? 0;
  const activeRegions = MENU_REGION_ORDER.filter(r => regionCount(r) > 0).length;
  const aesthetic = !NON_AESTHETIC.has(cat.slug);

  const stats: Array<{ label: string; value: ReactNode }> = [{ label: 'עסקים רשומים', value: <span className="ltr tnum">{fmtInt(count)}</span> }];
  if (rating != null) stats.push({ label: 'דירוג ממוצע בגוגל', value: <span className="ltr tnum">{rating.toFixed(1)}</span> });
  stats.push({ label: 'אזורים', value: <span className="ltr tnum">{activeRegions}</span> });

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
        data={pageLd({
          path: `/treatments/${cat.slug}`,
          type: 'CollectionPage',
          name: `${cat.name} בישראל`,
          image: body.img ?? null,
          crumbs: [
            { name: 'ראשי', path: '/' },
            { name: 'תחומי טיפול', path: '/treatments' },
            { name: cat.name, path: `/treatments/${cat.slug}` },
          ],
          faqs,
        })}
      />
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
              {cat.name} בישראל<span aria-hidden="true" className={shared.dot}>.</span>
            </h1>
            <p className={styles.answer}>
              {body.answer}{' '}
              {count > 0 ? <>באינדקס רשומים {businessCount(count, cat.slug)}, וטווחי המחירים המקובלים בשוק מופיעים למטה.</> : 'עדיין אין עסקים רשומים בתחום.'}
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
            <Image src={body.img} alt={STATIC_IMAGE_ALT[body.img] ?? cat.name} fill priority sizes="(min-width:1100px) 36vw, 100vw" style={{ objectFit: 'cover' }} />
            <span aria-hidden="true" className={styles.ping} />
          </figure>
        </div>

        <section aria-labelledby="h-what" className={`${shared.split} ${styles.block}`}>
          <div className={shared.splitCol}>
            <h2 id="h-what" className={`${shared.h2} ${shared.h2Lg} ${styles.whatH2}`}>
              מה התחום כולל<span aria-hidden="true" className={shared.dot}>.</span>
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
                ? 'עסק שמסר רופא אחראי מציג את שמו בפרופיל אחרי שרישיונו נבדק מול משרד הבריאות.'
                : 'עסק שמסר איש מקצוע אחראי מציג את שמו בפרופיל.'}
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
              לפני שקובעים תור<span aria-hidden="true" className={shared.dot}>.</span>
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

        <div className={styles.block}>
          <MarketPrices
            meta={market.meta}
            items={market.items}
            categoryName={cat.name}
            freq={body.freq}
            aesthetic={aesthetic}
            heading={
              <h2 id="h-prices" className={`${shared.h2} ${shared.h2Lg}`}>
                {market.meta.title}<span aria-hidden="true" className={shared.dot}>.</span>
              </h2>
            }
          />
        </div>

        <div className={styles.block}>
          <BizTabs
            headingId="h-top"
            heading={
              <h2 id="h-top" className={`${shared.h2} ${shared.h2Lg}`}>
                העסקים המדורגים ביותר<span aria-hidden="true" className={shared.dot}>.</span>
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
              שאלות נפוצות<span aria-hidden="true" className={shared.dot}>.</span>
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
                      {businessCount(counts.category[rc.slug] ?? 0, rc.slug)} בישראל
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
