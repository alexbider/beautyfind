import 'server-only';
import { cache } from 'react';
import { platformSettings } from './platformSettings';

/** The VAT rate shown on consumer prices (/ops/settings, "מע״מ להצגה"), read once per request. */
export const vatRatePct = cache(async (): Promise<number> => (await platformSettings()).vatRatePct);
