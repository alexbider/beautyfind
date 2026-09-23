// Payment provider interface. Each business connects its own provider (docs/decisions.md);
// every charge, refund and webhook for that business goes through its connection.

export interface ChargeRequest {
  paymentId: string; // our Payment.id, echoed back by the provider
  amountAgorot: number;
  description: string;
  customer: { name: string; phone?: string | null; email?: string | null };
  maxInstallments?: number;
  successUrl: string; // where the provider sends the browser after paying
  cancelUrl: string;
  webhookUrl: string; // server-to-server confirmation
}

export interface ChargeResult {
  checkoutUrl: string; // hosted payment page (card data never touches BeautyFind)
  providerRef: string;
}

export interface WebhookResult {
  paymentId: string;
  providerRef: string;
  status: 'succeeded' | 'failed';
  cardBrand?: string;
  cardLast4?: string;
  installments?: number;
}

export interface RefundResult {
  providerRef: string;
  status: 'issued' | 'failed';
}

export interface PaymentAdapter {
  /** Checks the credentials with a harmless API call. */
  verify(credentials: Record<string, string>): Promise<{ ok: true } | { ok: false; error: string }>;
  createCheckout(credentials: Record<string, string>, req: ChargeRequest): Promise<ChargeResult>;
  /** Verifies and parses a webhook. Must reject anything it can't authenticate. */
  parseWebhook(credentials: Record<string, string>, req: Request, rawBody: string): Promise<WebhookResult>;
  refund(credentials: Record<string, string>, opts: { providerRef: string; amountAgorot: number }): Promise<RefundResult>;
}

/** Field the business fills in when connecting (labels in Hebrew, keys match the provider's API). */
export interface CredentialField {
  key: string;
  label: string;
  secret?: boolean;
  help?: string;
}

export interface ProviderInfo {
  key: string;
  name: string;
  kind: 'payments' | 'invoicing';
  fields: CredentialField[];
  docsUrl: string;
  /** false until the adapter has been tested against the provider's sandbox with real credentials. */
  available: boolean;
}
