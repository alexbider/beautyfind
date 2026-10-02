// Crawls a running build and reports what search engines will see. Run it against the local production
// build (npm run build && npm run start -p 3111) before and after a change and compare the two reports.
//
//   npm run seo:verify -- --base http://localhost:3111 --label after
//   options: --out reports (folder)   --concurrency 6   --max 2000 (pages)   --compare reports/seo-verify-before.json
//
// Checks (per the SEO/GEO brief):
// - every sitemap URL answers 200 directly, with a canonical that points at itself, and never redirects;
// - per page: title 30 to 60 characters with the brand, meta description 110 to 160, exactly one H1,
//   Open Graph (title, description, url, image, locale, site name) and the Twitter card, JSON-LD that
//   parses with the type the template is expected to carry, no <img> without alt (empty only with
//   role="presentation"), every <img> with width and height (or a fill-style size), no skipped heading level;
// - visible text and JSON-LD descriptions scanned for the text rules (sentences about missing data, English
//   inside Hebrew, em dashes, emoji) from src/lib/import/textRules.ts;
// - the internal link graph: profiles with fewer than three inbound links from other pages.
// The report is JSON plus a Markdown summary; with --compare a before/after table is printed.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { textProblems } from '../src/lib/import/textRules';
import { SITE_ORIGIN } from '../src/lib/seo/meta';

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const BASE = (arg('base', 'http://localhost:3111') as string).replace(/\/$/, '');
const LABEL = arg('label', 'run') as string;
const OUT = arg('out', 'reports') as string;
const CONCURRENCY = Number(arg('concurrency', '6'));
const MAX = Number(arg('max', '2000'));
const COMPARE = arg('compare');

// Words that may stay in Latin script inside Hebrew interface copy (brands, protocols, products).
const UI_LATIN = ['beauty', 'find', 'SMS', 'CRM', 'Outlook', 'Meta', 'iOS', 'Android', 'PDF', 'QR', 'Esc', 'Business', 'Maps', 'Israfind', 'Group', 'Pro', 'Plus', 'Delaware', 'Waze', 'Jost', 'Wix', 'YouTube', 'LinkedIn', 'FUE', 'FUT', 'PRP', 'RF', 'IPL', 'UV', 'HIFU', 'LED', 'CO2', 'SPF', 'DPL', 'SHR'];

interface PageReport {
  url: string;
  path: string;
  status: number;
  redirectTo: string | null;
  template: string;
  title: string;
  titleLen: number;
  titleOk: boolean;
  description: string;
  descriptionLen: number;
  descriptionOk: boolean;
  canonical: string | null;
  canonicalSelf: boolean;
  robots: string | null;
  h1Count: number;
  headingSkips: number;
  og: { title: boolean; description: boolean; url: boolean; image: boolean; locale: boolean; siteName: boolean; twitterCard: boolean };
  ogOk: boolean;
  jsonLd: { blocks: number; parseErrors: number; types: string[]; expectedOk: boolean; duplicateIds: string[] };
  images: { total: number; missingAlt: number; emptyAltNotDecorative: number; missingSize: number };
  text: { missingInfo: number; latin: string[]; dashes: number; emoji: number; spelling: number };
  internalLinks: string[];
}

const TEMPLATE_TYPES: Record<string, string[]> = {
  home: ['WebSite', 'Organization', 'WebPage'],
  region: ['CollectionPage', 'BreadcrumbList'],
  city: ['CollectionPage', 'BreadcrumbList'],
  'city-category': ['CollectionPage', 'BreadcrumbList'],
  treatments: ['CollectionPage', 'BreadcrumbList'],
  'treatment-category': ['CollectionPage', 'BreadcrumbList'],
  regions: ['CollectionPage', 'BreadcrumbList'],
  profile: ['ItemPage', 'BreadcrumbList'],
  content: ['BreadcrumbList'],
  other: [],
};
const BUSINESS_TYPES = new Set(['HairSalon', 'NailSalon', 'BeautySalon', 'DaySpa', 'Dentist', 'MedicalClinic', 'HealthAndBeautyBusiness', 'LocalBusiness', 'MedicalBusiness']);
const REGIONS = ['north', 'haifa', 'sharon', 'dan', 'jerusalem', 'shfela', 'south'];
const CATEGORIES = ['facials', 'medical-aesthetics', 'plastic-surgery', 'dental-aesthetics', 'hair-restoration', 'hair-salons', 'hair-removal', 'brows-lashes', 'makeup', 'permanent-makeup', 'nails', 'spa-massage', 'body-contouring', 'tanning'];

function templateOf(path: string): string {
  const parts = path.split('?')[0].split('/').filter(Boolean);
  if (parts.length === 0) return 'home';
  if (parts[0] === 'treatments') return parts.length === 1 ? 'treatments' : 'treatment-category';
  if (parts[0] === 'regions') return 'regions';
  if (REGIONS.includes(parts[0])) {
    if (parts.length === 1) return 'region';
    if (parts.length === 2) return CATEGORIES.includes(parts[1]) ? 'other' : 'city';
    if (parts.length === 3) return CATEGORIES.includes(parts[1]) || parts[1] === 'biz' ? 'profile' : CATEGORIES.includes(parts[2]) ? 'city-category' : 'other';
  }
  if (['about', 'listing-standards', 'help', 'contact', 'privacy', 'terms', 'accessibility', 'for-business'].includes(parts[0])) return 'content';
  return 'other';
}

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : null;
}
function metaContent(html: string, key: string, by: 'name' | 'property'): string | null {
  const re = new RegExp(`<meta[^>]*\\s${by}\\s*=\\s*["']${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'i');
  const m = html.match(re);
  return m ? attr(m[0], 'content') : null;
}
const tags = (html: string, name: string) => [...html.matchAll(new RegExp(`<${name}(\\s[^>]*)?>`, 'gi'))].map(m => m[0]);

function visibleText(html: string): string {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ');
}

function headingSkips(html: string): number {
  const levels = [...html.matchAll(/<h([1-6])[\s>]/gi)].map(m => Number(m[1]));
  let skips = 0;
  let prev = 0;
  for (const l of levels) {
    if (prev && l > prev + 1) skips++;
    prev = l;
  }
  return skips;
}

function duplicateIds(nodes: unknown): string[] {
  const seen = new Map<string, number>();
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    if (typeof o['@id'] === 'string' && Object.keys(o).length > 1) seen.set(o['@id'], (seen.get(o['@id']) ?? 0) + 1);
    for (const v of Object.values(o)) walk(v);
  };
  walk(nodes);
  return [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
}

const toPath = (href: string): string | null => {
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return null;
  try {
    const u = new URL(href, BASE);
    // Canonicals and schema URLs are written on the production origin (metadataBase) even on a local build.
    if (u.origin !== new URL(BASE).origin && u.origin !== SITE_ORIGIN) return null;
    return decodeURI(u.pathname) + (u.search || '');
  } catch {
    return null;
  }
};

async function fetchPage(path: string): Promise<{ status: number; redirectTo: string | null; html: string }> {
  const res = await fetch(BASE + encodeURI(path), { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) seo-verify' } });
  const loc = res.headers.get('location');
  const html = res.status === 200 ? await res.text() : '';
  return { status: res.status, redirectTo: loc ? toPath(loc) ?? loc : null, html };
}

function analyse(path: string, status: number, redirectTo: string | null, html: string): PageReport {
  const template = templateOf(path);
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
  const description = metaContent(html, 'description', 'name') ?? '';
  const canonicalTag = tags(html, 'link').find(t => /rel\s*=\s*["']canonical["']/i.test(t));
  const canonical = canonicalTag ? (toPath(attr(canonicalTag, 'href') ?? '') ?? attr(canonicalTag, 'href')) : null;
  const robots = metaContent(html, 'robots', 'name');
  const og = {
    title: !!metaContent(html, 'og:title', 'property'),
    description: !!metaContent(html, 'og:description', 'property'),
    url: !!metaContent(html, 'og:url', 'property'),
    image: !!metaContent(html, 'og:image', 'property'),
    locale: metaContent(html, 'og:locale', 'property') === 'he_IL',
    siteName: !!metaContent(html, 'og:site_name', 'property'),
    twitterCard: !!metaContent(html, 'twitter:card', 'name'),
  };
  const ldBlocks = [...html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  const types: string[] = [];
  const descriptions: string[] = [];
  let parseErrors = 0;
  let dupIds: string[] = [];
  for (const b of ldBlocks) {
    try {
      const j = JSON.parse(b) as Record<string, unknown>;
      const nodes = (Array.isArray(j['@graph']) ? j['@graph'] : [j]) as Array<Record<string, unknown>>;
      for (const n of nodes) {
        if (typeof n['@type'] === 'string') types.push(n['@type']);
        if (typeof n.description === 'string') descriptions.push(n.description);
      }
      dupIds = [...dupIds, ...duplicateIds(nodes)];
    } catch {
      parseErrors++;
    }
  }
  const expected = TEMPLATE_TYPES[template] ?? [];
  const expectedOk = expected.every(t => types.includes(t)) && (template !== 'profile' || types.some(t => BUSINESS_TYPES.has(t)));

  const imgs = tags(html, 'img');
  let missingAlt = 0;
  let emptyAltNotDecorative = 0;
  let missingSize = 0;
  for (const t of imgs) {
    const alt = attr(t, 'alt');
    const role = attr(t, 'role');
    if (alt == null) missingAlt++;
    else if (alt.trim() === '' && role !== 'presentation') emptyAltNotDecorative++;
    const style = attr(t, 'style') ?? '';
    const sized = (attr(t, 'width') && attr(t, 'height')) || (/height:\s*100%/.test(style) && /width:\s*100%/.test(style)) || /aspect-ratio/.test(style);
    if (!sized) missingSize++;
  }

  const text = visibleText(html);
  const problems = textProblems(`${text}\n${descriptions.join('\n')}`, UI_LATIN, { strict: false });
  const emDashes = (text.match(/\u2014/g) ?? []).length + descriptions.reduce((n, d) => n + (d.match(/\u2014/g) ?? []).length, 0);
  const latin = [...new Set(problems.filter(p => p.code === 'latin').map(p => p.match))];
  const h1Count = tags(html, 'h1').length;
  const internalLinks = [...new Set(tags(html, 'a').map(t => toPath(attr(t, 'href') ?? '')).filter((p): p is string => !!p))];
  const brand = /BeautyFind/.test(title);
  const titleLen = [...title].length;
  const descriptionLen = [...description].length;
  return {
    url: BASE + path,
    path,
    status,
    redirectTo,
    template,
    title,
    titleLen,
    titleOk: titleLen >= 30 && titleLen <= 60 && brand,
    description,
    descriptionLen,
    descriptionOk: descriptionLen >= 110 && descriptionLen <= 160,
    canonical,
    canonicalSelf: canonical === path,
    robots,
    h1Count,
    headingSkips: headingSkips(html),
    og,
    ogOk: Object.values(og).every(Boolean),
    jsonLd: { blocks: ldBlocks.length, parseErrors, types, expectedOk, duplicateIds: dupIds },
    images: { total: imgs.length, missingAlt, emptyAltNotDecorative, missingSize },
    text: { missingInfo: problems.filter(p => p.code === 'missing_info').length, latin, dashes: emDashes, emoji: problems.filter(p => p.code === 'emoji').length, spelling: problems.filter(p => p.code === 'spelling').length },
    internalLinks,
  };
}

async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const sitemapRes = await fetch(`${BASE}/sitemap.xml`);
  const sitemap = sitemapRes.status === 200 ? await sitemapRes.text() : '';
  const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => toPath(decode(m[1]))).filter((p): p is string => !!p);
  const extra = ['/search', '/search?q=בוטוקס'];
  const seeds = [...new Set([...sitemapUrls, ...extra])].slice(0, MAX);

  const t0 = Date.now();
  const pages = await pool(seeds, CONCURRENCY, async path => {
    try {
      const r = await fetchPage(path);
      return analyse(path, r.status, r.redirectTo, r.html);
    } catch (e) {
      return analyse(path, 0, null, '');
    }
  });
  const inSitemap = new Set(sitemapUrls);

  // Inbound links per profile from the pages crawled (sitemap pages plus search).
  const inbound = new Map<string, Set<string>>();
  for (const p of pages) for (const l of p.internalLinks) {
    const target = l.split('?')[0];
    if (target === p.path) continue;
    if (!inbound.has(target)) inbound.set(target, new Set());
    inbound.get(target)!.add(p.path);
  }
  const profiles = pages.filter(p => p.template === 'profile' && inSitemap.has(p.path));
  const weakProfiles = profiles.map(p => ({ path: p.path, inbound: inbound.get(p.path)?.size ?? 0 })).filter(p => p.inbound < 3);
  const redirecting = pages.filter(p => p.internalLinks.some(l => pages.find(q => q.path === l)?.redirectTo));
  const linksToRedirects = new Set(pages.flatMap(p => p.internalLinks.filter(l => pages.find(q => q.path === l)?.redirectTo)));

  const sm = pages.filter(p => inSitemap.has(p.path));
  const summary = {
    label: LABEL,
    base: BASE,
    at: new Date().toISOString(),
    seconds: Math.round((Date.now() - t0) / 1000),
    sitemapUrls: sitemapUrls.length,
    sitemap200: sm.filter(p => p.status === 200).length,
    sitemapRedirects: sm.filter(p => p.status >= 300 && p.status < 400).length,
    sitemapErrors: sm.filter(p => p.status === 0 || p.status >= 400).length,
    sitemapSelfCanonical: sm.filter(p => p.status === 200 && p.canonicalSelf).length,
    pagesCrawled: pages.length,
    titleOk: sm.filter(p => p.titleOk).length,
    descriptionOk: sm.filter(p => p.descriptionOk).length,
    oneH1: sm.filter(p => p.h1Count === 1).length,
    headingSkips: sm.filter(p => p.headingSkips > 0).length,
    ogOk: sm.filter(p => p.ogOk).length,
    jsonLdOk: sm.filter(p => p.jsonLd.parseErrors === 0 && p.jsonLd.expectedOk && p.jsonLd.duplicateIds.length === 0).length,
    imagesMissingAlt: sm.reduce((n, p) => n + p.images.missingAlt + p.images.emptyAltNotDecorative, 0),
    imagesMissingSize: sm.reduce((n, p) => n + p.images.missingSize, 0),
    textMissingInfo: sm.reduce((n, p) => n + p.text.missingInfo, 0),
    textLatin: sm.reduce((n, p) => n + p.text.latin.length, 0),
    textDashes: sm.reduce((n, p) => n + p.text.dashes, 0),
    textEmoji: sm.reduce((n, p) => n + p.text.emoji, 0),
    linksToRedirectingUrls: linksToRedirects.size,
    pagesLinkingToRedirects: redirecting.length,
    profiles: profiles.length,
    profilesUnder3Inbound: weakProfiles.length,
  };

  const file = join(OUT, `seo-verify-${LABEL}`);
  writeFileSync(`${file}.json`, JSON.stringify({ summary, weakProfiles, linksToRedirects: [...linksToRedirects], pages }, null, 1));

  const rows: Array<[string, string | number]> = [
    ['Sitemap URLs', summary.sitemapUrls],
    ['Sitemap URLs answering 200', summary.sitemap200],
    ['Sitemap URLs redirecting', summary.sitemapRedirects],
    ['Sitemap URLs erroring', summary.sitemapErrors],
    ['Sitemap URLs with self canonical', summary.sitemapSelfCanonical],
    ['Titles 30 to 60 chars with brand', `${summary.titleOk}/${sm.length}`],
    ['Descriptions 110 to 160 chars', `${summary.descriptionOk}/${sm.length}`],
    ['Exactly one H1', `${summary.oneH1}/${sm.length}`],
    ['Pages with a skipped heading level', summary.headingSkips],
    ['Open Graph and Twitter complete', `${summary.ogOk}/${sm.length}`],
    ['JSON-LD parses with expected types, no duplicate @id', `${summary.jsonLdOk}/${sm.length}`],
    ['Images without alt (empty allowed only when decorative)', summary.imagesMissingAlt],
    ['Images without width and height', summary.imagesMissingSize],
    ['Text: sentences about missing data', summary.textMissingInfo],
    ['Text: English words inside Hebrew (distinct per page)', summary.textLatin],
    ['Text: em dashes', summary.textDashes],
    ['Text: emoji', summary.textEmoji],
    ['Internal links pointing at redirecting URLs', summary.linksToRedirectingUrls],
    ['Profiles with fewer than 3 inbound links', `${summary.profilesUnder3Inbound}/${summary.profiles}`],
  ];
  let md = `# SEO verification: ${LABEL}\n\n${BASE} at ${summary.at}, ${summary.pagesCrawled} pages in ${summary.seconds}s\n\n| Check | Value |\n|---|---|\n${rows.map(r => `| ${r[0]} | ${r[1]} |`).join('\n')}\n`;
  if (COMPARE) {
    const before = JSON.parse(readFileSync(COMPARE, 'utf8')) as { summary: typeof summary };
    const b = before.summary;
    const cmp: Array<[string, string | number, string | number]> = [
      ['Sitemap URLs', b.sitemapUrls, summary.sitemapUrls],
      ['Sitemap URLs redirecting', b.sitemapRedirects, summary.sitemapRedirects],
      ['Sitemap URLs with self canonical', b.sitemapSelfCanonical, summary.sitemapSelfCanonical],
      ['Titles in range with brand', b.titleOk, summary.titleOk],
      ['Descriptions in range', b.descriptionOk, summary.descriptionOk],
      ['Exactly one H1', b.oneH1, summary.oneH1],
      ['Pages with skipped heading levels', b.headingSkips, summary.headingSkips],
      ['Open Graph and Twitter complete', b.ogOk, summary.ogOk],
      ['JSON-LD ok', b.jsonLdOk, summary.jsonLdOk],
      ['Images without alt', b.imagesMissingAlt, summary.imagesMissingAlt],
      ['Images without size', b.imagesMissingSize, summary.imagesMissingSize],
      ['Text: missing-data sentences', b.textMissingInfo, summary.textMissingInfo],
      ['Text: English inside Hebrew', b.textLatin, summary.textLatin],
      ['Text: dashes', b.textDashes, summary.textDashes],
      ['Links to redirecting URLs', b.linksToRedirectingUrls, summary.linksToRedirectingUrls],
      ['Profiles under 3 inbound links', b.profilesUnder3Inbound, summary.profilesUnder3Inbound],
    ];
    md += `\n## Before (${b.label}) and after (${LABEL})\n\n| Check | Before | After |\n|---|---|---|\n${cmp.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} |`).join('\n')}\n`;
  }
  const worst = sm.filter(p => !p.titleOk || !p.descriptionOk || p.h1Count !== 1 || !p.ogOk || p.images.missingAlt + p.images.emptyAltNotDecorative > 0 || p.text.missingInfo > 0 || p.text.latin.length > 0 || p.redirectTo).slice(0, 40);
  if (worst.length) {
    md += `\n## Pages with findings (first ${worst.length})\n\n| Path | Status | Title | Desc | H1 | OG | Alt | Missing-data | Latin |\n|---|---|---|---|---|---|---|---|---|\n`;
    md += worst.map(p => `| ${p.path} | ${p.status}${p.redirectTo ? ` -> ${p.redirectTo}` : ''} | ${p.titleLen} | ${p.descriptionLen} | ${p.h1Count} | ${p.ogOk ? 'ok' : 'missing'} | ${p.images.missingAlt + p.images.emptyAltNotDecorative} | ${p.text.missingInfo} | ${p.text.latin.slice(0, 4).join(' ')} |`).join('\n');
    md += '\n';
  }
  if (weakProfiles.length) md += `\n## Profiles with fewer than 3 inbound links\n\n${weakProfiles.map(p => `- ${p.path} (${p.inbound})`).join('\n')}\n`;
  writeFileSync(`${file}.md`, md);
  console.log(md);
  console.log(`written ${file}.json and ${file}.md`);
}

main().catch(e => {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
