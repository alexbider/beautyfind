// Shared rules for the import: run scope, opening hours, and the checks that decide whether a
// record is ready, needs a human, or is incomplete. The worker and the review screen both use them.

import { z } from 'zod';
import { CATEGORIES, CITIES } from '../catalog';

export const RunScope = z.object({
  all: z.boolean(), // whole-country map grid on top of the cities
  cities: z.array(z.enum(CITIES.map(c => c.slug) as [string, ...string[]])),
  categories: z.array(z.enum(CATEGORIES.map(c => c.slug) as [string, ...string[]])).min(1),
  nearby: z.boolean(), // map grid by Google place type
  text: z.boolean(), // text queries per category and city
});
export type RunScope = z.infer<typeof RunScope>;

export interface DayHours {
  open: string;
  close: string;
  closed: boolean;
}

interface GPoint {
  day?: number;
  hour?: number;
  minute?: number;
}

const hhmm = (p: GPoint) => `${String(p.hour ?? 0).padStart(2, '0')}:${String(p.minute ?? 0).padStart(2, '0')}`;

/**
 * Google `regularOpeningHours.periods` to our 7 entries, Sunday first. Split shifts collapse to the
 * first opening and the last closing of the day; a period with no close means open 24 hours.
 */
export function hoursFromGoogle(periods: Array<{ open?: GPoint; close?: GPoint }> | undefined): DayHours[] | null {
  if (!periods?.length) return null;
  const days: DayHours[] = Array.from({ length: 7 }, () => ({ open: '', close: '', closed: true }));
  for (const p of periods) {
    if (!p.open || p.open.day == null) continue;
    const d = p.open.day;
    if (!p.close) {
      for (let i = 0; i < 7; i++) days[i] = { open: '00:00', close: '23:59', closed: false };
      break;
    }
    const open = hhmm(p.open);
    // Closing after midnight (close.day is the next day): show it as the end of this day.
    const close = p.close.day !== d ? '23:59' : hhmm(p.close);
    const cur = days[d];
    if (cur.closed) days[d] = { open, close, closed: false };
    else days[d] = { open: open < cur.open ? open : cur.open, close: close > cur.close ? close : cur.close, closed: false };
  }
  return days;
}

/** Reasons that keep a record out of approval until someone fixes the data. */
export const BLOCKING = ['no_phone', 'no_contact', 'no_email', 'email_no_mx', 'no_category', 'no_name', 'no_location'] as const;
/** Reasons that allow approval but only by a person looking at the record. */
export const REVIEW = [
  'possible_existing', 'possible_duplicate', 'email_domain_mismatch', 'shared_phone', 'temporarily_closed', 'not_beauty', 'city_not_in_catalog',
  'extraction_failed', 'medical_without_doctor_info', 'email_from_search', 'phone_conflict', 'hours_conflict', 'website_unverified',
] as const;

export const REASON_NAMES: Record<string, string> = {
  no_phone: 'אין טלפון תקין',
  no_contact: 'אין טלפון או דוא״ל',
  no_location: 'אין מיקום או אזור שירות',
  phone_conflict: 'הטלפון באתר שונה מהטלפון במקור',
  hours_conflict: 'שעות הפתיחה באתר שונות מהמקור',
  website_unverified: 'לא ברור שהאתר שייך לעסק (אין בו טלפון או שם תואמים)',
  no_email: 'לא נמצא דוא״ל',
  email_no_mx: 'דומיין הדוא״ל לא מקבל דואר',
  no_category: 'אין תחום טיפול',
  no_name: 'אין שם',
  possible_existing: 'ייתכן שכבר קיים באתר',
  possible_duplicate: 'ייתכן שזו רשומה כפולה',
  email_domain_mismatch: 'הדוא״ל מדומיין אחר מהאתר',
  shared_phone: 'אותו טלפון בעסק אחר',
  temporarily_closed: 'סגור זמנית בגוגל',
  not_beauty: 'ייתכן שאינו עסק יופי',
  city_not_in_catalog: 'יישוב שאינו ברשימה',
  extraction_failed: 'חילוץ הטיפולים מהאתר נכשל',
  email_from_search: 'הדוא״ל נמצא בחיפוש, צריך לאמת',
  medical_without_doctor_info: 'טיפול רפואי, צריך לבדוק רופא אחראי',
};

export interface QualifyInput {
  name: string;
  phone: string | null;
  email: string | null;
  emailMx: boolean | null;
  emailTier: 'own' | 'free' | 'other' | null;
  categories: string[];
  businessStatus: string | null;
  citySlug: string | null;
  notBeauty: boolean;
  extractionFailed: boolean;
  emailFromSearch?: boolean;
  possibleExisting: boolean;
  possibleDuplicate?: boolean;
  sharedPhone: boolean;
  hasWebsite?: boolean;
  hasLocation?: boolean; // an address, coordinates or an explicit service area
  phoneConflict?: boolean;
  hoursConflict?: boolean;
  websiteUnverified?: boolean;
}

/** Minimum for publication; staff change these in the import settings. */
export interface QualifyRules {
  requirePhoneOrEmail: boolean;
  requireEmail: boolean;
  requirePhoneOrWebsite: boolean;
}
export const DEFAULT_RULES: QualifyRules = { requirePhoneOrEmail: true, requireEmail: false, requirePhoneOrWebsite: false };

export function qualify(p: QualifyInput, rules: QualifyRules = DEFAULT_RULES): { status: 'ready' | 'needs_review' | 'incomplete' | 'closed'; reasons: string[] } {
  if (p.businessStatus === 'CLOSED_PERMANENTLY') return { status: 'closed', reasons: [] };
  const r: string[] = [];
  if (!p.name.trim()) r.push('no_name');
  // A way to reach the business: a phone or an email (default), or stricter/looser per settings.
  if (rules.requirePhoneOrEmail && !p.phone && !p.email) r.push('no_contact');
  else if (rules.requirePhoneOrWebsite && !p.phone && !p.hasWebsite) r.push('no_contact');
  else if (!p.phone && !p.email && !p.hasWebsite) r.push('no_contact');
  if (!p.email) {
    if (rules.requireEmail) r.push('no_email');
  } else if (p.emailMx === false) r.push('email_no_mx');
  if (p.hasLocation === false) r.push('no_location');
  if (p.phoneConflict) r.push('phone_conflict');
  if (p.hoursConflict) r.push('hours_conflict');
  if (p.websiteUnverified) r.push('website_unverified');
  if (!p.categories.length) r.push('no_category');
  if (p.possibleExisting) r.push('possible_existing');
  if (p.possibleDuplicate) r.push('possible_duplicate');
  if (p.email && p.emailTier === 'other') r.push('email_domain_mismatch');
  if (p.sharedPhone) r.push('shared_phone');
  if (p.businessStatus === 'CLOSED_TEMPORARILY') r.push('temporarily_closed');
  if (p.notBeauty) r.push('not_beauty');
  if (!p.citySlug) r.push('city_not_in_catalog');
  if (p.extractionFailed) r.push('extraction_failed');
  if (p.email && p.emailFromSearch) r.push('email_from_search');
  if (p.categories.some(c => CATEGORIES.find(x => x.slug === c)?.isMedical)) r.push('medical_without_doctor_info');
  const status = r.some(x => (BLOCKING as readonly string[]).includes(x)) ? 'incomplete' : r.length ? 'needs_review' : 'ready';
  return { status, reasons: r };
}

export interface ImportedTreatment {
  name: string;
  category: string | null;
  priceNis: number | null; // null: listed on the site without a price
  priceType: 'fixed' | 'from' | 'per_unit' | 'per_ml' | 'per_area';
  durationMin: number | null;
  isMedical: boolean;
  sourceText?: string; // the line on the site it came from
  sourceUrl?: string;
}
