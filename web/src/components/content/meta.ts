// Legal and company facts shared by About, Standards and Legal.
// Legal: update the dates and versions here only. Every page reads them from this file.

/** Visible stand-in for any fact counsel or the company has not supplied yet. */
export const PENDING = '[יושלם לפני העלייה לאוויר]';
/** Visible stand-in for the accessibility review date (legally required in the statement). */
export const PENDING_REVIEW = 'יעודכן לפני העלייה לאוויר';

export type DocKey = 'privacy' | 'terms' | 'accessibility' | 'standards';

/**
 * "עודכן לאחרונה" per document, ISO date (Asia/Jerusalem) + version.
 * TODO(legal): set the real publication dates and versions before launch.
 */
export const DOC_UPDATED: Record<DocKey, { date: string; version: string }> = {
  privacy: { date: '2026-09-23', version: '1.0' },
  terms: { date: '2026-09-23', version: '1.0' },
  accessibility: { date: '2026-09-23', version: '1.0' },
  standards: { date: '2026-09-23', version: '1.0' },
};

/**
 * Company details. null = not supplied yet, rendered as PENDING.
 * TODO(legal): legal name, ח.פ., registered address, privacy officer, accessibility coordinator.
 * Never fill these with invented values.
 */
export const COMPANY = {
  brand: 'BeautyFind',
  legalName: null as string | null,
  companyNo: null as string | null, // ח.פ.
  address: null as string | null,
  privacyOfficer: null as string | null,
  accessibilityCoordinator: null as string | null,
  accessibilityPhone: null as string | null, // E.164 when known, e.g. +9723…
  /** Date of the last accessibility review (ISO). null until the audit is done. */
  accessibilityReviewedAt: null as string | null,
};

export const orPending = (v: string | null) => v ?? PENDING;

/** Role mailboxes. TODO(legal): confirm each mailbox exists and is monitored before launch. */
export const MAIL = {
  privacy: 'privacy@beautyfind.co.il',
  legal: 'legal@beautyfind.co.il',
  access: 'access@beautyfind.co.il',
};

/** ISO date → DD/MM/YYYY (07-rules-and-tokens: dates are DD/MM/YYYY). */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
