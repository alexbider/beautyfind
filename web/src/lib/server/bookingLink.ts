import 'server-only';
import { hmac } from './crypto';
import { siteUrl } from './site';

// Guest links to a booking (/b/:token), kept apart from booking.ts so light modules (the reminder run) can build
// them without loading the booking flow.

/** Signed, non-expiring guest token for a booking. Grants view/reschedule/cancel of that booking only. */
export function bookingToken(bookingId: string) {
  const id = bookingId.replace(/-/g, '');
  return `${id}.${hmac('booking:' + bookingId).slice(0, 32)}`;
}

export function bookingIdFromToken(token: string): string | null {
  const m = /^([0-9a-f]{32})\.([0-9a-f]{32})$/.exec(token);
  if (!m) return null;
  const h = m[1];
  const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  return hmac('booking:' + id).slice(0, 32) === m[2] ? id : null;
}

export const manageUrl = (bookingId: string) => `${siteUrl()}/b/${bookingToken(bookingId)}`;
