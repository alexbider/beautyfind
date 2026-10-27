import 'server-only';
import type Stripe from 'stripe';
import { db } from '../db';
import { applyStripeSubscription, recordFailedInvoice, recordPaidInvoice, refreshCard, syncBilling } from './index';
import { customerIdOf, invoiceSubscriptionId, SITE, stripe } from './stripe';

// Stripe events for BeautyFind. The Stripe account also bills other sites, so every handler first
// finds our subscription row by the Stripe customer and ignores anything it does not know.

async function knownCustomer(customerId: string | null): Promise<boolean> {
  if (!customerId) return false;
  return !!(await db.subscription.findUnique({ where: { stripeCustomerId: customerId }, select: { id: true } }));
}

export async function handleStripeEvent(event: Stripe.Event): Promise<'handled' | 'ignored'> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.metadata?.site !== SITE) return 'ignored';
      const customerId = customerIdOf(s.customer);
      const businessId = s.metadata?.businessId ?? s.client_reference_id;
      if (!customerId || !businessId) return 'ignored';
      await db.subscription.updateMany({ where: { businessId, stripeCustomerId: null }, data: { stripeCustomerId: customerId } });
      if (s.mode === 'setup' && s.setup_intent) {
        // Card saved without a charge: it becomes the default for future invoices.
        const si = await stripe().setupIntents.retrieve(typeof s.setup_intent === 'string' ? s.setup_intent : s.setup_intent.id);
        const pm = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id;
        if (pm) await stripe().customers.update(customerId, { invoice_settings: { default_payment_method: pm } });
      }
      if (s.mode === 'subscription' && s.subscription) {
        const sub = await stripe().subscriptions.retrieve(typeof s.subscription === 'string' ? s.subscription : s.subscription.id);
        // The card used at checkout pays future invoices too, including sponsored ones.
        const pm = typeof sub.default_payment_method === 'string' ? sub.default_payment_method : sub.default_payment_method?.id;
        if (pm) await stripe().customers.update(customerId, { invoice_settings: { default_payment_method: pm } });
        await db.subscription.updateMany({ where: { businessId }, data: { stripeSubscriptionId: sub.id } });
        await applyStripeSubscription(sub);
      }
      await refreshCard(customerId);
      if (s.mode === 'setup') await syncBilling(businessId);
      return 'handled';
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      if (!(await knownCustomer(customerIdOf(sub.customer)))) return 'ignored';
      // Read the current state rather than trusting event order.
      const fresh = event.type === 'customer.subscription.deleted' ? sub : await stripe().subscriptions.retrieve(sub.id);
      await applyStripeSubscription(fresh);
      return 'handled';
    }
    case 'invoice.paid': {
      const inv = event.data.object as Stripe.Invoice;
      if (!(await knownCustomer(customerIdOf(inv.customer)))) return 'ignored';
      await recordPaidInvoice(inv);
      const subId = invoiceSubscriptionId(inv);
      if (subId) await applyStripeSubscription(await stripe().subscriptions.retrieve(subId));
      return 'handled';
    }
    case 'invoice.payment_failed': {
      const inv = event.data.object as Stripe.Invoice;
      if (!(await knownCustomer(customerIdOf(inv.customer)))) return 'ignored';
      await recordFailedInvoice(inv, invoiceSubscriptionId(inv));
      return 'handled';
    }
    case 'customer.updated': {
      const c = event.data.object as Stripe.Customer;
      if (!(await knownCustomer(c.id))) return 'ignored';
      await refreshCard(c.id);
      return 'handled';
    }
    default:
      return 'ignored';
  }
}
