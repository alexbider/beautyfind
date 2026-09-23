// Types and copy shared by the verification page (server) and console (client).
// No server imports here.

export type Kind = 'business' | 'license' | 'cert' | 'claim';
export type Status = 'open' | 'awaiting_document' | 'approved' | 'rejected';
export type Tone = 'ok' | 'warn' | 'bad' | 'todo';
export type Action = 'approve' | 'reject' | 'request_document' | 'reopen';

/** A run of text; `ltr` runs are refs, numbers, phones, emails and dates inside Hebrew. */
export type Seg = { t: string; ltr?: boolean };
export type Row = { k: string; v: Seg[]; tone?: Tone; selectId?: string };

export type LogEntry = { id: string; action: string; actor: string; role: string; at: Seg[]; reason: string | null };

export type QueueItem = {
  id: string;
  ref: string;
  kind: Kind;
  status: Status;
  what: string;
  who: string;
  biz: string;
  when: Seg[];
  sla: Seg[];
  slaUrgent: boolean;
  flags: Array<{ tone: 'warn' | 'bad'; text: string }>;
  submitted: Row[];
  context: Row[];
  source: { name: string; rows: Row[] };
  doc: { url: string; isImage: boolean; label: string } | null;
  checks: Array<{ tone: Tone; text: string }>;
  outcome: Seg[] | null;
  log: LogEntry[];
};

export type DecideActionResult =
  | { ok: true; status: Status }
  | { ok: false; error: 'not_found' | 'forbidden' | 'closed' | 'reason_required' | 'license_pending' | 'already_owned' | 'invalid' | 'failed'; related?: string };

export const KIND_FILTERS = [
  { key: 'all', name: 'הכל' },
  { key: 'business', name: 'רישום עסק חדש' },
  { key: 'license', name: 'רישיונות ותעודות' },
  { key: 'claim', name: 'בעלות' },
] as const;
export type KindFilter = (typeof KIND_FILTERS)[number]['key'];

export const STATUS_FILTERS = [
  { key: 'all', name: 'הכל' },
  { key: 'open', name: 'פתוחות' },
  { key: 'awaiting_document', name: 'ממתינות למסמך' },
  { key: 'approved', name: 'אושרו' },
  { key: 'rejected', name: 'נדחו' },
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number]['key'];

export const inKind = (k: Kind, f: KindFilter) => f === 'all' || (f === 'license' ? k === 'license' || k === 'cert' : k === f);
export const isActive = (s: Status) => s === 'open' || s === 'awaiting_document';

export const STATUS_NAME: Record<Status, string> = {
  open: 'ממתין',
  awaiting_document: 'ממתין למסמך',
  approved: 'אושר',
  rejected: 'נדחה',
};

// Reasons sent to the business. Free text is always allowed as well.
export const REJECT_REASONS: Record<Kind, string[]> = {
  business: ['ח.פ. / ע.מ. לא נמצא או אינו תואם', 'הכתובת אינה קיימת או אינה תואמת', 'הטיפולים אינם תואמים לקטגוריות או לתקנון'],
  license: ['המספר לא נמצא בפנקס', 'הרישיון אינו בתוקף או מושעה', 'השם אינו תואם ולא הומצא אישור'],
  cert: ['המסמך אינו קריא או חתוך', 'המוסד אינו מוכר', 'חשש לזיוף, הועבר לבדיקה'],
  claim: ['לעסק יש בעלים מאומת/ת', 'לא ניתן לאמת קשר לעסק', 'מסמכי העסק על שם אחר'],
};

export const DOCUMENT_REASONS: Record<Kind, string[]> = {
  business: ['תעודת עוסק או אישור רישום חברה', 'אישור כתובת הסניף (חוזה שכירות או חשבון)'],
  license: ['צילום רישיון בתוקף', 'תעודת זהות או אישור שינוי שם'],
  cert: ['סריקה קריאה של התעודה, עם חותמת וחתימה', 'אישור מהמוסד המכשיר'],
  claim: ['מסמך רישום העסק (ח.פ. / ע.מ.)', 'חשבון או חוזה שכירות על שם העסק'],
};

export const APPROVE_LABEL: Record<Kind, string> = {
  business: 'אישור ופרסום העסק',
  license: 'אישור רישיון',
  cert: 'אישור תעודה',
  claim: 'אישור בעלות',
};

export const TOAST: Record<Action, string> = {
  approve: 'אושר · הודעה נשלחה לעסק',
  request_document: 'הבקשה נשלחה לעסק במייל',
  reject: 'נדחה · הסבר נשלח לעסק',
  reopen: 'הבקשה חזרה לתור · שעון ה־SLA חודש',
};

export function errorText(r: Extract<DecideActionResult, { ok: false }>, action: Action): string {
  switch (r.error) {
    case 'reason_required':
      return action === 'request_document'
        ? 'יש לבחור איזה מסמך לבקש או לכתוב אותו. הבקשה תישלח לעסק.'
        : 'יש לבחור סיבה או לכתוב אותה. היא תישלח לעסק.';
    case 'license_pending':
      return `אי אפשר לפרסם עדיין: לסניף עם טיפולים רפואיים יש רופא/ה שהרישיון שלו/ה טרם אומת.${r.related ? ` אשרו קודם את ${r.related}.` : ' אשרו קודם את בקשת הרישיון.'}`;
    case 'already_owned':
      return 'לעסק כבר יש בעלים מאומת/ת. אפשר לדחות את הבקשה ולהציע הזמנה לצוות במקום בעלות.';
    case 'closed':
      return 'כבר התקבלה החלטה בבקשה הזו. התור עודכן.';
    case 'not_found':
      return 'הבקשה לא נמצאה. ייתכן שהוסרה, התור עודכן.';
    case 'forbidden':
      return 'אין לך הרשאה לקבל החלטות אימות.';
    case 'invalid':
      return action === 'reopen'
        ? 'אפשר להחזיר לתור רק בקשה שממתינה למסמך.'
        : 'בבקשה חסרים נתונים הדרושים לאישור (רישיון או סניף). אי אפשר לאשר אותה מכאן.';
    default:
      return 'הפעולה לא הושלמה. נסו שוב בעוד רגע.';
  }
}
