// Which enrichment steps a published listing still needs, from the template sections it is missing
// (coverage.ts) and the sources that exist for it. "All enrichments needed" in the admin means: every
// step below that can fill one of the listing's gaps and has something to work with. Pure: the worker
// (seedEnhance) and the admin (enrichQueue, the plan card) use the same rules and the same estimate.

import { apifyItemUsd, type Pricing } from './pricing';
import type { ImportSettings } from './settings';

export type StepId = 'dfs' | 'maps' | 'facebook' | 'instagram' | 'site' | 'render' | 'editorial' | 'regenerate' | 'images';

export const STEP_ORDER: StepId[] = ['dfs', 'maps', 'facebook', 'instagram', 'site', 'render', 'editorial', 'regenerate', 'images'];

export const STEP_NAME: Record<StepId, string> = {
  dfs: 'רענון DataForSEO',
  maps: 'Google Maps (Apify)',
  facebook: 'עמוד הפייסבוק (Apify)',
  instagram: 'פרופיל האינסטגרם (Apify)',
  site: 'קריאה חוזרת של האתר',
  render: 'האתר בדפדפן (Apify)',
  editorial: 'כתיבת תיאור ושאלות',
  regenerate: 'כתיבה מחדש',
  images: 'העתקת תמונות',
};

export const STEP_HINT: Record<StepId, string> = {
  dfs: 'דירוג, שעות, מאפיינים ותמונות מפרופיל Google דרך הספק. בתשלום לפי רשומה.',
  maps: 'שעות, טלפון, אתר, נגישות, חניה, התיאור של בעל העסק ותמונות הפרופיל. לעסקים עם מזהה Google.',
  facebook: 'טקסט האודות, דוא״ל, טלפון, אתר, שעות ותמונות. רק כשהעמוד עצמו מאשר את העסק (קישור לאתר או הטלפון).',
  instagram: 'אימות החשבון, הביו, קישור מהביו, תמונת פרופיל ופוסטים אחרונים. רק כשהפרופיל מאשר את העסק.',
  site: 'קריאה חוזרת של אתר העסק, מתעלמת ממטמון 30 הימים. ללא עלות ספק.',
  render: 'אתרים שהסורק שלנו לא הצליח לקרוא כי הם דורשים JavaScript. לא לאתרים שחסמו או שאוסרים סריקה.',
  editorial: 'קריאה אחת ל־Claude על חבילת הראיות; מהמטמון כשהראיות לא השתנו.',
  regenerate: 'כתיבה מחדש גם כשהראיות לא השתנו.',
  images: 'העתקת התמונות שנמצאו לאחסון שלנו (העובד צריך BLOB_READ_WRITE_TOKEN; אחרת מהכפתור בטאב).',
};

/** What is known about a listing's sources, from its import record. */
export interface PlanSignals {
  hasSite: boolean; // an own website (not a social profile or a directory)
  siteOutcome: string | null; // crawl.site
  siteThin: boolean; // read fine but empty: no services, no description, no photos (a JavaScript shell)
  placeId: boolean; // Google place id known
  cid: boolean; // DataForSEO cid known (numeric)
  instagram: boolean; // an Instagram account is named (verified or not)
  facebook: boolean;
  hasEditorial: boolean;
}

/** Sections (coverage ids) each step can help with. */
const HELPS: Record<StepId, string[]> = {
  dfs: ['rating', 'chips', 'hours', 'hero'],
  maps: ['hours', 'contact', 'chips', 'hero', 'rating', 'about', 'loc'],
  facebook: ['about', 'contact', 'hours', 'hero', 'identity', 'facts'],
  instagram: ['contact', 'hero', 'identity', 'about', 'facts'],
  site: ['hero', 'identity', 'facts', 'about', 'services', 'team', 'video', 'hours', 'faq', 'contact', 'chips'],
  render: ['hero', 'identity', 'facts', 'about', 'services', 'team', 'video', 'hours', 'faq', 'contact'],
  editorial: ['about', 'faq', 'services'],
  regenerate: [],
  images: ['hero', 'identity'],
};

export interface PlanOptions {
  settings: Pick<ImportSettings, 'dataforseoEnabled' | 'apifyEnabled' | 'apifyMaps' | 'apifyInstagram' | 'apifyFacebook' | 'apifyRender' | 'editorialEnabled' | 'killSwitch'>;
  apifyConfigured: boolean;
  allowed?: StepId[]; // staff's choice; default every step
}

const READABLE = new Set(['ok', 'no_email', 'not_modified', 'pending', '']);

/** Can this step run for this listing at all, whatever it is missing? */
export function stepApplies(step: StepId, s: PlanSignals, o: PlanOptions): boolean {
  const st = o.settings;
  const apify = st.apifyEnabled && o.apifyConfigured && !st.killSwitch;
  switch (step) {
    case 'dfs': return st.dataforseoEnabled && !st.killSwitch && s.cid;
    case 'maps': return apify && st.apifyMaps && (s.placeId || s.cid);
    case 'facebook': return apify && st.apifyFacebook && s.facebook;
    case 'instagram': return apify && st.apifyInstagram && s.instagram;
    case 'site': return s.hasSite && READABLE.has(s.siteOutcome ?? '') && !s.siteThin;
    case 'render': return apify && st.apifyRender && s.hasSite && (s.siteOutcome === 'failed' || s.siteThin);
    case 'editorial': return st.editorialEnabled;
    case 'regenerate': return st.editorialEnabled && s.hasEditorial;
    case 'images': return true;
  }
}

/**
 * The steps that can fill at least one of the listing's missing sections. `regenerate` is never part of
 * an automatic plan (it costs a call even when nothing changed); staff add it explicitly.
 */
export function planFor(missing: string[], s: PlanSignals, o: PlanOptions): StepId[] {
  const allowed = new Set(o.allowed ?? STEP_ORDER);
  const gaps = new Set(missing);
  const out: StepId[] = [];
  for (const step of STEP_ORDER) {
    if (!allowed.has(step)) continue;
    if (step === 'regenerate') continue;
    if (!stepApplies(step, s, o)) continue;
    if (!HELPS[step].some(g => gaps.has(g))) continue;
    // The description and FAQs are written from evidence: without any new source there is nothing to write from,
    // but the cached draft is free, so the step stays whenever the about or FAQ section is open.
    out.push(step);
  }
  return out;
}

/** Gross per-listing cost of one step (Apify at the reserve factor, as the run will hold it). */
export function stepUsd(step: StepId, p: Pricing, o: { renderPages: number; editorialEnabled: boolean }): number {
  switch (step) {
    case 'dfs': return p.dataforseo.businessListingsSearch.perItemUsd + p.dataforseo.businessListingsSearch.perRequestUsd / 500;
    case 'maps': return apifyItemUsd('maps', p) * p.apify.reserveFactor;
    case 'facebook': return apifyItemUsd('facebook', p) * p.apify.reserveFactor;
    case 'instagram': return apifyItemUsd('instagram', p) * p.apify.reserveFactor;
    case 'render': return apifyItemUsd('render', p) * o.renderPages * p.apify.reserveFactor;
    case 'editorial': return o.editorialEnabled ? p.editorial.perProfileUsd * 0.4 : 0; // most drafts come from the cache; new evidence pays the full call
    case 'regenerate': return o.editorialEnabled ? p.editorial.perProfileUsd * 1.3 : 0;
    case 'site':
    case 'images': return 0;
  }
}

export interface PlanEstimate {
  perStep: Record<StepId, { listings: number; usd: number }>;
  totalUsd: number;
  listings: number;
}

/** Totals over a selection: how many listings each step touches and the gross ceiling it needs. */
export function estimatePlans(plans: StepId[][], p: Pricing, o: { renderPages: number; editorialEnabled: boolean }): PlanEstimate {
  const perStep = Object.fromEntries(STEP_ORDER.map(s => [s, { listings: 0, usd: 0 }])) as PlanEstimate['perStep'];
  for (const plan of plans) {
    for (const step of plan) {
      perStep[step].listings++;
      perStep[step].usd += stepUsd(step, p, o);
    }
  }
  const totalUsd = Object.values(perStep).reduce((n, x) => n + x.usd, 0);
  return { perStep, totalUsd, listings: plans.length };
}

/** Steps of a run's scope as the worker reads them, with the legacy booleans folded in. */
export function scopeSteps(scope: { steps?: string[]; refresh?: boolean; regenerate?: boolean; rereadSite?: boolean; auto?: boolean }): { steps: Set<StepId>; auto: boolean } {
  const set = new Set<StepId>((scope.steps ?? []).filter((s): s is StepId => (STEP_ORDER as string[]).includes(s)));
  if (scope.refresh) set.add('dfs');
  if (scope.regenerate) set.add('regenerate');
  if (scope.rereadSite) set.add('site');
  if (!scope.steps) set.add('editorial').add('images'); // legacy scopes always wrote and copied
  return { steps: set, auto: scope.auto === true };
}
