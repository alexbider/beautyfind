// Serializable view models shared by /saved, /saved/compare and the account "saved" tab.

export interface Rating {
  rating: number;
  count: number;
}

export interface SavedCard {
  id: string;
  name: string;
  href: string; // public profile
  bookHref: string; // /book/:slug when booking is live, else the profile
  bookLabel: string;
  city: string;
  cats: string; // first categories, joined
  medical: boolean;
  online: boolean; // online booking (always false until BOOKING_LIVE)
  coverUrl: string | null;
  coverAlt: string;
  google: Rating | null;
  beautyfind: Rating | null;
  responsible: string | null; // "אחריות רפואית: ד״ר ..." (verified only)
  savedIso: string | null; // null for guests (localStorage has no date)
}

export interface CompareColumn {
  id: string;
  name: string;
  href: string;
  bookHref: string;
  bookLabel: string;
  city: string;
  cats: Array<{ slug: string; name: string }>;
  verified: boolean;
  google: Rating | null;
  beautyfind: Rating | null;
  responsible: { name: string; label: string; sub: string } | null;
  hoursToday: string | null; // "09:00–19:00"; null = closed today
  hoursKnown: boolean;
  accessible: boolean;
  freeParking: boolean;
  online: boolean;
  // Lowest published price in agorot (before VAT): key "all" or a category slug. Missing = not offered.
  priceFrom: Record<string, number>;
}

export const MAX_COMPARE = 3;

export const clinicsLabel = (n: number) => (n === 1 ? 'קליניקה אחת' : n === 2 ? 'שתי קליניקות' : `${n} קליניקות`);
export const reviewsCount = (n: number) => (n === 1 ? 'ביקורת אחת' : `${n.toLocaleString('en-US')} ביקורות`);
export const ratingText = (r: number) => (Math.round(r * 10) / 10).toFixed(1);
