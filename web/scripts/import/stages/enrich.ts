// Stage 2A: fill missing facts from the business's official website, cheaply.
//
// Per record: skip when there is no website or it is already complete; otherwise use the domain's
// cached result when it is fresh (30 days after success, 7 after a failure, negative results cached
// too), or crawl it (see crawl.ts). One crawl serves every branch on the same domain; branch-specific
// phones are only taken from the site when the site shows exactly one number and the provider gave none.

import { Prisma, type ImportPlace, type ImportRun } from '@prisma/client';
import { cleanEmail, emailDomain, sameDomain, siteHost } from '../../../src/lib/import/email';
import type { DayHours } from '../../../src/lib/import/rules';
import { rankEmails, type Fact, type PageFacts } from '../../../src/lib/import/siteExtract';
import { expiryFor, mayPublish } from '../../../src/lib/import/sourcePolicy';
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
  services: PageFacts['services'];
  logos: Fact[];
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
    services: uniq(all.flatMap(f => f.services), f => f.value.name + f.value.priceNis).slice(0, 60),
    logos: uniq(all.flatMap(f => f.logos), f => f.value).slice(0, 3),
    pages: c.pages,
    text: keepText ? all.map(f => f.text).join('\n\n').slice(0, 24_000) : undefined,
  };
}

const domainLocks = new Map<string, Promise<SiteSummary | null>>();

/** The domain's facts: from cache when fresh, otherwise crawled (once, even for concurrent branches). */
async function siteFor(website: string, runBrowser: { used: number; cap: number }): Promise<{ summary: SiteSummary | null; fromCache: boolean }> {
  const domain = siteHost(website);
  if (!domain) return { summary: null, fromCache: false };
  const cached = await db.siteFetch.findUnique({ where: { domain } });
  if (cached && cached.nextCheckAt > new Date()) return { summary: cached.result as unknown as SiteSummary, fromCache: true };
  if (!domainLocks.has(domain)) {
    domainLocks.set(domain, (async () => {
      const s = await settings();
      const c = await crawlSite(website, {
        maxPages: s.crawlMaxPages,
        prior: (cached?.validators ?? {}) as Record<string, { etag?: string; lastModified?: string; hash?: string }>,
        browserAllowed: () => s.browserFallback && runBrowser.used < runBrowser.cap && (++runBrowser.used, true),
      });
      const now = new Date();
      if (c.status === 'not_modified' && cached) {
        await db.siteFetch.update({ where: { domain }, data: { fetchedAt: now, nextCheckAt: new Date(now.getTime() + s.recheckOkDays * 86_400_000) } });
        return cached.result as unknown as SiteSummary;
      }
      const summary = summarize(c, s.llmEnabled);
      const okish = c.status === 'ok' || c.status === 'no_email';
      await db.siteFetch.upsert({
        where: { domain },
        create: {
          domain, status: c.status, fetchedAt: now, pages: c.pages.length, validators: c.validators as Prisma.InputJsonValue, contentHash: c.contentHash,
          result: summary as unknown as Prisma.InputJsonValue, error: c.error ?? null,
          nextCheckAt: new Date(now.getTime() + (okish ? s.recheckOkDays : s.recheckFailDays) * 86_400_000),
        },
        update: {
          status: c.status, fetchedAt: now, pages: c.pages.length, validators: c.validators as Prisma.InputJsonValue, contentHash: c.contentHash,
          result: summary as unknown as Prisma.InputJsonValue, error: c.error ?? null,
          nextCheckAt: new Date(now.getTime() + (okish ? s.recheckOkDays : s.recheckFailDays) * 86_400_000),
        },
      });
      return summary;
    })().finally(() => setTimeout(() => domainLocks.delete(domain), 1000)));
  }
  return { summary: await domainLocks.get(domain)!, fromCache: false };
}

const sameHours = (a: DayHours[] | null, b: DayHours[] | null) => !a || !b || JSON.stringify(a) === JSON.stringify(b);

async function enrichOne(p: ImportPlace, runBrowser: { used: number; cap: number }) {
  const crawl0 = (p.crawl ?? {}) as Record<string, unknown>;
  const done = (data: Prisma.ImportPlaceUpdateInput, extra: Record<string, unknown>) =>
    db.importPlace.update({ where: { id: p.id }, data: { status: 'enriched', enrichedAt: new Date(), ...data, crawl: { ...crawl0, ...extra } as Prisma.InputJsonValue } });

  if (!p.website) return void (await done({}, { site: 'no_website' }));
  // Already complete from the provider: no request needed.
  if (p.email && p.phone && p.hours) return void (await done({}, { site: 'skipped_complete' }));

  const { summary, fromCache } = await siteFor(p.website, runBrowser);
  if (!summary) return void (await done({}, { site: 'unsafe' }));
  const now = new Date();
  const domain = siteHost(p.website);

  // Observations with evidence.
  const obs: Prisma.FieldObservationCreateManyInput[] = [];
  const add = (field: string, f: Fact<unknown>, confidence: number, status?: string) =>
    obs.push({
      importPlaceId: p.id, field, value: f.value as Prisma.InputJsonValue, provider: 'website', sourceUrl: f.url, retrievedAt: now,
      confidence, evidence: f.evidence.slice(0, 300), retention: expiryFor('website') ? 'until_expiry' : 'permanent', expiresAt: expiryFor('website'),
      publishable: mayPublish('website', field), status,
    });

  // Email: contact-page and own-domain first; the site builder's credit is already excluded.
  const ranked = rankEmails(summary.emails.filter(e => cleanEmail(e.value)), p.website);
  let email: string | null = p.emailSource === 'manual' ? p.email : null;
  let emailStatus: string | null = p.emailSource === 'manual' ? p.emailStatus : null;
  let emailMx: boolean | null = p.emailMx;
  for (const [i, f] of ranked.entries()) {
    const mx = await hasMx(emailDomain(f.value));
    const status = mx ? 'dns_valid' : 'syntax_valid';
    add('email', f, sameDomain(f.value, p.website) ? (f.onContactPage ? 0.9 : 0.8) : f.onContactPage ? 0.7 : 0.5, status);
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
  for (const f of summary.socials) add('social', f, 0.8);
  for (const f of summary.booking) add('booking', f, 0.8);
  if (summary.hours) add('hours', summary.hours, 0.8);
  if (summary.address) add('address', summary.address, 0.7);
  for (const f of summary.services) add('service', f, 0.7);
  for (const f of summary.logos) add('logo', f, 0.5);
  // A recheck replaces this record's website observations instead of piling up copies.
  await db.$transaction([
    db.fieldObservation.deleteMany({ where: { importPlaceId: p.id, provider: 'website' } }),
    db.fieldObservation.createMany({ data: obs }),
  ]);

  const hoursFromSite = summary.hours?.value ?? null;
  const providerHours = (p.hours ?? null) as DayHours[] | null;
  const treatments = summary.services.map(f => ({ name: f.value.name, category: null, priceNis: f.value.priceNis, priceType: f.value.priceType, durationMin: null, isMedical: false, sourceText: f.evidence, sourceUrl: f.url }));

  await done(
    {
      email,
      emailSource: p.emailSource === 'manual' ? 'manual' : email ? 'site' : null,
      emailStatus,
      emailMx,
      emails: [...new Set([...p.emails, ...summary.emails.map(e => e.value)])],
      phone,
      whatsapp: p.whatsapp ?? summary.whatsapp[0]?.value ?? null,
      instagram: p.instagram ?? summary.socials.find(s => s.value.network === 'instagram')?.value.url ?? null,
      facebook: p.facebook ?? summary.socials.find(s => s.value.network === 'facebook')?.value.url ?? null,
      bookingUrl: p.bookingUrl ?? summary.booking[0]?.value ?? null,
      siteDomain: domain,
      // Official website hours fill a gap; a disagreement goes to review instead of overwriting.
      hours: providerHours ? undefined : (hoursFromSite as unknown as Prisma.InputJsonValue) ?? undefined,
      treatments: treatments.length && (!Array.isArray(p.treatments) || !p.treatments.length) ? (treatments as unknown as Prisma.InputJsonValue) : undefined,
    },
    {
      site: summary.status,
      siteFromCache: fromCache,
      pages: summary.pages,
      agencyEmails: summary.agencyEmails,
      phoneConflict,
      hoursConflict: !sameHours(providerHours, hoursFromSite),
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
