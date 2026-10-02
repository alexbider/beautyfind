import 'server-only';
import type { Metadata } from 'next';
import { CATEGORIES, REGIONS } from '@/lib/catalog';
import { pathIndexable } from '@/lib/indexing';
import { db } from './db';
import { indexingPolicy } from './indexing';

// Per-path SEO overrides edited on /ops/content. A public page builds its own metadata as before and
// passes it through `applySeo(path, metadata)`: a saved title, description or noindex for that path
// wins; nothing saved means nothing changes. One small query per page render, cached by Next's
// page revalidation.

export async function seoOverride(path: string) {
  try {
    return await db.pageSeo.findUnique({ where: { path } });
  } catch {
    return null;
  }
}

/**
 * The saved override for the path plus the indexing policy (src/lib/indexing.ts): a page whose section is
 * switched off, a page marked noindex by staff, or `opts.noindex` (a listing hidden by staff) gets a
 * noindex robots tag; a page's own robots metadata (search results, filtered directories) stays as it is.
 */
export async function applySeo(path: string, base: Metadata, opts: { noindex?: boolean } = {}): Promise<Metadata> {
  const [o, policy] = await Promise.all([seoOverride(path), indexingPolicy()]);
  const out: Metadata = { ...base };
  if (o?.title) {
    out.title = { absolute: o.title };
    if (out.openGraph) out.openGraph = { ...out.openGraph, title: o.title };
    if (out.twitter) out.twitter = { ...out.twitter, title: o.title };
  }
  if (o?.description) {
    out.description = o.description;
    if (out.openGraph) out.openGraph = { ...out.openGraph, description: o.description };
    if (out.twitter) out.twitter = { ...out.twitter, description: o.description };
  }
  if (o?.noindex || opts.noindex || !pathIndexable(policy, path)) out.robots = { index: false, follow: true };
  return out;
}

export interface SitePage {
  path: string;
  name: string;
  kind: 'page' | 'medical' | 'region' | 'category' | 'legal';
  defaultTitle: string;
  defaultDescription: string | null;
  keywordHint: string;
}

/** The public pages staff can tune (dynamic listing pages are tuned per business, not here). */
export function sitePages(): SitePage[] {
  const out: SitePage[] = [
    { path: '/', name: 'דף הבית', kind: 'page', defaultTitle: 'BeautyFind · מכוני יופי וקליניקות אסתטיקה בישראל', defaultDescription: 'מצאו מכוני יופי, קליניקות לאסתטיקה רפואית, מספרות וספא בכל רחבי ישראל.', keywordHint: 'קליניקות אסתטיקה' },
    { path: '/treatments', name: 'טיפולים', kind: 'page', defaultTitle: '14 תחומי טיפול', defaultDescription: '14 תחומי הטיפול באינדקס BeautyFind, מחירים חציוניים ומי מורשה לבצע כל טיפול.', keywordHint: 'טיפולים אסתטיים' },
    { path: '/regions', name: 'אזורים', kind: 'page', defaultTitle: 'אזורים', defaultDescription: null, keywordHint: 'יופי לפי אזור' },
    { path: '/search', name: 'חיפוש', kind: 'page', defaultTitle: 'חיפוש', defaultDescription: null, keywordHint: '' },
    { path: '/about', name: 'אודות', kind: 'page', defaultTitle: 'אודות BeautyFind', defaultDescription: null, keywordHint: '' },
    { path: '/about/methodology', name: 'מתודולוגיה', kind: 'page', defaultTitle: 'איך אנחנו מדרגים', defaultDescription: null, keywordHint: 'אימות רופאים' },
    { path: '/about/editorial', name: 'מדיניות העריכה', kind: 'page', defaultTitle: 'מדיניות העריכה', defaultDescription: null, keywordHint: '' },
    { path: '/listing-standards', name: 'סטנדרטים ואימות', kind: 'page', defaultTitle: 'סטנדרטים לרישום', defaultDescription: null, keywordHint: 'אימות רופאים' },
    { path: '/listing-standards/sponsorship', name: 'מדיניות מקומות ממומנים', kind: 'page', defaultTitle: 'מקומות ממומנים', defaultDescription: null, keywordHint: '' },
    { path: '/for-business', name: 'הצטרפות לעסקים', kind: 'page', defaultTitle: 'BeautyFind לעסקים', defaultDescription: null, keywordHint: 'פרסום קליניקה' },
    { path: '/magazine', name: 'מגזין', kind: 'page', defaultTitle: 'המגזין', defaultDescription: null, keywordHint: '' },
    { path: '/help', name: 'עזרה', kind: 'page', defaultTitle: 'עזרה', defaultDescription: null, keywordHint: '' },
    { path: '/contact', name: 'יצירת קשר', kind: 'page', defaultTitle: 'יצירת קשר', defaultDescription: null, keywordHint: '' },
    { path: '/accessibility', name: 'הצהרת נגישות', kind: 'legal', defaultTitle: 'הצהרת נגישות', defaultDescription: null, keywordHint: '' },
    { path: '/terms', name: 'תקנון', kind: 'legal', defaultTitle: 'תקנון', defaultDescription: null, keywordHint: '' },
    { path: '/privacy', name: 'מדיניות פרטיות', kind: 'legal', defaultTitle: 'מדיניות פרטיות', defaultDescription: null, keywordHint: '' },
    ...REGIONS.map(r => ({ path: `/${r.slug}`, name: r.name, kind: 'region' as const, defaultTitle: `יופי ואסתטיקה ב${r.name}`, defaultDescription: `עסקי יופי ואסתטיקה ב${r.name}: עסקים, מחירים חציוניים והעסקים המדורגים ביותר באזור.`, keywordHint: `קליניקות ב${r.name}` })),
    ...CATEGORIES.map(c => ({ path: `/treatments/${c.slug}`, name: c.name, kind: (/רפואי|הזרקות|לייזר/u.test(c.group) || /רפואי|הזרקות|לייזר/u.test(c.name) ? 'medical' : 'category') as SitePage['kind'], defaultTitle: `${c.name} בישראל`, defaultDescription: `${c.name} בישראל: מה כולל התחום, מחירים חציוניים, מי מורשה לבצע, והעסקים המדורגים ביותר בכל אזור.`, keywordHint: c.name })),
  ];
  return out;
}

/** A simple, explainable SEO score (0 to 100) for a page from its effective title, description, keyword and index state. */
export function seoScore(p: { title: string; description: string | null; keyword: string | null; noindex: boolean; path: string }): { score: number; notes: string[] } {
  const notes: string[] = [];
  let score = 0;
  const t = [...p.title].length;
  if (t >= 25 && t <= 65) score += 30; else { score += 10; notes.push(t < 25 ? 'כותרת קצרה מ־25 תווים' : 'כותרת ארוכה מ־65 תווים'); }
  const d = p.description ? [...p.description].length : 0;
  if (d >= 70 && d <= 160) score += 30; else if (d) { score += 12; notes.push(d < 70 ? 'תיאור קצר מ־70 תווים' : 'תיאור ארוך מ־160 תווים'); } else notes.push('ללא תיאור מותאם');
  if (p.keyword) {
    score += 10;
    if (p.title.includes(p.keyword)) score += 15; else notes.push('מילת המפתח לא בכותרת');
    if (p.description?.includes(p.keyword)) score += 10; else notes.push('מילת המפתח לא בתיאור');
  } else notes.push('לא הוגדרה מילת מפתח');
  if (!p.noindex) score += 5; else notes.push('noindex');
  return { score: Math.min(100, score), notes };
}
