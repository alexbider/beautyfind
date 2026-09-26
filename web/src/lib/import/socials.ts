// Which social accounts belong to the business. A same-name account is not evidence: an account is
// verified when the business's own website links to it (a backlink), or when two independent signals
// agree (the handle is the site's domain label, or the provider and a link-in-bio page both name it).
// Unverified accounts are kept for review and never published.

import { socialOf } from './websiteKind';

export type SocialNetwork = 'instagram' | 'facebook' | 'tiktok' | 'youtube';
export type SocialVia = 'backlink' | 'handle_matches_domain' | 'provider_and_linkhub' | 'owner' | 'staff' | 'unverified';

export interface SocialAccount {
  url: string;
  verified: boolean;
  via: SocialVia;
  sources: string[]; // where it was seen: website | linkhub | dataforseo | owner | staff
}
export type Socials = Partial<Record<SocialNetwork, SocialAccount>>;

export interface SocialInput {
  network: string;
  url: string;
  source: 'website' | 'linkhub' | 'dataforseo' | 'owner' | 'staff';
}

const NETWORKS: SocialNetwork[] = ['instagram', 'facebook', 'tiktok', 'youtube'];

/** The account handle: instagram.com/noa_clinic -> noa_clinic, youtube.com/@noaclinic -> noaclinic. */
export function handleOf(url: string): string | null {
  try {
    const u = new URL(url);
    const first = u.pathname.split('/').filter(Boolean)[0] ?? '';
    const h = first.replace(/^@/, '').toLowerCase();
    return h && !/^(channel|c|user|p|reel|profile\.php)$/.test(h) ? h : null;
  } catch {
    return null;
  }
}

const label = (domain: string | null) => (domain ? domain.replace(/^www\./, '').split('.')[0].toLowerCase() : null);
const squash = (s: string) => s.replace(/[^a-z0-9]/g, '');

/**
 * Decides per network. `domain` is the confirmed official website's host (null when there is none).
 * Owner and staff entries are always verified (they are the source of truth for that field).
 */
export function verifySocials(inputs: SocialInput[], domain: string | null): Socials {
  const out: Socials = {};
  for (const net of NETWORKS) {
    const seen = inputs.filter(i => i.network === net && socialOf(i.url));
    if (!seen.length) continue;
    // Group by canonical URL; the most-supported account wins.
    const byUrl = new Map<string, SocialInput[]>();
    for (const s of seen) {
      const canon = socialOf(s.url)!.url;
      byUrl.set(canon, [...(byUrl.get(canon) ?? []), s]);
    }
    let best: SocialAccount | null = null;
    for (const [url, list] of byUrl) {
      const sources = [...new Set(list.map(x => x.source))];
      let via: SocialVia = 'unverified';
      if (sources.includes('owner')) via = 'owner';
      else if (sources.includes('staff')) via = 'staff';
      else if (sources.includes('website')) via = 'backlink';
      else if (sources.includes('dataforseo') && sources.includes('linkhub')) via = 'provider_and_linkhub';
      else {
        const h = handleOf(url);
        const l = label(domain);
        if (h && l && l.length >= 4 && squash(h) === squash(l)) via = 'handle_matches_domain';
      }
      const acc: SocialAccount = { url, verified: via !== 'unverified', via, sources };
      const rank = (a: SocialAccount) => (a.via === 'owner' ? 5 : a.via === 'staff' ? 4 : a.via === 'backlink' ? 3 : a.verified ? 2 : 1) * 10 + a.sources.length;
      if (!best || rank(acc) > rank(best)) best = acc;
    }
    if (best) out[net] = best;
  }
  return out;
}

/** Only accounts that may appear on the public profile. */
export const publishableSocials = (s: Socials): Partial<Record<SocialNetwork, string>> =>
  Object.fromEntries(Object.entries(s).filter(([, a]) => a?.verified).map(([k, a]) => [k, a!.url])) as Partial<Record<SocialNetwork, string>>;
