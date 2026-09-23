// Payments & invoicing tab: DTOs passed from the server page to the client panels (no credentials, ever).

export type ProviderKindKey = 'payments' | 'invoicing';

export interface ProviderDTO {
  key: string;
  name: string;
  kind: ProviderKindKey;
  available: boolean;
  docsUrl: string;
  fields: Array<{ key: string; label: string; secret: boolean; help: string | null }>;
  connection: null | {
    status: 'pending' | 'connected' | 'error' | 'disabled';
    lastError: string | null;
    checked: string | null; // DD/MM/YYYY HH:MM
    testMode: boolean;
  };
}

export interface PolicyDTO {
  enabled: boolean;
  mode: 'fixed' | 'percent';
  value: number; // shekels when fixed, whole percent when percent
  scope: 'all' | 'medical_only' | 'per_treatment';
  refundWindowHours: number;
  waitlistHoldMinutes: number;
  consultFeeShekels: number;
}

export interface TreatmentDepositDTO {
  id: string;
  name: string;
  branch: string;
  priceShekels: number; // before VAT
  isMedical: boolean;
  depositShekels: number | null;
}

export const DEFAULT_HOLD_MINUTES = 30;
export const DEFAULT_CONSULT_FEE = 200;

/** Hebrew text for adapter verify error codes. */
export function verifyErrorText(code: string | null): string {
  if (!code) return 'החיבור נכשל.';
  if (code === 'sandbox_disabled') return 'סביבת הבדיקה כבויה בשרת הזה.';
  if (code === 'no_adapter') return 'החיבור לספק הזה עדיין לא זמין.';
  if (code === 'unreachable') return 'לא הצלחנו להגיע לשרת של הספק. נסו שוב בעוד כמה דקות.';
  if (code === 'invalid_credentials') return 'הספק דחה את הפרטים. בדקו שהעתקתם אותם במלואם.';
  return `הספק החזיר שגיאה: ${code}`;
}
