// Plain-language lines for the activity feed and the audit log: who did what, from the audit rows
// (AuditLog) and the append-only decisions (Decision). Pure: no database, no dates formatted here.

export type ActorKind = 'person' | 'ai' | 'system';
export const ACTOR_KIND_NAMES: Record<ActorKind, string> = { person: 'אדם', ai: 'AI', system: 'מערכת' };

type Meta = Record<string, unknown> | null | undefined;
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);

const AUDIT: Record<string, string> = {
  staff_login: 'נכנס/ה לניהול',
  staff_login_failed: 'ניסיון כניסה נכשל',
  staff_login_denied: 'כניסה נדחתה (ללא תפקיד צוות)',
  staff_password_setup: 'הגדיר/ה סיסמת צוות',
  staff_invite: 'הזמין/ה איש צוות',
  staff_role_change: 'שינה/תה תפקיד צוות',
  staff_role_remove: 'הסיר/ה תפקיד צוות',
  permissions_change: 'שינה/תה הרשאות תפקיד',
  platform_settings: 'עדכן/ה הגדרות פלטפורמה',
  business_status: 'שינה/תה מצב עסק',
  client_block: 'חסם/ה חשבון לקוחה',
  client_unblock: 'שחרר/ה חסימת חשבון',
  privacy_request_done: 'ביצע/ה בקשת פרטיות',
  privacy_anonymize: 'ביצע/ה מחיקת חשבון (אנונימיזציה)',
  dispute_open: 'פתח/ה מחלוקת',
  dispute_decide: 'החליט/ה במחלוקת',
  campaign_review: 'בדק/ה מקום ממומן',
  review_moderate: 'טיפל/ה בביקורת',
  contact_status: 'עדכן/ה פנייה',
  expense_create: 'רשם/ה הוצאה',
  expense_update: 'עדכן/ה הוצאה',
  expense_delete: 'מחק/ה הוצאה',
  platform_invoice: 'הפיק/ה חשבונית',
  subscription_update: 'עדכן/ה מנוי',
  seo_update: 'עדכן/ה SEO של עמוד',
  template_draft: 'עדכן/ה טיוטת תבנית',
  ai_action_decide: 'החליט/ה על בקשת AI',
  ai_action_execute: 'ביצע/ה בקשת AI',
  ai_assistant_query: 'שאל/ה את העוזר',
  support_login: 'כניסה כתמיכה · צפייה בלבד',
  read_declaration: 'קרא/ה הצהרת בריאות',
  read_clinical: 'קרא/ה רישום קליני',
  provider_disconnect: 'ניתק/ה ספק',
  integration_check: 'בדק/ה אינטגרציה',
  ai_completion_requested: 'הפעיל/ה השלמה ב־AI',
  import_record_seeded: 'יצר/ה רשומת ייבוא מרישום ידני',
  branch_edit: 'ערך/ה פרופיל סניף',
  ai_alt_generated: 'יצר/ה תיאור תמונה ב־AI',
  treatments_edit: 'ערך/ה טיפולים ומחירים',
  business_edit: 'ערך/ה פרטי עסק',
  audit_export: 'ייצא/ה את יומן הפעולות',
  businesses_export: 'ייצא/ה רשימת עסקים',
  google_lookup: 'ביצע/ה חיפוש Google',
  gift_card_cancel: 'ביטל/ה כרטיס מתנה',
  import_export: 'ייצא/ה רשומות ייבוא',
  import_settings: 'עדכן/ה הגדרות ייבוא',
  import_run_delete: 'מחק/ה ריצת ייבוא',
  import_reset: 'איפס/ה את הייבוא',
  import_recover: 'חידש/ה ריצת ייבוא',
  import_reconcile: 'סגר/ה התאמת חיוב בייבוא',
  import_publish_run: 'פרסם/ה רשומות ייבוא',
  import_enrich_selected: 'שלח/ה עסקים להשלמה',
  import_enhance: 'השלים/ה עסק מהייבוא',
  import_copy_images: 'העתיק/ה תמונות',
};

const DECISION: Record<string, string> = {
  approve: 'אישר/ה',
  reject: 'דחה/תה',
  request_document: 'ביקש/ה מסמך',
  reopen: 'פתח/ה מחדש',
  delete_request: 'ביקש/ה מחיקת חשבון',
  delete_done: 'השלים/ה מחיקת חשבון',
  delete_rejected: 'דחה/תה בקשת מחיקה',
  recommended_refund: 'המליץ/ה להחזיר',
  closed_policy_upheld: 'קבע/ה שהמדיניות נאכפה',
  escalated_legal: 'העביר/ה ליועמ״ש',
  publish: 'פרסם/ה',
  remove: 'הסיר/ה',
  resend_declaration: 'שלח/ה הצהרה שוב',
};

const SUBJECT: Record<string, string> = {
  user: 'חשבון', business: 'עסק', branch: 'סניף', booking: 'תור', review: 'ביקורת', dispute: 'מחלוקת', campaign: 'מקום ממומן',
  verification_request: 'בקשת אימות', consult_request: 'בקשת ייעוץ', contact_message: 'פנייה', expense: 'הוצאה', document: 'מסמך',
  platform_settings: 'הגדרות', import_settings: 'הגדרות ייבוא', import_run: 'ריצת ייבוא', import_place: 'רשומת ייבוא', ai_action: 'בקשת AI', page_seo: 'עמוד', subscription: 'מנוי',
};

export function actorKind(actorId: string | null, meta: Meta, actorRole?: string | null): ActorKind {
  const src = str(meta?.source) ?? actorRole ?? '';
  if (/^(ai|assistant|mcp)/i.test(src)) return 'ai';
  if (!actorId) return 'system';
  return 'person';
}

/** "אישר מקום ממומן" plus the subject line "AD-85 · לומה מדיקל". */
export function describeAudit(action: string, subjectType: string, meta: Meta): { text: string; detail: string } {
  const label = AUDIT[action] ?? action.replace(/_/g, ' ');
  const parts = [str(meta?.ref), str(meta?.label) ?? str(meta?.name), str(meta?.note)].filter((x): x is string => !!x);
  const subject = SUBJECT[subjectType] ?? subjectType;
  return { text: label, detail: parts.length ? parts.join(' · ') : subject };
}

export function describeDecision(action: string, subjectType: string, reason: string | null): { text: string; detail: string } {
  const subject = SUBJECT[subjectType] ?? subjectType;
  const label = DECISION[action] ?? action.replace(/_/g, ' ');
  return { text: `${label} · ${subject}`, detail: reason ?? subject };
}
