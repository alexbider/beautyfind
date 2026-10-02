// Product switches shared by server and client code.

/**
 * Online booking (phase 4). When false, no public page may claim, count or filter on it, whatever a
 * branch's onlineBooking flag says. Turn off to take booking offline without a deploy of each page.
 */
export const BOOKING_LIVE = true;

/**
 * Consumer prices shown including VAT (the default). NEXT_PUBLIC_PRICES_INCLUDE_VAT=0 shows the stored
 * amounts as "before VAT" again. BeautyFind's own plan prices are never affected (src/lib/pricing.ts).
 */
export const PRICES_INCLUDE_VAT = process.env.NEXT_PUBLIC_PRICES_INCLUDE_VAT !== '0';
/** "כולל מע״מ" next to a consumer price. */
export const VAT_LABEL = PRICES_INCLUDE_VAT ? 'כולל מע״מ' : 'לא כולל מע״מ';
/** The same label where the copy said "לפני מע״מ". */
export const VAT_LABEL_BEFORE = PRICES_INCLUDE_VAT ? 'כולל מע״מ' : 'לפני מע״מ';
/** "כוללים" / "לא כוללים", for sentences such as "המחירים ... מע״מ". */
export const VAT_VERB = PRICES_INCLUDE_VAT ? 'כוללים' : 'לא כוללים';
