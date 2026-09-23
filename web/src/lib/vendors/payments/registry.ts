import 'server-only';
import type { PaymentAdapter, ProviderInfo } from './types';
import { sandbox } from './sandbox';

// Providers a business can connect. Israeli acquirers first; add more behind the same interface.
// `available: false` means the adapter is not implemented and tested yet: the dashboard lists it
// as "coming soon" so businesses can see what's planned, but can't connect it.
export const PAYMENT_PROVIDERS: ProviderInfo[] = [
  {
    key: 'cardcom', name: 'Cardcom', kind: 'payments', available: false, docsUrl: 'https://secure.cardcom.solutions/swagger/index.html',
    fields: [{ key: 'terminalNumber', label: 'מספר מסוף' }, { key: 'apiName', label: 'שם משתמש API' }, { key: 'apiPassword', label: 'סיסמת API', secret: true }],
  },
  {
    key: 'tranzila', name: 'Tranzila', kind: 'payments', available: false, docsUrl: 'https://docs.tranzila.com/',
    fields: [{ key: 'terminal', label: 'שם מסוף' }, { key: 'appKey', label: 'מפתח אפליקציה' }, { key: 'secret', label: 'סוד', secret: true }],
  },
  {
    key: 'grow', name: 'Grow (משולם)', kind: 'payments', available: false, docsUrl: 'https://grow-il.readme.io/',
    fields: [{ key: 'userId', label: 'מזהה משתמש' }, { key: 'pageCode', label: 'קוד עמוד תשלום' }, { key: 'apiKey', label: 'מפתח API', secret: true }],
  },
  {
    key: 'payplus', name: 'PayPlus', kind: 'payments', available: false, docsUrl: 'https://docs.payplus.co.il/',
    fields: [{ key: 'apiKey', label: 'API Key' }, { key: 'secretKey', label: 'Secret Key', secret: true }, { key: 'pageUid', label: 'מזהה עמוד תשלום' }],
  },
  { key: 'sandbox', name: 'סביבת בדיקה', kind: 'payments', available: true, docsUrl: '', fields: [] },
];

const ADAPTERS: Record<string, PaymentAdapter> = { sandbox };

export function paymentAdapter(provider: string): PaymentAdapter {
  const a = ADAPTERS[provider];
  if (!a) throw new Error(`No payment adapter for "${provider}"`);
  return a;
}

export const paymentProvider = (key: string) => PAYMENT_PROVIDERS.find(p => p.key === key);
