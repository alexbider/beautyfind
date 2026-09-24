import 'server-only';
import { categoryBySlug, regionBySlug } from '@/lib/catalog';
import { nisFromAgorot } from '@/lib/format';
import { listBranches, type ListingCard, type PublicProfile } from '@/lib/server/public';
import {
  DAY_NAMES, PROFESSION_NAME, jerusalemNow, longDateHe, openState, openingHoursSpec, parseHours, priceParts, relHe,
  type DayHours, type OpenState, type PractitionerProfession, type PriceType,
} from '@/components/profile/format';
import { CATEGORY_ICONS, DEFAULT_CATEGORY_ICON } from '@/components/profile/icons';
import type { Photo } from '@/components/profile/Gallery';
import type { ReviewView } from '@/components/profile/Reviews';
import type { ServiceGroupView } from '@/components/profile/Services';

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

// ---------- Hebrew counts ----------

export const optionsLabel = (n: number) => (n === 1 ? 'אפשרות אחת' : n === 2 ? 'שתי אפשרויות' : `${n} אפשרויות`);
export const prosLabel = (n: number) => (n === 1 ? 'איש מקצוע אחד' : n === 2 ? 'שני אנשי מקצוע' : `${n} אנשי מקצוע`);
export const reviewsLabel = (n: number) => (n === 1 ? 'ביקורת אחת' : `${n.toLocaleString('en-US')} ביקורות`);

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
  today: boolean;
}

export function hoursRows(hours: DayHours[] | null, now: Date): HoursRow[] | null {
  if (!hours) return null;
  const { day } = jerusalemNow(now);
  return hours.map((h, i) => ({ day: DAY_NAMES[i], range: h.closed ? null : `${h.open}–${h.close}`, today: i === day }));
}

export function buildView(p: PublicProfile, now = new Date()) {
  const region = regionBySlug(p.regionSlug);
  const hours = parseHours(p.hours);
  const open: OpenState = openState(hours, now);
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
      const min = Math.min(...items.map(t => t.priceAgorot));
      const onlyOne = items.length === 1;
      return {
        key: k,
        name: cat?.name ?? 'טיפולים נוספים',
        meta: optionsLabel(items.length),
        icon: CATEGORY_ICONS[k] ?? DEFAULT_CATEGORY_ICON,
        from: onlyOne ? priceParts(items[0].priceType as PriceType, min) : priceParts('from', min),
        medical: items.some(t => t.isMedical),
        compare: cat ? { href: citySlug ? `/${p.regionSlug}/${citySlug}/${cat.slug}` : `/treatments/${cat.slug}`, label: `השוו עסקים ל${cat.name} ב${p.cityName}` } : null,
        items: items.map(t => ({
          id: t.id,
          name: t.name,
          price: priceParts(t.priceType as PriceType, t.priceAgorot),
          duration: t.durationMin ? `${t.durationMin} דק׳` : null,
          medical: t.isMedical,
        })),
      };
    });
  const pricesUpdated = p.treatments.length ? new Date(Math.max(...p.treatments.map(t => t.updatedAt.getTime()))) : null;

  const responsible = responsibleOf(p);
  const staff = p.staff.map(s => ({
    id: s.id,
    name: s.displayName,
    role: [PROFESSION_NAME[s.profession as PractitionerProfession], s.license?.status === 'verified' ? s.license.specialty : null].filter(Boolean).join(' · '),
    badge: staffBadge(s.license),
  }));

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

  return {
    region,
    citySlug,
    cats,
    medicalBiz,
    hours,
    hoursRows: hoursRows(hours, now),
    open,
    todayRange: today ? (today.closed ? null : `${today.open}–${today.close}`) : undefined,
    photos,
    beforeAfter,
    services,
    pricesUpdated: pricesUpdated ? longDateHe(pricesUpdated) : null,
    responsible,
    staff,
    reviews,
    dist,
    google,
    googleHref,
    googleSync,
    faqs: parseFaqs(p.faqs),
    description: (p.description ?? '').split(/\n\s*\n|\r?\n/).map(s => s.trim()).filter(Boolean),
    treatmentOptions: p.treatments.map(t => ({ name: t.name, isMedical: t.isMedical })),
  };
}

export type ProfileView = ReturnType<typeof buildView>;

/** Up to three other public businesses in the same city (or region) and main category. */
export async function similarBusinesses(p: PublicProfile, mainCategory: string | undefined): Promise<ListingCard[]> {
  const res = await listBranches({ region: p.regionSlug, citySlug: p.city?.slug ?? undefined, category: mainCategory, take: 4 });
  return res.items.filter(b => b.id !== p.id).slice(0, 3);
}

// ---------- SEO ----------

export function metaDescription(p: PublicProfile, v: ProfileView): string {
  const cats = v.cats.map(c => c.name).join(', ');
  const parts = [`${p.name} ב${p.cityName}${cats ? `: ${cats}` : ''}.`];
  if (v.google) parts.push(`דירוג ${v.google.rating.toFixed(1)} בגוגל על סמך ${reviewsLabel(v.google.count)}.`);
  if (p.beautyfind) parts.push(`${reviewsLabel(p.beautyfind.count)} מאומתות ב־BeautyFind.`);
  if (p.treatments.length) parts.push('מחירים לא כולל מע״מ, שעות פעילות וקביעת תור.');
  if (v.responsible) parts.push(`${v.responsible.label}: ${v.responsible.name}.`);
  if (p.description) parts.push(p.description.replace(/\s+/g, ' ').trim());
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (text.length <= 160) return text;
  const cut = text.slice(0, 159);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 120 ? cut.lastIndexOf(' ') : 159).trim()}…`;
}

/**
 * LocalBusiness (MedicalBusiness when a medical category is listed) + BreadcrumbList.
 * aggregateRating comes from BeautyFind reviews only, never from Google (Google's structured-data policy).
 */
export function jsonLd(p: PublicProfile, v: ProfileView) {
  const url = `${SITE}${p.href}`;
  const crumbs = [
    { name: v.region?.name ?? p.regionSlug, item: `${SITE}/${p.regionSlug}` },
    ...(v.citySlug ? [{ name: p.cityName, item: `${SITE}/${p.regionSlug}/${v.citySlug}` }] : []),
    { name: p.name, item: url },
  ];
  const prices = p.treatments.map(t => t.priceAgorot);
  const images = v.photos.map(ph => (ph.url.startsWith('http') ? ph.url : `${SITE}${ph.url}`));
  const biz: Record<string, unknown> = {
    '@type': v.medicalBiz ? 'MedicalBusiness' : 'LocalBusiness',
    '@id': `${url}#biz`,
    name: p.name,
    url,
    ...(p.websiteUrl ? { sameAs: [p.websiteUrl, ...(p.instagram ? [`https://instagram.com/${p.instagram.replace(/^@/, '')}`] : [])] } : p.instagram ? { sameAs: [`https://instagram.com/${p.instagram.replace(/^@/, '')}`] } : {}),
    ...(p.phone ? { telephone: p.phone } : {}),
    ...(p.email && p.isClaimed ? { email: p.email } : {}),
    ...(images.length ? { image: images } : {}),
    ...(p.description ? { description: p.description } : {}),
    address: { '@type': 'PostalAddress', streetAddress: p.address, addressLocality: p.cityName, addressRegion: v.region?.name, addressCountry: 'IL' },
    ...(p.lat != null && p.lng != null ? { geo: { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lng } } : {}),
    ...(prices.length ? { priceRange: prices.length > 1 && Math.min(...prices) !== Math.max(...prices) ? `${nisFromAgorot(Math.min(...prices))}–${nisFromAgorot(Math.max(...prices))}` : nisFromAgorot(prices[0]) } : {}),
    ...(openingHoursSpec(v.hours) ? { openingHoursSpecification: openingHoursSpec(v.hours) } : {}),
    ...(p.treatments.length
      ? {
          makesOffer: p.treatments.map(t => ({
            '@type': 'Offer',
            itemOffered: { '@type': 'Service', name: t.name, ...(t.category ? { category: t.category.name } : {}) },
            priceSpecification: {
              '@type': 'PriceSpecification',
              ...(t.priceType === 'from' ? { minPrice: t.priceAgorot / 100 } : { price: t.priceAgorot / 100 }),
              priceCurrency: 'ILS',
              valueAddedTaxIncluded: false,
            },
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
