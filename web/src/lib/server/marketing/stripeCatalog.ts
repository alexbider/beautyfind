import 'server-only';
import type Stripe from 'stripe';
import { SITE, stripe } from '../billing/stripe';
import type { ResolvedService } from './index';

// The marketing services as a Stripe catalog, on the shared Bidernet account next to the plans:
//   Product  beautyfind_mk_{slug}                one per service (name, description, metadata site/purpose/service)
//   Price    beautyfind_mk_{slug}_{package}       the package: ILS, monthly or one time
//   Price    beautyfind_mk_{slug}_{package}_setup the one-time setup fee of a monthly package, when it has one
// Prices are found by lookup key. Stripe prices cannot change, so a new price from /ops/marketing makes a new
// Stripe price that takes over the lookup key, and the old one is archived (subscriptions on it keep running).
// Checkout calls ensurePackagePrices, so the catalog heals itself even if a sync was missed.

const PURPOSE = 'marketing';
export const productIdOf = (slug: string) => `beautyfind_mk_${slug.replace(/-/g, '_')}`;
export const packageLookupKey = (slug: string, pkg: string) => `${productIdOf(slug)}_${pkg}`;
export const setupLookupKey = (slug: string, pkg: string) => `${packageLookupKey(slug, pkg)}_setup`;

async function ensureProduct(service: ResolvedService): Promise<string> {
  const id = productIdOf(service.slug);
  const name = `BeautyFind · ${service.name}`;
  const description = service.cardLine?.slice(0, 300) || undefined;
  const metadata = { site: SITE, purpose: PURPOSE, service: service.slug };
  try {
    const p = await stripe().products.retrieve(id);
    if (!p.active || p.name !== name || (description && p.description !== description)) {
      await stripe().products.update(id, { active: true, name, ...(description ? { description } : {}), metadata }).catch(e => console.warn('[marketing] product update skipped', e instanceof Error ? e.message : e));
    }
    return id;
  } catch (e) {
    if ((e as Stripe.errors.StripeError)?.statusCode !== 404) throw e;
    await stripe().products.create({ id, name, ...(description ? { description } : {}), type: 'service', statement_descriptor: 'BEAUTYFIND', metadata }, { idempotencyKey: `bf-mk-product-${id}` });
    return id;
  }
}

/** The active price for a lookup key with this amount and cycle; makes one (taking over the key) when it differs. */
async function ensurePrice(product: string, lookupKey: string, nickname: string, amountAgorot: number, monthly: boolean, metadata: Record<string, string>): Promise<{ id: string; created: boolean }> {
  const list = await stripe().prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  const cur = list.data[0];
  const same = cur && cur.unit_amount === amountAgorot && cur.currency === 'ils' && (cur.recurring?.interval === 'month') === monthly && cur.product === product;
  if (same) return { id: cur.id, created: false };
  const price = await stripe().prices.create(
    {
      product, currency: 'ils', unit_amount: amountAgorot, nickname, lookup_key: lookupKey, transfer_lookup_key: true,
      ...(monthly ? { recurring: { interval: 'month' } } : {}), tax_behavior: 'exclusive', metadata,
    },
    { idempotencyKey: `bf-mk-price-${lookupKey}-${amountAgorot}-${monthly ? 'm' : 'o'}` },
  );
  if (cur) await stripe().prices.update(cur.id, { active: false }).catch(() => undefined);
  return { id: price.id, created: true };
}

export interface PackagePrices { priceId: string; setupPriceId: string | null }

/** The Stripe prices of one package (and its setup fee), created or replaced when they do not match the site. */
export async function ensurePackagePrices(service: ResolvedService, pkgKey: string): Promise<PackagePrices & { created: number }> {
  const pkg = service.resolvedPackages.find(p => p.key === pkgKey);
  if (!pkg) throw new Error(`unknown package ${service.slug}/${pkgKey}`);
  const product = await ensureProduct(service);
  const meta = { site: SITE, purpose: PURPOSE, service: service.slug, package: pkg.key };
  const monthly = pkg.cycle === 'monthly';
  const main = await ensurePrice(product, packageLookupKey(service.slug, pkg.key), `${pkg.name}${monthly ? ' · חודשי' : ''}`, Math.round(pkg.priceNis * 100), monthly, { ...meta, kind: 'package', cycle: pkg.cycle });
  let setup: { id: string; created: boolean } | null = null;
  const setupAgorot = Math.round((pkg.setupNis ?? 0) * 100);
  if (setupAgorot > 0) {
    setup = await ensurePrice(product, setupLookupKey(service.slug, pkg.key), `${pkg.name} · הקמה`, setupAgorot, false, { ...meta, kind: 'setup' });
  } else {
    // A setup fee that was removed on the site: archive its price.
    const old = await stripe().prices.list({ lookup_keys: [setupLookupKey(service.slug, pkg.key)], active: true, limit: 1 });
    if (old.data[0]) await stripe().prices.update(old.data[0].id, { active: false }).catch(() => undefined);
  }
  return { priceId: main.id, setupPriceId: setup?.id ?? null, created: Number(main.created) + Number(setup?.created ?? false) };
}

export interface CatalogSync { ok: boolean; products: number; prices: number; created: number; errors: string[] }

/** Syncs every service and package to Stripe. Hidden packages are synced too, so turning one back on needs nothing. */
export async function syncMarketingCatalog(services: ResolvedService[]): Promise<CatalogSync> {
  const out: CatalogSync = { ok: true, products: 0, prices: 0, created: 0, errors: [] };
  for (const s of services) {
    out.products++;
    for (const p of s.resolvedPackages) {
      try {
        const r = await ensurePackagePrices(s, p.key);
        out.prices += r.setupPriceId ? 2 : 1;
        out.created += r.created;
      } catch (e) {
        out.ok = false;
        out.errors.push(`${s.slug}/${p.key}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
      }
    }
  }
  return out;
}
