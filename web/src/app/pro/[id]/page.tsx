import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowForward } from '@/components/icons';
import { licenseNote, licenseView } from '@/components/practitioner/license';
import { CallButton, TrackedLink, WhatsAppButton } from '@/components/profile/ContactLinks';
import {
  PROFESSION_NAME, initials, isMedicalProfession, openDaysLabel, parseHours, priceParts, ratingText, shortDate,
  type PractitionerProfession, type PriceType,
} from '@/components/profile/format';
import { CheckMark } from '@/components/profile/icons';
import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { ROUTES } from '@/lib/routes';
import { getPractitioner } from './data';
import styles from './page.module.css';

// Design: project/BeautyFind Practitioner.dc.html (practitionerType: doctor | cosmetic, from the profession).
// Not indexed until practitioner pages carry more of their own content (bio, CV, portrait).
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const pr = await getPractitioner(id);
  if (!pr) return { title: 'העמוד לא נמצא', robots: { index: false } };
  const b = pr.branches[0];
  const prof = PROFESSION_NAME[pr.profession as PractitionerProfession];
  return {
    title: `${pr.displayName}, ${prof}`,
    description: `${pr.displayName}, ${prof} ב${b.name}, ${b.cityName}. טיפולים ומחירים, רישיון או הסמכה כפי שאומתו ב־BeautyFind, ואיפה אפשר לפגוש.`,
    alternates: { canonical: `/pro/${pr.id}` },
    robots: { index: false, follow: true },
  };
}

const stars = (n: number) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
const monthYear = (d: Date) => new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', month: 'long', year: 'numeric' }).format(d);

export default async function PractitionerPage({ params }: Props) {
  const { id } = await params;
  const pr = await getPractitioner(id);
  if (!pr) notFound();

  const profession = pr.profession as PractitionerProfession;
  const medical = isMedicalProfession(profession);
  const lic = licenseView(profession, pr.license);
  const primary = pr.branches[0];
  const multi = pr.branches.length > 1;

  // The branch's verified doctor, for the "who injects here" footnote.
  const resp = primary.medicalResponsible;
  const doctorName = resp && resp.id !== pr.id && resp.profession === 'doctor' && resp.license?.kind === 'doctor' && resp.license.status === 'verified' ? resp.displayName : null;

  // Treatments from their branches, within what the profession may perform: medical for doctors and
  // nurses, non-medical for cosmeticians and technicians (they may not inject).
  const seen = new Set<string>();
  const treatments = pr.branches
    .flatMap(b => b.treatments.map(t => ({ ...t, branchName: b.name })))
    .filter(t => (medical ? t.isMedical || t.category?.isMedical : !(t.isMedical || t.category?.isMedical)))
    .filter(t => (seen.has(t.name) ? false : (seen.add(t.name), true)))
    .slice(0, 8);

  const title = [PROFESSION_NAME[profession], lic.verified ? pr.license?.specialty : null, primary.name].filter(Boolean).join(' · ');
  const branchName = new Map(pr.branches.map(b => [b.id, b.name]));
  const ctaLabel = medical ? 'בקשת ייעוץ' : 'פנייה לעסק';

  return (
    <div className={styles.root}>
      <SiteHeader variant="public" />

      <div className={styles.crumbs}>
        <nav aria-label="נתיב ניווט" className={styles.trail}>
          <Link href={`/${primary.regionSlug}`}>{primary.region.name}</Link>
          <span aria-hidden="true">/</span>
          <Link href={primary.href}>{primary.name}</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{pr.displayName}</span>
        </nav>
        <Link href={primary.href} className={styles.back}>
          <ArrowForward size={15} />
          <span>ל{primary.name}</span>
        </Link>
      </div>

      <div className={styles.body}>
        <section aria-labelledby="pr-h" className={styles.hero}>
          <div className={styles.portrait} aria-hidden="true">{initials(pr.displayName.replace(/^ד״ר\s+/, ''))}</div>
          <div style={{ minWidth: 0 }}>
            {lic.badge && (
              <span className={styles.badge} data-tone={lic.badgeTone}>
                <CheckMark size={13} strokeWidth={2.2} />
                {lic.badge}
              </span>
            )}
            <h1 id="pr-h" className={styles.h1}>{pr.displayName}</h1>
            <p className={styles.title}>{title}</p>
            <div className={styles.ctas}>
              {/* Full navigation so the profile opens its contact popup from the #contact hash on load. */}
              <a href={`${primary.href}#contact`} className={styles.cta}>{ctaLabel}</a>
              {primary.whatsapp && <WhatsAppButton branchId={primary.id} e164={primary.whatsapp} businessName={primary.name} />}
              {primary.phone && <CallButton branchId={primary.id} e164={primary.phone} label="חיוג" showNumber />}
            </div>
          </div>
        </section>

        <div className={styles.shell}>
          <main className={styles.main}>
            {treatments.length > 0 && (
              <section aria-labelledby="pr-tx">
                <h2 id="pr-tx" className={`${styles.h2} ${styles.h2Tight}`}>{multi ? 'טיפולים בתחום' : `טיפולים ב${primary.name}`}</h2>
                <p className={styles.lead}>מחירים מהעסק, לא כולל מע״מ.{medical ? ' הכמות והמחיר הסופי נקבעים בייעוץ.' : ''}</p>
                <div className={styles.tx}>
                  {treatments.map(t => {
                    const isMed = t.isMedical || !!t.category?.isMedical;
                    const pp = priceParts(t.priceType as PriceType, t.priceAgorot);
                    const note = [t.durationMin ? `כ־${t.durationMin} דקות` : null, multi ? t.branchName : null].filter(Boolean).join(' · ');
                    return (
                      <div key={t.id} className={styles.txCard}>
                        <span className={styles.txTop}>
                          <span className={styles.txName}>{t.name}</span>
                          <span className={styles.txPrice}>
                            {pp.pre}
                            <span className="ltr">{pp.amount}</span>
                            {pp.post}
                          </span>
                        </span>
                        {note && <span className={styles.txNote}>{note}</span>}
                        {isMed && <span className={styles.txTag}>בתיאום ייעוץ רפואי</span>}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <section aria-labelledby="pr-rv">
              <div className={styles.rvHead}>
                <h2 id="pr-rv" className={styles.h2}>{multi ? 'ביקורות מאומתות מהעסק' : `ביקורות מאומתות ב${primary.name}`}</h2>
                {pr.reviewStats && (
                  <span className={styles.rvSum}>
                    <span dir="ltr" className={`ltr ${styles.rvStar}`}>★ {ratingText(pr.reviewStats.rating)}</span>
                    {' · '}
                    {pr.reviewStats.count === 1 ? 'ביקורת מאומתת אחת' : `${pr.reviewStats.count} ביקורות מאומתות`}
                  </span>
                )}
              </div>
              {pr.reviews.length > 0 ? (
                <div className={styles.rvList}>
                  {pr.reviews.map(r => (
                    <article key={r.id} className={styles.rv}>
                      <div className={styles.rvTop}>
                        <span dir="ltr" className={styles.rvStars} role="img" aria-label={`${r.rating} מתוך 5`}>{stars(r.rating)}</span>
                        <h3 className={styles.rvTitle}>{r.title}</h3>
                        <span className={styles.rvMeta}>
                          {[r.authorName, r.treatmentName, multi ? branchName.get(r.branchId) : null, monthYear(r.createdAt)].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                      <p className={styles.rvBody}>{r.body}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className={styles.empty}>עדיין אין ביקורות מאומתות. ביקורת ב־BeautyFind נכתבת רק אחרי ביקור מאומת.</p>
              )}
            </section>
          </main>

          <aside className={styles.side} aria-label="רישיון ומקום עבודה">
            <div className={styles.lic} data-tone={lic.verified && lic.type === 'doctor' ? 'medical' : undefined}>
              <div className={styles.licHead}>
                {lic.respLabel && (
                  <span className={styles.licResp} style={{ color: lic.badgeTone === 'ok' ? 'var(--ok-text)' : 'var(--teal-deep)' }}>
                    {lic.respLabel}
                  </span>
                )}
                <span className={styles.licType}>{lic.licType}</span>
              </div>
              {lic.verified ? (
                <>
                  <dl className={styles.licDl}>
                    <dt>מספר</dt>
                    <dd data-num dir="ltr" className="ltr">{lic.number}</dd>
                    <dt>נבדק מול</dt>
                    <dd>{lic.source}</dd>
                    {lic.mohVerified && (
                      <>
                        <dt>סטטוס</dt>
                        <dd>מאומת מול משרד הבריאות</dd>
                      </>
                    )}
                    {pr.license?.verifiedAt && (
                      <>
                        <dt>בדיקה אחרונה</dt>
                        <dd data-num dir="ltr" className="ltr">{shortDate(pr.license.verifiedAt)}</dd>
                      </>
                    )}
                  </dl>
                  <p className={styles.licNote}>
                    {licenseNote(profession, doctorName)} <Link href={ROUTES.listingStandards}>איך אנחנו בודקים</Link>
                  </p>
                </>
              ) : (
                <p className={styles.licPending}>
                  פרטי הרישיון או ההסמכה עדיין לא אומתו ב־BeautyFind. <Link href={ROUTES.listingStandards}>איך אנחנו בודקים</Link>
                </p>
              )}
            </div>

            <div className={styles.box}>
              <h2 className={styles.boxH}>איפה אפשר לפגוש</h2>
              {pr.branches.map(b => {
                const days = openDaysLabel(parseHours(b.hours));
                return (
                  <div key={b.id}>
                    <Link href={b.href} className={styles.place}>
                      <span className={styles.placeName}>{b.name} · {b.cityName}</span>
                      <span className={styles.placeAddr}>{b.address}</span>
                      {days && <span className={styles.placeDays}>ימי פעילות: {days}</span>}
                    </Link>
                    {b.wazeUrl && (
                      <TrackedLink branchId={b.id} type="waze_click" href={b.wazeUrl} external className={styles.wazeLink}>
                        ניווט ב־Waze
                      </TrackedLink>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      </div>

      <SiteFooter wide note="מידע כללי בלבד, לא ייעוץ רפואי" />
    </div>
  );
}
