// Types for the marketing services pages (/for-business/marketing). One content module per service in
// ./services, rendered by the shared template in src/app/for-business/marketing/[service]. Copy rules:
// Hebrew, no em dashes, numbers and Latin names inside text are wrapped by the renderer where needed.

export const SERVICE_SLUGS = [
  'social-ads',
  'lead-generation',
  'google-ads',
  'seo',
  'geo',
  'websites',
  'branding',
  'social-videos',
  'content-creative',
] as const;

export type ServiceSlug = (typeof SERVICE_SLUGS)[number];

export const isServiceSlug = (s: string): s is ServiceSlug => (SERVICE_SLUGS as readonly string[]).includes(s);

/** buy: order online only; quote: quote request only; both: buy a package or ask for a quote. */
export type OrderMode = 'buy' | 'quote' | 'both';

export type PackageCycle = 'one_time' | 'monthly';

export type ServicePackage = {
  key: string;
  name: string;
  /** One line under the price: who this package is for. */
  line: string;
  priceNis: number;
  cycle: PackageCycle;
  /** One-off setup fee charged with the first payment (monthly packages). */
  setupNis?: number;
  /** Minimum commitment in months, shown next to the price (monthly packages). */
  minMonths?: number;
  /** Delivery time in business days (one-off packages). */
  deliveryDays?: number;
  badge?: string;
  feats: string[];
  /** Shown under the features, e.g. "תקציב המדיה משולם ישירות לפלטפורמה". */
  note?: string;
};

export type IconPaths = string[];

export type OnboardingField = {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'url' | 'select' | 'multi' | 'checkbox';
  help?: string;
  placeholder?: string;
  options?: string[];
  required?: boolean;
};

/** An account or asset the client grants or uploads after buying (Meta Business, Google Ads, GBP, site admin). */
export type AccessStep = {
  title: string;
  body: string;
  /** A how-to link on the platform's own help site. */
  href?: string;
};

export type MarketPriceRow = { label: string; range: string; note?: string };

export type LongSection = {
  h2: string;
  paras: string[];
  bullets?: string[];
};

export type MarketingService = {
  slug: ServiceSlug;
  /** Short name for nav, cards and breadcrumbs. */
  name: string;
  /** The Hebrew head term the page targets. */
  primaryKeyword: string;
  secondaryKeywords: string[];
  /** <title> and meta description. */
  title: string;
  description: string;
  eyebrow: string;
  /** H1 split into animated lines. Joined, it must contain the primary keyword. */
  h1: string[];
  lede: string;
  /** Card text on the hub and in "related services". */
  cardLine: string;
  icon: IconPaths;
  heroImage: { src: string; alt: string };
  /** Optional explainer video (mp4 in public/ or a media URL) with a poster. */
  heroVideo?: { src: string; poster: string; label: string };
  /** The direct answer block right under the hero, written to be quoted by AI answers. */
  answer: { q: string; a: string };
  /** Short facts strip under the hero. */
  proof: string[];
  /** Pains of beauty businesses this service solves. */
  problems: { title: string; body: string }[];
  /** What is included. */
  includes: { title: string; body: string; icon: IconPaths }[];
  /** How the work runs, step by step, after the order. */
  process: { title: string; body: string }[];
  packages: ServicePackage[];
  defaultMode: OrderMode;
  /** Notes next to the packages (billing, ad budget, commitment). */
  pricingNotes: string[];
  /** Market price ranges in Israel, for transparency, with the research month. */
  market: { intro: string; rows: MarketPriceRow[]; asOf: string; note: string };
  /** What is specific to beauty businesses in this service. */
  beauty: { title: string; body: string }[];
  /** Long-form sections for depth (SEO, GEO). */
  sections: LongSection[];
  onboarding: { fields: OnboardingField[]; access: AccessStep[] };
  faqs: { q: string; a: string }[];
  related: ServiceSlug[];
};
