// Chains and franchises. Several import records that share one business website (proportsia.co.il with
// branches in Tel Aviv, Haifa and Ramat Gan) are one business with several branches, not several
// businesses. The website domain is the chain key; a name check keeps two unrelated businesses that
// happen to share a hosting domain apart.

import { nameSimilarity, normName, usefulHost } from './match';

/** The chain key of an import record: its own website's domain, when it has one worth the name. */
export function chainKeyOf(p: { website: string | null; websiteKind?: string | null; siteDomain?: string | null }): string | null {
  if (p.websiteKind && p.websiteKind !== 'own') return null;
  const host = (p.siteDomain ?? usefulHost(p.website))?.toLowerCase().replace(/^www\./, '') ?? null;
  return host && host.includes('.') ? host : null;
}

/**
 * Two branch names that belong to one chain: the same first distinctive word ("פרופורציה תל אביב" and
 * "פרופורציה חיפה"), or names that are mostly alike after the generic words are dropped.
 */
export function sameChain(a: string, b: string): boolean {
  const x = normName(a).split(' ').filter(Boolean);
  const y = normName(b).split(' ').filter(Boolean);
  if (!x.length || !y.length) return false;
  if (x[0] === y[0] && x[0].length >= 3) return true;
  return nameSimilarity(a, b) >= 0.5;
}

