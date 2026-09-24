// Gift cards: constants and formatting shared by the buy, check and clinic screens (client-safe).
// Design: project/BeautyFind Gift Cards.dc.html (AMOUNTS, CHANNELS, WHENS, ST).

/** Preset amounts in shekels (design AMOUNTS). A custom amount runs from MIN to MAX. */
export const AMOUNTS = [250, 500, 750, 1000];
export const CUSTOM_MIN = 100;
export const CUSTOM_MAX = 5000;
export const MESSAGE_MAX = 140;
/** Legal minimum validity (03-states.md). */
export const MIN_VALIDITY_YEARS = 5;
/** Cancellation window for an unused card, in days. */
export const CANCEL_DAYS = 14;

export type Channel = 'wa' | 'email' | 'self';
export const CHANNELS: Array<{ key: Channel; name: string }> = [
  { key: 'wa', name: 'וואטסאפ' },
  { key: 'email', name: 'דוא״ל' },
  { key: 'self', name: 'אליי, אמסור בעצמי' },
];

/** ₪1,200 or ₪495.60 from integer agorot. Keeps agorot only when there are any. */
export const money = (agorot: number) =>
  '₪' + (agorot / 100).toLocaleString('en-US', { minimumFractionDigits: agorot % 100 ? 2 : 0, maximumFractionDigits: 2 });

/** "noa-7k4m 29qx" → "NOA7K4M29QX": case-insensitive, dashes and spaces optional. */
export const compactCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Canonical NOA-XXXX-XXXX form of a compacted code, or null when it can't be one. */
export function canonicalCode(raw: string): string | null {
  const c = compactCode(raw);
  if (c.length < 10 || c.length > 12) return null; // 2 to 4 letter prefix + two blocks of 4
  const prefix = c.slice(0, -8);
  if (!/^[A-Z]+$/.test(prefix)) return null;
  return `${prefix}-${c.slice(-8, -4)}-${c.slice(-4)}`;
}

export type LedgerStatus = 'pending_payment' | 'scheduled' | 'active' | 'partially_redeemed' | 'redeemed' | 'refunded' | 'expired';

/** Label, background and text color per status (design ST). */
export const STATUS: Record<LedgerStatus, { name: string; bg: string; color: string }> = {
  active: { name: 'פעיל', bg: '#EAF3EA', color: '#3B6B3F' },
  partially_redeemed: { name: 'מומש חלקית', bg: '#F0FAFB', color: '#0B7A87' },
  redeemed: { name: 'מומש', bg: '#F0F3F5', color: '#5B6B7B' },
  scheduled: { name: 'מתוזמן', bg: '#FFF8EC', color: '#9A5B15' },
  refunded: { name: 'בוטל והוחזר', bg: '#FDEDEC', color: '#A33A31' },
  expired: { name: 'פג תוקף', bg: '#F0F3F5', color: '#5B6B7B' },
  pending_payment: { name: 'ממתין לתשלום', bg: '#F0F3F5', color: '#8A96A3' },
};

/** Hebrew years: שנה · שנתיים · N שנים. */
export const yearsText = (n: number) => (n === 1 ? 'שנה' : n === 2 ? 'שנתיים' : `${n} שנים`);

/** Hebrew days: יום אחד · יומיים · N ימים. */
export const daysText = (n: number) => (n === 1 ? 'יום אחד' : n === 2 ? 'יומיים' : `${n} ימים`);

/** The terms shown before payment (03-states.md, 07-rules-and-tokens.md). */
export const termsFor = (years: number) => [
  `בתוקף ${yearsText(years)} מיום הקנייה, כנדרש בחוק`,
  'מימוש בכמה ביקורים, בכל סניף של הקליניקה, עד לניצול היתרה',
  'בטיפול רפואי, כמו הזרקה, המימוש מותנה בייעוץ רפואי',
  'אי אפשר להמיר לכסף, אבל אפשר להעביר לאדם אחר',
  `ביטול תוך ${CANCEL_DAYS} ימים מהקנייה, כל עוד השובר לא מומש, בהחזר מלא`,
];
