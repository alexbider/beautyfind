import type { MarketingOrderStatus } from '@prisma/client';

export const STATUS_TONE: Record<MarketingOrderStatus, 'warn' | 'ok' | 'bad' | 'neutral'> = {
  quote_requested: 'warn', quoted: 'neutral', awaiting_payment: 'neutral', paid: 'warn', onboarding: 'warn', in_progress: 'ok', active: 'ok', completed: 'ok', past_due: 'bad', cancelled: 'neutral',
};
