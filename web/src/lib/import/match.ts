// Duplicate detection. Used by the worker (import vs import, import vs live listings) and by the
// review screen to explain a match. Scores are 0..1 with the reasons that produced them.

import { distanceKm } from './geo';
import { FREE_MAIL, emailDomain, siteHost } from './email';

// Words that say what a business is, not which one it is.
const NOISE = [
  'מכון', 'מכוני', 'סלון', 'סטודיו', 'קליניקה', 'קליניקת', 'מרכז', 'ספא', 'יופי', 'קוסמטיקה', 'טיפוח', 'בע"מ', 'בעמ', 'בית',
  'המספרה', 'מספרה', 'מספרת', 'של', 'ה', 'ו', 'ב', 'ל',
  'beauty', 'salon', 'studio', 'clinic', 'center', 'centre', 'spa', 'the', 'by', 'and', 'ltd', 'hair', 'nails', 'aesthetics', 'cosmetics',
];
const NOISE_SET = new Set(NOISE);

export function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '')
    .replace(/['"׳״`’]/g, '')
    .replace(/[^a-z0-9א-ת]+/g, ' ')
    .split(' ')
    // Generic words, also with the Hebrew article or "and"/"of" prefix attached (היופי, והספא).
    .filter(w => w && !NOISE_SET.has(w) && !(/^[הוש]/.test(w) && w.length > 2 && NOISE_SET.has(w.slice(1))))
    .join(' ')
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/\s+/g, ' ');
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Dice coefficient on character bigrams of the normalised names, 0..1. */
export function nameSimilarity(a: string, b: string): number {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return 0;
  // "סטודיו 1" and "סטודיו 3" are two branches, not one business.
  const dx = (x.match(/\d+/g) ?? []).join(' ');
  const dy = (y.match(/\d+/g) ?? []).join(' ');
  if (dx !== dy && (dx || dy)) return Math.min(0.4, diceOf(x, y));
  if (x === y) return 1;
  return diceOf(x, y);
}

function diceOf(x: string, y: string): number {
  if (x.length < 2 || y.length < 2) return 0;
  const A = bigrams(x);
  const B = bigrams(y);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  const total = [...A.values()].reduce((s, n) => s + n, 0) + [...B.values()].reduce((s, n) => s + n, 0);
  return (2 * inter) / total;
}

// Hosts shared by thousands of unrelated businesses: never evidence of a match.
const SHARED_HOSTS = /(^|\.)(facebook\.com|instagram\.com|linktr\.ee|wa\.me|wix\.com|wixsite\.com|business\.site|google\.com|goo\.gl|tiktok\.com|easy\.co\.il|b144\.co\.il|d\.co\.il|calendly\.com|setmore\.com|tor4you\.co\.il|mytor\.co\.il|bizonline\.co\.il)$/i;

export const usefulHost = (url: string | null | undefined) => {
  const h = siteHost(url);
  return h && !SHARED_HOSTS.test(h) ? h : null;
};

export interface Comparable {
  name: string;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  googlePlaceId?: string | null;
}

export interface MatchResult {
  score: number;
  reasons: string[];
}

/** How likely two records are the same business. */
export function scoreMatch(a: Comparable, b: Comparable): MatchResult {
  const reasons: string[] = [];
  if (a.googlePlaceId && b.googlePlaceId && a.googlePlaceId === b.googlePlaceId) return { score: 1, reasons: ['same_place_id'] };
  let score = 0;
  const sim = nameSimilarity(a.name, b.name);
  const dist = a.lat != null && a.lng != null && b.lat != null && b.lng != null ? distanceKm(a.lat, a.lng, b.lat, b.lng) : null;
  if (a.phone && b.phone && a.phone === b.phone) {
    score += 0.55;
    reasons.push('same_phone');
  }
  if (a.email && b.email && a.email === b.email) {
    // A shared gmail can belong to one owner with two businesses; still strong evidence.
    score += FREE_MAIL.has(emailDomain(a.email)) ? 0.35 : 0.45;
    reasons.push('same_email');
  }
  const ha = usefulHost(a.website);
  if (ha && ha === usefulHost(b.website)) {
    score += 0.4;
    reasons.push('same_website');
  }
  if (sim >= 0.9) {
    score += 0.35;
    reasons.push('same_name');
  } else if (sim >= 0.7) {
    score += 0.2;
    reasons.push('similar_name');
  }
  if (dist != null) {
    if (dist <= 0.08) {
      score += 0.25;
      reasons.push('same_address');
    } else if (dist <= 0.3) {
      score += 0.1;
      reasons.push('nearby');
    } else if (dist > 5 && reasons.includes('same_phone') && sim < 0.7) {
      // Same number, different town and name: a franchise call centre, not the same branch.
      score -= 0.4;
      reasons.push('far_apart');
    }
  }
  return { score: Math.max(0, Math.min(1, score)), reasons };
}

/** At or above this, two import records are the same business and the later one is set aside. */
export const DUPLICATE_AT = 0.8;
/** An automatic duplicate also needs one of these; anything weaker goes to a person. */
export const STRONG = ['same_place_id', 'same_phone', 'same_email'];
/**
 * Strong enough to set a record aside automatically: the same source id, or a shared phone/email AND a
 * matching name. A shared domain or a chain's central phone alone never merges two branches.
 */
export const isStrong = (reasons: string[]) =>
  reasons.includes('same_place_id') ||
  ((reasons.includes('same_phone') || reasons.includes('same_email')) && (reasons.includes('same_name') || reasons.includes('similar_name')));
/** At or above this, an import record may already be a live listing and needs a human decision. */
export const POSSIBLE_MATCH_AT = 0.45;

export interface PoolItem extends Comparable {
  id: string;
  kind: 'import' | 'branch';
}

const cellOf = (lat: number, lng: number) => [Math.floor(lat / 0.004), Math.floor(lng / 0.005)] as const;

/** In-memory index so every record is compared only with plausible candidates. */
export class MatchPool {
  private byPhone = new Map<string, PoolItem[]>();
  private byEmail = new Map<string, PoolItem[]>();
  private byHost = new Map<string, PoolItem[]>();
  private byCell = new Map<string, PoolItem[]>();
  private byPlace = new Map<string, PoolItem>();

  private push(m: Map<string, PoolItem[]>, k: string | null | undefined, v: PoolItem) {
    if (!k) return;
    const list = m.get(k);
    if (list) list.push(v);
    else m.set(k, [v]);
  }

  add(item: PoolItem) {
    this.push(this.byPhone, item.phone, item);
    this.push(this.byEmail, item.email, item);
    this.push(this.byHost, usefulHost(item.website), item);
    if (item.lat != null && item.lng != null) this.push(this.byCell, cellOf(item.lat, item.lng).join(','), item);
    if (item.googlePlaceId) this.byPlace.set(item.googlePlaceId, item);
  }

  candidates(c: Comparable): PoolItem[] {
    const out = new Set<PoolItem>();
    if (c.googlePlaceId) {
      const p = this.byPlace.get(c.googlePlaceId);
      if (p) out.add(p);
    }
    for (const x of (c.phone && this.byPhone.get(c.phone)) || []) out.add(x);
    for (const x of (c.email && this.byEmail.get(c.email)) || []) out.add(x);
    const h = usefulHost(c.website);
    for (const x of (h && this.byHost.get(h)) || []) out.add(x);
    if (c.lat != null && c.lng != null) {
      const [a, b] = cellOf(c.lat, c.lng);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const x of this.byCell.get(`${a + i},${b + j}`) ?? []) out.add(x);
    }
    return [...out];
  }

  /** Best candidate by score, ignoring `selfId`. */
  best(c: Comparable, selfId?: string): { item: PoolItem; score: number; reasons: string[] } | null {
    let top: { item: PoolItem; score: number; reasons: string[] } | null = null;
    for (const item of this.candidates(c)) {
      if (item.id === selfId) continue;
      const m = scoreMatch(c, item);
      if (m.score > 0 && (!top || m.score > top.score)) top = { item, ...m };
    }
    return top;
  }

  /** Another record with the same phone that is not the same business (score below duplicate). */
  sharesPhone(c: Comparable, selfId: string, notIds: Set<string>): boolean {
    return ((c.phone && this.byPhone.get(c.phone)) || []).some(x => x.id !== selfId && !notIds.has(x.id));
  }
}
