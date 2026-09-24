import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { FaqAccordion } from '@/components/faq/FaqAccordion';
import { ArrowForward, Check, PathIcon, Stars } from '@/components/icons';
import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { nis } from '@/lib/format';
import { PLAN_MONTHLY_NIS, PLATFORM_BILLING_LINE, PLATFORM_PRICE_NOTE, type PlanKey } from '@/lib/pricing';
import { ROUTES, joinWithPlan } from '@/lib/routes';
import { StickyJoinBar } from './StickyJoinBar';
import styles from './page.module.css';

// Design: project/BeautyFind Get Listed.dc.html

const TITLE = 'רישום עסק באינדקס ופרסום למכוני יופי וקליניקות';
const DESCRIPTION = `פרסום עסק ב־BeautyFind, אינדקס מכוני היופי והקליניקות לאסתטיקה בישראל: פרופיל מאומת, מחירון, ביקורות ומערכת זימון תורים. מ־${nis(PLAN_MONTHLY_NIS.basic)} לסניף בחודש, בלי עמלות.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/for-business' },
  openGraph: { type: 'website', locale: 'he_IL', url: '/for-business', siteName: 'BeautyFind', title: TITLE, description: DESCRIPTION, images: ['/assets/hero-clinic.jpg'] },
};

const PROOF = [
  { strong: '7 אזורים ומעל 60 ערים', post: ' בכל רחבי ישראל' },
  { strong: '14 תחומי טיפול', post: ', מאסתטיקה רפואית ועד ספא' },
  { pre: 'דירוגי Google ', strong: 'מתעדכנים מדי שבוע' },
];

const FEATURES = [
  {
    num: '1',
    title: 'רישום הסניף שלכם',
    body: 'אמתו בעלות על דף קיים, או הוסיפו עסק שעדיין לא מופיע ב־BeautyFind, וקבלו שליטה מלאה על הדף.',
    icon: ['M12 3.2 4.6 6.1v5.3c0 4.6 3.1 7.9 7.4 9.3 4.3-1.4 7.4-4.7 7.4-9.3V6.1z', 'M8.8 11.8 11 14l4-4.2'],
  },
  {
    num: '2',
    title: 'תג עסק מאומת',
    body: 'עסקים מאומתים מקבלים תג ומדורגים מעל דפים לא רשומים בחיפוש לפי עיר ולפי תחום טיפול.',
    icon: ['M12 3.4 14 7l4 .6-2.9 2.8.7 4L12 12.5 8.2 14.4l.7-4L6 7.6 10 7z', 'M8.6 15.8 7 21l5-2.2L17 21l-1.6-5.2'],
  },
  {
    num: '3',
    title: 'פרופיל מלא ועשיר',
    body: 'גלריית תמונות, תפריט טיפולים עם מחירים, צוות, שעות פעילות, שאלות נפוצות ותמונות לפני ואחרי. הכול בעריכה שלכם.',
    icon: ['M3.6 5.4h16.8v13.2H3.6z', 'M3.6 15.2 8.4 10.6l4 3.8 3.2-2.6 3.8 3.4', 'M15.4 9.2a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4'],
  },
  {
    num: '4',
    title: 'ביקורות Google וביקורות מאומתות',
    // Google reviews cannot be answered from BeautyFind (decision A4), so only BeautyFind reviews get a reply here.
    body: 'דירוג Google מסתנכרן מדי שבוע, ולצידו ביקורות BeautyFind שנכתבות רק אחרי ביקור מאומת ביומן. לביקורות BeautyFind מגיבים ישירות מלוח הבקרה.',
    icon: ['M12 3.6l2.5 5.1 5.6.8-4.1 3.9 1 5.6L12 16.3 6.9 19l1-5.6-4.1-3.9 5.6-.8z'],
  },
  {
    num: '5',
    title: 'קביעת תור אונליין',
    body: 'לקוחות קובעים תור ישירות מהפרופיל. היומן מסתנכרן עם Google Calendar, עם Outlook או עם מערכת ניהול התורים שלכם, ואישורים ותזכורות נשלחים בוואטסאפ, ב־SMS ובמייל.',
    icon: ['M4.2 5.6h15.6v14.2H4.2z', 'M4.2 10h15.6', 'M8.4 3.4v3.6', 'M15.6 3.4v3.6', 'M9.4 14.6l1.9 1.9 3.6-3.8'],
  },
  {
    num: '6',
    title: 'ריבוי סניפים',
    body: 'רשמו את כל הסניפים שלכם. החיוב הוא לפי סניף, במנוי אחד ובחשבונית אחת.',
    icon: [
      'M8.4 21c-2.7-3.2-4.2-5.5-4.2-7.8a4.2 4.2 0 0 1 8.4 0c0 2.3-1.5 4.6-4.2 7.8z',
      'M8.4 12.2a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2',
      'M15.6 3.2c2.3 2.8 3.6 4.7 3.6 6.7a3.6 3.6 0 0 1-7.2 0c0-2 1.3-3.9 3.6-6.7z',
    ],
  },
];

const PRICING_NOTES = [
  'בלי עמלות ובלי אחוזים על תורים. מה שהלקוח משלם לכם נשאר אצלכם.',
  'החיוב הוא לפי סניף מפורסם. על סניף בטיוטה אין חיוב.',
  'אפשר לעבור בין המסלולים בכל חודש, והמידע נשמר.',
  'חשבונית נשלחת אוטומטית בכל חיוב, מ־Israfind Group (דלאוור, ארה״ב), בלי מע״מ ישראלי.',
  'ביטול בכל עת מתוך אזור בעלי העסקים, בלי שיחות ובלי התחייבות.',
];

const PLANS: Array<{ key: PlanKey; name: string; line: string; badge?: string; cta: string; feats: string[] }> = [
  {
    key: 'basic',
    name: 'רישום בסיסי',
    line: 'נראות, קביעת תורים וביקורות',
    cta: 'התחלה בבסיסי',
    feats: ['פרופיל מאומת, גלריה ותפריט מחירים', 'קביעת תור אונליין עם סנכרון יומן', 'אישורים ותזכורות בוואטסאפ, ב־SMS ובמייל', 'ביקורות Google וביקורות מאומתות', 'לוח פניות ואנליטיקת פרופיל'],
  },
  {
    key: 'advanced',
    name: 'רישום מתקדם + CRM',
    line: 'כל מה שבבסיסי, וגם מערכת לניהול הקליניקה',
    badge: 'לקליניקות',
    cta: 'התחלה במתקדם',
    feats: [
      'כל מה שבמסלול הבסיסי',
      'יומן לניהול תורים, CRM וכרטיסי לקוחות',
      'הצהרות בריאות, צ׳ק־אין ורישום קליני',
      'מקדמות, שוברי מתנה ורשימת המתנה',
      'בקשות לייעוץ רפואי, ניהול צוות והרשאות',
      'מלאי, אוטומציות ואינטגרציות',
    ],
  },
];

const OUTCOMES = [
  ['להופיע בחיפושים מקומיים', 'כך לקוחות מחפשים בפועל: ״קוסמטיקאית בתל אביב״, ״מכון יופי קרוב אליי״. דפי הערים ודפי תחומי הטיפול מכניסים את העסק שלכם לתוצאות האלה.'],
  ['להציג את העסק כמו שהוא', 'דף לא מאומת מציג רק שם וכתובת. פרופיל רשום מציג את המקום, את הצוות, את המחירים ואת הסטנדרטים שלכם.'],
  ['להפוך מתעניינים לתורים', 'לקוחה שמשווה בין שלושה מכונים בוחרת במכון שענה על השאלות שלה עוד לפני שהתקשרה. ומשם, קביעת התור במרחק לחיצה.'],
];

const FAQS = [
  {
    q: 'העסק צריך להופיע כבר באינדקס כדי להירשם?',
    a: 'לא. אם העסק שלכם כבר מופיע באינדקס, מאמתים בעלות על הדף הקיים. אם לא, מוסיפים אותו בתהליך ההרשמה, והוא עולה לאוויר ברגע שהאימות מסתיים.',
  },
  {
    // Aligned with the Claim and Onboarding flows: code to the listed contact + company registry check.
    q: 'איך עובד האימות?',
    a: 'האימות כולל קוד שנשלח ב־SMS, בשיחה קולית או בדוא״ל לפרטי הקשר הרשומים של העסק, ובדיקה של הח״פ מול רשם החברות. בעסק שמציע טיפולים רפואיים בודקים גם את רישיון הרופא מול משרד הבריאות. אצל רוב העסקים האימות מסתיים באותו יום עסקים.',
  },
  {
    q: 'אפשר לנהל כמה סניפים?',
    a: 'כן. חשבון אחד מנהל את כל הסניפים שלכם, ולכל סניף פרופיל, שעות פעילות ותפריט טיפולים משלו. הכמות במנוי תואמת את מספר הסניפים הרשומים.',
  },
  {
    q: 'מה מופיע בפרופיל הציבורי?',
    a: 'כל מה שתפרסמו: גלריה, תיאור, שירותים עם מחירים, צוות, סרטונים, שעות פעילות, שאלות נפוצות, תמונות לפני ואחרי, מפה ודרכי התקשרות, לצד הדירוג שלכם ב־Google.',
  },
  {
    q: 'איך עובדות הביקורות?',
    a: 'יש שני סוגי ביקורות, והם מוצגים בנפרד: דירוג Google הציבורי שלכם עם קישור לפרופיל, וביקורות BeautyFind שנכתבות רק על ידי לקוחות שביקרו בפועל. לכל ביקורת BeautyFind אפשר להגיב בפומבי מלוח הבקרה, ולביקורות Google מגיבים ב־Google. אי אפשר למחוק ביקורת שלילית, אבל אפשר לדווח על ביקורת שמפרה את תקן הרישום.',
  },
  {
    q: 'איך עובד החיוב והחשבונית?',
    a: `מנוי אחד לכל העסק, לפי מספר הסניפים המפורסמים: ${nis(PLAN_MONTHLY_NIS.basic)} לחודש לסניף במסלול הבסיסי, או ${nis(PLAN_MONTHLY_NIS.advanced)} לחודש לסניף במסלול המתקדם עם CRM. על סניף בטיוטה אין חיוב, וסניף חדש נכנס למחזור החיוב הבא. חשבונית אחת בכל חיוב. אין עמלות על תורים. ${PLATFORM_BILLING_LINE}`,
  },
];

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
};

function VerifiedBadge() {
  return (
    <span className={styles.verified}>
      <Check />
      מאומת
    </span>
  );
}

export default function GetListedPage() {
  return (
    <div className={styles.root}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <SiteHeader title="רישום עסק" backHref="/more" />

      <main>
        <section aria-labelledby="hero-h1" className={styles.hero}>
          <span aria-hidden="true" className={styles.heroGlow} />
          <div className={styles.heroInner}>
            <div className={styles.heroCopy}>
              <div className={styles.eyebrow}>
                <span aria-hidden="true" className={styles.eyebrowLine} />
                לבעלי עסקים בתחום היופי
              </div>
              <h1 id="hero-h1" className={styles.h1}>
                <span style={{ animationDelay: '.05s' }}>שהעסק שלכם</span>
                <br />
                <span style={{ animationDelay: '.2s' }}>יופיע בדיוק</span>
                <br />
                <span style={{ animationDelay: '.35s' }}>
                  כשמחפשים אותו<span className={styles.dot}>.</span>
                </span>
              </h1>
              <p className={styles.lede}>
                לקוחות מחפשים לפי עיר ולפי טיפול: ״קוסמטיקאית בתל אביב״, ״הסרת שיער בלייזר בחיפה״. פרופיל מאומת מציב את העסק שלכם בתוצאות האלה, בדיוק ברגע שבו הם מחליטים.
              </p>
              <div className={styles.heroCtas}>
                <Link href={ROUTES.join} className={styles.ctaPrimary}>
                  <span>רישום העסק</span>
                  <ArrowForward />
                </Link>
                <a href="#pricing" className={styles.ctaGhost}>למחירים</a>
              </div>
              <p className={styles.already}>
                כבר רשומים? <Link href={ROUTES.bizLogin}>כניסה לחשבון</Link>
              </p>
            </div>

            <div className={styles.heroArt}>
              <div className={styles.heroStack}>
                <figure className={styles.heroFigure}>
                  <span className={styles.heroImg}>
                    <Image src="/assets/hero-clinic.jpg" alt="חדר טיפולים מעוצב בקליניקה לאסתטיקה" fill sizes="(min-width:1000px) 520px, 0px" priority style={{ objectFit: 'cover' }} />
                  </span>
                </figure>
                <div className={styles.heroCard}>
                  <div className={styles.cardTitleRow}>
                    <span className={styles.cardName}>שם העסק שלכם</span>
                    <VerifiedBadge />
                  </div>
                  <div className={styles.ratingRow}>
                    <Stars />
                    <span className={`${styles.score} ltr`}>4.9</span>
                    <span className={`${styles.count} ltr`}>(312)</span>
                  </div>
                  <span className={styles.cardMeta}>12 תמונות · 24 טיפולים עם מחיר · קביעת תור אונליין</span>
                </div>
              </div>
              <span aria-hidden="true" className={styles.heroDot} />
            </div>
          </div>
        </section>

        <span id="hero-end" aria-hidden="true" />
        <section aria-label="נתוני האינדקס" className={styles.proof}>
          <ul>
            {PROOF.map((p, i) => (
              <li key={p.strong} style={{ animationDelay: `${i * 90}ms` }}>
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#0B7A87" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2.6 8.4 6 11.8 13.4 4" />
                </svg>
                <span>
                  {p.pre}
                  <strong>{p.strong}</strong>
                  {p.post}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="h-features" className={styles.features}>
          <div className={styles.sectionHead}>
            <h2 id="h-features" className={styles.h2}>
              נרשמים פעם אחת. הפרופיל עושה את השאר<span className={styles.dot}>.</span>
            </h2>
            <p className={styles.sectionLede}>ההרשמה לוקחת כמה דקות, והאימות מסתיים תוך עד 2 ימי עסקים. מכאן והלאה אתם שולטים בכל מה שהלקוחות רואים: תמונות, תפריט טיפולים, מחירים, צוות ושעות פעילות.</p>
          </div>
          <ol className={styles.featureGrid}>
            {FEATURES.map((f, i) => (
              <li key={f.num} className={styles.feature} style={{ animationDelay: `${i * 70}ms` }}>
                <span aria-hidden="true" className={styles.featureBar} />
                <span aria-hidden="true" className={styles.featureNum}>{f.num}</span>
                <span aria-hidden="true" className={styles.featureIcon}>
                  <PathIcon paths={f.icon} />
                </span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="pricing" aria-labelledby="h-pricing" className={styles.pricing}>
          <div className={styles.pricingInner}>
            <div className={styles.pricingCopy}>
              <span className={styles.eyebrowStatic}>
                <span aria-hidden="true" className={styles.eyebrowLineStatic} />
                מסלולי המנוי
              </span>
              <h2 id="h-pricing" className={`${styles.h2} ${styles.h2Pricing}`}>
                שני מסלולים, לפי מספר הסניפים<span className={styles.dot}>.</span>
              </h2>
              <p className={styles.sectionLede}>רישום בסיסי לנראות ולקביעת תורים, או רישום מתקדם שכולל מערכת לניהול הקליניקה. בשני המסלולים המחיר הוא לסניף, בלי עמלות על תורים.</p>
              <ul className={styles.notes}>
                {PRICING_NOTES.map(n => (
                  <li key={n}>
                    <span aria-hidden="true" />
                    {n}
                  </li>
                ))}
              </ul>
            </div>

            <div className={styles.plans}>
              {PLANS.map(pl => (
                <div key={pl.key} className={styles.plan} data-featured={pl.badge ? true : undefined}>
                  <div className={styles.planHead}>
                    <span className={styles.planName}>{pl.name}</span>
                    {pl.badge && <span className={styles.planBadge}>{pl.badge}</span>}
                  </div>
                  <div className={styles.planPriceRow}>
                    <span className={`${styles.planPrice} ltr`}>{nis(PLAN_MONTHLY_NIS[pl.key])}</span>
                    <span className={styles.planUnit}>לחודש, לכל סניף</span>
                  </div>
                  <p className={styles.planVat}>{PLATFORM_PRICE_NOTE} · ללא התחייבות</p>
                  <p className={styles.planLine}>{pl.line}</p>
                  <ul className={styles.planFeats}>
                    {pl.feats.map(f => (
                      <li key={f}>
                        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="#0B7A87" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M4 10.5 8 14.5l8-9" />
                        </svg>
                        {f}
                      </li>
                    ))}
                  </ul>
                  <div className={styles.planCtaWrap}>
                    <Link href={joinWithPlan(pl.key)} className={styles.planCta}>
                      <span>{pl.cta}</span>
                      <ArrowForward />
                    </Link>
                  </div>
                </div>
              ))}
              <p className={styles.plansNote}>ביטול בכל עת. מעבר בין המסלולים בכל חודש.</p>
            </div>
          </div>
        </section>

        <section aria-labelledby="h-outcome" className={styles.outcome}>
          <div className={styles.outcomeGrid}>
            <div>
              <h2 id="h-outcome" className={styles.h2Sm}>
                כדי שלקוחות ימצאו אתכם, וגם יבחרו בכם<span className={styles.dot}>.</span>
              </h2>
              <div className={styles.outcomeList}>
                {OUTCOMES.map(([title, body], i) => (
                  <div key={title} className={styles.outcomeItem} style={{ animationDelay: `${i * 90}ms` }}>
                    <span aria-hidden="true" />
                    <span className={styles.outcomeText}>
                      <span className={styles.outcomeTitle}>{title}</span>
                      <span className={styles.outcomeBody}>{body}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.compare}>
              <div className={styles.unlisted}>
                <div className={styles.compareLabel}>לא רשום</div>
                <div className={styles.unlistedName}>שם העסק שלכם</div>
                <div className={styles.unlistedMeta}>תל אביב–יפו · בלי תמונות · בלי תפריט טיפולים</div>
              </div>
              <div aria-hidden="true" className={styles.compareArrow}>
                <svg width="20" height="20" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 2v10M3 8l4 4 4-4" />
                </svg>
              </div>
              <div className={styles.listed}>
                <div className={`${styles.compareLabel} ${styles.compareLabelOn}`}>רשום ומאומת</div>
                <div className={styles.cardTitleRow}>
                  <span className={styles.listedName}>שם העסק שלכם</span>
                  <VerifiedBadge />
                </div>
                <div className={styles.listedRating}>
                  <Stars width={80} height={15} />
                  <span className={`${styles.score} ltr`}>4.9</span>
                  <span className={styles.count}>
                    <span className="ltr">312</span> ביקורות ב־Google
                  </span>
                </div>
                <div className={styles.listedMeta}>12 תמונות · 24 טיפולים עם מחיר · קביעת תור אונליין</div>
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="h-faq" className={styles.faq}>
          <h2 id="h-faq" className={`${styles.h2Sm} ${styles.faqTitle}`}>
            שאלות מבעלי עסקים<span className={styles.dot}>.</span>
          </h2>
          <FaqAccordion items={FAQS} />
        </section>

        <section aria-labelledby="h-cta" className={styles.ctaSection}>
          <div className={styles.ctaBox}>
            <span aria-hidden="true" className={styles.ctaStripes} />
            <span aria-hidden="true" className={styles.ctaGlow} />
            <div className={styles.ctaCopy}>
              <h2 id="h-cta">
                מוכנים שלקוחות ימצאו את העסק שלכם<span className={styles.dotLight}>?</span>
              </h2>
              <p>רשמו את הסניף שלכם היום. האימות מסתיים תוך עד 2 ימי עסקים.</p>
            </div>
            <div className={styles.ctaActions}>
              <Link href={ROUTES.join} className={styles.ctaWhite}>
                <span>רישום העסק</span>
                <ArrowForward size={16} />
              </Link>
              <Link href={ROUTES.bizLogin} className={styles.ctaLogin}>כניסת בעלי עסקים</Link>
            </div>
          </div>
        </section>
      </main>

      <StickyJoinBar heroEndId="hero-end" ctaId="h-cta" />
      {/* Phones: the footer's links live on the "עוד" tab. */}
      <div className="bf-desk-only">
        <SiteFooter />
      </div>
    </div>
  );
}
