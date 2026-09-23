import 'server-only';
import { hmac } from '../../server/crypto';
import { siteUrl } from '../../server/site';
import type { PaymentAdapter } from './types';

// Sandbox provider: a fake hosted checkout on our own site (/pay/sandbox/[paymentId]) so every paid
// flow works end to end in development and demos. It never moves money. Disabled in production
// unless ALLOW_SANDBOX_PAYMENTS=1.

const enabled = () => process.env.NODE_ENV !== 'production' || process.env.ALLOW_SANDBOX_PAYMENTS === '1';

export const sandboxSignature = (paymentId: string, status: string) => hmac(`sandbox:${paymentId}:${status}`);

export const sandbox: PaymentAdapter = {
  async verify() {
    if (!enabled()) return { ok: false, error: 'sandbox_disabled' };
    return { ok: true };
  },
  async createCheckout(_c, req) {
    // Never hand out a checkout link to a page that 404s.
    if (!enabled()) throw new Error('sandbox_disabled');
    const ref = 'sbx_' + req.paymentId.slice(0, 8);
    const q = new URLSearchParams({ success: req.successUrl, cancel: req.cancelUrl });
    return { checkoutUrl: `${siteUrl()}/pay/sandbox/${req.paymentId}?${q}`, providerRef: ref };
  },
  async parseWebhook(_c, _req, raw) {
    const body = JSON.parse(raw) as { paymentId: string; status: 'succeeded' | 'failed'; sig: string };
    if (body.sig !== sandboxSignature(body.paymentId, body.status)) throw new Error('bad signature');
    return { paymentId: body.paymentId, providerRef: 'sbx_' + body.paymentId.slice(0, 8), status: body.status, cardBrand: 'visa', cardLast4: '4242', installments: 1 };
  },
  async refund(_c, opts) {
    return { providerRef: `sbx_rf_${opts.providerRef}`, status: 'issued' };
  },
};
