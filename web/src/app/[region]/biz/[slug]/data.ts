import 'server-only';
import { categoryBySlug, regionBySlug } from '@/lib/catalog';
import { orderCategories } from '@/lib/category';
import { nisFromAgorot } from '@/lib/format';
import { BOOKING_LIVE } from '@/lib/features';
import { DEFAULT_VAT_PCT, withConsumerPrices } from '@/lib/vat';
import { cleanTeam } from '@/lib/import/profileExtract';
import { listBranches, nearbyBranches, type ListingCard, type PublicProfile } from '@/lib/server/public';
import { listingTitle } from '@/lib/seo/listingTitle';
import { normalizeHebrew } from '@/lib/import/textRules';
import { composeMetaDescription, joinHe, metaDescriptionOk, metaLead } from '@/lib/seo/metaRules';
import { seoCityName, seoName } from '@/lib/seo/seoName';
import { coverAlt, galleryAlts } from '@/lib/seo/imageAlt';
import { CATEGORY_SHORT } from '@/lib/seo/terms';
import { isOffer } from '@/lib/seo/treatmentHygiene';
import { hebrewTreatmentNames } from '@/lib/seo/treatmentNames';
import { absoluteUrl, breadcrumbNode, businessId, businessType, faqNode, graph, ldJson, pageId, webPageNode, type Crumb } from '@/lib/seo/schema';
import {
  COMPARABLE_PRICE_TYPES, DAY_NAMES, PROFESSION_NAME, hoursKnown, jerusalemNow, longDateHe, openDaysLabel, openState, openingHoursSpec, parseHours, priceParts, relHe, servicePrice,
  type DayHours, type OpenState, type PractitionerProfession, type PriceView,
} from '@/components/profile/format';
import { CATEGORY_ICONS, DEFAULT_CATEGORY_ICON } from '@/components/profile/icons';
import type { Photo } from '@/components/profile/Gallery';
import type { ReviewView } from '@/components/profile/Reviews';
import type { ServiceGroupView } from '@/components/profile/Services';
import type { VideoView } from '@/components/profile/VideoEmbed';

export const BEFORE_AFTER_TAG = 'לפני/אחרי';

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
    return typeof o.q === 'string' && typeof o.a === 'string' && o.q.trim() && o.a.trim() ? [{ q: normalizeHebrew(o.q.trim()), a: normalizeHebrew(o.a.trim()) }] : [];
  });
}

/** People named on the business's own site (imported): shown without a link, badge or login. */
export function parseTeam(json: unknown): Array<{ name: string; role: string; bio: string | null; sourceUrl: string | null }> {
  if (!Array.isArray(json)) return [];
  // The same quality gate as the import: a stored entry that is not a person with a role is never shown.
  return cleanTeam<Record<string, unknown>>(json).flatMap(t => {
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
    return [{ id: o.id, title: typeof o.title === 'string' ? o.title : null, channelTitle: typeof o.channelTitle === 'string' ? o.channelTitle : null, durationSec: typeof o.durationSec === 'number' ? o.durationSec : null, thumbnail: typeof o.thumbnail === 'string' ? o.thumbnail : null, poster: typeof o.poster === 'string' ? o.poster : null, status: 'ok' as const }];
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
  key: 'established' | 'team' | 'languages' | 'responsible' | 'hours' | 'rating';
  label: string;
  value: string;
  note: string | null;
  href?: string;
  ltr?: boolean;
}

export const HEADINGS = ['על הקליניקה', 'על המספרה', 'על הספא', 'על הסטודיו', 'על העסק'] as const;

export function buildView(p: PublicProfile, now = new Date(), vatPct = DEFAULT_VAT_PCT) {
  const region = regionBySlug(p.regionSlug);
  const hours = parseHours(p.hours);
  const known = hoursKnown(hours);
  const open: OpenState = known ? openState(hours, now) : null;
  const gallery = parseGallery(p.gallery);
  const ba = gallery.filter(g => g.tag === BEFORE_AFTER_TAG);
  const plain = gallery.filter(g => g.tag !== BEFORE_AFTER_TAG);
  const rest = plain.filter(g => g.url !== p.coverUrl);
  const restAlts = galleryAlts(p.name, rest);
  const photos: Photo[] = [
    ...(p.coverUrl ? [{ url: p.coverUrl, alt: coverAlt(p) }] : []),
    ...rest.map((g, i) => ({ url: g.url, alt: restAlts[i] })),
  ];
  const baAlts = galleryAlts(p.name, ba.map(g => ({ alt: g.alt, tag: 'לפני ואחרי' })));
  const beforeAfter: Photo[] = ba.map((g, i) => ({ url: g.url, alt: baAlts[i] }));

  const cats = orderCategories(p.categories).map(c => c.category); // [0] is the primary category, the one in the canonical URL
  const medicalBiz = cats.some(c => c.isMedical);
  const citySlug = p.city?.slug ?? null;
  const bookingOnline = BOOKING_LIVE && p.onlineBooking && p.isClaimed;
  // Every amount on the page is the consumer price (src/lib/vat.ts); every name and summary gets Hebrew typography.
  const treatments = p.treatments.map(t => ({ ...withConsumerPrices(t, vatPct), name: normalizeHebrew(t.name), description: t.description ? normalizeHebrew(t.description) : t.description }));

  // Services grouped by category, in the branch's category order; uncategorised last.
  const order = new Map(cats.map((c, i) => [c.slug, i]));
  const groupsMap = new Map<string, PublicProfile['treatments']>();
  for (const t of treatments) {
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
  const pricesUpdated = treatments.length ? new Date(Math.max(...treatments.map(t => (t.sourceAt ?? t.updatedAt).getTime()))) : null;
  const importedPrices = treatments.some(t => t.source && t.source !== 'owner');

  const responsible = responsibleOf(p);
  const staff = p.staff.map(s => ({
    id: s.id,
    name: s.displayName,
    role: [PROFESSION_NAME[s.profession as PractitionerProfession], s.license?.status === 'verified' ? s.license.specialty : null].filter(Boolean).join(' · '),
    badge: staffBadge(s.license),
  }));
  // The team section is the owner's: only verified staff members appear. Names scraped from a website
  // (branch.team) are never shown; the owner adds people after claiming the listing.
  const siteTeam: Array<{ name: string; role: string; bio: string | null; sourceUrl: string | null }> = [];

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

  // Up to three fact cards (design: established, team, languages). A slot without a sourced value takes
  // a known alternate fact; with fewer sourced facts the row is shorter, and with none it is left out.
  // No placeholder card: a card that says nothing looks like a mistake.
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
    ...(known ? [{ key: 'hours' as const, label: 'שעות היום', value: todayRange ?? (todayRange === null ? 'סגור היום' : 'ללא שעות להיום'), note: open?.label ?? null, ltr: !!todayRange }] : []),
    ...(google && google.count > 0 ? [{ key: 'rating' as const, label: 'דירוג בגוגל', value: `${google.rating.toFixed(1)} מתוך 5`, note: reviewsLabel(google.count), ltr: false }] : []),
  ];
  const facts: Fact[] = [...primary.filter((f): f is Fact => !!f), ...alternates].slice(0, 3);

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
    description: normalizeHebrew(p.description ?? '').split(/\n\s*\n|\r?\n/).map(s => s.trim()).filter(Boolean),
    heading,
    attributes,
    facts,
    bookingOnline,
    treatments,
    treatmentOptions: treatments.map(t => ({ name: t.name, isMedical: t.isMedical })),
    socials: [
      p.instagram && { network: 'instagram', url: p.instagram.startsWith('http') ? p.instagram : `https://instagram.com/${encodeURIComponent(p.instagram.replace(/^@/, ''))}`, label: 'אינסטגרם' },
      p.facebook && { network: 'facebook', url: p.facebook, label: 'פייסבוק' },
      p.tiktok && { network: 'tiktok', url: p.tiktok, label: 'טיקטוק' },
      p.youtube && { network: 'youtube', url: p.youtube, label: 'יוטיוב' },
    ].filter((s): s is { network: string; url: string; label: string } => !!s),
  };
}

export type ProfileView = ReturnType<typeof buildView>;

/** Up to six other public businesses with the same primary category in the same city ("עוד X ב{city}"). */
export async function similarBusinesses(p: PublicProfile, mainCategory: string | undefined): Promise<ListingCard[]> {
  const res = await listBranches({ region: p.regionSlug, citySlug: p.city?.slug ?? undefined, category: mainCategory, take: 7 });
  return res.items.filter(b => b.id !== p.id).slice(0, 6);
}

/** Up to six public businesses closest to this one ("בקרבת מקום"), not already shown. */
export async function nearbyBusinesses(p: PublicProfile, exclude: string[]): Promise<ListingCard[]> {
  if (p.lat == null || p.lng == null) return [];
  return nearbyBranches({ id: p.id, lat: p.lat, lng: p.lng }, 6, exclude);
}

// ---------- SEO ----------

/**
 * The page title: "{seoName} ב{city}: {short category}" (the layout appends " | BeautyFind"), under 60
 * characters. An owner's own title (claimed listing) is kept.
 */
export function metaTitle(p: PublicProfile, v: ProfileView): string {
  if (p.isClaimed && p.metaTitle && p.metaTitle.trim().length >= 10) return normalizeHebrew(p.metaTitle.trim()).slice(0, 70);
  const cat = v.cats[0];
  return listingTitle({ name: p.name, city: p.cityName, category: cat ? CATEGORY_SHORT[cat.slug] ?? cat.name : null });
}

/**
 * 130 to 155 characters, one pattern for every listing (src/lib/seo/metaRules.ts): one sentence that leads
 * with what the business offers in its city (its first treatments in Hebrew, phrased by category so it
 * never opens with the title's words), the Google rating with its review count when there is one, then
 * the action. When that is short, real facts follow: the responsible doctor, the opening days, another
 * treatment, the founding year, the street, languages, parking, access. Nothing about missing data,
 * booking, contact channels or "phone only". A saved override is used only when it follows the same rules.
 */
export function metaDescription(p: PublicProfile, v: ProfileView, extraFacts: string[] = []): string {
  const title = metaTitle(p, v);
  const saved = p.metaDescription ? normalizeHebrew(p.metaDescription.replace(/\s+/g, ' ').trim()) : '';
  if (saved && metaDescriptionOk(saved, { title, allow: [p.name] })) return saved;
  const name = seoName(p.name);
  const city = seoCityName(p.cityName);
  const cat = v.cats[0];
  const treatments = hebrewTreatmentNames(p.treatments.map(t => t.name), 4);
  const g = v.google && v.google.count > 0 ? v.google : null;
  const days = openDaysLabel(v.hours);
  const street = p.address && /^[א-ת]/u.test(p.address) && !/[A-Za-z]/.test(p.address) ? p.address.replace(p.cityName, '').replace(/[\s,]+$/u, '').trim() : '';
  const langs = p.languages.filter(l => /^[א-ת\s]+$/u.test(l));
  return composeMetaDescription({
    lead: t => metaLead(cat?.slug, name, city, t),
    treatments: treatments.slice(0, 3),
    rating: g ? `דירוג ${g.rating.toFixed(1)} בגוגל (${reviewsLabel(g.count)}).` : null,
    facts: [
      v.responsible ? (v.responsible.label === 'אחריות רפואית' ? `האחריות הרפואית בידי ${v.responsible.name}.` : `איש המקצוע האחראי הוא ${v.responsible.name}.`) : '',
      days ? `פתוח ${/עד|,|כל/u.test(days) ? 'בימים' : 'בימי'} ${days}.` : '',
      treatments[3] ? `מציעים גם ${treatments[3]}.` : '',
      p.establishedYear ? `העסק פועל מאז ${p.establishedYear}.` : '',
      street.length >= 4 ? `העסק נמצא ${/^רחוב /u.test(street) ? `ב${street}` : `ב${street}`}.` : '',
      langs.length ? `השירות ניתן ${joinHe(langs.map(l => `ב${l}`))}.` : '',
      v.attributes.parking === true ? 'יש חניה חינם במקום.' : '',
      v.attributes.accessible === true ? 'המקום נגיש לכיסא גלגלים.' : '',
      v.cats[1] ? `עוסקים גם ב${v.cats[1].name}.` : '',
      ...extraFacts,
      v.region ? `העסק פועל באזור ${v.region.name}.` : '',
    ],
  });
}

/**
 * The profile's graph: the ItemPage (part of the site, published by BeautyFind) with its breadcrumb
 * (ראשי > region > city > category > business), the business node typed by its primary category with the
 * same @id the URL carries, and the FAQPage when FAQs are visible. Only visible, sourced facts: no offers
 * for unpublished prices, no aggregate rating from Google (its structured-data policy; BeautyFind's own
 * reviews only), sameAs only for verified accounts.
 */
export function jsonLd(p: PublicProfile, v: ProfileView) {
  const path = p.href;
  const url = absoluteUrl(path);
  const cat = v.cats[0];
  const cityPath = v.citySlug && v.citySlug !== p.regionSlug ? `/${p.regionSlug}/${v.citySlug}` : null;
  const name = seoName(p.name);
  const crumbs: Crumb[] = [
    { name: 'ראשי', path: '/' },
    { name: v.region?.name ?? p.regionSlug, path: `/${p.regionSlug}` },
    ...(cityPath ? [{ name: seoCityName(p.cityName), path: cityPath }] : []),
    ...(cat ? [{ name: cat.name, path: v.citySlug ? `/${p.regionSlug}/${v.citySlug}/${cat.slug}` : `/treatments/${cat.slug}` }] : []),
    { name, path },
  ];
  const priced = v.treatments.filter(t => t.priceAgorot != null && t.priceAgorot > 0);
  const comparable = priced.filter(t => COMPARABLE_PRICE_TYPES.has(t.priceType)).map(t => t.priceAgorot as number);
  const images = v.photos.map(ph => absoluteUrl(ph.url));
  const sameAs = [...(p.websiteUrl ? [p.websiteUrl] : []), ...v.socials.map(s => s.url)];
  const biz: Record<string, unknown> = {
    '@type': businessType(cat?.slug, v.medicalBiz),
    '@id': businessId(path),
    name,
    ...(name !== p.name ? { alternateName: p.name } : {}),
    url,
    mainEntityOfPage: { '@id': pageId(path) },
    isPartOf: { '@id': pageId(path) },
    ...(sameAs.length ? { sameAs } : {}),
    ...(p.phone ? { telephone: p.phone } : {}),
    ...(p.email && p.isClaimed ? { email: p.email } : {}),
    ...(images.length ? { image: images } : {}),
    ...(p.description ? { description: normalizeHebrew(p.description).slice(0, 5000) } : {}),
    // The street address as stored (Hebrew for every listing the import geocoded); the city in Hebrew; no postal code is stored.
    address: { '@type': 'PostalAddress', streetAddress: p.address, addressLocality: seoCityName(p.cityName), addressRegion: v.region?.name, addressCountry: 'IL' },
    ...(p.lat != null && p.lng != null ? { geo: { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lng } } : {}),
    ...(comparable.length ? { priceRange: comparable.length > 1 && Math.min(...comparable) !== Math.max(...comparable) ? `${nisFromAgorot(Math.min(...comparable))}-${nisFromAgorot(Math.max(...comparable))}` : nisFromAgorot(comparable[0]) } : {}),
    ...(openingHoursSpec(v.hours) ? { openingHoursSpecification: openingHoursSpec(v.hours) } : {}),
    ...(p.establishedYear ? { foundingDate: String(p.establishedYear) } : {}),
    ...(v.treatments.some(t => isOffer(t.name))
      ? {
          // Product lines, sentences and stray words from price lists are not offers (treatmentHygiene.ts); a package of sessions is.
          makesOffer: v.treatments.filter(t => isOffer(t.name)).map(t => ({
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
  return graph([
    webPageNode({ path, type: 'ItemPage', name: `${name} ב${seoCityName(p.cityName)}`, image: v.photos[0]?.url ?? null, breadcrumb: true, mainEntityId: businessId(path) }),
    breadcrumbNode(path, crumbs),
    biz,
    ...(v.faqs.length ? [faqNode(path, v.faqs)] : []),
  ]);
}

export { ldJson };

export const categoryName = (slug: string) => categoryBySlug(slug)?.name ?? slug;
