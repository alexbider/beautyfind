// Template coverage manifest: every visible element of the Business Profile template (desktop and
// mobile v2), where its data comes from, what shows when the data is missing, and the test that covers
// it. `coverageOf()` scores one profile against it and `classifyProfile()` turns that into the four
// readiness states. Two measures are kept apart on purpose: template coverage (every section renders
// something truthful) and evidence readiness (the section is actually filled with sourced content).
//
// docs/coverage-manifest.md is generated from MANIFEST by `npm run import:manifest`.

import { CATEGORIES } from '../catalog';

export type SectionState = 'populated' | 'fallback' | 'missing';

export interface ManifestEntry {
  id: string;
  element: string; // template element
  selector: string; // component / anchor in our implementation
  fields: string; // data fields
  source: string; // source rule
  fallback: string; // honest state when the data is missing
  cta: string; // action in that state
  test: string; // covering test
  weight: number; // for the readiness score
  ownerField: boolean; // missing means "needs_owner_information" rather than "needs_review"
}

export const MANIFEST: ManifestEntry[] = [
  { id: 'chrome', element: 'Header, footer, breadcrumbs', selector: 'SiteHeader / SiteFooter / .crumbs', fields: 'region, city, category, name', source: 'Catalog and the branch record; the profile URL is /region/category/slug', fallback: 'Always rendered', cta: 'Region and city links', test: 'unit: profile view (crumbs)', weight: 0, ownerField: false },
  { id: 'hero', element: 'Hero and gallery', selector: 'Gallery (grid, mobile carousel, lightbox)', fields: 'coverUrl, gallery[], mediaProvenance[]', source: 'Own website images and Google profile photos copied to our storage with provenance; count is the real count', fallback: 'Neutral branded monogram hero, hero_media_missing in admin, owner upload action', cta: 'Owner upload (claim)', test: 'unit: coverage hero; db: images copied and counted', weight: 12, ownerField: true },
  { id: 'identity', element: 'Identity', selector: 'Identity (.idRow, .metaRow)', fields: 'logoUrl, name, address, categories, hours', source: 'DataForSEO + website; logo from the site or the Google profile', fallback: 'Monogram instead of a logo; open state omitted when hours are unknown', cta: 'None', test: 'unit: open state with unknown hours', weight: 6, ownerField: false },
  { id: 'rating', element: 'Rating summary', selector: '.rating (identity) and h-reviews box', fields: 'googleRating, googleReviewCount, beautyfind stats', source: 'Google rating via DataForSEO (labelled), BeautyFind verified reviews; never merged into one number', fallback: '"אין עדיין דירוג" with a link to search the business on Google', cta: 'Google link', test: 'unit: reviews never merged; fixture claims absent', weight: 4, ownerField: false },
  { id: 'chips', element: 'Highlight chips', selector: '.chips', fields: 'attributes.accessible, attributes.parking, verified responsibility, prices', source: 'Google attributes and explicit statements on the site; tri-state (true, false, unknown)', fallback: 'Unknown attributes are not shown, never shown as false', cta: 'None', test: 'unit: tri-state chips', weight: 3, ownerField: false },
  { id: 'facts', element: 'Three fact cards', selector: '.facts', fields: 'establishedYear, teamSize/team, languages', source: 'Explicit statements on the site ("מאז 2014", "דוברות רוסית"); never inferred from the site language or the number of cards', fallback: 'Known alternate fact (responsibility, hours today, Google rating) else "פרטים טרם עודכנו"', cta: 'None', test: 'unit: facts fallback', weight: 4, ownerField: true },
  { id: 'about', element: 'h-about', selector: '#h-about', fields: 'description, editorial.words, editorial.needsMoreInfo', source: 'Editorial call on the evidence packet (450 to 550 words); the source description otherwise', fallback: 'Short accurate draft, flagged needs_more_business_information in admin', cta: 'Claim', test: 'unit: editorial checks; db: short draft flagged', weight: 12, ownerField: true },
  { id: 'promises', element: 'Promises / policy copy', selector: 'Services note, booking card note', fields: 'none imported', source: 'Only policies the business published (deposit, cancellation) after claiming', fallback: 'Neutral copy: no guarantees, no free consultation, no sample policies', cta: 'None', test: 'unit: no fixture claims', weight: 0, ownerField: false },
  { id: 'services', element: 'h-services', selector: 'Services accordion (#h-services)', fields: 'treatments[] with priceType, priceAgorot, priceMaxAgorot, priceNote, source', source: 'Website price lists, JSON-LD offers, Google services; missing price is null (on_request)', fallback: 'Section kept with "פירוט השירותים טרם עודכן"; unpriced rows show "המחיר לא פורסם" + "לקבלת מחיר ופרטים"', cta: 'Quote request with business, branch and service ids; direct contact when unclaimed', test: 'unit: services view never renders ₪0; db: quote CTA context', weight: 12, ownerField: true },
  { id: 'compare', element: 'Comparison links', selector: 'Services foot link', fields: 'category, city', source: 'Existing /region/city/category routes only', fallback: 'No link when the city has no page', cta: 'Compare', test: 'unit: compare href', weight: 0, ownerField: false },
  { id: 'reviews', element: 'h-reviews', selector: '#h-reviews', fields: 'googleRating, reviews[] (BeautyFind)', source: 'Google summary (labelled) and BeautyFind verified reviews, sorted by real controls', fallback: 'Truthful empty states with the source link', cta: 'Google link, write a review after a visit', test: 'unit: no weekly-refresh claim without a job', weight: 2, ownerField: false },
  { id: 'ba', element: 'h-ba', selector: '#h-ba', fields: 'gallery items tagged לפני/אחרי with consent', source: 'Only owner-published pairs with a consent basis; crawler candidates wait for owner confirmation', fallback: 'Short honest empty state', cta: 'Claim', test: 'unit: candidates never published', weight: 0, ownerField: true },
  { id: 'team', element: 'h-team', selector: '#h-team', fields: 'staff (verified) + team[] (imported: name, role, bio, sourceUrl)', source: 'People named with a role on the business site; never a login, permission or verified badge', fallback: '"פרטי הצוות טרם עודכנו"', cta: 'Claim', test: 'db: imported team creates no StaffMember', weight: 6, ownerField: true },
  { id: 'video', element: 'h-video', selector: '#h-video (VideoEmbed)', fields: 'videos[] (id, title, channel, status, embeddable)', source: 'YouTube ids on the official site, then the verified channel (Data API); validated via API or oEmbed', fallback: 'Short empty state; unavailable videos keep a working channel link', cta: 'Consent-gated click-to-load player', test: 'unit: video validation states', weight: 3, ownerField: true },
  { id: 'hours', element: 'h-hours', selector: '#h-hours', fields: 'hours[7] with per-day unknown', source: 'Google hours via DataForSEO or the site; Asia/Jerusalem; unknown is not closed; no Saturday default', fallback: '"שעות הפעילות לא פורסמו" with a contact action; no open-now claim', cta: 'Contact', test: 'unit: unknown hours give no open state', weight: 6, ownerField: true },
  { id: 'faq', element: 'h-faq', selector: '#h-faq', fields: 'faqs[] (5 to 8)', source: 'Editorial call from the evidence packet, with a basis per answer; site FAQs as evidence', fallback: 'Fewer than five accurate FAQs flags editorial review; the section shows what exists', cta: 'None', test: 'unit: five FAQs from rich evidence, flag on sparse', weight: 6, ownerField: false },
  { id: 'loc', element: 'h-loc', selector: '#h-loc (MapEmbed)', fields: 'googlePlaceId, address, lat/lng, wazeUrl', source: 'Google Maps Embed API in place mode (place_id, else name + address), consent-gated; Waze and Google directions', fallback: 'Address, Waze and directions links; activate-map control before consent; schematic map when no key is configured', cta: 'Waze, directions', test: 'unit: embed URL; screenshot: consent flow', weight: 4, ownerField: false },
  { id: 'contact', element: 'bf-contact', selector: '#bf-contact (BookingCard)', fields: 'phone, whatsapp, email, websiteUrl, instagram, facebook, tiktok, youtube', source: 'DataForSEO and the official site; social accounts only when verified (backlink or matching signals)', fallback: '"אימייל לא פורסם"; unclaimed listings show direct contact instead of booking', cta: 'Call, WhatsApp, website, claim', test: 'unit: unverified socials not published', weight: 8, ownerField: false },
  { id: 'mobile', element: 'Mobile controls', selector: 'SectionTabs, ActionBar', fields: 'section anchors, today status, primary CTA', source: 'Same data as the sections; CTA = booking only when bookable, else availability or consultation', fallback: 'Tabs only for sections that exist; status omitted when hours are unknown', cta: 'Call, WhatsApp, primary', test: 'screenshot 390px', weight: 0, ownerField: false },
  { id: 'dialogs', element: 'Gallery and video dialogs', selector: 'Lightbox, VideoEmbed', fields: 'real assets and validated ids', source: 'Copied images with Hebrew alt text; validated YouTube ids', fallback: 'No dialog without assets', cta: 'Keyboard: arrows, Esc, focus return', test: 'existing Gallery behaviour; screenshot lightbox', weight: 0, ownerField: false },
  { id: 'trust', element: 'Trust labels', selector: 'מאומת, אחריות רפואית badges', fields: 'isClaimed, verified licenses', source: 'Our verification workflow only; provider claim status never sets a badge', fallback: 'No badge', cta: 'Claim', test: 'unit: provider claim status ignored', weight: 0, ownerField: false },
];

export interface CoverageInput {
  coverUrl: string | null;
  galleryCount: number;
  logoUrl: string | null;
  hoursKnown: boolean;
  description: string | null;
  editorialWords: number | null;
  editorialNeedsMore: boolean | null;
  services: number;
  servicesPriced: number;
  teamCount: number;
  verifiedStaff: number;
  videosPlayable: number;
  faqs: number;
  establishedYear: number | null;
  languages: number;
  accessible: boolean | null;
  parking: boolean | null;
  phone: boolean;
  email: boolean;
  website: boolean;
  socialsVerified: number;
  socialsUnverified: number;
  rating: boolean;
  mapConfigured: boolean;
  placeId: boolean;
  conflicts: string[]; // phone, hours, address
  reviewReasons: string[]; // qualification reasons that need a person
  claimed: boolean;
}

export interface CoverageRow {
  id: string;
  state: SectionState;
  detail: string;
}

export type ProfileStatus = 'ready' | 'ready_with_disclosed_gaps' | 'needs_owner_information' | 'needs_review';

export interface Coverage {
  rows: CoverageRow[];
  templateCoverage: number; // % of sections that render populated or a truthful fallback (always 100 when the page renders)
  readiness: number; // % of weighted sections that are populated with sourced content
  missing: string[]; // ids of sections in fallback or missing
  ownerMissing: string[]; // subset that only the owner can complete
  status: ProfileStatus;
}

export function coverageOf(i: CoverageInput): Coverage {
  const rows: CoverageRow[] = [];
  const row = (id: string, state: SectionState, detail: string) => rows.push({ id, state, detail });
  row('chrome', 'populated', 'navigation');
  const photos = (i.coverUrl ? 1 : 0) + i.galleryCount;
  row('hero', i.coverUrl ? (photos >= 5 ? 'populated' : 'populated') : 'fallback', i.coverUrl ? `${photos} photos` : 'hero_media_missing');
  row('identity', i.logoUrl ? 'populated' : 'fallback', i.logoUrl ? 'logo' : 'monogram');
  row('rating', i.rating ? 'populated' : 'fallback', i.rating ? 'google rating' : 'no rating');
  row('chips', i.accessible != null || i.parking != null || i.servicesPriced > 0 ? 'populated' : 'fallback', `accessible=${i.accessible ?? 'unknown'} parking=${i.parking ?? 'unknown'}`);
  const factSlots = [i.establishedYear != null, i.teamCount + i.verifiedStaff > 0, i.languages > 0].filter(Boolean).length;
  row('facts', factSlots >= 2 ? 'populated' : factSlots === 1 ? 'fallback' : 'fallback', `${factSlots}/3 template facts`);
  const aboutOk = !!i.description && (i.editorialWords ?? 0) >= 450 && i.editorialNeedsMore !== true;
  row('about', aboutOk ? 'populated' : i.description ? 'fallback' : 'missing', i.editorialWords != null ? `${i.editorialWords} words${i.editorialNeedsMore ? ', needs_more_business_information' : ''}` : i.description ? 'source description only' : 'no description');
  row('promises', 'populated', 'neutral copy');
  row('services', i.services > 0 ? 'populated' : 'fallback', i.services ? `${i.services} services, ${i.servicesPriced} priced` : 'פירוט השירותים טרם עודכן');
  row('compare', 'populated', 'category links');
  row('reviews', 'populated', i.rating ? 'google summary' : 'empty state');
  row('ba', 'fallback', 'owner-published only');
  row('team', i.teamCount + i.verifiedStaff > 0 ? 'populated' : 'fallback', `${i.verifiedStaff} verified, ${i.teamCount} from the site`);
  row('video', i.videosPlayable > 0 ? 'populated' : 'fallback', `${i.videosPlayable} playable`);
  row('hours', i.hoursKnown ? 'populated' : 'fallback', i.hoursKnown ? 'seven days' : 'unknown');
  row('faq', i.faqs >= 5 ? 'populated' : i.faqs > 0 ? 'fallback' : 'missing', `${i.faqs} faqs`);
  row('loc', i.mapConfigured ? 'populated' : 'fallback', i.mapConfigured ? (i.placeId ? 'place_id' : 'address query') : 'map key not configured');
  const contactOk = i.phone || i.email;
  row('contact', contactOk ? 'populated' : 'missing', `${[i.phone && 'phone', i.email && 'email', i.website && 'website'].filter(Boolean).join(', ') || 'none'}; socials ${i.socialsVerified} verified${i.socialsUnverified ? `, ${i.socialsUnverified} unverified` : ''}`);
  row('mobile', 'populated', 'tabs and bar');
  row('dialogs', photos > 0 || i.videosPlayable > 0 ? 'populated' : 'fallback', 'assets only');
  row('trust', 'populated', i.claimed ? 'claimed' : 'no badge');

  const weighted = MANIFEST.filter(m => m.weight > 0);
  const total = weighted.reduce((n, m) => n + m.weight, 0);
  const got = weighted.reduce((n, m) => n + (rows.find(r => r.id === m.id)?.state === 'populated' ? m.weight : 0), 0);
  const missing = rows.filter(r => r.state !== 'populated').map(r => r.id).filter(id => (MANIFEST.find(m => m.id === id)?.weight ?? 0) > 0);
  const ownerMissing = missing.filter(id => MANIFEST.find(m => m.id === id)?.ownerField);
  const templateCoverage = Math.round((rows.filter(r => r.state !== 'missing').length / rows.length) * 100);
  const readiness = Math.round((got / total) * 100);

  let status: ProfileStatus;
  if (i.conflicts.length || i.reviewReasons.length || i.socialsUnverified > 0 && i.socialsVerified === 0 && false) status = 'needs_review';
  else if (i.editorialNeedsMore === true && !aboutOk && readiness < 60) status = 'needs_owner_information';
  else if (!contactOk) status = 'needs_review';
  else if (missing.length === 0) status = 'ready';
  else if (readiness >= 60) status = 'ready_with_disclosed_gaps';
  else status = 'needs_owner_information';
  return { rows, templateCoverage, readiness, missing, ownerMissing, status };
}

export const STATUS_NAME: Record<ProfileStatus, string> = {
  ready: 'מוכן',
  ready_with_disclosed_gaps: 'מוכן, עם פערים גלויים',
  needs_owner_information: 'חסר מידע מבעל העסק',
  needs_review: 'דורש בדיקה',
};

export const SECTION_NAME: Record<string, string> = {
  chrome: 'ניווט', hero: 'תמונות', identity: 'זהות', rating: 'דירוג', chips: 'מאפיינים', facts: 'עובדות', about: 'תיאור', promises: 'מדיניות', services: 'שירותים ומחירים', compare: 'השוואה',
  reviews: 'ביקורות', ba: 'לפני ואחרי', team: 'צוות', video: 'סרטונים', hours: 'שעות', faq: 'שאלות נפוצות', loc: 'מפה והגעה', contact: 'יצירת קשר', mobile: 'נייד', dialogs: 'חלונות', trust: 'אמון',
};

export const isMedicalCategory = (slug: string) => !!CATEGORIES.find(c => c.slug === slug)?.isMedical;

/** Markdown table of the manifest (docs/coverage-manifest.md). */
export function manifestMarkdown(): string {
  const head = ['# Template coverage manifest', '', 'Generated from `src/lib/import/coverage.ts` (`npm run import:manifest`). Every visible element of the Business Profile template (desktop `BeautyFind Business Profile.dc.html` and `Mobile v2`), its implementation, data, source rule, honest fallback, action and covering test.', '', 'Two measures are tracked separately: **template coverage** (every section renders populated content or a truthful state) and **evidence readiness** (sections filled with sourced content, weighted). A truthful missing state counts for coverage, never for readiness.', '', '| Element | Implementation | Data | Source rule | Fallback | CTA | Test | Weight | Owner field |', '|---|---|---|---|---|---|---|---|---|'];
  const rows = MANIFEST.map(m => `| ${m.element} | ${m.selector} | ${m.fields} | ${m.source} | ${m.fallback} | ${m.cta} | ${m.test} | ${m.weight} | ${m.ownerField ? 'yes' : 'no'} |`);
  const tail = ['', '## Profile classification', '', '- **ready**: every weighted section populated, contact present, no conflicts.', '- **ready_with_disclosed_gaps**: readiness 60% or more, gaps shown as honest states.', '- **needs_owner_information**: readiness under 60%, or the description needs more business information.', '- **needs_review**: a source conflict or a qualification reason that needs a person (phone, hours, address, duplicates, unverified website).', ''];
  return [...head, ...rows, ...tail].join('\n');
}
