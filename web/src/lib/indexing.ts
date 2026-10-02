import { CATEGORIES, REGIONS } from './catalog'; // relative: next.config.ts loads this file without the "@/" alias

// What search engines may index, decided in one place. Two layers:
//   1. Private areas (admin, business dashboard, clinic system, accounts, token pages, API) are never
//      indexed: robots.txt disallows them, every response carries X-Robots-Tag: noindex (next.config.ts),
//      and their layouts declare robots noindex. Nothing in the admin can open them.
//   2. Public sections are switched on /ops/content (tab אינדוקס) and stored in platform settings:
//      one master switch for the whole site and one per section. A section that is off keeps serving
//      pages, but with a noindex robots tag and without them in the sitemap. Single pages can also be
//      excluded (PageSeo.noindex) and so can single listings (Branch.noindex).
// This module is pure so the tests and the client can import it; the server reads the saved policy
// in src/lib/server/indexing.ts.

export const INDEX_SECTION_KEYS = ['home', 'regions', 'cities', 'categories', 'cityCategories', 'profiles', 'content', 'legal'] as const;
export type IndexSectionKey = (typeof INDEX_SECTION_KEYS)[number];

export interface IndexSection { key: IndexSectionKey; name: string; desc: string; example: string }

export const INDEX_SECTIONS: IndexSection[] = [
  { key: 'home', name: 'דף הבית', desc: 'העמוד הראשי של האתר', example: '/' },
  { key: 'regions', name: 'עמודי אזורים', desc: 'שבעת עמודי האזור ועמוד כל האזורים', example: '/dan' },
  { key: 'cities', name: 'עמודי ערים', desc: 'עמוד לכל עיר שיש בה עסקים חיים', example: '/dan/ramat-gan' },
  { key: 'categories', name: 'תחומי טיפול', desc: 'עמוד הטיפולים ו־14 עמודי התחומים', example: '/treatments/facials' },
  { key: 'cityCategories', name: 'עיר + תחום', desc: 'עמוד לכל צירוף של עיר ותחום שיש בו עסקים חיים', example: '/dan/ramat-gan/facials' },
  { key: 'profiles', name: 'פרופילי עסקים', desc: 'עמוד הפרופיל של כל עסק חי; עסק בודד אפשר להסתיר בעורך הסניף', example: '/dan/facials/studio-lin' },
  { key: 'content', name: 'עמודי תוכן', desc: 'אודות, מתודולוגיה, עריכה, סטנדרטים, הצטרפות לעסקים, מגזין, עזרה, יצירת קשר', example: '/about' },
  { key: 'legal', name: 'עמודים משפטיים', desc: 'תקנון, מדיניות פרטיות, הצהרת נגישות', example: '/privacy' },
];

/** Areas that are never indexed. The list feeds robots.txt and the X-Robots-Tag header. */
export const PRIVATE_AREAS: Array<{ prefix: string; name: string }> = [
  { prefix: '/ops', name: 'ניהול ראשי' },
  { prefix: '/biz', name: 'לוח הבקרה לעסקים' },
  { prefix: '/clinic', name: 'מערכת הקליניקה' },
  { prefix: '/account', name: 'חשבון לקוח' },
  { prefix: '/saved', name: 'מועדפים והשוואה' },
  { prefix: '/login', name: 'כניסה' },
  { prefix: '/logout', name: 'יציאה' },
  { prefix: '/invite', name: 'הזמנות צוות' },
  { prefix: '/for-business/join', name: 'רישום עסק' },
  { prefix: '/for-business/claim', name: 'תביעת בעלות' },
  { prefix: '/pay', name: 'תשלום' },
  { prefix: '/receipt', name: 'קבלות ומסמכים' },
  { prefix: '/unsubscribe', name: 'הסרה מדיוור' },
  { prefix: '/b/', name: 'קישורי תור ללקוחות' },
  { prefix: '/w/', name: 'הצעות מרשימת המתנה' },
  { prefix: '/review/', name: 'קישורי ביקורת' },
  { prefix: '/api', name: 'API' },
];

export const PRIVATE_PREFIXES = PRIVATE_AREAS.map(a => a.prefix);

/** True for any path inside a private area. A prefix ending with "/" matches only below it. */
export function isPrivatePath(path: string): boolean {
  return PRIVATE_PREFIXES.some(p => (p.endsWith('/') ? path.startsWith(p) : path === p || path.startsWith(p + '/')));
}

const CONTENT_PATHS = new Set(['/about', '/about/methodology', '/about/editorial', '/listing-standards', '/listing-standards/sponsorship', '/for-business', '/magazine', '/help', '/contact']);
const LEGAL_PATHS = new Set(['/privacy', '/terms', '/accessibility']);
const REGION_SLUGS = new Set<string>(REGIONS.map(r => r.slug));
const CATEGORY_SLUGS = new Set<string>(CATEGORIES.map(c => c.slug));

/** The public section a path belongs to, or null for private and unknown paths. */
export function sectionOfPath(rawPath: string): IndexSectionKey | null {
  const path = decodePath(rawPath.split('?')[0].replace(/\/+$/, '') || '/');
  if (isPrivatePath(path)) return null;
  if (path === '/') return 'home';
  if (path === '/regions') return 'regions';
  if (path === '/treatments' || path.startsWith('/treatments/')) return 'categories';
  if (CONTENT_PATHS.has(path)) return 'content';
  if (LEGAL_PATHS.has(path)) return 'legal';
  const seg = path.slice(1).split('/');
  if (!REGION_SLUGS.has(seg[0])) return null;
  if (seg.length === 1) return 'regions';
  if (seg.length === 2) return 'cities';
  if (seg.length === 3) return seg[1] === 'biz' || CATEGORY_SLUGS.has(seg[1]) ? 'profiles' : 'cityCategories';
  return null;
}

function decodePath(p: string): string {
  try { return decodeURI(p); } catch { return p; }
}

export interface IndexingPolicy {
  /** STAGING=1 on the deployment: everything is blocked whatever the settings say. */
  staging: boolean;
  /** The master switch on /ops/content. */
  site: boolean;
  sections: Record<IndexSectionKey, boolean>;
}

export const OPEN_POLICY: IndexingPolicy = { staging: false, site: true, sections: Object.fromEntries(INDEX_SECTION_KEYS.map(k => [k, true])) as Record<IndexSectionKey, boolean> };

/** Whether search engines may index a path under the policy. Private and unknown paths are never indexable. */
export function pathIndexable(policy: IndexingPolicy, path: string): boolean {
  if (policy.staging || !policy.site) return false;
  const section = sectionOfPath(path);
  return section !== null && policy.sections[section] !== false;
}
