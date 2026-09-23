// Product switches shared by server and client code.

/**
 * Online booking ships in phase 4. Until then no public page may claim, count or filter on it,
 * whatever a branch's onlineBooking flag says. Flip this when /book/[branch] is live.
 */
export const BOOKING_LIVE = false;
