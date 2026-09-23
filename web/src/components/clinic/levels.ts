import 'server-only';
import type { ClinicArea } from '@/lib/server/clinic';

// Nav for the /clinic header. Items whose level is `none` are removed (04-permissions.md) via
// clinicLevel from lib/server/clinic.ts; the pages themselves still gate through clinicContext.

export { clinicLevel } from '@/lib/server/clinic';

export const CLINIC_NAV: Array<{ area: ClinicArea; name: string; href: string }> = [
  { area: 'bookings', name: 'תורים', href: '/clinic' },
  { area: 'consults', name: 'בקשות ייעוץ', href: '/clinic/consults' },
  { area: 'waitlist', name: 'רשימת המתנה', href: '/clinic/waitlist' },
  { area: 'giftcards', name: 'שוברי מתנה', href: '/clinic/gift-cards' },
];
