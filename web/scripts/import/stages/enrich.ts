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
import { mergeServices, rankEmails, type Fact, type PageFacts, type SiteService } from '../../../src/lib/import/siteExtract';
import { expiryFor, mayPublish } from '../../../src/lib/import/sourcePolicy';
import { classifyWebsite, siteBelongs, type WebsiteKind } from '../../../src/lib/import/websiteKind';
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
    photos: uniq(all.flatMap(f => f.photos), f => f.value).slice(0, 24),
    names: [...new Set(all.map(f => f.siteName).filter((x): x is string => !!x))].slice(0, 6),
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

async function enrichOne(p: ImportPlace, runBrowser: { used: number; cap: number }) {
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
  const provCandidates = { logos: prov.logo ? [prov.logo] : [], photos: prov.photo ? [prov.photo] : [] };
  // No usable website of its own: the Google profile link stands in.
  const mapsFallback = { website: p.googleMapsUri ?? null, websiteKind: p.googleMapsUri ? 'google_profile' : null, siteDomain: null };
  const save = async (data: Prisma.ImportPlaceUpdateInput, extra: Record<string, unknown>) => {
    extra.imageCandidates ??= provCandidates;
    await db.$transaction([
      db.fieldObservation.deleteMany({ where: { importPlaceId: p.id, provider: 'website' } }),
      db.fieldObservation.createMany({ data: obs }),
      db.importPlace.update({ where: { id: p.id }, data: { status: 'enriched', enrichedAt: new Date(), ...data, crawl: { ...crawl0, ...extra } as Prisma.InputJsonValue } }),
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
    const net = w.network;
    return save(
      { websiteKind: 'social', instagram: net === 'instagram' && !p.instagram ? w.url : undefined, facebook: net === 'facebook' && !p.facebook ? w.url : undefined },
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
  for (const f of summary.logos) add('logo', f, 0.6);
  for (const f of summary.photos) add('photo', f, 0.5);

  const hoursFromSite = summary.hours?.value ?? null;
  const providerHours = (p.hours ?? null) as DayHours[] | null;

  // Services: add what the site lists, fill a missing price, never drop what is already there.
  const existing = (Array.isArray(p.treatments) ? p.treatments : []) as unknown as Array<ImportedTreatment & { sourceText?: string; sourceUrl?: string }>;
  const byKey = new Map(existing.map(t => [serviceKey(t.name), t]));
  for (const f of summary.services) {
    const k = serviceKey(f.value.name);
    const cur = byKey.get(k);
    if (cur) {
      if (cur.priceNis == null && f.value.priceNis != null) Object.assign(cur, { priceNis: f.value.priceNis, priceType: f.value.priceType, sourceText: f.evidence, sourceUrl: f.url });
      continue;
    }
    byKey.set(k, {
      name: f.value.name, category: f.value.category, priceNis: f.value.priceNis, priceType: f.value.priceType, durationMin: f.value.durationMin,
      isMedical: f.value.isMedical, sourceText: f.evidence, sourceUrl: f.url,
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
      instagram: p.instagram ?? [...summary.socials, ...(hub?.socials ?? [])].find(x => x.value.network === 'instagram')?.value.url ?? null,
      facebook: p.facebook ?? [...summary.socials, ...(hub?.socials ?? [])].find(x => x.value.network === 'facebook')?.value.url ?? null,
      bookingUrl: p.bookingUrl ?? summary.booking[0]?.value ?? hub?.booking[0]?.value ?? null,
      // Official website hours fill a gap; a disagreement goes to review instead of overwriting.
      hours: providerHours ? undefined : (hoursFromSite as unknown as Prisma.InputJsonValue) ?? undefined,
      treatments: treatments as unknown as Prisma.InputJsonValue,
      categories,
      logoUrl,
      photoUrls,
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
  // Different domains in parallel, each domain one request at a time (crawl.ts pauses between pages).
  await pool(places, 4, async p => {
    try {
      await enrichOne(p, runBrowser);
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 200) : 'enrich_failed';
      log('enrich failed', p.name, msg);
      await db.importPlace.update({ where: { id: p.id }, data: { status: 'enriched', enrichedAt: new Date(), crawl: { ...((p.crawl ?? {}) as object), site: 'failed', enrichError: msg } } });
    }
  });
  await bump(run.id, { enriched: places.length, browserPages: runBrowser.used - before });
  return true;
}
