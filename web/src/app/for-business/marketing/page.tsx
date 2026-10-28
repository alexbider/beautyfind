import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { rich } from '@/components/content/Rich';
import { FaqAccordion } from '@/components/faq/FaqAccordion';
import { ArrowForward, Check, PathIcon } from '@/components/icons';
import { MarketingStickyBar } from '@/components/marketing/MarketingStickyBar';
import { QuoteForm } from '@/components/marketing/QuoteForm';
import { Reveal } from '@/components/marketing/Reveal';
import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { SERVICE_GROUPS } from '@/content/marketing';
import { nis } from '@/lib/format';
import { ROUTES, marketingService } from '@/lib/routes';
import { canBuy, canQuote, resolvedServices, type ResolvedService } from '@/lib/server/marketing';
import { applySeo } from '@/lib/server/seo';
import { publicMetadata } from '@/lib/seo/meta';
import { breadcrumbNode, faqNode, graph, itemListNode, ldJson, webPageNode } from '@/lib/seo/schema';
import styles from './marketing.module.css';

// Hub of BeautyFind for Business marketing services. Research: /home/claude/research/research-D-hub-offers.md.
// Primary keyword "שיווק דיגיטלי לעסקים" (390/mo, KD 10), framed for beauty (beauty-niche phrasings have
// almost no measurable volume). Supports "שיווק דיגיטלי" (1,900), "חבילות שיווק דיגיטלי", "פרסום עסק" (260).

const PATH = '/for-business/marketing';
const TITLE = 'שיווק דיגיטלי לעסקים בתחום היופי: שירותים, חבילות ומחירים';
const DESCRIPTION = 'שיווק דיגיטלי לעסקי יופי וקליניקות: פרסום ממומן, קידום בגוגל וב־AI, בניית אתר, מיתוג, סרטונים וניהול סושיאל. מחירים שקופים והזמנה אונליין.';
const HERO = { src: '/assets/marketing/hub.webp', alt: 'בעלת קליניקה ליופי בודקת את נתוני השיווק של העסק בטאבלט בדלפק הקבלה' };

const BASE: Metadata = publicMetadata({ path: PATH, title: TITLE, description: DESCRIPTION, image: HERO.src });
export const generateMetadata = () => applySeo(PATH, BASE);
export const revalidate = 600;

const WHY = [
  { title: 'בנוי רק לעסקי יופי', body: 'אנחנו עובדים כל יום עם אינדקס של מכוני יופי וקליניקות בכל הארץ. אנחנו יודעים מה לקוחות מחפשות, אילו טיפולים מתחרים על אותו קהל ואילו כללים חלים על טיפולים רפואיים.' },
  { title: 'מחירים שקופים, מראש', body: 'כל חבילה מופיעה עם מחיר, היקף עבודה ותנאים. אין צורך לקבוע שיחה רק כדי לדעת כמה זה עולה.' },
  { title: 'מזמינים אונליין, מתחילים מהר', body: 'בוחרים חבילה, משלמים בתשלום מאובטח וממלאים שאלון פתיחה של עשר דקות. משם הצוות לוקח את זה.' },
  { title: 'הכול נשאר שלכם', body: 'חשבונות הפרסום, האתר, התוכן והפרופיל העסקי רשומים על שמכם. אם תפסיקו, הכול נשאר אצלכם.' },
  { title: 'צוות אחד לכל הערוצים', body: 'קמפיין, אתר, קידום ותוכן שמדברים באותה שפה, במקום ארבעה ספקים שלא מכירים זה את זה.' },
  { title: 'מחובר לפרופיל שלכם ב־BeautyFind', body: 'השירותים מופיעים בלוח הניהול לצד הפרופיל, הפניות והביקורות, כך שרואים במקום אחד מה עובד.' },
];

const STEPS = [
  { title: 'בוחרים שירות', body: 'חבילה קבועה עם מחיר שקוף, או בקשה להצעה מותאמת כשצריך משהו אחר.' },
  { title: 'שאלון פתיחה', body: 'עשר דקות על העסק, הקהל והמטרות, והענקת גישה לחשבונות בלי למסור סיסמאות.' },
  { title: 'תוכנית עבודה', body: 'תוך כמה ימי עסקים מקבלים תוכנית עבודה ולוח זמנים.' },
  { title: 'עבודה ומדידה', body: 'עדכונים במייל ובלוח הניהול, ודוח חודשי שמראה מה קרה ומה הלאה.' },
];

const FAQS = [
  { q: 'כמה עולה שיווק דיגיטלי לעסק יופי?', a: 'זה תלוי בשירות. ניהול קמפיינים ממומנים מתחיל אצלנו ב־1,490 ₪ לחודש, קידום אתרים ב־1,990 ₪ לחודש, ובניית אתר עסקי ב־4,900 ₪ בתשלום חד־פעמי. בשוק הישראלי, ניהול קמפיינים עולה בדרך כלל 1,500 עד 3,000 ₪ לחודש וקידום אורגני לעסק מקומי 2,000 עד 3,500 ₪ לחודש. המחירים שלנו ללא מע״מ ישראלי.' },
  { q: 'עם איזה שירות כדאי להתחיל?', a: 'עסק בלי אתר או עם פרופיל חלש בגוגל מתחיל בדרך כלל באתר ובקידום בגוגל. עסק עם נוכחות טובה שרוצה למלא את היומן מהר מתחיל בקמפיין ממומן או במערכת לידים. אם אתם לא בטוחים, השאירו פרטים ונמליץ על נקודת התחלה.' },
  { q: 'השירותים מתאימים רק לעסקים שרשומים ב־BeautyFind?', a: 'לא. כל עסק בתחום היופי והאסתטיקה יכול להזמין. לעסקים רשומים ההזמנות מופיעות גם בלוח הניהול, לצד הפרופיל והפניות.' },
  { q: 'יש התחייבות?', a: 'בשירותים החודשיים יש התחייבות ל־3 חודשים, כי זה הזמן המינימלי ללמידה ולשיפור. אחר כך ממשיכים מחודש לחודש, ואפשר להפסיק בסוף כל חודש. פרויקטים כמו אתר, מיתוג או סרטון תדמית משולמים פעם אחת.' },
  { q: 'אתם מבטיחים תוצאות?', a: 'אנחנו לא מבטיחים מיקום בגוגל או מספר לקוחות, כי אף אחד לא יכול להבטיח את זה ביושר. אנחנו מתחייבים להיקף עבודה ברור, ללוחות זמנים ולשקיפות מלאה במה שנעשה ובמה שנמדד.' },
  { q: 'מי מבצע את העבודה?', a: 'הצוות של BeautyFind לעסקים: אנשי קמפיינים, קידום, תוכן, עיצוב ווידאו שעובדים עם עסקי יופי. תמיד יש לכם כתובת אחת לפניות.' },
  { q: 'אתם עובדים גם עם קליניקות לאסתטיקה רפואית?', a: 'כן. בקליניקות שבהן רופא/ה מבצע/ת טיפולים, הפרסום כפוף לכללים מחמירים יותר. אנחנו בונים את התוכן והקמפיינים בהתאם, ובמקרים כאלה ההזמנה עוברת לרוב דרך הצעת מחיר.' },
];

function fromPrice(s: ResolvedService): { price: number; monthly: boolean } | null {
  if (!canBuy(s)) return null;
  const visible = s.resolvedPackages.filter(p => !p.hidden);
  if (!visible.length) return null;
  const min = visible.reduce((a, b) => (b.priceNis < a.priceNis ? b : a));
  return { price: min.priceNis, monthly: min.cycle === 'monthly' };
}

export default async function MarketingHubPage() {
  const services = (await resolvedServices()).filter(s => s.enabled);
  const bySlug = new Map(services.map(s => [s.slug, s]));
  const quoteServices = services.filter(canQuote).map(s => ({ slug: s.slug, name: s.name }));

  const JSON_LD = graph([
    webPageNode({ path: PATH, name: TITLE, description: DESCRIPTION, image: HERO.src, breadcrumb: true }),
    breadcrumbNode(PATH, [
      { name: 'ראשי', path: '/' },
      { name: 'לעסקים', path: ROUTES.forBusiness },
      { name: 'שירותי שיווק', path: PATH },
    ]),
    itemListNode(PATH, 'שירותי שיווק דיגיטלי לעסקי יופי', services.map(s => ({ path: marketingService(s.slug), name: s.name }))),
    faqNode(PATH, FAQS),
  ]);

  const n = services.length;

  return (
    <div className={styles.root}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(JSON_LD) }} />
      <SiteHeader title="שירותי שיווק" backHref={ROUTES.forBusiness} />

      <main>
        <section aria-labelledby="hero-h1" className={`${styles.hero} ${styles.hubHero}`}>
          <span aria-hidden="true" className={styles.heroMesh} />
          <span aria-hidden="true" className={styles.heroGrid} />
          <div className={styles.heroInner}>
            <div className={styles.heroCopy}>
              <nav aria-label="פירורי לחם">
                <ol className={styles.crumbs}>
                  <li><Link href={ROUTES.forBusiness}>לעסקים</Link></li>
                  <li aria-current="page">שירותי שיווק</li>
                </ol>
              </nav>
              <div className={styles.eyebrow}>
                <span aria-hidden="true" className={styles.eyebrowLine} />
                BeautyFind לעסקים
              </div>
              <h1 id="hero-h1" className={styles.h1}>
                <span style={{ animationDelay: '.05s' }}>שיווק דיגיטלי</span>{' '}
                <span style={{ animationDelay: '.2s' }}>לעסקי יופי</span>{' '}
                <span style={{ animationDelay: '.35s' }}>
                  וקליניקות<span aria-hidden="true" className={styles.dot}>.</span>
                </span>
              </h1>
              <p className={styles.lede}>
                כל מה שעסק יופי צריך כדי שלקוחות ימצאו אותו, יבחרו בו ויקבעו תור: פרסום ממומן, קידום בגוגל ובמנועי AI, אתר, מיתוג, סרטונים ותוכן. עם מחירים שקופים, הזמנה אונליין וצוות אחד שמכיר את התחום.
              </p>
              <div className={styles.heroCtas}>
                <a href="#services" className={styles.ctaPrimary}>
                  <span>לכל השירותים</span>
                  <ArrowForward />
                </a>
                <a href="#quote" className={styles.ctaGhost}>
                  לא בטוחים מאיפה להתחיל?
                </a>
              </div>
              <ul className={styles.heroMeta}>
                {['מחירים מפורסמים מראש', 'הזמנה ותשלום אונליין', 'החשבונות והתוכן נשארים שלכם'].map(t => (
                  <li key={t}>
                    <Check size={13} />
                    {t}
                  </li>
                ))}
              </ul>
            </div>

            <div className={styles.heroArt}>
              <div className={styles.orbit} aria-label="השירותים" role="list">
                <span className={styles.orbitRing} aria-hidden="true" />
                <span className={`${styles.orbitRing} ${styles.orbitRing2}`} aria-hidden="true">
                  <span style={{ position: 'absolute', inset: 6, borderRadius: '50%', overflow: 'hidden' }}>
                    <Image src={HERO.src} alt={HERO.alt} fill sizes="(min-width:1024px) 340px, 60vw" priority style={{ objectFit: 'cover' }} />
                  </span>
                </span>
                <div className={styles.orbitSpin}>
                  {services.map((s, i) => {
                    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
                    return (
                      <span key={s.slug} role="listitem" className={styles.orbitItem} style={{ left: `${50 + 50 * Math.cos(a)}%`, top: `${50 + 50 * Math.sin(a)}%` }}>
                        <span className={styles.orbitBadge} style={{ animationDelay: `${-i * 0}s` }}>
                          <Link href={marketingService(s.slug)} aria-label={s.name} title={s.name}>
                            <PathIcon paths={s.icon} size={24} stroke="currentColor" />
                          </Link>
                        </span>
                      </span>
                    );
                  })}
                </div>
                <div className={styles.orbitPill} aria-hidden="true">
                  <strong>BeautyFind</strong>
                  <span>לעסקים</span>
                </div>
              </div>
            </div>
          </div>
        </section>
        <span id="hero-end" aria-hidden="true" />

        <div className={styles.marquee} aria-hidden="true">
          <div className={styles.marqueeTrack}>
            {[...services, ...services].map((s, i) => (
              <span key={`${s.slug}-${i}`}>
                <i />
                {s.name}
              </span>
            ))}
          </div>
        </div>

        <section aria-labelledby="h-answer" className={`${styles.wrap} ${styles.section}`}>
          <Reveal className={styles.answerCard} kind="scale">
            <div>
              <span className={styles.answerLabel}>בקצרה</span>
              <h2 id="h-answer" className={styles.answerQ}>מה כולל שיווק דיגיטלי לעסק יופי?</h2>
            </div>
            <p className={styles.answerA}>
              שיווק דיגיטלי לעסק יופי בנוי משלוש שכבות. הראשונה מביאה לקוחות עכשיו: קמפיינים בפייסבוק, באינסטגרם ובגוגל, ודפי נחיתה שהופכים צפיות לפניות. השנייה דואגת שימצאו אתכם כשמחפשים: אתר, פרופיל עסקי בגוגל, קידום אורגני ונוכחות בתשובות של מנועי AI. השלישית קובעת אם יבחרו בכם: מיתוג, סרטונים ותוכן שמראים את העבודה שלכם. ב־BeautyFind כל השכבות זמינות במחיר שקוף, עם חבילות שמתחילות ב־990 ₪.
            </p>
          </Reveal>
        </section>

        <section id="services" aria-labelledby="h-services" className={`${styles.wrap} ${styles.section}`} style={{ scrollMarginTop: 92 }}>
          <Reveal className={styles.sectionHead}>
            <span className={styles.kicker}>השירותים</span>
            <h2 id="h-services" className={styles.h2}>
              כל השירותים שעסק יופי צריך<span aria-hidden="true" className={styles.dot}>.</span>
            </h2>
            <p className={styles.sectionLede}>אפשר להזמין שירות אחד או לשלב כמה. רוב העסקים מתחילים בשירות אחד ומוסיפים עוד כשהם רואים מה עובד.</p>
          </Reveal>
          <div className={styles.groups}>
            {SERVICE_GROUPS.map((g, gi) => (
              <div key={g.title}>
                <Reveal className={styles.groupHead} delay={gi * 60}>
                  <h3>{g.title}</h3>
                  <p>{g.line}</p>
                </Reveal>
                <ul className={styles.cards}>
                  {g.slugs
                    .map(slug => bySlug.get(slug))
                    .filter((s): s is ResolvedService => !!s)
                    .map((s, i) => {
                      const from = fromPrice(s);
                      return (
                        <Reveal as="li" key={s.slug} delay={i * 90}>
                          <Link href={marketingService(s.slug)} className={styles.card}>
                            <span className={styles.cardIcon} aria-hidden="true">
                              <PathIcon paths={s.icon} stroke="currentColor" />
                            </span>
                            <h4 className={styles.cardTitle}>{s.name}</h4>
                            <p className={styles.cardLine}>{s.cardLine}</p>
                            <p className={styles.cardFrom}>
                              {from ? (
                                <>
                                  החל מ־<strong className="ltr">{nis(from.price)}</strong> {from.monthly ? 'לחודש' : ''}
                                </>
                              ) : (
                                'בהצעת מחיר מותאמת'
                              )}
                            </p>
                            <span className={styles.cardMore}>
                              לפרטים ולחבילות
                              <ArrowForward />
                            </span>
                          </Link>
                        </Reveal>
                      );
                    })}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="h-why" className={`${styles.wrap} ${styles.section}`}>
          <Reveal className={styles.sectionHead}>
            <span className={styles.kicker}>למה BeautyFind</span>
            <h2 id="h-why" className={styles.h2}>
              שיווק שמבין איך לקוחות בוחרות מכון יופי<span aria-hidden="true" className={styles.dot}>.</span>
            </h2>
          </Reveal>
          <ol className={styles.why}>
            {WHY.map((w, i) => (
              <Reveal as="li" key={w.title} delay={(i % 2) * 90}>
                <span className={styles.whyNum} aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <h3>{w.title}</h3>
                  <p>{w.body}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        </section>

        <section aria-labelledby="h-prices" className={styles.pricing}>
          <div className={styles.pricingInner}>
            <Reveal className={`${styles.sectionHead} ${styles.sectionHeadCenter}`}>
              <span className={styles.kicker}>מחירים</span>
              <h2 id="h-prices" className={styles.h2}>
                כמה עולה כל שירות<span aria-hidden="true" className={styles.dot}>?</span>
              </h2>
              <p className={styles.sectionLede}>המחיר ההתחלתי של כל שירות אצלנו. בכל עמוד שירות יש פירוט מלא של החבילות, וגם טווחי המחירים המקובלים בשוק.</p>
            </Reveal>
            <Reveal className={styles.tableWrap} delay={100}>
              <table className={styles.table}>
                <caption className="sr-only">מחירים התחלתיים לשירותי השיווק</caption>
                <thead>
                  <tr>
                    <th scope="col">שירות</th>
                    <th scope="col">החל מ־</th>
                    <th scope="col">אופן החיוב</th>
                  </tr>
                </thead>
                <tbody>
                  {services.map(s => {
                    const from = fromPrice(s);
                    return (
                      <tr key={s.slug}>
                        <td>
                          <Link href={marketingService(s.slug)} style={{ fontWeight: 700 }}>
                            {s.name}
                          </Link>
                        </td>
                        <td className="ltr">{from ? nis(from.price) : 'הצעת מחיר'}</td>
                        <td>{from ? (from.monthly ? 'חודשי, התחייבות ל־3 חודשים' : 'תשלום חד־פעמי') : 'לפי היקף'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Reveal>
            <p className={styles.asOf} style={{ textAlign: 'center' }}>כל המחירים ללא מע״מ ישראלי. תקציב המדיה בקמפיינים משולם ישירות לגוגל, למטא או לטיקטוק.</p>
          </div>
        </section>

        <section aria-labelledby="h-steps" className={`${styles.wrap} ${styles.section}`}>
          <Reveal className={styles.sectionHead}>
            <span className={styles.kicker}>איך זה עובד</span>
            <h2 id="h-steps" className={styles.h2}>
              מההזמנה ועד לקוחות חדשות ביומן<span aria-hidden="true" className={styles.dot}>.</span>
            </h2>
          </Reveal>
          <ol className={styles.process} data-count={STEPS.length}>
            {STEPS.map((st, i) => (
              <Reveal as="li" key={st.title} className={styles.step} delay={i * 120}>
                <span className={styles.stepNum} aria-hidden="true">{i + 1}</span>
                <div>
                  <h3>{st.title}</h3>
                  <p>{st.body}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        </section>

        <section aria-labelledby="h-guide" className={`${styles.wrap} ${styles.section}`}>
          <div className={styles.article} style={{ marginInline: 'auto' }}>
            <Reveal as="section" aria-labelledby="h-guide">
              <h2 id="h-guide">איך בוחרים שיווק דיגיטלי לעסק יופי</h2>
              <p>
                רוב בעלי עסקי היופי מתחילים מאינסטגרם, וזה הגיוני: שם רואים את העבודה. אבל לקוחה חדשה מגיעה ברוב המקרים מחיפוש. היא מקלידה בגוגל ״טיפול פנים בהרצליה״, פותחת את המפה, משווה שלושה מקומות לפי ביקורות ותמונות, ולפעמים שואלת את ChatGPT מי מומלץ באזור. עסק שלא מופיע ברגעים האלה מפסיד אותה, גם אם העבודה שלו מצוינת.
              </p>
              <p>{rich('לכן כדאי לחשוב על שיווק כעל שלושה צעדים. קודם מוודאים שיש בסיס: אתר ברור עם מחירון, פרופיל עסקי מלא בגוגל, ו[פרופיל מאומת ב־BeautyFind](/for-business). אחר כך מוסיפים ערוץ שמביא לקוחות מהר, כמו [פרסום בפייסבוק ובאינסטגרם](/for-business/marketing/social-ads) או [קידום ממומן בגוגל](/for-business/marketing/google-ads). ובמקביל בונים נכסים לטווח ארוך: [קידום אתרים בגוגל](/for-business/marketing/seo), [קידום במנועי AI](/for-business/marketing/geo) ו[תוכן קבוע ברשתות](/for-business/marketing/content-creative).', 'hubg')}</p>
            </Reveal>
            <Reveal as="section" aria-labelledby="h-guide2">
              <h2 id="h-guide2">מה לבדוק לפני שבוחרים חברת שיווק</h2>
              <p>לפני שמתחייבים, שווה לקבל תשובות ברורות לכמה שאלות. ספק טוב יענה עליהן בלי היסוס.</p>
              <ul>
                <li>מה בדיוק נעשה בכל חודש, ובאיזו כמות?</li>
                <li>על שם מי רשומים חשבונות הפרסום, האתר והפרופיל העסקי?</li>
                <li>האם תקציב המדיה מופרד מדמי הניהול, ואני רואה כמה הוצא?</li>
                <li>איך נמדדת הצלחה: פניות ותורים, או רק חשיפות?</li>
                <li>מה ההתחייבות, ומה קורה כשרוצים להפסיק?</li>
              </ul>
            </Reveal>
          </div>
        </section>

        <section aria-labelledby="h-faq" className={styles.faq}>
          <h2 id="h-faq" className={`${styles.h2Sm} ${styles.faqTitle}`}>
            שאלות נפוצות על שיווק לעסקי יופי<span aria-hidden="true" className={styles.dot}>.</span>
          </h2>
          <FaqAccordion items={FAQS} />
        </section>

        <section id="quote" aria-labelledby="h-quote" className={styles.quote}>
          <Reveal className={styles.quoteBox} kind="scale">
            <div className={styles.quoteCopy}>
              <span className={styles.kicker}>בואו נדבר</span>
              <h2 id="h-quote" className={styles.h2Sm}>
                לא בטוחים מאיפה להתחיל<span aria-hidden="true" className={styles.dot}>?</span>
              </h2>
              <p className={styles.sectionLede}>ספרו לנו על העסק ונחזור אליכם תוך יום עסקים עם המלצה והצעה מסודרת. בלי התחייבות.</p>
              <ul>
                {['המלצה על נקודת ההתחלה הנכונה לעסק שלכם', 'הצעה כתובה עם היקף, מחיר ולוח זמנים', 'אפשר לשלב כמה שירותים בהצעה אחת'].map(t => (
                  <li key={t}>
                    <Check size={14} />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <QuoteForm service={quoteServices[0]?.slug ?? 'seo'} serviceName="שירותי שיווק" services={quoteServices} messageLabel="ספרו בקצרה על העסק ומה הייתם רוצים לשפר" />
          </Reveal>
        </section>

        <section aria-labelledby="h-cta" className={styles.ctaSection}>
          <Reveal className={styles.ctaBox} kind="scale">
            <span aria-hidden="true" className={styles.ctaStripes} />
            <span aria-hidden="true" className={styles.ctaGlow} />
            <div className={styles.ctaCopy}>
              <h2 id="h-cta">
                עוד לא רשומים ב־BeautyFind<span aria-hidden="true" className={styles.dotLight}>?</span>
              </h2>
              <p>פרופיל מאומת באינדקס הוא הבסיס לכל שיווק: לקוחות מוצאות אתכם לפי עיר וטיפול. ובבדיקה שערכנו באוקטובר 2026, ChatGPT ציטט עמוד של BeautyFind כמקור בתשובה על קוסמטיקאית מומלצת.</p>
            </div>
            <div className={styles.ctaActions}>
              <Link href={ROUTES.forBusiness} className={styles.ctaWhite}>
                <span>לרישום העסק</span>
                <ArrowForward size={16} />
              </Link>
              <a href="#services" className={styles.ctaLink}>
                חזרה לשירותים
              </a>
            </div>
          </Reveal>
        </section>
      </main>

      <MarketingStickyBar heroEndId="hero-end" hideIds={['services', 'quote', 'h-cta']} primary={{ href: '#services', label: 'לכל השירותים' }} secondary={{ href: '#quote', label: 'הצעה' }} />
      <div className="bf-desk-only">
        <SiteFooter />
      </div>
    </div>
  );
}
