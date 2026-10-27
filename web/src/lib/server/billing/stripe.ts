import 'server-only';
import Stripe from 'stripe';
import type { PlanKey } from '@/lib/pricing';

// BeautyFind's own charges (plans, sponsored weeks) go through one Stripe account (Bidernet). That
// account also bills other sites, so everything BeautyFind creates there carries metadata site=beautyfind,
// and the webhook only acts on customers it knows. Prices are found by lookup key, never by id:
//   beautyfind_{basic|advanced}_{monthly|yearly}  graduated, full price for branches 1 to 3, 25% off from the 4th
//   beautyfind_sponsored_week                     one sponsored week
// The only secret is STRIPE_SECRET_KEY (a restricted key is enough). STRIPE_WEBHOOK_SECRET is optional:
// without it the webhook confirms each event by reading it back from Stripe.

export const SITE = 'beautyfind';
export type Cycle = 'monthly' | 'yearly';

let client: Stripe | null = null;

export const stripeConfigured = () => !!process.env.STRIPE_SECRET_KEY;

export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  client ??= new Stripe(key, { appInfo: { name: 'BeautyFind', url: 'https://beautyfind.co.il' }, maxNetworkRetries: 2 });
  return client;
}

export const planLookupKey = (plan: PlanKey, cycle: Cycle) => `beautyfind_${plan}_${cycle}`;

const priceCache = new Map<string, { id: string; at: number }>();
const TTL = 10 * 60_000;

/** The active price for a lookup key. Cached for ten minutes per server instance. */
export async function priceId(lookupKey: string): Promise<string> {
  const hit = priceCache.get(lookupKey);
  if (hit && Date.now() - hit.at < TTL) return hit.id;
  const list = await stripe().prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  const id = list.data[0]?.id;
  if (!id) throw new Error(`Stripe price with lookup key "${lookupKey}" not found`);
  priceCache.set(lookupKey, { id, at: Date.now() });
  return id;
}

export const planPriceId = (plan: PlanKey, cycle: Cycle) => priceId(planLookupKey(plan, cycle));

/** Plan and cycle from a Stripe price (its metadata, or its lookup key). Null for a price that is not a BeautyFind plan. */
export function planOfPrice(price: Stripe.Price | string | null | undefined): { plan: PlanKey; cycle: Cycle } | null {
  if (!price || typeof price === 'string') return null;
  const m = /^beautyfind_(basic|advanced)_(monthly|yearly)$/.exec(price.lookup_key ?? '');
  if (m) return { plan: m[1] as PlanKey, cycle: m[2] as Cycle };
  const plan = price.metadata?.planKey;
  const cycle = price.metadata?.cycle;
  if ((plan === 'basic' || plan === 'advanced') && (cycle === 'monthly' || cycle === 'yearly')) return { plan, cycle };
  return null;
}

let portalConfig: string | null | undefined;

/** The customer portal configuration made for BeautyFind (metadata site=beautyfind), if there is one. */
export async function portalConfigurationId(): Promise<string | undefined> {
  if (portalConfig !== undefined) return portalConfig ?? undefined;
  const list = await stripe().billingPortal.configurations.list({ active: true, limit: 50 });
  portalConfig = list.data.find(c => c.metadata?.site === SITE)?.id ?? null;
  return portalConfig ?? undefined;
}

/** Customer id from a field that may be an id, an expanded customer or null. */
export const customerIdOf = (c: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined) => (typeof c === 'string' ? c : c?.id ?? null);

/** Subscription id an invoice belongs to, across API versions (invoice.parent in new ones, invoice.subscription in old ones). */
export function invoiceSubscriptionId(inv: Stripe.Invoice): string | null {
  const parent = (inv as unknown as { parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null }).parent;
  const fromParent = parent?.subscription_details?.subscription;
  if (fromParent) return typeof fromParent === 'string' ? fromParent : fromParent.id;
  const legacy = (inv as unknown as { subscription?: string | { id: string } | null }).subscription;
  if (legacy) return typeof legacy === 'string' ? legacy : legacy.id;
  return null;
}

/** End of the current period, across API versions (on the item in new ones, on the subscription in old ones). */
export function periodEndOf(sub: Stripe.Subscription): Date | null {
  const item = sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined;
  const ts = item?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end;
  return ts ? new Date(ts * 1000) : null;
}
