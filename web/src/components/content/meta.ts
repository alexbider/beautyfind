// Legal and company facts shared by About, Standards and Legal.
// Legal: update the dates and versions here only. Every page reads them from this file.

/** Visible stand-in for any fact counsel or the company has not supplied yet. */
export const PENDING = '[יושלם לפני העלייה לאוויר]';
/** Visible stand-in for the accessibility review date (legally required in the statement). */
export const PENDING_REVIEW = 'יעודכן לפני העלייה לאוויר';

export type DocKey = 'privacy' | 'terms' | 'accessibility' | 'standards';

/** "עודכן לאחרונה" per document, ISO date (Asia/Jerusalem) + version. Bump both on every material change. */
export const DOC_UPDATED: Record<DocKey, { date: string; version: string }> = {
  privacy: { date: '2026-09-23', version: '1.0' },
  terms: { date: '2026-09-23', version: '1.0' },
  accessibility: { date: '2026-09-23', version: '1.0' },
  standards: { date: '2026-09-23', version: '1.0' },
};

/**
 * Company details (approved by the company, 2026-09-23). BeautyFind is operated by Israfind Group,
 * a Delaware company, so there is no Israeli ח.פ. Contacts are role mailboxes, never personal names.
 * null = not applicable, and the field is omitted from the page.
 */
export const COMPANY = {
  brand: 'BeautyFind',
  legalName: 'Israfind Group' as string | null,
  jurisdiction: 'מדינת דלאוור, ארצות הברית',
  companyNo: null as string | null, // Israeli ח.פ.: not applicable to a Delaware company
  address: null as string | null, // correspondence by email (MAIL) until a postal address is set
  privacyOfficer: 'ממונה הגנת הפרטיות, בכתובת privacy@beautyfind.co.il' as string | null,
  accessibilityCoordinator: 'רכז/ת הנגישות, בכתובת access@beautyfind.co.il' as string | null,
  accessibilityPhone: null as string | null, // E.164 when a phone line is set up
  /** Date of the last accessibility review (ISO). */
  accessibilityReviewedAt: '2026-09-23' as string | null,
};

export const orPending = (v: string | null) => v ?? PENDING;

/** Role mailboxes. They must exist and be monitored before launch. */
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
