// Types, constants and validation shared by the Claim client flow and its server actions.

import { CATEGORIES } from '@/lib/catalog';
import { IL_PHONE_RE } from '@/lib/format';

/** Verification methods as designed. `call` sends the code by voice. */
export type ClaimMethod = 'sms' | 'call' | 'mail';
export const CLAIM_METHODS: ClaimMethod[] = ['sms', 'call', 'mail'];

export interface DayHours {
  open: boolean;
  from: string; // HH:MM
  to: string; // HH:MM
}

/** One search result. Only masked contact targets ever reach the client. */
export interface ListingHit {
  id: string;
  name: string;
  category: string;
  city: string;
  phone: string; // display form (09-748-2210), public on the listing
  img: string | null;
  imgAlt: string;
  claimed: boolean;
  targets: Record<ClaimMethod, string | null>;
  prefill: {
    address: string;
    phone: string;
    whatsapp: string;
    cats: string[];
    days: DayHours[];
  };
}

export interface ClaimDetails {
  branchId: string;
  bizName: string;
  address: string;
  phone: string;
  whatsapp: string;
  cats: string[];
  doctor: string;
  days: DayHours[];
}

export const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

// The design's default week. Saturday has no designed hours, so it borrows Friday's if opened.
export const DEFAULT_DAYS: DayHours[] = [
  { open: true, from: '09:00', to: '19:00' },
  { open: true, from: '09:00', to: '19:00' },
  { open: true, from: '09:00', to: '19:00' },
  { open: true, from: '09:00', to: '20:00' },
  { open: true, from: '09:00', to: '20:00' },
  { open: true, from: '09:00', to: '13:00' },
  { open: false, from: '09:00', to: '13:00' },
];

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const MEDICAL = new Set(CATEGORIES.filter(c => c.isMedical).map(c => c.slug));
export const CATEGORY_SLUGS = new Set(CATEGORIES.map(c => c.slug));
export const hasMedical = (cats: string[]) => cats.some(c => MEDICAL.has(c));

/** 09:00 + 19:00 → 9:00–19:00, as the design prints it. Render inside an LTR span. */
export const hoursLabel = (d: DayHours) => `${d.from.replace(/^0(\d)/, '$1')}–${d.to.replace(/^0(\d)/, '$1')}`;

export type DetailsField = 'bizName' | 'address' | 'phone' | 'whatsapp' | 'cats' | 'doctor';

/** Fields that fail the design's rules. Same function runs on the client and in the server action. */
export function detailsErrors(d: Omit<ClaimDetails, 'branchId' | 'days'>): Record<DetailsField, boolean> {
  const wa = d.whatsapp.trim();
  return {
    bizName: d.bizName.trim().length < 2,
    address: d.address.trim().length < 4,
    phone: !IL_PHONE_RE.test(d.phone.trim()),
    whatsapp: wa !== '' && !IL_PHONE_RE.test(wa),
    cats: d.cats.length === 0,
    doctor: hasMedical(d.cats) && d.doctor.trim().length < 3,
  };
}

export const detailsOk = (d: Omit<ClaimDetails, 'branchId' | 'days'>) => !Object.values(detailsErrors(d)).some(Boolean);
