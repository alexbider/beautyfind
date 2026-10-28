import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment } from 'react';
import { notFound } from 'next/navigation';
import { rich } from '@/components/content/Rich';
import { FaqAccordion } from '@/components/faq/FaqAccordion';
import { ArrowForward, Check, PathIcon } from '@/components/icons';
import { HeroMedia } from '@/components/marketing/HeroMedia';
import { MarketingStickyBar } from '@/components/marketing/MarketingStickyBar';
import { QuoteForm } from '@/components/marketing/QuoteForm';
import { Reveal } from '@/components/marketing/Reveal';
import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { getService } from '@/content/marketing';
import { SERVICE_SLUGS, isServiceSlug } from '@/content/marketing/types';
import { nis } from '@/lib/format';
import { PLATFORM_PRICE_NOTE } from '@/lib/pricing';
import { ROUTES, marketingOrder, marketingService } from '@/lib/routes';
import { canBuy, canQuote, resolvedService } from '@/lib/server/marketing';
import { applySeo } from '@/lib/server/seo';
import { publicMetadata } from '@/lib/seo/meta';
import { breadcrumbNode, faqNode, graph, ldJson, serviceId, serviceNode, webPageNode } from '@/lib/seo/schema';
import styles from '../marketing.module.css';

export const dynamicParams = false;
export const revalidate = 600;

export function generateStaticParams() {
  return SERVICE_SLUGS.map(service => ({ service }));
}

type Params = { params: Promise<{ service: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { service } = await params;
  if (!isServiceSlug(service)) return {};
  const s = getService(service);
  const path = marketingService(service);
  return applySeo(path, publicMetadata({ path, title: s.title, description: s.description, image: s.heroImage.src }));
}

const plain = (t: string) => t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

const CHECK = (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 10.5 8 14.5l8-9" />
  </svg>
);

export default async function ServicePage({ params }: Params) {
  const { service: slug } = await params;
  if (!isServiceSlug(slug)) notFound();
  const s = await resolvedService(slug);
  if (!s || !s.enabled) notFound();
  const path = marketingService(slug);
  const packages = s.resolvedPackages.filter(p => !p.hidden);
  const buy = canBuy(s);
  const quote = canQuote(s);
  const related = s.related.map(r => getService(r));
  const from = packages.length ? Math.min(...packages.map(p => p.priceNis)) : null;

  const JSON_LD = graph([
    webPageNode({ path, name: s.title, description: s.description, image: s.heroImage.src, breadcrumb: true, mainEntityId: serviceId(path) }),
    breadcrumbNode(path, [
      { name: 'ראשי', path: '/' },
      { name: 'לעסקים', path: ROUTES.forBusiness },
      { name: 'שירותי שיווק', path: ROUTES.marketing },
      { name: s.name, path },
    ]),
    serviceNode({
      path,
      name: s.name,
      serviceType: s.primaryKeyword,
      description: s.description,
      image: s.heroImage.src,
      offers: buy ? packages.map(p => ({ name: p.name, priceNis: p.priceNis, monthly: p.cycle === 'monthly', description: p.line })) : [],
    }),
    faqNode(path, s.faqs.map(f => ({ q: f.q, a: plain(f.a) }))),
  ]);

  return (
    <div className={styles.root}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(JSON_LD) }} />
      <SiteHeader title={s.name} backHref={ROUTES.marketing} />

      <main>
        {/* ---------- Hero ---------- */}
        <section aria-labelledby="hero-h1" className={styles.hero}>
          <span aria-hidden="true" className={styles.heroMesh} />
          <span aria-hidden="true" className={styles.heroGrid} />
          <div className={styles.heroInner}>
            <div className={styles.heroCopy}>
              <nav aria-label="פירורי לחם">
                <ol className={styles.crumbs}>
                  <li><Link href={ROUTES.forBusiness}>לעסקים</Link></li>
                  <li><Link href={ROUTES.marketing}>שירותי שיווק</Link></li>
                  <li aria-current="page">{s.name}</li>
                </ol>
              </nav>
              <div className={styles.eyebrow}>
                <span aria-hidden="true" className={styles.eyebrowLine} />
                {s.eyebrow}
              </div>
              <h1 id="hero-h1" className={styles.h1}>
                {s.h1.map((line, i) => (
                  <Fragment key={line}>
                    {i > 0 && ' '}
                    <span style={{ animationDelay: `${0.05 + i * 0.15}s` }}>
                      {line}
                      {i === s.h1.length - 1 && <span aria-hidden="true" className={styles.dot}>.</span>}
                    </span>
                  </Fragment>
                ))}
              </h1>
              <p className={styles.lede}>{rich(s.lede, 'lede')}</p>
              <div className={styles.heroCtas}>
                {buy ? (
                  <a href="#packages" className={styles.ctaPrimary}>
                    <span>{from ? `לחבילות, החל מ־${nis(from)}` : 'לחבילות'}</span>
                    <ArrowForward />
                  </a>
                ) : (
                  <a href="#quote" className={styles.ctaPrimary}>
                    <span>לקבלת הצעת מחיר</span>
                    <ArrowForward />
                  </a>
                )}
                {buy && quote && (
                  <a href="#quote" className={styles.ctaGhost}>
                    הצעת מחיר מותאמת
                  </a>
                )}
              </div>
              <ul className={styles.heroMeta}>
                {s.proof.slice(0, 3).map(p => (
                  <li key={p}>
                    <Check size={13} />
                    {p}
                  </li>
                ))}
              </ul>
            </div>

            <div className={styles.heroArt}>
              <span aria-hidden="true" className={styles.heroBlob} />
              <figure className={styles.heroMedia}>
                <HeroMedia image={s.heroImage} video={s.heroVideo} />
              </figure>
              <div aria-hidden="true" className={`${styles.chip} ${styles.chipA}`}>
                <i><PathIcon paths={s.icon} size={17} stroke="currentColor" /></i>
                <span>
                  {s.name}
                  <small>לעסקי יופי ואסתטיקה</small>
                </span>
              </div>
              <div aria-hidden="true" className={`${styles.chip} ${styles.chipB}`}>
                <i><Check size={14} /></i>
                <span>
                  {buy ? 'הזמנה אונליין' : 'הצעה תוך יום עסקים'}
                  <small>{buy ? 'שאלון פתיחה ומתחילים' : 'בלי התחייבות'}</small>
                </span>
              </div>
              {from && (
                <div aria-hidden="true" className={`${styles.chip} ${styles.chipC}`}>
                  <span>
                    החל מ־<span className="ltr">{nis(from)}</span>
                    <small>{packages.find(p => p.priceNis === from)?.cycle === 'monthly' ? 'לחודש' : 'תשלום חד־פעמי'}</small>
                  </span>
                </div>
              )}
            </div>
          </div>
        </section>
        <span id="hero-end" aria-hidden="true" />

        {/* ---------- Answer box ---------- */}
        <section aria-labelledby="h-answer" className={`${styles.wrap} ${styles.answer}`}>
          <Reveal className={styles.answerCard} kind="scale">
            <div>
              <span className={styles.answerLabel}>בקצרה</span>
              <h2 id="h-answer" className={styles.answerQ}>{s.answer.q}</h2>
            </div>
            <p className={styles.answerA}>{rich(s.answer.a, 'ans')}</p>
          </Reveal>
        </section>

        <ul className={styles.proof} aria-label="עיקרי השירות">
          {s.proof.map(p => (
            <li key={p}>
              <Check size={14} />
              {p}
            </li>
          ))}
        </ul>

        {/* ---------- Problems ---------- */}
        <section aria-labelledby="h-problems" className={`${styles.wrap} ${styles.section}`}>
          <Reveal className={styles.sectionHead}>
            <span className={styles.kicker}>מה מעכב עסקי יופי</span>
            <h2 id="h-problems" className={styles.h2}>
              אם זה נשמע מוכר, זה בדיוק המקום להתחיל<span aria-hidden="true" className={styles.dot}>.</span>
            </h2>
          </Reveal>
          <ul className={styles.problems}>
            {s.problems.map((p, i) => (
              <Reveal as="li" key={p.title} className={styles.problem} delay={i * 80}>
                <h3>{p.title}</h3>
                <p>{rich(p.body, `pr${i}`)}</p>
              </Reveal>
            ))}
          </ul>
        </section>

        {/* ---------- Includes ---------- */}
        <section aria-labelledby="h-includes" className={`${styles.wrap} ${styles.section}`}>
          <Reveal className={styles.sectionHead}>
            <span className={styles.kicker}>מה כלול</span>
            <h2 id="h-includes" className={styles.h2}>
              מה נכלל ב{s.name}<span aria-hidden="true" className={styles.dot}>.</span>
            </h2>
          </Reveal>
          <ol className={styles.featureGrid}>
            {s.includes.map((f, i) => (
              <Reveal as="li" key={f.title} className={styles.feature} delay={(i % 3) * 90}>
                <span aria-hidden="true" className={styles.featureBar} />
                <span aria-hidden="true" className={styles.featureNum}>{i + 1}</span>
                <span aria-hidden="true" className={styles.featureIcon}>
                  <PathIcon paths={f.icon} stroke="currentColor" />
                </span>
                <h3>{f.title}</h3>
                <p>{rich(f.body, `in${i}`)}</p>
              </Reveal>
            ))}
          </ol>
        </section>

        {/* ---------- Packages ---------- */}
        <section id="packages" aria-labelledby="h-packages" className={styles.pricing}>
          <div className={styles.pricingInner}>
            <Reveal className={`${styles.sectionHead} ${styles.sectionHeadCenter}`}>
              <span className={styles.kicker}>{buy ? 'חבילות ומחירים' : 'מחיר'}</span>
              <h2 id="h-packages" className={styles.h2}>
                {buy ? 'מחיר שקוף, מזמינים אונליין' : 'הצעת מחיר לפי מה שהעסק צריך'}
                <span aria-hidden="true" className={styles.dot}>.</span>
              </h2>
              <p className={styles.sectionLede}>
                {buy
                  ? 'בוחרים חבילה, משלמים בתשלום מאובטח, ממלאים שאלון פתיחה קצר, והצוות שלנו מתחיל לעבוד. צריכים משהו אחר? אפשר לבקש הצעה מותאמת.'
                  : 'כל פרויקט כאן שונה בהיקף שלו, ולכן אנחנו בונים הצעה אחרי שיחה קצרה. הטווחים בהמשך העמוד יתנו לכם מושג מה מקובל בשוק.'}
              </p>
            </Reveal>
            {buy ? (
              <div className={styles.plans} data-count={packages.length}>
                {packages.map((p, i) => (
                  <Reveal key={p.key} className={styles.plan} delay={i * 110} kind="rise" data={{ featured: p.badge ? '' : undefined }}>
                    <div className={styles.planHead}>
                      <span className={styles.planName}>{p.name}</span>
                      {p.badge && <span className={styles.planBadge}>{p.badge}</span>}
                    </div>
                    <div className={styles.planPriceRow}>
                      <span className={`${styles.planPrice} ltr`}>{nis(p.priceNis)}</span>
                      <span className={styles.planUnit}>{p.cycle === 'monthly' ? 'לחודש' : 'תשלום חד־פעמי'}</span>
                    </div>
                    <p className={styles.planSub}>
                      {[
                        PLATFORM_PRICE_NOTE,
                        p.setupNis ? `הקמה ${nis(p.setupNis)} בתשלום הראשון` : null,
                        p.minMonths ? `התחייבות ל־${p.minMonths} חודשים` : p.cycle === 'monthly' ? 'בלי התחייבות' : null,
                        p.deliveryDays ? `מסירה תוך ${p.deliveryDays} ימי עסקים` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <p className={styles.planLine}>{p.line}</p>
                    <ul className={styles.planFeats}>
                      {p.feats.map(f => (
                        <li key={f}>
                          {CHECK}
                          {f}
                        </li>
                      ))}
                    </ul>
                    {p.note && <p className={styles.planNote}>{p.note}</p>}
                    <div className={styles.planCtaWrap}>
                      <Link href={marketingOrder(slug, p.key)} className={styles.planCta} rel="nofollow">
                        <span>הזמנת {p.name}</span>
                        <ArrowForward />
                      </Link>
                      {quote && (
                        <a href="#quote" className={styles.planQuote}>
                          או הצעה מותאמת
                        </a>
                      )}
                    </div>
                  </Reveal>
                ))}
              </div>
            ) : (
              <Reveal className={styles.quoteOnly}>
                <a href="#quote" className={styles.ctaPrimary}>
                  <span>לקבלת הצעת מחיר</span>
                  <ArrowForward />
                </a>
              </Reveal>
            )}
            <ul className={styles.pricingNotes}>
              {s.pricingNotes.map(n => (
                <li key={n}>
                  <span>{rich(n, 'pn')}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------- Process ---------- */}
        <section aria-labelledby="h-process" className={`${styles.wrap} ${styles.section}`}>
          <Reveal className={styles.sectionHead}>
            <span className={styles.kicker}>איך זה עובד</span>
            <h2 id="h-process" className={styles.h2}>
              מההזמנה ועד שרואים תוצאות<span aria-hidden="true" className={styles.dot}>.</span>
            </h2>
          </Reveal>
          <ol className={styles.process} data-count={s.process.length}>
            {s.process.map((st, i) => (
              <Reveal as="li" key={st.title} className={styles.step} delay={i * 120}>
                <span className={styles.stepNum} aria-hidden="true">{i + 1}</span>
                <div>
                  <h3>{st.title}</h3>
                  <p>{rich(st.body, `st${i}`)}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        </section>

        {/* ---------- Market prices ---------- */}
        <section aria-labelledby="h-market" className={`${styles.wrap} ${styles.section}`}>
          <div className={styles.market}>
            <Reveal className={styles.sectionHead}>
              <span className={styles.kicker}>שקיפות מחירים</span>
              <h2 id="h-market" className={styles.h2Sm}>
                מה המחיר של {s.name} בישראל<span aria-hidden="true" className={styles.dot}>?</span>
              </h2>
              <p className={styles.sectionLede}>{rich(s.market.intro, 'mi')}</p>
            </Reveal>
            <Reveal delay={120}>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <caption className="sr-only">טווחי מחירים מקובלים בשוק ל{s.name}</caption>
                  <thead>
                    <tr>
                      <th scope="col">מה מקבלים</th>
                      <th scope="col">טווח מקובל</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.market.rows.map(r => (
                      <tr key={r.label}>
                        <td>
                          {r.label}
                          {r.note && <small>{r.note}</small>}
                        </td>
                        <td className="ltr">{r.range}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={styles.asOf}>
                {s.market.note} נבדק ב{s.market.asOf}.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ---------- Beauty specifics ---------- */}
        <section aria-labelledby="h-beauty" className={styles.beautyBand}>
          <div className={styles.beautyInner}>
            <Reveal className={styles.sectionHead}>
              <span className={styles.kicker}>מה שונה בעסקי יופי</span>
              <h2 id="h-beauty" className={styles.h2}>
                מה שונה ב{s.name} כשמדובר בעסקי יופי<span aria-hidden="true" className={styles.dotLight}>.</span>
              </h2>
            </Reveal>
            <ul className={styles.beautyGrid} data-count={s.beauty.length}>
              {s.beauty.map((b, i) => (
                <Reveal as="li" key={b.title} className={styles.beautyItem} delay={i * 90}>
                  <h3>{b.title}</h3>
                  <p>{rich(b.body, `be${i}`)}</p>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------- Guide ---------- */}
        <section aria-label={`המדריך ל${s.name}`} className={`${styles.wrap} ${styles.section}`}>
          <div className={styles.guide}>
            <nav className={styles.toc} aria-label="בעמוד הזה">
              <p className={styles.tocTitle}>בעמוד הזה</p>
              <ol>
                {s.sections.map((sec, i) => (
                  <li key={sec.h2}>
                    <a href={`#g${i + 1}`}>{sec.h2}</a>
                  </li>
                ))}
                <li><a href="#h-faq">שאלות נפוצות</a></li>
              </ol>
            </nav>
            <div className={styles.article}>
              {s.sections.map((sec, i) => (
                <Reveal as="section" key={sec.h2} aria-labelledby={`g${i + 1}`}>
                  <h2 id={`g${i + 1}`}>{sec.h2}</h2>
                  {sec.paras.map((p, j) => (
                    <p key={j}>{rich(p, `g${i}p${j}`)}</p>
                  ))}
                  {sec.bullets && (
                    <ul>
                      {sec.bullets.map((b, j) => (
                        <li key={j}>{rich(b, `g${i}b${j}`)}</li>
                      ))}
                    </ul>
                  )}
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- FAQ ---------- */}
        <section aria-labelledby="h-faq" className={styles.faq}>
          <h2 id="h-faq" className={`${styles.h2Sm} ${styles.faqTitle}`}>
            שאלות נפוצות על {s.name}<span aria-hidden="true" className={styles.dot}>.</span>
          </h2>
          <FaqAccordion items={s.faqs.map(f => ({ q: f.q, a: plain(f.a) }))} />
        </section>

        {/* ---------- Quote form ---------- */}
        {quote && (
          <section id="quote" aria-labelledby="h-quote" className={styles.quote}>
            <Reveal className={styles.quoteBox} kind="scale">
              <div className={styles.quoteCopy}>
                <span className={styles.kicker}>הצעת מחיר</span>
                <h2 id="h-quote" className={styles.h2Sm}>
                  רוצים הצעה מותאמת ל{s.name}<span aria-hidden="true" className={styles.dot}>?</span>
                </h2>
                <p className={styles.sectionLede}>השאירו פרטים ונחזור אליכם תוך יום עסקים אחד עם הצעה מסודרת. בלי התחייבות, ובלי לחץ.</p>
                <ul>
                  {['תשובה תוך יום עסקים אחד', 'הצעה כתובה עם היקף, מחיר ולוח זמנים', 'צוות שמכיר את עסקי היופי והאסתטיקה'].map(t => (
                    <li key={t}>
                      {CHECK}
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
              <QuoteForm service={slug} serviceName={s.name} packages={buy ? packages.map(p => ({ key: p.key, name: p.name })) : []} />
            </Reveal>
          </section>
        )}

        {/* ---------- Related ---------- */}
        <section aria-labelledby="h-related" className={`${styles.wrap} ${styles.section}`}>
          <Reveal className={styles.sectionHead}>
            <h2 id="h-related" className={styles.h2Sm}>
              שירותים שעובדים טוב יחד עם {s.name}<span aria-hidden="true" className={styles.dot}>.</span>
            </h2>
          </Reveal>
          <ul className={styles.cards}>
            {related.map((r, i) => (
              <Reveal as="li" key={r.slug} delay={i * 90}>
                <Link href={marketingService(r.slug)} className={styles.card}>
                  <span className={styles.cardIcon} aria-hidden="true">
                    <PathIcon paths={r.icon} stroke="currentColor" />
                  </span>
                  <h3 className={styles.cardTitle}>{r.name}</h3>
                  <p className={styles.cardLine}>{r.cardLine}</p>
                  <span className={styles.cardMore}>
                    לפרטים
                    <ArrowForward />
                  </span>
                </Link>
              </Reveal>
            ))}
          </ul>
        </section>

        {/* ---------- Closing CTA ---------- */}
        <section aria-labelledby="h-cta" className={styles.ctaSection}>
          <Reveal className={styles.ctaBox} kind="scale">
            <span aria-hidden="true" className={styles.ctaStripes} />
            <span aria-hidden="true" className={styles.ctaGlow} />
            <div className={styles.ctaCopy}>
              <h2 id="h-cta">
                מוכנים להתחיל עם {s.name}<span aria-hidden="true" className={styles.dotLight}>?</span>
              </h2>
              <p>{buy ? 'בוחרים חבילה ומתחילים עוד היום, או משאירים פרטים להצעה מותאמת.' : 'השאירו פרטים ונחזור אליכם עם הצעה תוך יום עסקים.'}</p>
            </div>
            <div className={styles.ctaActions}>
              <a href={buy ? '#packages' : '#quote'} className={styles.ctaWhite}>
                <span>{buy ? 'לבחירת חבילה' : 'לקבלת הצעת מחיר'}</span>
                <ArrowForward size={16} />
              </a>
              <Link href={ROUTES.marketing} className={styles.ctaLink}>
                לכל שירותי השיווק
              </Link>
            </div>
          </Reveal>
        </section>
      </main>

      <MarketingStickyBar
        heroEndId="hero-end"
        hideIds={['packages', 'quote', 'h-cta']}
        primary={buy ? { href: '#packages', label: from ? `חבילות מ־${nis(from)}` : 'לחבילות' } : { href: '#quote', label: 'לקבלת הצעת מחיר' }}
        secondary={buy && quote ? { href: '#quote', label: 'הצעה' } : undefined}
      />
      <div className="bf-desk-only">
        <SiteFooter />
      </div>
    </div>
  );
}
