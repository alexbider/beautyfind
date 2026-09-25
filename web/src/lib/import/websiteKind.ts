// What a "website" value really is. A listing's website may be the business's own site or its own
// social profile. Directories, marketplaces, maps, health-fund pages and other unrelated sites are
// never kept as the website. Booking pages and WhatsApp links go to their own fields instead.

import { nameSimilarity, normName } from './match';
import { normalizeIlPhone } from './phone';

export type WebsiteKind = 'own' | 'social' | 'linkhub' | 'booking' | 'whatsapp' | 'directory' | 'invalid';

export interface WebsiteClass {
  kind: WebsiteKind;
  url: string | null; // normalized URL (null for invalid)
  network?: string; // for social
  phone?: string; // for whatsapp
}

const host = (u: URL) => u.hostname.toLowerCase().replace(/^(www|m|he|he-il|mobile)\./, '');
const on = (h: string, list: RegExp) => list.test(h);

// Link-in-bio pages belong to the business and point at its real site, socials and booking.
const LINKHUBS = /(^|\.)(linktr\.ee|beacons\.ai|taplink\.cc|linkin\.bio|bio\.link|lnk\.bio|msha\.ke|campsite\.bio|linkr\.bio|solo\.to|carrd\.co|koji\.to)$/;

export const BOOKING_HOSTS = /(^|\.)(tor4you\.co\.il|mytor\.co\.il|calendly\.com|setmore\.com|fresha\.com|booksy\.com|simplybook\.(me|it)|vagaro\.com|easyapp\.co\.il|bizonline\.co\.il|picktime\.com|appointy\.com|zappix\.com|tori\.co\.il|toor\.co\.il|easytor\.co\.il|tor\.co\.il|booker\.co\.il|squareup\.com|square\.site|acuityscheduling\.com|mindbodyonline\.com|treatwell\.[a-z.]+|planity\.com|timely\.com|gettimely\.com)$/;

// Directories, marketplaces, maps, review sites, health funds, government and other third parties.
const DIRECTORIES = new RegExp(
  '(^|\\.)(' +
    [
      // Israeli business directories and portals
      'easy\\.co\\.il', 'b144\\.co\\.il', '144\\.co\\.il', 'd\\.co\\.il', 'dapeizahav\\.co\\.il', 'zap\\.co\\.il', 'bizportal\\.co\\.il', 'rest\\.co\\.il',
      'yad2\\.co\\.il', 'madlan\\.co\\.il', 'homeless\\.co\\.il', 'mouse\\.co\\.il', 'golan\\.co\\.il', 'israelbiz\\.co\\.il', 'bizmakebiz\\.co\\.il',
      'yellowpages\\.co\\.il', 'dapim\\.co\\.il', 'indx\\.co\\.il', 'wedding\\.co\\.il', 'mit4mit\\.co\\.il', 'weddings\\.co\\.il', 'beautyfind\\.co\\.il',
      'beauty\\.co\\.il', 'cosmetica\\.co\\.il', 'mishpacha\\.co\\.il', 'ynet\\.co\\.il', 'walla\\.co\\.il', 'mako\\.co\\.il', 'haaretz\\.co\\.il',
      // medical directories and health funds
      'doctors\\.co\\.il', 'infomed\\.co\\.il', 'clalit\\.co\\.il', 'maccabi4u\\.co\\.il', 'maccabi\\.co\\.il', 'meuhedet\\.co\\.il', 'leumit\\.co\\.il',
      'medicalmarketing\\.co\\.il', 'rofim\\.org\\.il', 'doctorim\\.co\\.il', 'zimuni\\.co\\.il', 'health\\.gov\\.il', 'gov\\.il',
      // international directories, maps, reviews, delivery
      'google\\.[a-z.]+', 'goo\\.gl', 'g\\.page', 'g\\.co', 'business\\.site', 'maps\\.app\\.goo\\.gl', 'waze\\.com', 'apple\\.com', 'bing\\.com',
      'yelp\\.[a-z.]+', 'tripadvisor\\.[a-z.]+', 'foursquare\\.com', 'yellowpages\\.com', 'cylex\\.[a-z.]+', 'hotfrog\\.[a-z.]+', 'infobel\\.com',
      'wolt\\.com', '10bis\\.co\\.il', 'booking\\.com', 'airbnb\\.[a-z.]+', 'groupon\\.[a-z.]+', 'buyme\\.co\\.il', 'giftcard\\.co\\.il',
      'wikipedia\\.org', 'amazon\\.[a-z.]+', 'aliexpress\\.com', 'ebay\\.[a-z.]+', 'etsy\\.com',
      // hosting placeholders and shorteners
      'bit\\.ly', 'tinyurl\\.com', 'ow\\.ly', 'did\\.li', 'example\\.com',
    ].join('|') +
    ')$',
);

// Social networks that host business profiles; profile paths are validated by socialOf().
const SOCIAL = /(^|\.)(facebook\.com|fb\.com|instagram\.com|tiktok\.com|youtube\.com)$/;
const OTHER_SOCIAL = /(^|\.)(t\.me|telegram\.me|twitter\.com|x\.com|linkedin\.com|pinterest\.[a-z.]+|threads\.net)$/;

/** A social profile URL (not a share, post or plugin link), normalized. */
export function socialOf(href: string): { network: string; url: string } | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|he-il|he)\./, '');
  const first = u.pathname.split('/').filter(Boolean)[0] ?? '';
  if (!first) return null;
  if (host === 'instagram.com' && !['p', 'reel', 'reels', 'explore', 'accounts', 'stories'].includes(first)) return { network: 'instagram', url: `https://www.instagram.com/${first}` };
  if (host === 'facebook.com' || host === 'fb.com') {
    if (['sharer', 'sharer.php', 'share', 'plugins', 'tr', 'dialog', 'login', 'groups', 'events', 'watch', 'photo', 'photo.php', 'story.php', 'hashtag', 'search', 'reel', 'reels', 'permalink.php', 'home.php', 'l.php'].includes(first)) return null;
    if (first === 'profile.php') {
      const id = u.searchParams.get('id');
      return id && /^\d+$/.test(id) ? { network: 'facebook', url: `https://www.facebook.com/profile.php?id=${id}` } : null;
    }
    // Keep the page itself, not a post under it.
    const path = first === 'pages' ? u.pathname.split('/').filter(Boolean).slice(0, 3).join('/') : first;
    return { network: 'facebook', url: `https://www.facebook.com/${path}` };
  }
  if (host === 'tiktok.com' && first.startsWith('@')) return { network: 'tiktok', url: `https://www.tiktok.com/${first}` };
  if (host === 'youtube.com' && (first.startsWith('@') || first === 'channel' || first === 'c')) return { network: 'youtube', url: `https://www.youtube.com${u.pathname}` };
  return null;
}

export function classifyWebsite(raw: string | null | undefined): WebsiteClass {
  if (!raw || !raw.trim()) return { kind: 'invalid', url: null };
  const t = raw.trim();
  // Any other scheme (mailto:, tel:, javascript:) is not a website.
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^https?:\/\//i.test(t)) return { kind: 'invalid', url: null };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
  } catch {
    return { kind: 'invalid', url: null };
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) return { kind: 'invalid', url: null };
  const h = host(u);
  if (!h.includes('.')) return { kind: 'invalid', url: null };

  if (h === 'wa.me' || h === 'api.whatsapp.com' || h === 'whatsapp.com' || h === 'chat.whatsapp.com') {
    const digits = h === 'wa.me' ? u.pathname.replace(/\D/g, '') : (u.searchParams.get('phone') ?? '').replace(/\D/g, '');
    const phone = normalizeIlPhone(digits ? `+${digits}` : null);
    return phone ? { kind: 'whatsapp', url: `https://wa.me/${phone.slice(1)}`, phone } : { kind: 'invalid', url: null };
  }
  if (on(h, SOCIAL)) {
    const s = socialOf(u.toString());
    return s ? { kind: 'social', url: s.url, network: s.network } : { kind: 'invalid', url: null };
  }
  if (on(h, BOOKING_HOSTS)) return { kind: 'booking', url: u.toString() };
  if (on(h, LINKHUBS)) return u.pathname.length > 1 ? { kind: 'linkhub', url: u.toString() } : { kind: 'invalid', url: null };
  if (h === 'sites.google.com') return { kind: 'own', url: `${u.origin}${u.pathname}` };
  if (on(h, DIRECTORIES) || on(h, OTHER_SOCIAL)) return { kind: 'directory', url: u.toString() };
  // Own site: keep the origin plus a meaningful path (some businesses live under a sub-path).
  return { kind: 'own', url: u.pathname.length > 1 && !/^\/(he|en|index\.html?)\/?$/i.test(u.pathname) ? `${u.origin}${u.pathname}` : `${u.origin}/` };
}

/** Kinds that may be stored as the listing's website. */
export const KEEP_AS_WEBSITE: WebsiteKind[] = ['own', 'social', 'linkhub'];
/** Kinds whose pages we read. Social profiles are kept as links but not read (login walls, terms). */
export const CRAWLABLE: WebsiteKind[] = ['own', 'linkhub'];

/**
 * Does this site belong to this business? "yes" on a matching phone (site or WhatsApp) or name;
 * "no" when the site shows phones and none match, and the name does not match either;
 * "unknown" when the site gives nothing to compare (kept, flagged for review).
 */
export function siteBelongs(p: { name: string; phone: string | null }, s: { phones: Array<{ value: string }>; whatsapp: Array<{ value: string }>; names: string[] }, host: string | null): 'yes' | 'no' | 'unknown' {
  if (p.phone && (s.phones.some(f => f.value === p.phone) || s.whatsapp.some(f => f.value === p.phone))) return 'yes';
  const tokens = normName(p.name).split(' ').filter(t => t.length >= 3);
  const names = [...s.names, host ?? ''];
  if (s.names.some(n => nameSimilarity(n, p.name) >= 0.5)) return 'yes';
  if (tokens.some(t => names.some(n => normName(n).includes(t) || n.toLowerCase().includes(t)))) return 'yes';
  // Only a site with phones of its own is judged unrelated; a title alone is too weak to drop a site.
  return s.phones.length ? 'no' : 'unknown';
}
