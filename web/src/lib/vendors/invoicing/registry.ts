import 'server-only';
import { randomDigits } from '../../server/crypto';
import type { ProviderInfo } from '../payments/types';
import type { InvoiceAdapter } from './types';

export const INVOICE_PROVIDERS: ProviderInfo[] = [
  { key: 'green_invoice', name: 'חשבונית ירוקה (Morning)', kind: 'invoicing', available: false, docsUrl: 'https://www.greeninvoice.co.il/api-docs', fields: [{ key: 'apiKeyId', label: 'מזהה מפתח API' }, { key: 'apiKeySecret', label: 'סוד מפתח API', secret: true }] },
  { key: 'icount', name: 'iCount', kind: 'invoicing', available: false, docsUrl: 'https://api.icount.co.il/', fields: [{ key: 'cid', label: 'מזהה חברה' }, { key: 'user', label: 'שם משתמש' }, { key: 'pass', label: 'סיסמה', secret: true }] },
  { key: 'ezcount', name: 'EZcount', kind: 'invoicing', available: false, docsUrl: 'https://docs.ezcount.co.il/', fields: [{ key: 'apiKey', label: 'מפתח API', secret: true }, { key: 'developerEmail', label: 'דוא״ל מפתח' }] },
  { key: 'sandbox', name: 'סביבת בדיקה', kind: 'invoicing', available: true, docsUrl: '', fields: [] },
];

// Sandbox: numbers documents locally, no PDF. For development and demos only.
const sandbox: InvoiceAdapter = {
  async verify() {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SANDBOX_PAYMENTS !== '1') return { ok: false, error: 'sandbox_disabled' };
    return { ok: true };
  },
  async issue(_c, req) {
    const n = (req.type === 'credit_note' ? 'CN-' : req.type === 'receipt' ? 'RC-' : 'INV-') + randomDigits(6);
    return { number: n, providerRef: 'sbx_' + n, pdfUrl: null };
  },
};

const ADAPTERS: Record<string, InvoiceAdapter> = { sandbox };

export function invoiceAdapter(provider: string): InvoiceAdapter {
  const a = ADAPTERS[provider];
  if (!a) throw new Error(`No invoicing adapter for "${provider}"`);
  return a;
}
