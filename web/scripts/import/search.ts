// Web search for a business that has no email yet (Brave Search API, BRAVE_SEARCH_API_KEY).
// Looks for its email and its Facebook or Instagram page in Israeli results.
//
// Only trusted when the result clearly belongs to the business: the result is on its own website or
// social page, or the title names the business. Emails found this way are marked "search" and
// always go to a person for review.

import { cleanEmail, extractEmails, siteHost } from '../../src/lib/import/email';
import { nameSimilarity } from '../../src/lib/import/match';

const KEY = process.env.BRAVE_SEARCH_API_KEY?.trim();

export interface SearchFind {
  emails: string[];
  facebook: string | null;
  instagram: string | null;
  status: string;
}

interface BraveResult {
  url: string;
  title?: string;
  description?: string;
  extra_snippets?: string[];
}

const strip = (s: string) => s.replace(/<[^>]+>/g, ' ');

export async function searchBusiness(b: { name: string; city: string | null; website: string | null }): Promise<SearchFind> {
  const out: SearchFind = { emails: [], facebook: null, instagram: null, status: 'disabled' };
  if (!KEY) return out;
  const q = `"${b.name}" ${b.city ?? ''} אימייל OR email OR "צור קשר"`.trim();
  const url = `${process.env.SEARCH_BASE_URL || 'https://api.search.brave.com'}/res/v1/web/search?q=${encodeURIComponent(q)}&country=IL&search_lang=he&count=10&extra_snippets=true`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': KEY }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { ...out, status: `http_${res.status}` };
    const data = (await res.json()) as { web?: { results?: BraveResult[] } };
    const own = siteHost(b.website);
    const emails = new Set<string>();
    for (const r of data.web?.results ?? []) {
      const host = siteHost(r.url) ?? '';
      const title = strip(r.title ?? '');
      const named = nameSimilarity(title.split(/[|\-–]/)[0] ?? title, b.name) >= 0.6 || nameSimilarity(title, b.name) >= 0.6;
      const isOwn = !!own && (host === own || host.endsWith('.' + own));
      if (/(^|\.)facebook\.com$/.test(host) && named && !out.facebook && !/\/(posts|photos|groups|events)\//.test(r.url)) out.facebook = r.url.split('?')[0];
      if (/(^|\.)instagram\.com$/.test(host) && named && !out.instagram && !/\/(p|reel|explore)\//.test(r.url)) out.instagram = r.url.split('?')[0];
      if (!isOwn && !named) continue; // someone else's page: its emails are not this business's
      const text = strip([r.description ?? '', ...(r.extra_snippets ?? [])].join(' '));
      for (const e of extractEmails(text)) {
        const c = cleanEmail(e);
        if (c) emails.add(c);
      }
    }
    return { ...out, emails: [...emails], status: 'ok' };
  } catch (e) {
    return { ...out, status: e instanceof Error ? e.name : 'failed' };
  }
}
