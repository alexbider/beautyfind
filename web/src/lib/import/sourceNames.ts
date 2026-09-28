// Hebrew names for the outcomes each source records on an import record, shared by the admin screens.

/** crawl.site: what happened when the worker read the business's website. */
export const SITE_OUTCOME_NAME: Record<string, string> = {
  ok: 'האתר נקרא',
  no_email: 'נקרא, בלי דוא״ל',
  blocked: 'האתר חסם',
  robots: 'robots.txt אוסר',
  failed: 'האתר לא נטען',
  unsafe: 'כתובת לא בטוחה',
  unrelated: 'אתר של עסק אחר',
  directory: 'אינדקס, לא אתר',
  social_profile: 'רשת חברתית',
  linkhub: 'דף קישורים',
  google_profile: 'רק פרופיל Google',
  no_website: 'אין אתר',
  not_modified: 'לא השתנה',
  skipped_complete: 'לא נדרש',
};

/** Result of an Apify read of a Facebook page or Instagram profile. */
export const SOCIAL_CHECK_NAME: Record<string, string> = { match: 'תואם לעסק', no_match: 'לא תואם', unavailable: 'לא זמין', found: 'נמצא', not_found: 'לא נמצא', done: 'נבדק' };

/** Result of the ChatGPT research step. */
export const RESEARCH_NAME: Record<string, string> = { filled: 'השלים', nothing: 'לא מצא מקורות', failed: 'נכשל' };
