import 'server-only';
import { categoryBySlug, regionBySlug } from '@/lib/catalog';
import { nisFromAgorot } from '@/lib/format';
import { BOOKING_LIVE } from '@/lib/features';
import { listBranches, type ListingCard, type PublicProfile } from '@/lib/server/public';
import {
  COMPARABLE_PRICE_TYPES, DAY_NAMES, PROFESSION_NAME, hoursKnown, jerusalemNow, longDateHe, openState, openingHoursSpec, parseHours, priceParts, relHe, servicePrice,
  type DayHours, type OpenState, type PractitionerProfession, type PriceView,
} from '@/components/profile/format';
import { CATEGORY_ICONS, DEFAULT_CATEGORY_ICON } from '@/components/profile/icons';
import type { Photo } from '@/components/profile/Gallery';
import type { ReviewView } from '@/components/profile/Reviews';
import type { ServiceGroupView } from '@/components/profile/Services';
import type { VideoView } from '@/components/profile/VideoEmbed';

export const BEFORE_AFTER_TAG = 'לפני/אחרי';

const SITE = 'https://beautyfind.co.il';

// ---------- JSON columns ----------

export function parseGallery(json: unknown): Array<{ url: string; alt: string; tag: string | null }> {
  if (!Array.isArray(json)) return [];
  return json.flatMap(g => {
    const o = (g ?? {}) as Record<string, unknown>;
    if (typeof o.url !== 'string' || !o.url) return [];
    return [{ url: o.url, alt: typeof o.alt === 'string' ? o.alt : '', tag: typeof o.tag === 'string' ? o.tag : null }];
  });
}

export function parseFaqs(json: unknown): Array<{ q: string; a: string }> {
  if (!Array.isArray(json)) return [];
  return json.flatMap(f => {
    const o = (f ?? {}) as Record<string, unknown>;
    return typeof o.q === 'string' && typeof o.a === 'string' && o.q.trim() && o.a.trim() ? [{ q: o.q.trim(), a: o.a.trim() }] : [];
  });
}

/** People named on the business's own site (imported): shown without a link, badge or login. */
export function parseTeam(json: unknown): Array<{ name: string; role: string; bio: string | null; sourceUrl: string | null }> {
  if (!Array.isArray(json)) return [];
  return json.flatMap(t => {
    const o = (t ?? {}) as Record<string, unknown>;
    if (typeof o.name !== 'string' || !o.name.trim()) return [];
    return [{ name: o.name.trim(), role: typeof o.role === 'string' ? o.role.trim() : '', bio: typeof o.bio === 'string' && o.bio.trim() ? o.bio.trim() : null, sourceUrl: typeof o.sourceUrl === 'string' ? o.sourceUrl : null }];
  }).slice(0, 12);
}

export function parseVideos(json: unknown): VideoView[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap(v => {
    const o = (v ?? {}) as Record<string, unknown>;
    if (typeof o.id !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(o.id) || o.status !== 'ok' || o.embeddable !== true) return [];
    return [{ id: o.id, title: typeof o.title === 'string' ? o.title : null, channelTitle: typeof o.channelTitle === 'string' ? o.channelTitle : null, durationSec: typeof o.durationSec === 'number' ? o.durationSec : null, thumbnail: typeof o.thumbnail === 'string' ? o.thumbnail : null, status: 'ok' as const }];
  }).slice(0, 6);
}

type Tri = boolean | null;
/** Tri-state attributes with their source; the legacy booleans mean "true" only. */
export function parseAttributes(json: unknown, legacy: { accessible: boolean; freeParking: boolean }): { accessible: Tri; parking: Tri } {
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, { value?: unknown } | undefined>;
  const tri = (v: unknown): Tri => (v === true ? true : v === false ? false : null);
  const acc = o.accessible ? tri(o.accessible.value) : null;
  const park = o.parking ? tri(o.parking.value) : null;
  return { accessible: acc ?? (legacy.accessible ? true : null), parking: park ?? (legacy.freeParking ? true : null) };
}

// ---------- Hebrew counts ----------

export const optionsLabel = (n: number) => (n === 1 ? 'אפשרות אחת' : n === 2 ? 'שתי אפשרויות' : `${n} אפשרויות`);
export const prosLabel = (n: number) => (n === 1 ? 'איש מקצוע אחד' : n === 2 ? 'שני אנשי מקצוע' : `${n} אנשי מקצוע`);
export const reviewsLabel = (n: number) => (n === 1 ? 'ביקורת אחת' : `${n.toLocaleString('en-US')} ביקורות`);
const yearsLabel = (n: number) => (n === 1 ? 'שנת פעילות אחת' : n === 2 ? 'שנתיים של פעילות' : `${n} שנות פעילות`);

// ---------- Responsibility (04-permissions: only verified claims are public) ----------

export type Responsible = { label: 'אחריות רפואית' | 'איש מקצוע אחראי'; name: string; staffId: string; note: string } | null;

export function responsibleOf(p: PublicProfile): Responsible {
  const m = p.medicalResponsible;
  const lic = m?.license;
  if (!m || !lic || lic.status !== 'verified') return null;
  if (m.profession === 'doctor' && lic.kind === 'doctor') return { label: 'אחריות רפואית', name: m.displayName, staffId: m.id, note: 'רישיון רופא מאומת מול משרד הבריאות' };
  if ((m.profession === 'cosmetician' || m.profession === 'technician') && lic.kind === 'cosmetician_cert')
    return { label: 'איש מקצוע אחראי', name: m.displayName, staffId: m.id, note: 'הסמכה מקצועית אומתה' };
  return null;
}

export function staffBadge(lic: { kind: string; status: string } | null): string | null {
  if (!lic || lic.status !== 'verified') return null;
  if (lic.kind === 'doctor' || lic.kind === 'nurse') return 'רישיון מאומת מול משרד הבריאות';
  return 'הסמכה מקצועית אומתה';
}

// ---------- View model ----------

export interface HoursRow {
  day: string;
  range: string | null; // "09:00–19:00", null = closed
  unknown: boolean; // the source said nothing about this day
  today: boolean;
}

export function hoursRows(hours: DayHours[] | null, now: Date): HoursRow[] | null {
  if (!hours) return null;
  const { day } = jerusalemNow(now);
  return hours.map((h, i) => ({ day: DAY_NAMES[i], range: h.closed || h.unknown ? null : `${h.open}–${h.close}`, unknown: !!h.unknown, today: i === day }));
}

export interface Fact {
  key: 'established' | 'team' | 'languages' | 'responsible' | 'hours' | 'rating' | 'unknown';
  label: string;
  value: string;
  note: string | null;
  href?: string;
  ltr?: boolean;
}

export const HEADINGS = ['על הקליניקה', 'על המספרה', 'על הספא', 'על הסטודיו', 'על העסק'] as const;

export function buildView(p: PublicProfile, now = new Date()) {
  const region = regionBySlug(p.regionSlug);
  const hours = parseHours(p.hours);
  const known = hoursKnown(hours);
  const open: OpenState = known ? openState(hours, now) : null;
  const gallery = parseGallery(p.gallery);
  const ba = gallery.filter(g => g.tag === BEFORE_AFTER_TAG);
  const plain = gallery.filter(g => g.tag !== BEFORE_AFTER_TAG);
  const photos: Photo[] = [
    ...(p.coverUrl ? [{ url: p.coverUrl, alt: p.coverAlt || p.name }] : []),
    ...plain.filter(g => g.url !== p.coverUrl).map(g => ({ url: g.url, alt: g.alt || p.name })),
  ];
  const beforeAfter: Photo[] = ba.map(g => ({ url: g.url, alt: g.alt || 'לפני ואחרי' }));

  const cats = [...p.categories].sort((a, b) => a.category.sortOrder - b.category.sortOrder).map(c => c.category);
  const medicalBiz = cats.some(c => c.isMedical);
  const citySlug = p.city?.slug ?? null;
  const bookingOnline = BOOKING_LIVE && p.onlineBooking && p.isClaimed;

  // Services grouped by category, in the branch's category order; uncategorised last.
  const order = new Map(cats.map((c, i) => [c.slug, i]));
  const groupsMap = new Map<string, PublicProfile['treatments']>();
  for (const t of p.treatments) {
    const k = t.categorySlug ?? '_other';
    groupsMap.set(k, [...(groupsMap.get(k) ?? []), t]);
  }
  const services: ServiceGroupView[] = [...groupsMap.entries()]
    .sort(([a], [b]) => (order.get(a) ?? 99) - (order.get(b) ?? 99))
    .map(([k, items]) => {
      const cat = items[0].category;
      // The category's "from" line: comparable published amounts only (never per-unit, per-ml, per-area or package totals).
      const comparable = items.filter(t => t.priceAgorot != null && t.priceAgorot > 0 && COMPARABLE_PRICE_TYPES.has(t.priceType)).map(t => t.priceAgorot as number);
      const from: PriceView | null = comparable.length ? { kind: 'amount', ...priceParts(comparable.length === 1 && items.length === 1 ? (items[0].priceType as 'fixed' | 'from') : 'from', Math.min(...comparable)) } : null;
      return {
        key: k,
        name: cat?.name ?? 'טיפולים נוספים',
        meta: optionsLabel(items.length),
        icon: CATEGORY_ICONS[k] ?? DEFAULT_CATEGORY_ICON,
        from,
        quoteCount: items.filter(t => t.priceAgorot == null || t.priceType === 'on_request').length,
        medical: items.some(t => t.isMedical),
        compare: cat ? { href: citySlug ? `/${p.regionSlug}/${citySlug}/${cat.slug}` : `/treatments/${cat.slug}`, label: `השוו עסקים ל${cat.name} ב${p.cityName}` } : null,
        items: items.map(t => ({
          id: t.id,
          name: t.name,
          price: servicePrice(t),
          duration: t.durationMin ? `${t.durationMin} דק׳` : null,
          medical: t.isMedical,
          summary: t.description?.trim() || null,
          bookable: bookingOnline && !t.isMedical && t.onlineBookable && t.priceAgorot != null,
        })),
      };
    });
  const pricesUpdated = p.treatments.length ? new Date(Math.max(...p.treatments.map(t => (t.sourceAt ?? t.updatedAt).getTime()))) : null;
  const importedPrices = p.treatments.some(t => t.source && t.source !== 'owner');

  const responsible = responsibleOf(p);
  const staff = p.staff.map(s => ({
    id: s.id,
    name: s.displayName,
    role: [PROFESSION_NAME[s.profession as PractitionerProfession], s.license?.status === 'verified' ? s.license.specialty : null].filter(Boolean).join(' · '),
    badge: staffBadge(s.license),
  }));
  // People named on the business's own site, minus anyone who is already a verified staff member.
  const staffNames = new Set(staff.map(s => s.name.replace(/^(ד["״]?ר|דר['׳]|פרופ['׳]?)\s+/, '').toLowerCase()));
  const siteTeam = parseTeam(p.team).filter(t => !staffNames.has(t.name.replace(/^(ד["״]?ר|דר['׳]|פרופ['׳]?)\s+/, '').toLowerCase()));

  const reviews: ReviewView[] = p.reviews.map(r => ({
    id: r.id,
    author: r.authorName,
    rating: r.rating,
    iso: r.createdAt.toISOString(),
    rel: relHe(r.createdAt, now),
    title: r.title,
    body: r.body,
    treatment: r.treatmentName,
    reply: r.businessReply,
  }));
  const dist = [5, 4, 3, 2, 1].map(star => ({ star, count: p.reviews.filter(r => r.rating === star).length }));

  const google = p.googleRating != null ? { rating: p.googleRating, count: p.googleReviewCount ?? 0 } : null;
  const googleHref = p.googlePlaceUrl || `https://www.google.com/search?q=${encodeURIComponent(`${p.name} ${p.cityName} ביקורות`)}`;
  const googleSync = p.googleSyncedAt ? relHe(p.googleSyncedAt, now) : null;

  const today = hours ? hours[jerusalemNow(now).day] : null;
  const todayRange = today && !today.unknown ? (today.closed ? null : `${today.open}–${today.close}`) : undefined;

  const attributes = parseAttributes(p.attributes, { accessible: p.accessible, freeParking: p.freeParking });
  const videos = parseVideos(p.videos);
  const editorial = (p.editorial && typeof p.editorial === 'object' ? (p.editorial as { heading?: string; words?: number; needsMoreInfo?: boolean }) : null);
  const heading = (HEADINGS as readonly string[]).includes(editorial?.heading ?? '') ? (editorial!.heading as string) : p.business.type === 'clinic' || p.business.type === 'medspa' ? 'על הקליניקה' : cats.some(c => c.slug === 'hair-salons') && cats.length === 1 ? 'על המספרה' : cats.some(c => c.slug === 'spa-massage') && cats.length === 1 ? 'על הספא' : 'על העסק';

  // Three fact cards (design: established, team, languages). A slot without a sourced value takes a
  // known alternate fact; the last resort says the detail was not updated, never a made-up value.
  const thisYear = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', year: 'numeric' }).format(now));
  const primary: Array<Fact | null> = [
    p.establishedYear ? { key: 'established', label: 'פועל מאז', value: String(p.establishedYear), note: thisYear - p.establishedYear >= 1 ? `${yearsLabel(thisYear - p.establishedYear)} לפי אתר העסק` : 'לפי אתר העסק', ltr: true } : null,
    staff.length + siteTeam.length > 0
      ? { key: 'team', label: 'צוות', value: p.teamSize ? prosLabel(p.teamSize) : staff.length ? prosLabel(staff.length) : `${siteTeam.length === 1 ? 'איש מקצוע אחד' : `${siteTeam.length} אנשי מקצוע`} באתר העסק`, note: [...new Set([...staff.map(s => s.role.split(' · ')[0]), ...siteTeam.map(t => t.role)])].filter(Boolean).slice(0, 3).join(', ') || null }
      : null,
    p.languages.length ? { key: 'languages', label: 'שפות', value: p.languages.join(' · '), note: 'לפי אתר העסק' } : null,
  ];
  const alternates: Fact[] = [
    ...(responsible ? [{ key: 'responsible' as const, label: responsible.label, value: responsible.name, note: responsible.note, href: `/pro/${responsible.staffId}` }] : []),
    ...(known ? [{ key: 'hours' as const, label: 'שעות היום', value: todayRange ?? (todayRange === null ? 'סגור היום' : 'לא פורסם להיום'), note: open?.label ?? null, ltr: !!todayRange }] : []),
    ...(google && google.count > 0 ? [{ key: 'rating' as const, label: 'דירוג בגוגל', value: `${google.rating.toFixed(1)} מתוך 5`, note: reviewsLabel(google.count), ltr: false }] : []),
  ];
  const facts: Fact[] = primary.map(f => f ?? alternates.shift() ?? { key: 'unknown', label: 'פרטים', value: 'פרטים טרם עודכנו', note: null });

  return {
    region,
    citySlug,
    cats,
    medicalBiz,
    hours,
    hoursKnown: known,
    hoursRows: hoursRows(hours, now),
    open,
    todayRange,
    photos,
    beforeAfter,
    services,
    pricesUpdated: pricesUpdated ? longDateHe(pricesUpdated) : null,
    importedPrices,
    responsible,
    staff,
    siteTeam,
    videos,
    reviews,
    dist,
    google,
    googleHref,
    googleSync,
    faqs: parseFaqs(p.faqs),
    description: (p.description ?? '').split(/\n\s*\n|\r?\n/).map(s => s.trim()).filter(Boolean),
    heading,
    attributes,
    facts,
    bookingOnline,
    treatmentOptions: p.treatments.map(t => ({ name: t.name, isMedical: t.isMedical })),
    socials: [
      p.instagram && { network: 'instagram', url: p.instagram.startsWith('http') ? p.instagram : `https://instagram.com/${encodeURIComponent(p.instagram.replace(/^@/, ''))}`, label: 'אינסטגרם' },
      p.facebook && { network: 'facebook', url: p.facebook, label: 'פייסבוק' },
      p.tiktok && { network: 'tiktok', url: p.tiktok, label: 'טיקטוק' },
      p.youtube && { network: 'youtube', url: p.youtube, label: 'יוטיוב' },
    ].filter((s): s is { network: string; url: string; label: string } => !!s),
  };
}

export type ProfileView = ReturnType<typeof buildView>;

/** Up to three other public businesses in the same city (or region) and main category. */
export async function similarBusinesses(p: PublicProfile, mainCategory: string | undefined): Promise<ListingCard[]> {
  const res = await listBranches({ region: p.regionSlug, citySlug: p.city?.slug ?? undefined, category: mainCategory, take: 4 });
  return res.items.filter(b => b.id !== p.id).slice(0, 3);
}

// ---------- SEO ----------

export function metaTitle(p: PublicProfile, v: ProfileView): string {
  if (p.metaTitle && p.metaTitle.trim().length >= 10) return p.metaTitle.trim().slice(0, 70);
  const main = v.cats[0]?.name;
  return main ? `${p.name}: ${main} ב${p.cityName}` : `${p.name}, ${p.cityName}`;
}

export function metaDescription(p: PublicProfile, v: ProfileView): string {
  if (p.metaDescription && p.metaDescription.trim().length >= 60) return p.metaDescription.trim().slice(0, 170);
  const cats = v.cats.map(c => c.name).join(', ');
  const parts = [`${p.name} ב${p.cityName}${cats ? `: ${cats}` : ''}.`];
  if (v.google && v.google.count > 0) parts.push(`דירוג ${v.google.rating.toFixed(1)} בגוגל על סמך ${reviewsLabel(v.google.count)}.`);
  if (p.beautyfind) parts.push(`${reviewsLabel(p.beautyfind.count)} מאומתות ב־BeautyFind.`);
  if (p.treatments.length) parts.push(`${p.treatments.slice(0, 3).map(t => t.name).join(', ')}${p.treatments.length > 3 ? ' ועוד' : ''}.`);
  if (v.responsible) parts.push(`${v.responsible.label}: ${v.responsible.name}.`);
  if (p.description) parts.push(p.description.replace(/\s+/g, ' ').trim());
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (text.length <= 160) return text;
  const cut = text.slice(0, 159);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 120 ? cut.lastIndexOf(' ') : 159).trim()}…`;
}

/**
 * LocalBusiness (MedicalBusiness when a medical category is listed) + BreadcrumbList, FAQPage when
 * FAQs are visible. Only visible, sourced facts: no offers for unpublished prices, no aggregate rating
 * from Google (its structured-data policy), sameAs only for verified accounts.
 */
export function jsonLd(p: PublicProfile, v: ProfileView) {
  const url = `${SITE}${p.href}`;
  const crumbs = [
    { name: v.region?.name ?? p.regionSlug, item: `${SITE}/${p.regionSlug}` },
    ...(v.citySlug ? [{ name: p.cityName, item: `${SITE}/${p.regionSlug}/${v.citySlug}` }] : []),
    { name: p.name, item: url },
  ];
  const priced = p.treatments.filter(t => t.priceAgorot != null && t.priceAgorot > 0);
  const comparable = priced.filter(t => COMPARABLE_PRICE_TYPES.has(t.priceType)).map(t => t.priceAgorot as number);
  const images = v.photos.map(ph => (ph.url.startsWith('http') ? ph.url : `${SITE}${ph.url}`));
  const sameAs = [...(p.websiteUrl ? [p.websiteUrl] : []), ...v.socials.map(s => s.url)];
  const biz: Record<string, unknown> = {
    '@type': v.medicalBiz ? 'MedicalBusiness' : 'LocalBusiness',
    '@id': `${url}#biz`,
    name: p.name,
    url,
    ...(sameAs.length ? { sameAs } : {}),
    ...(p.phone ? { telephone: p.phone } : {}),
    ...(p.email && p.isClaimed ? { email: p.email } : {}),
    ...(images.length ? { image: images } : {}),
    ...(p.description ? { description: p.description.slice(0, 5000) } : {}),
    address: { '@type': 'PostalAddress', streetAddress: p.address, addressLocality: p.cityName, addressRegion: v.region?.name, addressCountry: 'IL' },
    ...(p.lat != null && p.lng != null ? { geo: { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lng } } : {}),
    ...(comparable.length ? { priceRange: comparable.length > 1 && Math.min(...comparable) !== Math.max(...comparable) ? `${nisFromAgorot(Math.min(...comparable))}–${nisFromAgorot(Math.max(...comparable))}` : nisFromAgorot(comparable[0]) } : {}),
    ...(openingHoursSpec(v.hours) ? { openingHoursSpecification: openingHoursSpec(v.hours) } : {}),
    ...(p.establishedYear ? { foundingDate: String(p.establishedYear) } : {}),
    ...(p.treatments.length
      ? {
          makesOffer: p.treatments.map(t => ({
            '@type': 'Offer',
            itemOffered: { '@type': 'Service', name: t.name, ...(t.category ? { category: t.category.name } : {}) },
            // Unknown prices carry no priceSpecification at all; published free services carry price 0.
            ...(t.priceAgorot != null && t.priceType !== 'on_request'
              ? {
                  priceSpecification: {
                    '@type': 'PriceSpecification',
                    ...(t.priceType === 'from' || t.priceType === 'range' ? { minPrice: t.priceAgorot / 100, ...(t.priceMaxAgorot ? { maxPrice: t.priceMaxAgorot / 100 } : {}) } : { price: t.priceAgorot / 100 }),
                    priceCurrency: 'ILS',
                    ...(t.taxIncluded != null ? { valueAddedTaxIncluded: t.taxIncluded } : {}),
                  },
                }
              : {}),
          })),
        }
      : {}),
    ...(p.beautyfind && p.beautyfind.count > 0
      ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: p.beautyfind.rating.toFixed(1), reviewCount: p.beautyfind.count, bestRating: 5, worstRating: 1 } }
      : {}),
    ...(v.responsible?.label === 'אחריות רפואית' ? { employee: [{ '@type': 'Person', name: v.responsible.name, jobTitle: 'רופא/ה אחראי/ת' }] } : {}),
  };
  const graph: unknown[] = [
    { '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.item })) },
    biz,
  ];
  if (v.faqs.length) {
    graph.push({ '@type': 'FAQPage', mainEntity: v.faqs.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

/** JSON for a <script type="application/ld+json"> without breaking out of the tag. */
export const ldJson = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');

export const categoryName = (slug: string) => categoryBySlug(slug)?.name ?? slug;
