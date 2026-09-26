// Stage 2A: fill missing facts from the business's own website, cheaply.
//
// Per record:
// - The website is classified first. Directories, maps, marketplaces and other third-party pages are
//   dropped (booking and WhatsApp links move to their own fields). Social profiles are kept as the
//   website but not read (login walls and platform terms). A link-in-bio page is read once to find
//   the real site, socials and booking link.
// - The own site is read (see crawl.ts) and must belong to the business: its phone or its name has to
//   match. A site that shows other phones and another name is dropped as unrelated.
// - Services with and without prices, contact details, hours, logo and photos are taken with evidence.
// One crawl serves every branch on the same domain; results are cached per domain (30 days after
// success, 7 after a failure). Branch-specific phones come from the site only when it shows one number.

import { Prisma, type ImportPlace, type ImportRun } from '@prisma/client';
import { cleanEmail, emailDomain, sameDomain, siteHost } from '../../../src/lib/import/email';
import type { DayHours, ImportedTreatment } from '../../../src/lib/import/rules';
import { serviceKey } from '../../../src/lib/import/services';
import type { TeamMember, VideoCandidate } from '../../../src/lib/import/profileExtract';
import { mergeServices, rankEmails, type Fact, type PageFacts, type SiteService } from '../../../src/lib/import/siteExtract';
import { publishableSocials, verifySocials, type SocialInput } from '../../../src/lib/import/socials';
import { expiryFor, mayPublish } from '../../../src/lib/import/sourcePolicy';
import { classifyWebsite, siteBelongs, type WebsiteKind } from '../../../src/lib/import/websiteKind';
import { channelUploads, chooseVideos, validateVideos, type VideoRecord } from '../../../src/lib/import/youtube';
import { crawlSite, type CrawlOutcome, type SiteStatus } from '../crawl';
import { bump, db, hasMx, heartbeat, log, pool, settings } from '../ctx';

interface SiteSummary {
  status: SiteStatus;
  emails: Fact[];
  agencyEmails: string[];
  phones: Fact[];
  whatsapp: Fact[];
  socials: PageFacts['socials'];
  booking: Fact[];
  hours: Fact<DayHours[]> | null;
  address: Fact | null;
  services: Fact<SiteService>[];
  logos: Fact[];
  photos: Fact[];
  names: string[]; // site names (JSON-LD, og:site_name, titles) for the ownership check
  description?: Fact | null;
  faqs?: Fact<{ q: string; a: string }>[];
  accessible?: Fact<boolean> | null;
  freeParking?: Fact<boolean> | null;
  team?: Fact<TeamMember>[];
  videos?: Fact<VideoCandidate>[];
  channels?: Fact[];
  languages?: Fact<string[]> | null;
  establishedYear?: Fact<number> | null;
  beforeAfter?: Fact[];
  sitemapUrls?: number;
  extended?: boolean;
  outLinks: string[];
  pages: CrawlOutcome['pages'];
  text?: string; // kept only when the optional LLM step is on
}

function summarize(c: CrawlOutcome, keepText: boolean): SiteSummary {
  const all = c.facts;
  const uniq = <T,>(xs: T[], key: (x: T) => string) => [...new Map(xs.map(x => [key(x), x])).values()];
  return {
    status: c.status,
    emails: uniq(all.flatMap(f => f.emails), f => f.value),
    agencyEmails: [...new Set(all.flatMap(f => f.agencyEmails))],
    phones: uniq(all.flatMap(f => f.phones), f => f.value),
    whatsapp: uniq(all.flatMap(f => f.whatsapp), f => f.value),
    socials: uniq(all.flatMap(f => f.socials), f => f.value.url),
    booking: uniq(all.flatMap(f => f.booking), f => f.value),
    hours: all.find(f => f.hours)?.hours ?? null,
    address: all.find(f => f.address)?.address ?? null,
    services: mergeServices(all.flatMap(f => f.services)).slice(0, 100),
    logos: uniq(all.flatMap(f => f.logos), f => f.value).slice(0, 4),
    photos: uniq(all.flatMap(f => f.photos), f => f.value).slice(0, 30),
    names: [...new Set(all.map(f => f.siteName).filter((x): x is string => !!x))].slice(0, 6),
    description: all.find(f => f.description)?.description ?? null,
    faqs: uniq(all.flatMap(f => f.faqs ?? []), f => f.value.q).slice(0, 20),
    accessible: all.find(f => f.accessible)?.accessible ?? null,
    freeParking: all.find(f => f.freeParking)?.freeParking ?? null,
    // Team pages first, so a card on the about page does not shadow the full team page.
    team: uniq([...all.filter(f => f.isTeamPage), ...all.filter(f => !f.isTeamPage)].flatMap(f => f.team ?? []), f => f.value.name.toLowerCase()).slice(0, 12),
    videos: uniq(all.flatMap(f => f.videos ?? []), f => f.value.id).slice(0, 20),
    channels: uniq(all.flatMap(f => f.channels ?? []), f => f.value).slice(0, 3),
    languages: all.find(f => f.languages)?.languages ?? null,
    establishedYear: all.find(f => f.establishedYear)?.establishedYear ?? null,
    beforeAfter: uniq(all.flatMap(f => f.beforeAfter ?? []), f => f.value).slice(0, 12),
    sitemapUrls: c.sitemapUrls ?? 0,
    extended: c.extended ?? false,
    outLinks: [...new Set(all.flatMap(f => f.outLinks ?? []))].slice(0, 40),
    pages: c.pages,
    text: keepText ? all.map(f => f.text).join('\n\n').slice(0, 24_000) : undefined,
  };
}

const domainLocks = new Map<string, Promise<SiteSummary | null>>();

/** The domain's facts: from cache when fresh, otherwise crawled (once, even for concurrent branches). */
async function siteFor(website: string, runBrowser: { used: number; cap: number }, maxPages?: number): Promise<{ summary: SiteSummary | null; fromCache: boolean }> {
  const domain = siteHost(website);
  if (!domain) return { summary: null, fromCache: false };
  // Link-in-bio pages are per account, not per domain.
  const key = maxPages === 1 ? website : domain;
  const cached = await db.siteFetch.findUnique({ where: { domain: key } });
  if (cached && cached.nextCheckAt > new Date() && (cached.result as { names?: unknown } | null)?.names) {
    return { summary: cached.result as unknown as SiteSummary, fromCache: true };
  }
  if (!domainLocks.has(key)) {
    domainLocks.set(key, (async () => {
      const s = await settings();
      const c = await crawlSite(website, {
        maxPages: maxPages ?? s.crawlMaxPages,
        maxPagesExtended: maxPages ? undefined : s.crawlMaxPagesExtended,
        sitemap: !maxPages,
        prior: (cached?.validators ?? {}) as Record<string, { etag?: string; lastModified?: string; hash?: string }>,
        browserAllowed: () => s.browserFallback && runBrowser.used < runBrowser.cap && (++runBrowser.used, true),
      });
      const now = new Date();
      if (c.status === 'not_modified' && cached && (cached.result as { names?: unknown } | null)?.names) {
        await db.siteFetch.update({ where: { domain: key }, data: { fetchedAt: now, nextCheckAt: new Date(now.getTime() + s.recheckOkDays * 86_400_000) } });
        return cached.result as unknown as SiteSummary;
      }
      const summary = summarize(c, s.llmEnabled);
      const okish = c.status === 'ok' || c.status === 'no_email';
      const row = {
        status: c.status, fetchedAt: now, pages: c.pages.length, validators: c.validators as Prisma.InputJsonValue, contentHash: c.contentHash,
        result: summary as unknown as Prisma.InputJsonValue, error: c.error ?? null,
        nextCheckAt: new Date(now.getTime() + (okish ? s.recheckOkDays : s.recheckFailDays) * 86_400_000),
      };
      await db.siteFetch.upsert({ where: { domain: key }, create: { domain: key, ...row }, update: row });
      return summary;
    })().finally(() => setTimeout(() => domainLocks.delete(key), 1000)));
  }
  return { summary: await domainLocks.get(key)!, fromCache: false };
}

const sameHours = (a: DayHours[] | null, b: DayHours[] | null) => !a || !b || JSON.stringify(a) === JSON.stringify(b);

type Obs = Prisma.FieldObservationCreateManyInput;

/** Reads one record's website. keepStatus: for approved records being enhanced (their status stays). */
export interface EnrichCosts {
  youtubeQuota?: number;
  youtubeRequests?: number;
  sitemapRequests?: number;
}

/** Per-run YouTube quota accounting shared by every record of a run. */
export interface RunQuota {
  used: number;
  cap: number;
}

export async function enrichOne(p: ImportPlace, runBrowser: { used: number; cap: number }, opts: { keepStatus?: boolean; youtubeQuota?: RunQuota; onCost?: (c: EnrichCosts) => void } = {}) {
  const s = await settings();
  const crawl0 = (p.crawl ?? {}) as Record<string, unknown>;
  const edited = new Set((crawl0.editedFields ?? []) as string[]);
  const now = new Date();
  const obs: Obs[] = [];
  const add = (field: string, f: Fact<unknown>, confidence: number, status?: string) =>
    obs.push({
      importPlaceId: p.id, field, value: f.value as Prisma.InputJsonValue, provider: 'website', sourceUrl: f.url, retrievedAt: now,
      confidence, evidence: f.evidence.slice(0, 300), retention: expiryFor('website') ? 'until_expiry' : 'permanent', expiresAt: expiryFor('website'),
      publishable: mayPublish('website', field, { useWebsiteImages: s.useWebsiteImages }), status,
    });
  const reject = (url: string, why: string) =>
    obs.push({ importPlaceId: p.id, field: 'website', value: url, provider: 'website', sourceUrl: url, retrievedAt: now, confidence: 0.1, publishable: false, status: `rejected_${why}`, evidence: why === 'unrelated' ? 'The site shows another business (different phone and name)' : 'Directory or third-party page, not the business website' });
  // Google profile logo and photo (from discovery): candidates in every case, used when the site has none.
  const prov = (crawl0.providerImages ?? {}) as { logo?: string | null; photo?: string | null };
  const postImages = (crawl0.postImages ?? []) as string[]; // from the business's Google posts (googlePosts.ts)
  const provCandidates = { logos: prov.logo ? [prov.logo] : [], photos: [...(prov.photo ? [prov.photo] : []), ...postImages] };
  // No usable website of its own: the Google profile link stands in.
  const mapsFallback = { website: p.googleMapsUri ?? null, websiteKind: p.googleMapsUri ? 'google_profile' : null, siteDomain: null };
  const save = async (data: Prisma.ImportPlaceUpdateInput, extra: Record<string, unknown>) => {
    extra.imageCandidates ??= provCandidates;
    // Records that never reach the website step: the provider's social links are verified on their own
    // (a claimed Google profile names its accounts; an unclaimed one is a same-name account at best).
    if (data.socials === undefined) {
      const src = (crawl0.claimedOnProvider === true ? 'owner' : 'dataforseo') as SocialInput['source'];
      const inputs: SocialInput[] = [p.instagram && { network: 'instagram', url: p.instagram, source: src }, p.facebook && { network: 'facebook', url: p.facebook, source: src }].filter((x): x is SocialInput => !!x);
      const v = verifySocials(inputs, null);
      const pub = publishableSocials(v);
      data.socials = v as unknown as Prisma.InputJsonValue;
      if (!edited.has('instagram') && data.instagram === undefined) data.instagram = pub.instagram ?? null;
      if (!edited.has('facebook') && data.facebook === undefined) data.facebook = pub.facebook ?? null;
    }
    await db.$transaction([
      db.fieldObservation.deleteMany({ where: { importPlaceId: p.id, provider: 'website' } }),
      db.fieldObservation.createMany({ data: obs }),
      db.importPlace.update({ where: { id: p.id }, data: { ...(opts.keepStatus ? {} : { status: 'enriched' as const }), enrichedAt: new Date(), ...data, crawl: { ...crawl0, ...extra } as Prisma.InputJsonValue } }),
    ]);
  };

  if (!p.website) return save(p.googleMapsUri ? mapsFallback : {}, { site: crawl0.rejectedWebsite ? 'directory' : 'no_website' });
  if (p.websiteKind === 'google_profile') return save({}, { site: 'google_profile' });

  // 1. What is the website?
  const w = classifyWebsite(p.website);
  let kind: WebsiteKind = (p.websiteKind as WebsiteKind | null) ?? w.kind;
  if (w.kind !== 'own' && w.kind !== kind) kind = w.kind; // older records were never classified
  if (!['own', 'social', 'linkhub'].includes(kind)) {
    if (edited.has('website')) kind = 'own'; // staff chose it; respect that
    else {
      reject(p.website, 'directory');
      return save(
        {
          ...mapsFallback,
          bookingUrl: kind === 'booking' && !p.bookingUrl ? w.url : undefined,
          whatsapp: kind === 'whatsapp' && !p.whatsapp ? (w.phone ?? null) : undefined,
        },
        { site: 'directory', rejectedWebsite: p.website },
      );
    }
  }
  if (kind === 'social') {
    // The provider's website field names a social profile. On a claimed Google profile the owner set
    // that field, which counts as the business naming its own account; otherwise it stays unverified.
    const net = w.network;
    const claimed = crawl0.claimedOnProvider === true;
    const socials = verifySocials([{ network: net ?? '', url: w.url ?? p.website, source: claimed ? 'owner' : 'dataforseo' }], null);
    const pub = publishableSocials(socials);
    return save(
      { websiteKind: 'social', socials: socials as unknown as Prisma.InputJsonValue, instagram: pub.instagram ?? (p.instagram || undefined), facebook: pub.facebook ?? (p.facebook || undefined), tiktok: pub.tiktok, youtube: pub.youtube },
      { site: 'social_profile' },
    );
  }

  // 2. A link-in-bio page: read it once for the real site, socials and booking link.
  let site = p.website;
  let hub: SiteSummary | null = null;
  if (kind === 'linkhub') {
    hub = (await siteFor(p.website, runBrowser, 1)).summary;
    const own = hub?.outLinks.map(u => classifyWebsite(u)).find(c => c.kind === 'own');
    if (!own?.url) {
      for (const f of hub?.socials ?? []) add('social', f, 0.8);
      for (const f of hub?.booking ?? []) add('booking', f, 0.8);
      for (const f of hub?.whatsapp ?? []) add('whatsapp', f, 0.8, 'published');
      return save(
        {
          websiteKind: 'linkhub',
          instagram: p.instagram ?? hub?.socials.find(x => x.value.network === 'instagram')?.value.url ?? null,
          facebook: p.facebook ?? hub?.socials.find(x => x.value.network === 'facebook')?.value.url ?? null,
          bookingUrl: p.bookingUrl ?? hub?.booking[0]?.value ?? null,
          whatsapp: p.whatsapp ?? hub?.whatsapp[0]?.value ?? null,
        },
        { site: 'linkhub' },
      );
    }
    site = own.url;
  }

  // Already complete from the provider: nothing the site could add is missing.
  const haveTreatments = Array.isArray(p.treatments) && p.treatments.length > 0;
  if (p.email && p.phone && p.hours && haveTreatments && p.photoUrls.length > 1 && (p.logoUrl || !s.useWebsiteImages)) return save({}, { site: 'skipped_complete' });

  // 3. Read the site and check it belongs to this business.
  const { summary, fromCache } = await siteFor(site, runBrowser);
  if (!summary) return save({}, { site: 'unsafe' });
  const domain = siteHost(site);
  const belongs = summary.status === 'ok' || summary.status === 'no_email' ? siteBelongs(p, summary, domain) : 'not_read';
  if (belongs === 'no' && !edited.has('website')) {
    reject(site, 'unrelated');
    return save(mapsFallback, { site: 'unrelated', rejectedWebsite: site, siteNames: summary.names });
  }
  const website = site;

  // Email: contact-page and own-domain first; the site builder's credit is already excluded.
  const ranked = rankEmails(summary.emails.filter(e => cleanEmail(e.value)), website);
  // A staff-entered email always stays; otherwise the site's best email, else the provider's.
  let email: string | null = p.emailSource === 'manual' ? p.email : null;
  let emailStatus: string | null = p.emailSource === 'manual' ? p.emailStatus : null;
  let emailMx: boolean | null = p.emailMx;
  for (const [i, f] of ranked.entries()) {
    const mx = await hasMx(emailDomain(f.value));
    const status = mx ? 'dns_valid' : 'syntax_valid';
    add('email', f, sameDomain(f.value, website) ? (f.onContactPage ? 0.9 : 0.8) : f.onContactPage ? 0.7 : 0.5, status);
    if (!email && i === 0) {
      email = f.value;
      emailStatus = status;
      emailMx = mx;
    }
  }

  // Phones: the provider's phone stays; the site's number fills it only when unambiguous.
  for (const f of summary.phones) add('phone', f, f.onContactPage ? 0.8 : 0.6, 'published');
  const sitePhones = summary.phones.map(f => f.value);
  const phone = p.phone ?? (sitePhones.length === 1 ? sitePhones[0] : null);
  const phoneConflict = !!p.phone && sitePhones.length === 1 && sitePhones[0] !== p.phone;

  for (const f of summary.whatsapp) add('whatsapp', f, 0.8, 'published');
  for (const f of [...summary.socials, ...(hub?.socials ?? [])]) add('social', f, 0.8);
  for (const f of summary.booking) add('booking', f, 0.8);
  if (summary.hours) add('hours', summary.hours, 0.8);
  if (summary.address) add('address', summary.address, 0.7);
  for (const f of summary.services) add('service', f, f.value.priceNis != null ? 0.8 : 0.6);
  if (summary.description) add('description', summary.description, 0.7);
  for (const f of summary.faqs ?? []) add('faq', f, 0.8);
  if (summary.accessible) add('accessible', summary.accessible, 0.7);
  if (summary.freeParking) add('free_parking', summary.freeParking, 0.7);
  for (const f of summary.logos) add('logo', f, 0.6);
  for (const f of summary.photos) add('photo', f, 0.5);
  for (const f of summary.team ?? []) add('team', f, 0.7);
  if (summary.languages) add('languages', summary.languages, 0.8);
  if (summary.establishedYear) add('established', summary.establishedYear, 0.8);
  for (const f of summary.videos ?? []) add('video', f, 0.7);
  for (const f of summary.channels ?? []) add('social', { value: { network: 'youtube', url: f.value }, url: f.url, evidence: f.evidence }, 0.8);

  // Social accounts: the site's own links verify an account; the provider's alone does not.
  const socialInputs: SocialInput[] = [
    ...summary.socials.map(x => ({ network: x.value.network, url: x.value.url, source: 'website' as const })),
    ...(summary.channels ?? []).map(x => ({ network: 'youtube', url: x.value, source: 'website' as const })),
    ...(hub?.socials ?? []).map(x => ({ network: x.value.network, url: x.value.url, source: 'linkhub' as const })),
    ...[p.instagram && { network: 'instagram', url: p.instagram }, p.facebook && { network: 'facebook', url: p.facebook }]
      .filter((x): x is { network: string; url: string } => !!x)
      .map(x => ({ ...x, source: (crawl0.claimedOnProvider === true ? 'owner' : 'dataforseo') as SocialInput['source'] })),
  ];
  const socials = verifySocials(socialInputs, domain);
  const pubSocial = publishableSocials(socials);

  // Official YouTube videos: ids on the site first; a channel link is followed only with the Data API key.
  const ytCosts: EnrichCosts = {};
  let videos: VideoRecord[] = (Array.isArray(p.videos) ? (p.videos as unknown as VideoRecord[]) : []).filter(v => v.source === 'owner');
  if (s.youtubeEnabled && !edited.has('videos')) {
    const yt = {
      apiKey: process.env.YOUTUBE_API_KEY || null, apiBase: process.env.YOUTUBE_API_BASE, oembedBase: process.env.YOUTUBE_OEMBED_BASE, allowPrivate: process.env.IMPORT_TEST_ALLOW_PRIVATE === '1',
      quota: (units: number) => {
        const q = opts.youtubeQuota;
        if (q && q.used + units > q.cap) return false;
        if (q) q.used += units;
        ytCosts.youtubeQuota = (ytCosts.youtubeQuota ?? 0) + units;
        return true;
      },
    };
    const ids = (summary.videos ?? []).map(v => v.value.id).slice(0, 12);
    const fromSite = ids.length ? await validateVideos(ids, yt, 'website', (summary.videos ?? [])[0]?.url ?? website) : { videos: [], quotaUsed: 0 };
    ytCosts.youtubeRequests = (ytCosts.youtubeRequests ?? 0) + (yt.apiKey ? fromSite.quotaUsed : ids.length);
    videos = [...videos, ...fromSite.videos];
    const channel = pubSocial.youtube ?? null;
    if (channel && chooseVideos(videos, s.youtubeMaxVideos).length < s.youtubeMaxVideos && yt.apiKey) {
      const up = await channelUploads(channel, yt, 10);
      if (up.ids.length) {
        const fresh = up.ids.filter(id => !videos.some(v => v.id === id));
        const r = await validateVideos(fresh, yt, 'channel', channel);
        videos = [...videos, ...r.videos];
      }
    }
  }
  opts.onCost?.(ytCosts);

  const hoursFromSite = summary.hours?.value ?? null;
  const providerHours = (p.hours ?? null) as DayHours[] | null;

  // Services: add what the site lists, fill a missing price, never drop what is already there.
  const existing = (Array.isArray(p.treatments) ? p.treatments : []) as unknown as Array<ImportedTreatment & { sourceText?: string; sourceUrl?: string }>;
  const byKey = new Map(existing.map(t => [serviceKey(t.name), t]));
  for (const f of summary.services) {
    const k = serviceKey(f.value.name);
    const cur = byKey.get(k);
    if (cur) {
      if (cur.priceNis == null && f.value.priceNis != null) Object.assign(cur, { priceNis: f.value.priceNis, priceMaxNis: f.value.priceMaxNis ?? null, priceNote: f.value.priceNote ?? null, priceType: f.value.priceType, source: 'website', sourceText: f.evidence, sourceUrl: f.url, sourceAt: now.toISOString() });
      continue;
    }
    byKey.set(k, {
      name: f.value.name, category: f.value.category, priceNis: f.value.priceNis, priceMaxNis: f.value.priceMaxNis ?? null, priceNote: f.value.priceNote ?? null, priceType: f.value.priceType, durationMin: f.value.durationMin,
      isMedical: f.value.isMedical, source: 'website', sourceText: f.evidence, sourceUrl: f.url, sourceAt: now.toISOString(),
    });
  }
  const treatments = [...byKey.values()].slice(0, 80);

  // Categories the site clearly offers: one priced service or two listed services in that category.
  const perCat = new Map<string, { n: number; priced: number }>();
  for (const t of treatments) {
    if (!t.category) continue;
    const c = perCat.get(t.category) ?? { n: 0, priced: 0 };
    c.n++;
    if (t.priceNis != null) c.priced++;
    perCat.set(t.category, c);
  }
  const siteCats = [...perCat.entries()].filter(([, c]) => c.priced >= 1 || c.n >= 2).map(([k]) => k);
  const categories = edited.has('categories') ? undefined : [...new Set([...p.categories, ...siteCats])];

  // Logo and photos: the site's own first, then the Google profile's. Staff choose in review; the
  // choice is copied to our storage on approval. A choice staff already made is kept.
  const siteLogos = s.useWebsiteImages ? summary.logos.map(f => f.value) : [];
  const sitePhotos = s.useWebsiteImages ? summary.photos.map(f => f.value) : [];
  const provLogos = s.useProviderImages ? provCandidates.logos : [];
  const provPhotos = s.useProviderImages ? provCandidates.photos : [];
  const logoUrl = edited.has('logoUrl') ? p.logoUrl : (siteLogos[0] ?? provLogos[0] ?? null);
  const photoUrls = edited.has('photoUrls') ? p.photoUrls : [...new Set([...sitePhotos, ...provPhotos])].slice(0, s.maxListingPhotos);

  await save(
    {
      website,
      websiteKind: 'own',
      siteDomain: domain,
      email: email ?? (p.emailSource === 'provider' ? p.email : null),
      emailSource: p.emailSource === 'manual' ? 'manual' : email ? 'site' : p.emailSource === 'provider' && p.email ? 'provider' : null,
      emailStatus: email ? emailStatus : p.emailSource === 'provider' ? p.emailStatus : null,
      emailMx,
      emails: [...new Set([...p.emails, ...summary.emails.map(e => e.value)])],
      phone,
      whatsapp: p.whatsapp ?? summary.whatsapp[0]?.value ?? null,
      // Only verified accounts reach the listing fields; the rest stay in `socials` for review.
      instagram: edited.has('instagram') ? p.instagram : pubSocial.instagram ?? null,
      facebook: edited.has('facebook') ? p.facebook : pubSocial.facebook ?? null,
      tiktok: pubSocial.tiktok ?? null,
      youtube: pubSocial.youtube ?? null,
      socials: socials as unknown as Prisma.InputJsonValue,
      team: edited.has('team') ? undefined : ((summary.team ?? []).map(f => ({ ...f.value, sourceUrl: f.url })) as unknown as Prisma.InputJsonValue),
      languages: edited.has('languages') ? undefined : summary.languages?.value ?? [],
      establishedYear: edited.has('establishedYear') ? undefined : summary.establishedYear?.value ?? null,
      videos: videos as unknown as Prisma.InputJsonValue,
      bookingUrl: p.bookingUrl ?? summary.booking[0]?.value ?? hub?.booking[0]?.value ?? null,
      // Official website hours fill a gap; a disagreement goes to review instead of overwriting.
      hours: providerHours ? undefined : (hoursFromSite as unknown as Prisma.InputJsonValue) ?? undefined,
      treatments: treatments as unknown as Prisma.InputJsonValue,
      categories,
      logoUrl,
      photoUrls,
      // Template fields the provider did not give: the site's own words and statements.
      description: edited.has('description') || p.description ? undefined : summary.description?.value ?? undefined,
      faqs: Array.isArray(p.faqs) && p.faqs.length ? undefined : (summary.faqs ?? []).length ? ((summary.faqs ?? []).map(f => f.value) as Prisma.InputJsonValue) : undefined,
      accessible: p.accessible ?? (summary.accessible ? true : undefined),
      freeParking: p.freeParking ?? (summary.freeParking ? true : undefined),
    },
    {
      site: summary.status,
      siteFromCache: fromCache,
      siteBelongs: belongs,
      viaLinkhub: kind === 'linkhub' ? p.website : undefined,
      pages: summary.pages,
      agencyEmails: summary.agencyEmails,
      phoneConflict,
      hoursConflict: !sameHours(providerHours, hoursFromSite),
      services: { total: summary.services.length, priced: summary.services.filter(f => f.value.priceNis != null).length },
      imageCandidates: { logos: [...new Set([...summary.logos.map(f => f.value), ...provCandidates.logos])], photos: [...new Set([...summary.photos.map(f => f.value), ...provCandidates.photos])] },
      // Where each candidate came from (kept with the copy on approval). Before/after images wait for the owner.
      mediaCandidates: [
        ...summary.photos.map(f => ({ url: f.value, pageUrl: f.url, provider: 'website', evidence: f.evidence, retrievedAt: now.toISOString() })),
        ...provCandidates.photos.map(u => ({ url: u, pageUrl: p.googleMapsUri ?? null, provider: 'google_profile', evidence: 'Google Business Profile photo (via DataForSEO)', retrievedAt: now.toISOString() })),
      ].slice(0, 40),
      beforeAfterCandidates: (summary.beforeAfter ?? []).map(f => ({ url: f.value, pageUrl: f.url, evidence: f.evidence, status: 'needs_owner_confirmation' })),
      crawlBudget: { pages: summary.pages.length, sitemapUrls: summary.sitemapUrls ?? 0, extended: summary.extended ?? false },
      youtube: { checked: videos.length, playable: chooseVideos(videos, s.youtubeMaxVideos).length, channel: pubSocial.youtube ?? null, unverifiedChannel: socials.youtube && !socials.youtube.verified ? socials.youtube.url : null },
      text: summary.text,
      extractError: null,
    },
  );
}

export async function enrich(run: ImportRun): Promise<boolean> {
  const places = await db.importPlace.findMany({ where: { runId: run.id, status: 'found' }, orderBy: { createdAt: 'asc' }, take: 12 });
  if (!places.length) return false;
  await heartbeat(run.id);
  const s = await settings();
  const stats = (run.stats ?? {}) as { counters?: Record<string, number> };
  const runBrowser = { used: stats.counters?.browserPages ?? 0, cap: s.browserMaxPerRun };
  const before = runBrowser.used;
  const youtubeQuota = { used: stats.counters?.youtubeQuota ?? 0, cap: s.youtubeQuotaPerRun };
  const costs: Record<string, number> = {};
  // Different domains in parallel, each domain one request at a time (crawl.ts pauses between pages).
  await pool(places, 4, async p => {
    try {
      await enrichOne(p, runBrowser, { youtubeQuota, onCost: c => Object.entries(c).forEach(([k, v]) => (costs[k] = (costs[k] ?? 0) + (v ?? 0))) });
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 200) : 'enrich_failed';
      log('enrich failed', p.name, msg);
      await db.importPlace.update({ where: { id: p.id }, data: { status: 'enriched', enrichedAt: new Date(), crawl: { ...((p.crawl ?? {}) as object), site: 'failed', enrichError: msg } } });
    }
  });
  await bump(run.id, { enriched: places.length, browserPages: runBrowser.used - before, ...costs });
  return true;
}
