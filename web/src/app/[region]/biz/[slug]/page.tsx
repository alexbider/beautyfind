import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FaqAccordion } from '@/components/faq/FaqAccordion';
import { ArrowForward } from '@/components/icons';
import { ContactProvider, ContactTrigger } from '@/components/profile/ContactDialog';
import { CallButton, TrackedLink, WazeButton, WhatsAppButton } from '@/components/profile/ContactLinks';
import { displayUrl, initials, instagramHref, mapsHref, ratingText } from '@/components/profile/format';
import { BeforeAfter, Gallery } from '@/components/profile/Gallery';
import { CheckMark, ExternalGlyph, INSTAGRAM_PATH, MessageGlyph, PinGlyph, RatingStars } from '@/components/profile/icons';
import { DetailsSheetProvider, DetailsTrigger, ProfileHeader, SectionTabs } from '@/components/profile/ProfileMobile';
import { ProfileView } from '@/components/profile/ProfileView';
import { ReviewsInfo, ReviewsRail } from '@/components/profile/Reviews';
import { Services } from '@/components/profile/Services';
import { UnclaimedProfile } from '@/components/profile/Unclaimed';
import { SaveHeart } from '@/components/save-heart/SaveHeart';
import { ActionBar } from '@/components/shell/ActionBar';
import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { BOOKING_LIVE } from '@/lib/features';
import { fromE164, telHref } from '@/lib/format';
import { getProfile, type PublicProfile } from '@/lib/server/public';
import { buildView, jsonLd, ldJson, metaDescription, prosLabel, reviewsLabel, similarBusinesses, type ProfileView as View } from './data';
import btn from '@/components/profile/buttons.module.css';
import rv from '@/components/profile/Reviews.module.css';
import styles from './page.module.css';

// Design: project/BeautyFind Business Profile.dc.html (+ States.dc.html "unclaimed" for isClaimed = false).
// "Open now", "today" and relative review dates are computed per request in Asia/Jerusalem, so no stale cache.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ region: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { region, slug } = await params;
  const p = await getProfile(region, slug);
  if (!p) return { title: 'העסק לא נמצא', robots: { index: false } };
  const v = buildView(p);
  const main = v.cats[0]?.name;
  const title = `${p.name}, ${p.cityName}${main ? `: ${main}` : ''}`;
  const description = metaDescription(p, v);
  return {
    title,
    description,
    alternates: { canonical: p.href },
    openGraph: { title, description, url: p.href, type: 'website', locale: 'he_IL', siteName: 'BeautyFind', ...(v.photos[0] ? { images: [{ url: v.photos[0].url, alt: v.photos[0].alt }] } : {}) },
  };
}

const FACT_ICONS = {
  shield: ['M10 2.4 4 4.8v4.4c0 3.8 2.6 6.6 6 7.8 3.4-1.2 6-4 6-7.8V4.8z', 'M7.4 9.8l1.9 1.9 3.4-3.6'],
  team: ['M13.8 17.5v-1.6a3 3 0 0 0-3-3H5.2a3 3 0 0 0-3 3v1.6', 'M8 9.8a3 3 0 1 0 0-6 3 3 0 0 0 0 6', 'M17.8 17.5v-1.6a3 3 0 0 0-2.3-2.9', 'M12.8 3.9a3 3 0 0 1 0 5.8'],
  clock: ['M10 5.2v5l3.4 2', 'M10 2.2a7.8 7.8 0 1 0 0 15.6 7.8 7.8 0 0 0 0-15.6'],
};

export default async function BusinessProfilePage({ params }: Props) {
  const { region, slug } = await params;
  const p = await getProfile(region, slug);
  if (!p) notFound();
  const v = buildView(p);

  const parentHref = v.citySlug ? `/${p.regionSlug}/${v.citySlug}` : `/${p.regionSlug}`;
  const crumbs = (
    <nav aria-label="נתיב ניווט" className={`${styles.crumbs} bf-desk-only`}>
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

  if (!p.isClaimed) {
    return (
      <div className={styles.root}>
        {ld}
        <SiteHeader variant="public" title={p.name} backHref={parentHref} />
        {crumbs}
        <UnclaimedProfile p={p} v={v} />
        <ProfileView branchId={p.id} />
        <SiteFooter wide note="מידע כללי בלבד, לא ייעוץ רפואי" />
      </div>
    );
  }

  const similar = await similarBusinesses(p, v.cats[0]?.slug);
  const isClinic = p.business.type === 'clinic' || p.business.type === 'medspa';
  const cta = primaryCta(p, v);

  // Phone section tabs, in the order the sections are shown there (CSS order in the app shell).
  const tabs = [
    v.services.length > 0 && { key: 'services', label: 'טיפולים', target: 'sec-services' },
    v.staff.length > 0 && { key: 'team', label: 'צוות', target: 'sec-team' },
    { key: 'reviews', label: 'ביקורות', target: 'sec-reviews' },
    { key: 'details', label: 'פרטים', target: 'sec-details' },
  ].filter((t): t is { key: string; label: string; target: string } => !!t);

  return (
    <div className={styles.root}>
      {ld}
      <ProfileHeader name={p.name} watchId="h-name" backHref={parentHref} />
      {crumbs}
      <ProfileView branchId={p.id} />

      <ContactProvider branch={{ id: p.id, name: p.name, phone: p.phone, whatsapp: p.whatsapp }} treatments={v.treatmentOptions}>
      <DetailsSheetProvider title="פרטים" sheet={<DetailsSheet p={p} v={v} />}>
        {v.photos.length > 0 && (
          <section aria-label="תמונות העסק" className={`${styles.wrap} ${styles.gallery}`}>
            <Gallery photos={v.photos} />
          </section>
        )}

        <main className={`${styles.wrap} ${styles.main}`}>
          <div className={styles.col}>
            <Identity p={p} v={v} />

            <div className={styles.tabsSlot}>
              <SectionTabs items={tabs} />
            </div>

            <section id="sec-details" aria-labelledby="h-details" className={`${styles.detailsM} ${styles.oDetails}`}>
              <h2 id="h-details" className={styles.h2}>פרטים<span className={styles.dotTeal}>.</span></h2>
              <DetailsSummary p={p} v={v} />
            </section>

            {v.description.length > 0 && (
              <section aria-labelledby="h-about" className={styles.oAbout}>
                <h2 id="h-about" className={styles.h2}>{isClinic ? 'על הקליניקה' : 'על העסק'}<span className={styles.dotTeal}>.</span></h2>
                <div className={styles.about}>
                  {v.description.map((para, i) => <p key={i}>{para}</p>)}
                </div>
              </section>
            )}

            {v.services.length > 0 && (
              <section id="sec-services" aria-labelledby="h-services" className={styles.oServices}>
                <div className={styles.secHead}>
                  <h2 id="h-services" className={styles.h2}>שירותים ומחירים<span className={styles.dotTeal}>.</span></h2>
                  {v.pricesUpdated && <span className={styles.secNote}>המחירים כפי שנמסרו על ידי העסק, עודכנו ב־{v.pricesUpdated}</span>}
                </div>
                <Services groups={v.services} />
                <p className={styles.vat}>כל המחירים לא כולל מע״מ. טיפולים רפואיים נקבעים בתיאום ייעוץ רפואי, והמחיר הסופי נקבע בו.</p>
              </section>
            )}

            <ReviewsSection p={p} v={v} />

            {v.beforeAfter.length > 0 && (
              <section aria-labelledby="h-ba" className={styles.oBa}>
                <div className={styles.secHead}>
                  <h2 id="h-ba" className={styles.h2}>לפני ואחרי<span className={styles.dotTeal}>.</span></h2>
                  <span className={styles.secNote}>פורסם על ידי העסק בהסכמת המטופלים</span>
                </div>
                <BeforeAfter photos={v.beforeAfter} />
              </section>
            )}

            {v.staff.length > 0 && (
              <section id="sec-team" aria-labelledby="h-team" className={styles.oTeam}>
                <h2 id="h-team" className={styles.h2}>הצוות שלנו<span className={styles.dotTeal}>.</span></h2>
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
                </div>
              </section>
            )}

            {v.hoursRows && (
              <section aria-labelledby="h-hours" className="bf-desk-only">
                <h2 id="h-hours" className={styles.h2}>שעות פעילות<span className={styles.dotTeal}>.</span></h2>
                <table className={styles.hours}>
                  <caption>היום מסומן. השעות לפי שעון ישראל.</caption>
                  <tbody>
                    {v.hoursRows.map(h => (
                      <tr key={h.day} data-today={h.today || undefined}>
                        <th scope="row">
                          {h.day}
                          {h.today && <span className={styles.todayBadge}> · היום</span>}
                        </th>
                        <td data-closed={!h.range || undefined}>
                          {h.range ? <span dir="ltr" className={`ltr ${styles.range}`}>{h.range}</span> : 'סגור'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {v.faqs.length > 0 && (
              <section aria-labelledby="h-faq" className={styles.oFaq}>
                <h2 id="h-faq" className={styles.h2}>שאלות נפוצות<span className={styles.dotTeal}>.</span></h2>
                <FaqAccordion items={v.faqs} />
              </section>
            )}

            <Location p={p} />

            {similar.length > 0 && (
              <section aria-labelledby="h-similar" className={styles.oSimilar}>
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

          <aside aria-label="יצירת קשר עם העסק" className={`${styles.aside} bf-desk-only`}>
            <BookingCard p={p} v={v} cta={cta} />
          </aside>
        </main>

        <ActionBar mobileOnly>
          {p.whatsapp && <WhatsAppButton branchId={p.id} e164={p.whatsapp} businessName={p.name} size="lg" iconOnly />}
          {p.phone && <CallButton branchId={p.id} e164={p.phone} size="lg" iconOnly />}
          {cta ? (
            <Link href={cta.href} className={btn.primary} data-size="lg">
              {cta.label}
            </Link>
          ) : (
            <ContactTrigger className={btn.primary} dataSize="lg">
              השארת פרטים לתיאום
            </ContactTrigger>
          )}
        </ActionBar>
      </DetailsSheetProvider>
      </ContactProvider>

      <div className={styles.footGap} />
      <SiteFooter wide note="מידע כללי בלבד, לא ייעוץ רפואי" />
    </div>
  );
}

// ---------- Sections ----------

function Identity({ p, v }: { p: PublicProfile; v: View }) {
  const highlights = [
    v.responsible && { name: v.responsible.label === 'אחריות רפואית' ? 'אחריות רפואית מאומתת' : 'איש מקצוע אחראי מאומת', on: true },
    p.treatments.length > 0 && { name: 'מחירים שקופים', on: true },
    p.freeParking && { name: 'חנייה חינם', on: true },
    p.accessible && { name: 'נגיש לכיסא גלגלים', on: true },
    ...v.cats.map(c => ({ name: c.name, on: false })),
  ].filter((h): h is { name: string; on: boolean } => !!h);

  type Fact = { label: string; value: React.ReactNode; note: string | null; icon: string[] };
  const facts = ([
    v.responsible && {
      label: v.responsible.label,
      value: <Link href={`/pro/${v.responsible.staffId}`}>{v.responsible.name}</Link>,
      note: v.responsible.note,
      icon: FACT_ICONS.shield,
    },
    v.staff.length > 0 && {
      label: 'צוות',
      value: prosLabel(v.staff.length),
      note: [...new Set(v.staff.map(s => s.role.split(' · ')[0]))].join(', '),
      icon: FACT_ICONS.team,
    },
    v.hoursRows && {
      label: 'שעות היום',
      value: v.todayRange ? <span dir="ltr" className={`ltr ${styles.range}`}>{v.todayRange}</span> : 'סגור היום',
      note: v.open?.label ?? null,
      icon: FACT_ICONS.clock,
    },
  ] as Array<Fact | false | null>).filter((f): f is Fact => !!f);

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
        {v.google && (
          <span className={styles.rating} role="img" aria-label={`${ratingText(v.google.rating)} מתוך 5 בגוגל, ${reviewsLabel(v.google.count)}`}>
            <RatingStars rating={v.google.rating} />
            <span className={`ltr ${styles.ratingNum}`}>{ratingText(v.google.rating)}</span>
            <span className={styles.ratingCount}>{reviewsLabel(v.google.count)} בגוגל</span>
          </span>
        )}
        {p.beautyfind && (
          <>
            {v.google && <span aria-hidden="true" className={styles.sep} />}
            <a href="#h-reviews" className={styles.rating}>
              <span className={`ltr ${styles.ratingNum}`}>{ratingText(p.beautyfind.rating)}</span>
              <span className={styles.ratingCount}>{reviewsLabel(p.beautyfind.count)} {p.beautyfind.count === 1 ? 'מאומתת' : 'מאומתות'} ב־BeautyFind</span>
            </a>
          </>
        )}
        {(v.google || p.beautyfind) && <span aria-hidden="true" className={styles.sep} />}
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

      {facts.length > 0 && (
        <dl className={styles.facts} style={{ '--n': facts.length } as React.CSSProperties}>
          {facts.map(f => (
            <div key={f.label} className={styles.fact}>
              <span aria-hidden="true" className={styles.factIcon}>
                <svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="#0B7A87" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {f.icon.map(d => <path key={d} d={d} />)}
                </svg>
              </span>
              <span className={styles.factBody}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
                {f.note && <span className={styles.factNote}>{f.note}</span>}
              </span>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function ReviewsSection({ p, v }: { p: PublicProfile; v: View }) {
  const bf = p.beautyfind;
  const distMax = Math.max(1, ...v.dist.map(d => d.count));
  return (
    <section id="sec-reviews" aria-labelledby="h-reviews" className={styles.oReviews}>
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

function Location({ p }: { p: PublicProfile }) {
  const full = p.address.includes(p.cityName) ? p.address : `${p.address}, ${p.cityName}`;
  const cells = [
    p.freeParking && { label: 'חנייה', value: 'חנייה חינם במקום' },
    p.accessible && { label: 'נגישות', value: 'המקום נגיש לכיסא גלגלים' },
  ].filter((c): c is { label: string; value: string } => !!c);
  return (
    <section aria-labelledby="h-loc" className="bf-desk-only">
      <h2 id="h-loc" className={styles.h2}>איך מגיעים<span className={styles.dotTeal}>.</span></h2>
      <div className={styles.loc}>
        <div role="img" aria-label={`מפה סכמטית: ${p.name}, ${full}`} className={styles.map}>
          <span aria-hidden="true" className={styles.mapGrid} />
          <span aria-hidden="true" className={styles.mapRoadH} />
          <span aria-hidden="true" className={styles.mapRoadV} />
          <span aria-hidden="true" className={styles.mapPin}>
            <span className={styles.mapLabel}>{p.name}</span>
            <span className={styles.mapDot} />
          </span>
        </div>
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
            {p.wazeUrl && <WazeButton branchId={p.id} href={p.wazeUrl} />}
            <a href={mapsHref(`${p.name} ${full}`)} target="_blank" rel="noopener noreferrer" className={styles.directions}>
              <span>הוראות הגעה</span>
              <ArrowForward size={14} />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/** The ONE sticky sidebar card: contact CTA, WhatsApp/phone, details, socials, and the Google rating at its end. */
function BookingCard({ p, v, cta }: { p: PublicProfile; v: View; cta: Cta | null }) {
  const place = p.address.includes(p.cityName) ? p.address : `${p.address.split(',')[0]}, ${p.cityName}`;
  return (
    <div id="contact" className={styles.book}>
      <div className={styles.bookHead}>
        <h2 className={styles.bookTitle}>תיאום תור</h2>
        <span className={styles.verified}>
          <CheckMark size={12} />
          מאומת
        </span>
      </div>
      <p className={styles.bookSub}>
        {place}
        {v.open && ` · ${v.open.label}`}
      </p>

      {/* Online booking (phase 4): shown only once BOOKING_LIVE is flipped. The contact form below stays. */}
      {cta && (
        <Link href={cta.href} className={`${btn.primary} ${styles.bookCta}`}>
          <span>{cta.label}</span>
          <ArrowForward size={15} />
        </Link>
      )}
      <ContactTrigger className={`${btn.primary} ${styles.bookCta}`} dataTone={cta ? 'quiet' : undefined}>
        <MessageGlyph />
        <span>השארת פרטים לתיאום</span>
      </ContactTrigger>
      <p className={styles.bookNote}>הפנייה מגיעה ישירות לעסק, והוא חוזר אליכם</p>

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

      {(p.phone || p.email || p.websiteUrl) && (
        <dl className={styles.bookDl}>
          {p.phone && (
            <div>
              <dt>טלפון</dt>
              <dd>
                <TrackedLink branchId={p.id} type="call_click" href={telHref(p.phone)} dir="ltr">
                  {fromE164(p.phone)}
                </TrackedLink>
              </dd>
            </div>
          )}
          {p.email && (
            <div>
              <dt>אימייל</dt>
              <dd>
                <TrackedLink branchId={p.id} type="contact_click" href={`mailto:${p.email}`} dir="ltr">
                  {p.email}
                </TrackedLink>
              </dd>
            </div>
          )}
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
      )}

      {p.instagram && (
        <div className={styles.bookBlock}>
          <div className={styles.blockLabel}>עקבו אחרינו</div>
          <div className={styles.socials}>
            <a href={instagramHref(p.instagram)} target="_blank" rel="noopener noreferrer" aria-label="אינסטגרם" title="אינסטגרם" className={styles.social}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={INSTAGRAM_PATH} /></svg>
            </a>
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
        <p className={styles.gNote}>הדירוגים מגיעים מפרופיל Google Business של העסק ומתעדכנים מדי שבוע. BeautyFind אינו עורך או משנה את סדר הביקורות.</p>
      </div>
    </div>
  );
}

type Cta = { href: string; label: string };

/**
 * Online booking CTA, only when booking is live and the branch takes it. A clinic whose published
 * treatments are all medical books a consult instead (the booking flow would hand off to it anyway).
 * Null = no online booking: the contact form is the primary action.
 */
function primaryCta(p: PublicProfile, v: View): Cta | null {
  if (!(BOOKING_LIVE && p.onlineBooking)) return null;
  const medicalOnly = p.treatments.length > 0 ? p.treatments.every(t => t.isMedical) : v.cats.length > 0 && v.cats.every(c => c.isMedical);
  return medicalOnly ? { href: `/consult/${p.slug}`, label: 'קביעת ייעוץ' } : { href: `/book/${p.slug}`, label: 'קביעת תור' };
}

/** Phone "פרטים" section: today's hours and the address, each opening the details sheet. */
function DetailsSummary({ p, v }: { p: PublicProfile; v: View }) {
  const full = p.address.includes(p.cityName) ? p.address : `${p.address}, ${p.cityName}`;
  return (
    <div className={styles.sumCard}>
      {v.hoursRows && (
        <DetailsTrigger className={styles.sumRow}>
          <span aria-hidden="true" className={styles.sumIcon}>
            <svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {FACT_ICONS.clock.map(d => <path key={d} d={d} />)}
            </svg>
          </span>
          <span className={styles.sumText}>
            <span className={styles.sumLabel}>שעות פעילות</span>
            <span className={styles.sumValue}>
              {v.todayRange ? <>היום <span dir="ltr" className={`ltr ${styles.range}`}>{v.todayRange}</span></> : 'סגור היום'}
              {v.open && <span className={styles.sumOpen} data-closed={!v.open.open || undefined}> · {v.open.label}</span>}
            </span>
          </span>
          <ChevronGlyph />
        </DetailsTrigger>
      )}
      <DetailsTrigger className={styles.sumRow}>
        <span aria-hidden="true" className={styles.sumIcon}><PinGlyph size={18} /></span>
        <span className={styles.sumText}>
          <span className={styles.sumLabel}>כתובת ויצירת קשר</span>
          <span className={styles.sumValue}>{full}</span>
        </span>
        <ChevronGlyph />
      </DetailsTrigger>
    </div>
  );
}

function ChevronGlyph() {
  return (
    <svg className={styles.sumChev} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

/** Content of the phone "פרטים" sheet: hours, address and directions, contact details. */
function DetailsSheet({ p, v }: { p: PublicProfile; v: View }) {
  const full = p.address.includes(p.cityName) ? p.address : `${p.address}, ${p.cityName}`;
  const extras = [p.freeParking && 'חנייה חינם במקום', p.accessible && 'המקום נגיש לכיסא גלגלים'].filter((x): x is string => !!x);
  return (
    <div className={styles.sheet}>
      {v.hoursRows && (
        <section aria-labelledby="sh-hours">
          <h3 id="sh-hours" className={styles.sheetH}>
            שעות פעילות
            {v.open && <span className={styles.sumOpen} data-closed={!v.open.open || undefined}> · {v.open.label}</span>}
          </h3>
          <table className={styles.hours}>
            <caption className="sr-only">שעות הפעילות לפי שעון ישראל. היום מסומן.</caption>
            <tbody>
              {v.hoursRows.map(h => (
                <tr key={h.day} data-today={h.today || undefined}>
                  <th scope="row">
                    {h.day}
                    {h.today && <span className={styles.todayBadge}> · היום</span>}
                  </th>
                  <td data-closed={!h.range || undefined}>{h.range ? <span dir="ltr" className={`ltr ${styles.range}`}>{h.range}</span> : 'סגור'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section aria-labelledby="sh-addr">
        <h3 id="sh-addr" className={styles.sheetH}>כתובת</h3>
        <address className={styles.sheetAddr}>{full}</address>
        {extras.length > 0 && <p className={styles.sheetNote}>{extras.join(' · ')}</p>}
        <div className={styles.sheetBtns}>
          <a href={mapsHref(`${p.name} ${full}`)} target="_blank" rel="noopener noreferrer" className={styles.sheetBtn}>
            <span>הוראות הגעה</span>
            <ArrowForward size={14} />
          </a>
          {p.wazeUrl && <WazeButton branchId={p.id} href={p.wazeUrl} size="md" />}
        </div>
      </section>

      {(p.phone || p.email || p.websiteUrl || p.instagram) && (
        <section aria-labelledby="sh-contact">
          <h3 id="sh-contact" className={styles.sheetH}>יצירת קשר</h3>
          <dl className={`${styles.bookDl} ${styles.sheetDl}`}>
            {p.phone && (
              <div>
                <dt>טלפון</dt>
                <dd>
                  <TrackedLink branchId={p.id} type="call_click" href={telHref(p.phone)} dir="ltr">{fromE164(p.phone)}</TrackedLink>
                </dd>
              </div>
            )}
            {p.email && (
              <div>
                <dt>אימייל</dt>
                <dd>
                  <TrackedLink branchId={p.id} type="contact_click" href={`mailto:${p.email}`} dir="ltr">{p.email}</TrackedLink>
                </dd>
              </div>
            )}
            {p.websiteUrl && (
              <div>
                <dt>אתר</dt>
                <dd>
                  <TrackedLink branchId={p.id} type="contact_click" href={p.websiteUrl} dir="ltr" external>{displayUrl(p.websiteUrl)}</TrackedLink>
                </dd>
              </div>
            )}
            {p.instagram && (
              <div>
                <dt>אינסטגרם</dt>
                <dd>
                  <a href={instagramHref(p.instagram)} target="_blank" rel="noopener noreferrer" dir="ltr">{p.instagram.startsWith('@') ? p.instagram : `@${p.instagram}`}</a>
                </dd>
              </div>
            )}
          </dl>
        </section>
      )}
    </div>
  );
}
