import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { FaqAccordion } from '@/components/faq/FaqAccordion';
import { ArrowForward } from '@/components/icons';
import { ContactProvider, ContactTrigger } from '@/components/profile/ContactDialog';
import { CallButton, TrackedLink, WazeButton, WhatsAppButton } from '@/components/profile/ContactLinks';
import { displayUrl, initials, mapsHref, ratingText } from '@/components/profile/format';
import { BeforeAfter, Gallery } from '@/components/profile/Gallery';
import { CheckMark, ExternalGlyph, INSTAGRAM_PATH, MessageGlyph, PinGlyph, RatingStars } from '@/components/profile/icons';
import { MapEmbed } from '@/components/profile/MapEmbed';
import { mapQuery } from '@/lib/mapsEmbed';
import { ProfileHeader, SectionTabs } from '@/components/profile/ProfileMobile';
import { ProfileView } from '@/components/profile/ProfileView';
import { ReviewsInfo, ReviewsRail } from '@/components/profile/Reviews';
import { Services, ServicesEmpty } from '@/components/profile/Services';
import { VideoGrid } from '@/components/profile/VideoEmbed';
import { SaveHeart } from '@/components/save-heart/SaveHeart';
import { ActionBar } from '@/components/shell/ActionBar';
import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { ROUTES } from '@/lib/routes';
import { fromE164, telHref } from '@/lib/format';
import { getProfile, type PublicProfile } from '@/lib/server/public';
import { buildView, jsonLd, ldJson, metaDescription, metaTitle, reviewsLabel, similarBusinesses, type ProfileView as View } from './data';
import btn from '@/components/profile/buttons.module.css';
import rv from '@/components/profile/Reviews.module.css';
import styles from './page.module.css';

// Design: project/BeautyFind Business Profile.dc.html and Business Profile Mobile v2 (docs/coverage-manifest.md
// maps every element). "Open now", "today" and relative review dates are computed per request in
// Asia/Jerusalem, so no stale cache. Unclaimed listings use the same template: every section stays, with a
// truthful state where the data is missing.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ region: string; slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { region, slug } = await params;
  const p = await getProfile(region, slug);
  if (!p) return { title: 'העסק לא נמצא', robots: { index: false } };
  const v = buildView(p);
  const title = metaTitle(p, v);
  const description = metaDescription(p, v);
  return {
    title,
    description,
    alternates: { canonical: p.href },
    openGraph: { title, description, url: p.href, type: 'website', locale: 'he_IL', siteName: 'BeautyFind', ...(v.photos[0] ? { images: [{ url: v.photos[0].url, alt: v.photos[0].alt }] } : {}) },
  };
}

const FACT_ICONS: Record<string, string[]> = {
  established: ['M10 5.2v5l3.4 2', 'M10 2.2a7.8 7.8 0 1 0 0 15.6 7.8 7.8 0 0 0 0-15.6'],
  team: ['M13.8 17.5v-1.6a3 3 0 0 0-3-3H5.2a3 3 0 0 0-3 3v1.6', 'M8 9.8a3 3 0 1 0 0-6 3 3 0 0 0 0 6', 'M17.8 17.5v-1.6a3 3 0 0 0-2.3-2.9', 'M12.8 3.9a3 3 0 0 1 0 5.8'],
  languages: ['M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16', 'M2 10h16', 'M10 2c2.2 2.4 2.2 13.2 0 16', 'M10 2c-2.2 2.4-2.2 13.2 0 16'],
  responsible: ['M10 2.4 4 4.8v4.4c0 3.8 2.6 6.6 6 7.8 3.4-1.2 6-4 6-7.8V4.8z', 'M7.4 9.8l1.9 1.9 3.4-3.6'],
  hours: ['M10 5.2v5l3.4 2', 'M10 2.2a7.8 7.8 0 1 0 0 15.6 7.8 7.8 0 0 0 0-15.6'],
  rating: ['M10 2.6l2.3 4.7 5.2.8-3.8 3.7.9 5.2-4.6-2.4-4.6 2.4.9-5.2-3.8-3.7 5.2-.8z'],
  unknown: ['M10 2.2a7.8 7.8 0 1 0 0 15.6 7.8 7.8 0 0 0 0-15.6', 'M10 13.6h.01', 'M8 7.6a2 2 0 1 1 2.8 1.8c-.6.3-.8.7-.8 1.4'],
};

const EMBED_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY || '';

export default async function BusinessProfilePage({ params, searchParams }: Props) {
  const { region, slug } = await params;
  const p = await getProfile(region, slug);
  if (!p) notFound();
  // Served at /:region/:category/:slug (see the rewrite in next.config.ts, which passes the category as
  // "via"). Any other address, including the old /:region/biz/:slug, moves permanently to that one.
  const via = (await searchParams).via;
  const canonicalCat = p.href.split('/')[2];
  if (canonicalCat !== 'biz' && via !== canonicalCat) permanentRedirect(p.href);
  const v = buildView(p);

  const parentHref = v.citySlug ? `/${p.regionSlug}/${v.citySlug}` : `/${p.regionSlug}`;
  const crumbs = (
    <nav aria-label="נתיב ניווט" className={styles.crumbs}>
      <ol>
        <li><Link href="/">ראשי</Link></li>
        <li aria-hidden="true">/</li>
        <li><Link href={`/${p.regionSlug}`}>{p.region.name}</Link></li>
        {v.citySlug && (
          <>
            <li aria-hidden="true">/</li>
            <li><Link href={`/${p.regionSlug}/${v.citySlug}`}>{p.cityName}</Link></li>
          </>
        )}
        <li aria-hidden="true">/</li>
        <li aria-current="page">{p.name}</li>
      </ol>
    </nav>
  );

  const ld = <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(jsonLd(p, v)) }} />;

  const similar = await similarBusinesses(p, v.cats[0]?.slug);
  const cta = primaryCta(p, v);
  const bookHref = cta?.kind === 'book' ? cta.href : null;

  // Phone section chips (mobile v2 §4), in page order. Every section keeps its anchor; the chips list the ones with content.
  const tabs = [
    { key: 'services', label: 'מחירים', target: 'h-services' },
    { key: 'reviews', label: 'ביקורות', target: 'h-reviews' },
    (v.staff.length > 0 || v.siteTeam.length > 0) && { key: 'team', label: 'צוות', target: 'h-team' },
    v.videos.length > 0 && { key: 'video', label: 'סרטונים', target: 'h-video' },
    { key: 'hours', label: 'שעות', target: 'h-hours' },
    v.faqs.length > 0 && { key: 'faq', label: 'שאלות', target: 'h-faq' },
    { key: 'loc', label: 'הגעה', target: 'h-loc' },
    { key: 'contact', label: 'יצירת קשר', target: 'bf-contact' },
  ].filter((t): t is { key: string; label: string; target: string } => !!t);
  // The bar's status line makes no claim when hours are unknown.
  const status = v.open ? v.open.label : v.hoursKnown && v.todayRange === null ? 'סגור היום' : null;

  return (
    <div className={styles.root}>
      {ld}
      <ProfileHeader name={p.name} watchId="h-name" backHref={parentHref} />
      {crumbs}
      <ProfileView branchId={p.id} />
      {!p.isClaimed && (
        <p className={`${styles.wrap} ${styles.unclaimedNote}`} role="note">
          הכרטיס הזה אינו מנוהל על ידי העסק. הפרטים נאספו ממקורות פומביים וייתכן שאינם מעודכנים.{' '}
          <Link href={ROUTES.claim}>זה העסק שלכם?</Link>
        </p>
      )}

      <ContactProvider branch={{ id: p.id, name: p.name, phone: p.phone, whatsapp: p.whatsapp, email: p.email, website: p.websiteUrl, direct: !p.isClaimed }} treatments={v.treatmentOptions}>
        {v.photos.length > 0 ? (
          <section aria-label="תמונות העסק" className={`${styles.wrap} ${styles.gallery}`}>
            <Gallery photos={v.photos} />
          </section>
        ) : (
          <section aria-label="תמונות העסק" className={`${styles.wrap} ${styles.gallery}`}>
            <div className={styles.heroFallback} role="img" aria-label={`${p.name}: עדיין אין תמונות מהעסק`}>
              <span aria-hidden="true" className={styles.heroMono}>{initials(p.name)}</span>
              <span className={styles.heroText}>
                {p.isClaimed ? 'העסק טרם העלה תמונות.' : 'לא נמצאו תמונות מהעסק במקורות שנבדקו.'}{' '}
                {p.isClaimed ? <Link href="/biz/profile">העלאת תמונות</Link> : <Link href={ROUTES.claim}>בעלי העסק יכולים להוסיף תמונות אחרי אישור בעלות</Link>}
              </span>
            </div>
          </section>
        )}
        <SectionTabs items={tabs} />

        <main className={`${styles.wrap} ${styles.main}`}>
          <div className={styles.col}>
            <Identity p={p} v={v} />

            <section aria-labelledby="h-about">
              <h2 id="h-about" className={styles.h2}>{v.heading}<span className={styles.dotTeal}>.</span></h2>
              {v.description.length > 0 ? (
                <div className={styles.about}>
                  {v.description.map((para, i) => <p key={i}>{para}</p>)}
                </div>
              ) : (
                <p className={styles.emptyState}>{p.isClaimed ? 'העסק טרם כתב תיאור.' : 'לא נמצא תיאור של העסק במקורות שנבדקו. הפרטים שנמצאו מופיעים בהמשך העמוד.'}</p>
              )}
            </section>

            <section aria-labelledby="h-services">
              <div className={styles.secHead}>
                <h2 id="h-services" className={styles.h2}>שירותים ומחירים<span className={styles.dotTeal}>.</span></h2>
                {v.services.length > 0 && (p.isClaimed && !v.importedPrices
                  ? v.pricesUpdated && <span className={styles.secNote}>המחירים נמסרו על ידי העסק ועודכנו ב־{v.pricesUpdated}</span>
                  : <span className={styles.secNote}>{v.pricesUpdated ? `כפי שפורסמו על ידי העסק, נאספו ב־${v.pricesUpdated}` : 'כפי שפורסמו על ידי העסק'}</span>)}
              </div>
              {v.services.length > 0 ? (
                <>
                  <Services groups={v.services} contact={p.isClaimed} bookHref={bookHref} />
                  <p className={styles.vat}>
                    {p.isClaimed && !v.importedPrices
                      ? 'כל המחירים לא כוללים מע״מ.'
                      : 'המחירים כפי שפרסם העסק; כדאי לוודא מול העסק אם הם כוללים מע״מ.'}
                    {v.medicalBiz ? ' טיפולים רפואיים נקבעים אחרי ייעוץ רפואי, ושם נקבע גם המחיר הסופי.' : ''}
                  </p>
                </>
              ) : (
                <ServicesEmpty contact={p.isClaimed} />
              )}
            </section>

            <ReviewsSection p={p} v={v} />

            <section aria-labelledby="h-ba">
              <div className={styles.secHead}>
                <h2 id="h-ba" className={styles.h2}>לפני ואחרי<span className={styles.dotTeal}>.</span></h2>
                {v.beforeAfter.length > 0 && <span className={styles.secNote}>פורסם על ידי העסק בהסכמת המטופלים</span>}
              </div>
              {v.beforeAfter.length > 0 ? <BeforeAfter photos={v.beforeAfter} /> : <p className={styles.emptyState}>{p.isClaimed ? 'העסק טרם פרסם תמונות לפני ואחרי.' : 'תמונות לפני ואחרי מתפרסמות רק על ידי העסק עצמו, בהסכמת המטופלים.'}</p>}
            </section>

            <section aria-labelledby="h-team">
              <h2 id="h-team" className={styles.h2}>הצוות שלנו<span className={styles.dotTeal}>.</span></h2>
              {v.staff.length > 0 || v.siteTeam.length > 0 ? (
                <>
                  <div className={styles.team}>
                    {v.staff.map(s => (
                      <Link key={s.id} href={`/pro/${s.id}`} className={styles.person}>
                        <span aria-hidden="true" className={styles.personPic} />
                        <span className={styles.personText}>
                          <span className={styles.personName}>{s.name}</span>
                          <span className={styles.personRole}>{s.role}</span>
                        </span>
                        {s.badge && (
                          <span className={styles.personBadge}>
                            <CheckMark size={12} strokeWidth={2.1} />
                            {s.badge}
                          </span>
                        )}
                        <span className={styles.personMore}>
                          לעמוד איש המקצוע
                          <ArrowForward size={13} />
                        </span>
                      </Link>
                    ))}
                    {v.siteTeam.map(t => (
                      <article key={t.name} className={`${styles.person} ${styles.personSite}`}>
                        <span aria-hidden="true" className={styles.personPic} />
                        <span className={styles.personText}>
                          <span className={styles.personName}>{t.name}</span>
                          {t.role && <span className={styles.personRole}>{t.role}</span>}
                        </span>
                        {t.bio && <span className={styles.personBio}>{t.bio}</span>}
                      </article>
                    ))}
                  </div>
                  {v.siteTeam.length > 0 && <p className={styles.secFoot}>פרטי הצוות לקוחים מאתר העסק. הסמכות ורישיונות מאומתים מופיעים רק אחרי אימות ב־BeautyFind.</p>}
                </>
              ) : (
                <p className={styles.emptyState}>{p.isClaimed ? 'העסק טרם הוסיף את אנשי הצוות.' : 'פרטי הצוות טרם עודכנו.'}</p>
              )}
            </section>

            <section aria-labelledby="h-video">
              <h2 id="h-video" className={styles.h2}>סרטונים<span className={styles.dotTeal}>.</span></h2>
              {v.videos.length > 0 ? (
                <VideoGrid videos={v.videos} />
              ) : (
                <p className={styles.emptyState}>
                  {p.youtube ? (
                    <>
                      לא נמצאו סרטונים שאפשר להציג כאן. <a href={p.youtube} target="_blank" rel="noopener nofollow">לערוץ היוטיוב של העסק</a>
                    </>
                  ) : p.isClaimed ? 'העסק טרם הוסיף סרטונים.' : 'לא נמצאו סרטונים רשמיים של העסק.'}
                </p>
              )}
            </section>

            <section aria-labelledby="h-hours">
              <h2 id="h-hours" className={styles.h2}>שעות פעילות<span className={styles.dotTeal}>.</span></h2>
              {v.hoursRows && v.hoursKnown ? (
                <table className={styles.hours}>
                  <caption>היום מסומן. השעות לפי שעון ישראל{v.hoursRows.some(h => h.unknown) ? '; ימים שלא פורסמו מסומנים כך.' : '.'}</caption>
                  <tbody>
                    {v.hoursRows.map(h => (
                      <tr key={h.day} data-today={h.today || undefined}>
                        <th scope="row">
                          {h.day}
                          {h.today && <span className={styles.todayBadge}> · היום</span>}
                        </th>
                        <td data-closed={(!h.range && !h.unknown) || undefined} data-unknown={h.unknown || undefined}>
                          {h.range ? <span dir="ltr" className={`ltr ${styles.range}`}>{h.range}</span> : h.unknown ? 'לא פורסם' : 'סגור'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className={styles.emptyBox}>
                  <p className={styles.emptyText}>שעות הפעילות לא פורסמו במקורות שנבדקו. כדאי לבדוק מול העסק לפני ההגעה.</p>
                  <ContactTrigger className={styles.emptyAction}>{p.isClaimed ? 'פנייה לעסק' : 'בירור מול העסק'}</ContactTrigger>
                </div>
              )}
            </section>

            <section aria-labelledby="h-faq">
              <h2 id="h-faq" className={styles.h2}>שאלות נפוצות<span className={styles.dotTeal}>.</span></h2>
              {v.faqs.length > 0 ? <FaqAccordion items={v.faqs} /> : <p className={styles.emptyState}>עוד לא נאספו שאלות ותשובות על העסק הזה. אפשר לפנות לעסק ישירות דרך פרטי הקשר.</p>}
            </section>

            <Location p={p} v={v} />

            {similar.length > 0 && (
              <section aria-labelledby="h-similar">
                <h2 id="h-similar" className={styles.h2}>עסקים נוספים ב{p.cityName}<span className={styles.dotTeal}>.</span></h2>
                <div className={styles.similar} data-n={similar.length}>
                  {similar.map(s => (
                    <Link key={s.id} href={s.href} className={styles.simCard}>
                      <span className={styles.simImg}>{s.coverUrl && <img src={s.coverUrl} alt={s.coverAlt} loading="lazy" />}</span>
                      <span className={styles.simBody}>
                        <span className={styles.simName}>{s.name}</span>
                        <span className={styles.simMeta}>{[s.cityName, s.categories[0]?.name].filter(Boolean).join(' · ')}</span>
                        {s.google && (
                          <span className={styles.simRating}>
                            <RatingStars rating={s.google.rating} width={72} height={14} />
                            <b className="ltr">{ratingText(s.google.rating)}</b>
                            בגוגל
                          </span>
                        )}
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside aria-label="יצירת קשר עם העסק" className={styles.aside}>
            <BookingCard p={p} v={v} cta={cta} />
          </aside>
        </main>

        {/* Phones (mobile v2 §16): today's status, call, WhatsApp, then the primary action. No sample copy. */}
        <ActionBar mobileOnly className={styles.actionBar}>
          <span className={styles.barStatus}>
            {status ? (
              <span className={styles.barState} data-closed={!v.open?.open || undefined}>
                <span aria-hidden="true" className={styles.barDot} />
                {status}
              </span>
            ) : (
              <span className={styles.barState} data-closed>{p.name}</span>
            )}
            <span className={styles.barSub}>{v.todayRange ? <span dir="ltr" className="ltr">{v.todayRange}</span> : p.cityName}</span>
          </span>
          {p.phone && <CallButton branchId={p.id} e164={p.phone} size="lg" iconOnly />}
          {p.whatsapp && <WhatsAppButton branchId={p.id} e164={p.whatsapp} businessName={p.name} size="lg" iconOnly />}
          {cta?.kind === 'book' ? (
            <Link href={cta.href} className={`${btn.primary} ${styles.barCta}`} data-size="lg">
              {cta.label}
            </Link>
          ) : (
            <ContactTrigger className={`${btn.primary} ${styles.barCta}`} dataSize="lg">
              {cta?.label ?? 'בירור זמינות'}
            </ContactTrigger>
          )}
        </ActionBar>
      </ContactProvider>

      <div className={styles.footGap} />
      <SiteFooter wide note="מידע כללי בלבד, לא ייעוץ רפואי" />
    </div>
  );
}

// ---------- Sections ----------

function Identity({ p, v }: { p: PublicProfile; v: View }) {
  // Highlight chips are tri-state: an evidenced "yes" is highlighted, an evidenced "no" shows plainly, unknown is not shown.
  const highlights = [
    v.responsible && { name: v.responsible.label === 'אחריות רפואית' ? 'אחריות רפואית מאומתת' : 'איש מקצוע אחראי מאומת', on: true },
    p.treatments.some(t => t.priceAgorot != null && t.priceAgorot > 0) && { name: 'מחירים מפורסמים', on: true },
    v.bookingOnline && { name: 'קביעת תור אונליין', on: true },
    v.attributes.parking === true && { name: 'חניה חינם', on: true },
    v.attributes.parking === false && { name: 'ללא חניה חינם', on: false },
    v.attributes.accessible === true && { name: 'נגיש לכיסא גלגלים', on: true },
    v.attributes.accessible === false && { name: 'לא נגיש לכיסא גלגלים', on: false },
    p.languages.length > 0 && { name: p.languages.join(' · '), on: true },
    ...v.cats.map(c => ({ name: c.name, on: false })),
  ].filter((h): h is { name: string; on: boolean } => !!h);

  // One line under the name: Google and BeautyFind side by side, never one merged number (locked product rule).
  const g = v.google && v.google.count > 0 ? v.google : null;
  const bf = p.beautyfind && p.beautyfind.count > 0 ? p.beautyfind : null;

  return (
    <section className={styles.identity} aria-labelledby="h-name">
      <div className={styles.idRow}>
        <span aria-hidden="true" className={styles.logo}>
          {p.logoUrl ? <img src={p.logoUrl} alt="" /> : initials(p.name)}
        </span>
        <h1 id="h-name" className={styles.h1}>
          {p.name}
          <span className={styles.dotTeal}>.</span>
        </h1>
        <SaveHeart id={p.id} name={p.name} className={styles.heart} />
      </div>

      <div className={styles.metaRow}>
        {g && (
          <a href="#h-reviews" className={styles.rating} aria-label={`דירוג ${ratingText(g.rating)} מתוך 5 בגוגל, ${reviewsLabel(g.count)}. מעבר לביקורות`}>
            <RatingStars rating={g.rating} />
            <span className={`ltr ${styles.ratingNum}`}>{ratingText(g.rating)}</span>
            <span className={styles.ratingCount}>({reviewsLabel(g.count)})</span>
            <span className={styles.ratingSrc}>בגוגל</span>
          </a>
        )}
        {bf && (
          <a href="#h-reviews" className={styles.rating} aria-label={`דירוג ${ratingText(bf.rating)} מתוך 5 ב־BeautyFind, ${reviewsLabel(bf.count)}. מעבר לביקורות`}>
            <RatingStars rating={bf.rating} />
            <span className={`ltr ${styles.ratingNum}`}>{ratingText(bf.rating)}</span>
            <span className={styles.ratingCount}>({reviewsLabel(bf.count)})</span>
            <span className={styles.ratingSrc}>ב־BeautyFind</span>
          </a>
        )}
        {!g && !bf && <a href="#h-reviews" className={styles.ratingNone}>אין עדיין דירוג</a>}
        <span aria-hidden="true" className={styles.sep} />
        <span className={styles.addr}>
          <PinGlyph />
          {p.address}
          {p.address.includes(p.cityName) ? '' : `, ${p.cityName}`}
        </span>
        {v.open && (
          <span className={styles.openNow} data-closed={!v.open.open || undefined}>
            <span aria-hidden="true" className={styles.ping} />
            {v.open.label}
          </span>
        )}
      </div>

      {highlights.length > 0 && (
        <ul className={styles.chips}>
          {highlights.map(h => (
            <li key={h.name} className={styles.chip} data-on={h.on || undefined}>
              {h.on && <CheckMark size={13} />}
              {h.name}
            </li>
          ))}
        </ul>
      )}

      <dl className={styles.facts} style={{ '--n': 3 } as React.CSSProperties}>
        {v.facts.map((f, i) => (
          <div key={`${f.key}-${i}`} className={styles.fact} data-unknown={f.key === 'unknown' || undefined}>
            <span aria-hidden="true" className={styles.factIcon}>
              <svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="#0B7A87" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {(FACT_ICONS[f.key] ?? FACT_ICONS.unknown).map(d => <path key={d} d={d} />)}
              </svg>
            </span>
            <span className={styles.factBody}>
              <dt>{f.label}</dt>
              <dd>{f.href ? <Link href={f.href}>{f.value}</Link> : f.ltr ? <span dir="ltr" className={`ltr ${styles.range}`}>{f.value}</span> : f.value}</dd>
              {f.note && <span className={styles.factNote}>{f.note}</span>}
            </span>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ReviewsSection({ p, v }: { p: PublicProfile; v: View }) {
  const bf = p.beautyfind;
  const distMax = Math.max(1, ...v.dist.map(d => d.count));
  return (
    <section aria-labelledby="h-reviews">
      <div className={rv.head}>
        <h2 id="h-reviews" className={styles.h2} style={{ margin: 0 }}>מה הלקוחות אומרים<span className={styles.dotTeal}>.</span></h2>
        <div className={rv.tools}>
          {v.googleSync && (
            <span className={rv.sync}>
              <span aria-hidden="true" className={rv.dot} />
              דירוג Google עודכן {v.googleSync}
            </span>
          )}
          <ReviewsInfo />
        </div>
      </div>

      <div className={rv.box}>
        <div className={rv.boxGrid}>
          <div className={rv.col}>
            <span className={rv.src}>דירוג בגוגל</span>
            {v.google ? (
              <>
                <div className={rv.score}>
                  <span className={`ltr ${rv.avg}`}>{ratingText(v.google.rating)}</span>
                  <span className={rv.scoreSide}>
                    <span role="img" aria-label={`${ratingText(v.google.rating)} מתוך 5 בגוגל`}>
                      <RatingStars rating={v.google.rating} width={102} height={19} lg />
                    </span>
                    <span className={rv.count}>{reviewsLabel(v.google.count)} בגוגל</span>
                  </span>
                </div>
                <span className={rv.chip}>
                  <CheckMark size={13} strokeWidth={1.8} />
                  מתוך פרופיל Google Business של העסק
                </span>
                <a href={v.googleHref} target="_blank" rel="noopener nofollow" className={rv.ext}>
                  {v.google.count > 0 ? `לכל ${reviewsLabel(v.google.count)} בגוגל` : 'לפרופיל בגוגל'}
                  <ExternalGlyph />
                </a>
              </>
            ) : (
              <>
                <p className={rv.empty}>לעסק אין עדיין דירוג בגוגל שמסונכרן ל־BeautyFind.</p>
                <a href={v.googleHref} target="_blank" rel="noopener nofollow" className={rv.ext}>
                  חיפוש העסק בגוגל
                  <ExternalGlyph />
                </a>
              </>
            )}
          </div>

          <div className={rv.col}>
            <span className={rv.src}>ביקורות מאומתות ב־BeautyFind</span>
            {bf && bf.count > 0 ? (
              <>
                <div className={rv.score}>
                  <span className={`ltr ${rv.avg}`}>{ratingText(bf.rating)}</span>
                  <span className={rv.scoreSide}>
                    <span role="img" aria-label={`${ratingText(bf.rating)} מתוך 5 ב־BeautyFind`}>
                      <RatingStars rating={bf.rating} width={102} height={19} lg />
                    </span>
                    <span className={rv.count}>{reviewsLabel(bf.count)} אחרי ביקור מאומת</span>
                  </span>
                </div>
                <dl className={rv.dist}>
                  {v.dist.map(d => (
                    <div key={d.star} className={rv.distRow}>
                      <dt className={rv.distStar}>
                        <span className="ltr">{d.star}</span>
                        <svg width="11" height="11" viewBox="0 0 14 14" fill="#FBBC04" aria-hidden="true"><path d="M7 1.2l1.8 3.75 4.1.54-3 2.84.76 4.07L7 10.5l-3.66 1.94.76-4.07-3-2.84 4.1-.54z" /></svg>
                        <span className="sr-only">כוכבים</span>
                      </dt>
                      <dd className={rv.distBar}>
                        <span style={{ width: `${Math.round((d.count / distMax) * 100)}%`, background: d.star >= 4 ? '#14B3C6' : d.star === 3 ? '#9AD4DC' : '#D4D4D4' }} />
                      </dd>
                      <span className={rv.distN}>{d.count}</span>
                    </div>
                  ))}
                </dl>
              </>
            ) : (
              <p className={rv.empty}>עדיין אין ביקורות מאומתות. ביקורת ב־BeautyFind נכתבת רק אחרי ביקור מאומת בעסק.</p>
            )}
          </div>
        </div>
      </div>

      {v.reviews.length > 0 && (
        <>
          <h3 className={rv.sub}>ביקורות מאומתות ב־BeautyFind</h3>
          <ReviewsRail reviews={v.reviews} total={bf?.count ?? v.reviews.length} />
        </>
      )}
    </section>
  );
}

function Location({ p, v }: { p: PublicProfile; v: View }) {
  const full = p.address.includes(p.cityName) ? p.address : `${p.address}, ${p.cityName}`;
  // Travel cells only for sourced facts; nothing about parking, transit or access is guessed.
  const cells = [
    v.attributes.parking === true && { label: 'חניה', value: 'חניה חינם במקום, לפי פרסום העסק' },
    v.attributes.parking === false && { label: 'חניה', value: 'העסק מציין שאין חניה חינם במקום' },
    v.attributes.accessible === true && { label: 'נגישות', value: 'המקום נגיש לכיסא גלגלים, לפי הצהרת העסק' },
    v.attributes.accessible === false && { label: 'נגישות', value: 'העסק מציין שהמקום אינו נגיש לכיסא גלגלים' },
  ].filter((c): c is { label: string; value: string } => !!c);
  const directions = p.googlePlaceId
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${p.name}, ${full}`)}&destination_place_id=${encodeURIComponent(p.googlePlaceId)}`
    : mapsHref(`${p.name} ${full}`);
  const wazeUrl = p.wazeUrl ?? (p.lat != null && p.lng != null ? `https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes` : null);
  return (
    <section aria-labelledby="h-loc">
      <h2 id="h-loc" className={styles.h2}>איך מגיעים<span className={styles.dotTeal}>.</span></h2>
      <div className={styles.loc}>
        {EMBED_KEY ? (
          <MapEmbed embedKey={EMBED_KEY} query={mapQuery(p)} title={`מפה: ${p.name}, ${full}`} />
        ) : (
          <div role="img" aria-label={`מפה סכמטית: ${p.name}, ${full}. המפה האינטראקטיבית טרם הופעלה.`} className={styles.map}>
            <span aria-hidden="true" className={styles.mapGrid} />
            <span aria-hidden="true" className={styles.mapRoadH} />
            <span aria-hidden="true" className={styles.mapRoadV} />
            <span aria-hidden="true" className={styles.mapPin}>
              <span className={styles.mapLabel}>{p.name}</span>
              <span className={styles.mapDot} />
            </span>
          </div>
        )}
        {cells.length > 0 && (
          <div className={styles.travel} style={{ '--n': cells.length } as React.CSSProperties}>
            {cells.map(c => (
              <div key={c.label} className={styles.travelCell}>
                <span className={styles.travelLabel}>{c.label}</span>
                <span className={styles.travelValue}>{c.value}</span>
              </div>
            ))}
          </div>
        )}
        <div className={styles.locFoot}>
          <address>{full}</address>
          <div className={styles.locActions}>
            {wazeUrl && <WazeButton branchId={p.id} href={wazeUrl} />}
            <a href={directions} target="_blank" rel="noopener noreferrer" className={styles.directions}>
              <span>הוראות הגעה</span>
              <ArrowForward size={14} />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

const SOCIAL_PATHS: Record<string, string> = {
  instagram: INSTAGRAM_PATH,
  facebook: 'M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.1 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12',
  tiktok: 'M16.6 2h-3.1v13.2a2.6 2.6 0 1 1-1.9-2.5V9.5a5.7 5.7 0 1 0 5 5.6V8.3a6.4 6.4 0 0 0 3.6 1.1V6.3a3.5 3.5 0 0 1-3.6-3.5V2z',
  youtube: 'M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15.2V8.8l5.2 3.2z',
};

/** The ONE sticky sidebar card: contact CTA, WhatsApp/phone, details, socials, and the Google rating at its end. */
function BookingCard({ p, v, cta }: { p: PublicProfile; v: View; cta: Cta | null }) {
  const place = p.address.includes(p.cityName) ? p.address : `${p.address.split(',')[0]}, ${p.cityName}`;
  return (
    <div id="bf-contact" className={styles.book}>
      <div className={styles.bookHead}>
        <h2 className={styles.bookTitle}>{p.isClaimed ? 'תיאום תור' : 'יצירת קשר'}</h2>
        {p.isClaimed ? (
          <span className={styles.verified}>
            <CheckMark size={12} />
            מאומת
          </span>
        ) : null}
      </div>
      <p className={styles.bookSub}>
        {place}
        {v.open && ` · ${v.open.label}`}
      </p>

      {cta?.kind === 'book' && (
        <Link href={cta.href} className={`${btn.primary} ${styles.bookCta}`}>
          <span>{cta.label}</span>
          <ArrowForward size={15} />
        </Link>
      )}
      {p.isClaimed ? (
        <>
          <ContactTrigger className={`${btn.primary} ${styles.bookCta}`} dataTone={cta?.kind === 'book' ? 'quiet' : undefined}>
            <MessageGlyph />
            <span>{cta?.kind === 'book' ? 'השארת פרטים לתיאום' : cta?.label ?? 'השארת פרטים לתיאום'}</span>
          </ContactTrigger>
          <p className={styles.bookNote}>הפנייה מגיעה ישירות לעסק, והוא חוזר אליכם</p>
        </>
      ) : (
        <div className={styles.claimBox}>
          <p>העסק עוד לא מנהל את הכרטיס, לכן אין כאן תיאום תור. אפשר לפנות לעסק ישירות בטלפון, בוואטסאפ או באתר.</p>
          <Link href={ROUTES.claim} className={styles.claimLink}>זה העסק שלכם? אישור בעלות</Link>
        </div>
      )}

      {(p.phone || p.whatsapp) && (
        <div className={styles.bookBtns}>
          {p.phone && <CallButton branchId={p.id} e164={p.phone} />}
          {p.whatsapp && <WhatsAppButton branchId={p.id} e164={p.whatsapp} businessName={p.name} />}
        </div>
      )}
      {p.wazeUrl && (
        <div className={styles.bookWaze}>
          <WazeButton branchId={p.id} href={p.wazeUrl} />
        </div>
      )}

      <dl className={styles.bookDl}>
        <div>
          <dt>טלפון</dt>
          <dd>
            {p.phone ? (
              <TrackedLink branchId={p.id} type="call_click" href={telHref(p.phone)} dir="ltr">
                {fromE164(p.phone)}
              </TrackedLink>
            ) : <span className={styles.dlMissing}>טלפון לא פורסם</span>}
          </dd>
        </div>
        <div>
          <dt>דוא״ל</dt>
          <dd>
            {p.email ? (
              <TrackedLink branchId={p.id} type="contact_click" href={`mailto:${p.email}`} dir="ltr">
                {p.email}
              </TrackedLink>
            ) : <span className={styles.dlMissing}>אימייל לא פורסם</span>}
          </dd>
        </div>
        {p.websiteUrl && (
          <div>
            <dt>אתר</dt>
            <dd>
              <TrackedLink branchId={p.id} type="contact_click" href={p.websiteUrl} dir="ltr" external>
                {displayUrl(p.websiteUrl)}
              </TrackedLink>
            </dd>
          </div>
        )}
      </dl>

      {v.socials.length > 0 && (
        <div className={styles.bookBlock}>
          <div className={styles.blockLabel}>עקבו אחרינו</div>
          <div className={styles.socials}>
            {v.socials.map(s => (
              <a key={s.network} href={s.url} target="_blank" rel="noopener noreferrer" aria-label={s.label} title={s.label} className={styles.social}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={SOCIAL_PATHS[s.network] ?? INSTAGRAM_PATH} /></svg>
              </a>
            ))}
          </div>
        </div>
      )}

      <div className={styles.bookBlock}>
        <div className={styles.blockLabel}>דירוג בגוגל</div>
        {v.google ? (
          <div className={styles.gRow}>
            <RatingStars rating={v.google.rating} width={85} height={16} />
            <span className={`ltr ${styles.gNum}`}>{ratingText(v.google.rating)}</span>
            <span className={styles.gCount}>{reviewsLabel(v.google.count)}</span>
          </div>
        ) : (
          <div className={styles.gCount}>לעסק אין עדיין דירוג בגוגל.</div>
        )}
        <div className={styles.gLinks}>
          <a href={v.googleHref} target="_blank" rel="noopener nofollow" className={styles.gLink}>
            <span>{v.google ? 'לקריאת הביקורות בגוגל' : 'חיפוש העסק בגוגל'}</span>
            <ArrowForward size={13} />
          </a>
        </div>
        <p className={styles.gNote}>הדירוג מגיע מפרופיל Google Business של העסק{v.googleSync ? ` ועודכן ${v.googleSync}` : ''}. BeautyFind אינו עורך או משנה את סדר הביקורות.</p>
      </div>
    </div>
  );
}

type Cta = { kind: 'book' | 'ask'; href: string; label: string };

/**
 * Primary action. Native booking only when booking is live, the branch takes it and an owner runs the
 * listing; a clinic whose published treatments are all medical books a consult instead. Otherwise the
 * action asks for availability (or a consultation for medical businesses) through the contact flow.
 */
function primaryCta(p: PublicProfile, v: View): Cta | null {
  const medicalOnly = p.treatments.length > 0 ? p.treatments.every(t => t.isMedical) : v.cats.length > 0 && v.cats.every(c => c.isMedical);
  if (v.bookingOnline) return medicalOnly ? { kind: 'book', href: `/consult/${p.slug}`, label: 'קביעת ייעוץ' } : { kind: 'book', href: `/book/${p.slug}`, label: 'קביעת תור' };
  return { kind: 'ask', href: '#bf-contact', label: medicalOnly ? 'בקשת ייעוץ' : 'בירור זמינות' };
}
