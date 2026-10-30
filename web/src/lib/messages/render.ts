// The text of every message the platform sends, rendered from a template id and its vars: an email (subject,
// RTL HTML, plain text) and a short SMS. Pure, so it is shared by the senders, the admin preview and the tests.
// Codes and personal details appear only in the message itself, never in logs.
//
// Every email uses one layout (emailBody): logo, a small kicker, a headline, the opening paragraphs, an optional
// details card (label and value rows), an optional big code, the button, an optional note, then the footer.

import { reasonInfo, isContactReason } from '@/components/contact/reasons';

export type Kicker = 'booking' | 'consult' | 'gift' | 'payment' | 'account' | 'team' | 'business' | 'support' | 'invite';

export interface Rendered {
  subject: string;
  /** Short line shown by mail apps next to the subject (hidden in the body). */
  preheader?: string;
  /** Small label above the headline. */
  kicker?: Kicker;
  /** The headline; the subject when absent. */
  title?: string;
  /** Paragraphs of the email body, in order. */
  lines: string[];
  /** Label and value rows shown in a card under the paragraphs. Empty values are dropped. */
  details?: Array<[string, string]>;
  /** A code shown large (verification code, gift card code). */
  code?: string;
  cta?: { label: string; url: string };
  /** A boxed note under the button: info (teal) or warn (amber). */
  note?: { tone: 'info' | 'warn'; text: string };
  /** The SMS version: one short message, link included. */
  sms: string;
  /** Marketing and first-contact messages carry an unsubscribe link (Communications Law §30A). */
  unsubscribe?: string;
}

const BRAND = 'BeautyFind';
const v = (vars: Record<string, string>, k: string) => (vars[k] ?? '').trim();
const hi = (name: string) => (name ? `שלום ${name},` : 'שלום,');
const join = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

/** How the client answers a consultation message: the reply page on a paid plan, else a call to the business. */
function replyLine(vars: Record<string, string>): { line: string; sms: string; cta?: { label: string; url: string } } {
  const link = v(vars, 'reply_link');
  if (link) return { line: 'אפשר להשיב לעסק בקישור, והתשובה תגיע אליהם ישירות.', sms: `לתשובה לעסק: ${link}`, cta: { label: 'תשובה לעסק', url: link } };
  const phone = v(vars, 'business_phone');
  return phone ? { line: `לתשובה, אפשר להתקשר לעסק: ${phone}.`, sms: `לתשובה התקשרו לעסק: ${phone}` } : { line: '', sms: '' };
}

/** Verification code text (also used by the SMS and voice senders). */
export function codeText(vars: Record<string, string>): string {
  return `קוד האימות שלך ב-${BRAND}: ${v(vars, 'code')}. בתוקף ${v(vars, 'minutes') || '10'} דקות. אין למסור את הקוד לאיש.`;
}

const STATUS_TEXT: Record<string, string> = {
  approved: 'הבקשה אושרה.',
  rejected: 'הבקשה נדחתה.',
  awaiting_document: 'כדי להמשיך בבדיקה אנחנו צריכים מסמך נוסף.',
};

/** Renders one template. Null for an unknown template (the caller then keeps the default adapter). */
export function renderMessage(template: string, vars: Record<string, string>, site: string): Rendered | null {
  const root = site.replace(/\/+$/, '');
  const name = v(vars, 'name');
  const business = v(vars, 'business');
  const link = v(vars, 'link');
  const when = v(vars, 'date') && v(vars, 'time') ? `${v(vars, 'date')} בשעה ${v(vars, 'time')}` : v(vars, 'date') || v(vars, 'time');
  const bookingRows = (): Array<[string, string]> => [
    ['טיפול', v(vars, 'treatment')],
    ['מקום', business],
    ['מתי', when],
    ['אצל', v(vars, 'practitioner')],
    ['כתובת', v(vars, 'address')],
    ['מספר הזמנה', v(vars, 'ref')],
  ];

  switch (template) {
    // ---------- Account ----------
    case 'M16_otp':
      return {
        subject: `קוד האימות שלך ב-${BRAND}`, preheader: `הקוד בתוקף ${v(vars, 'minutes') || '10'} דקות`, kicker: 'account', title: 'קוד האימות שלך',
        lines: ['זה הקוד להשלמת הכניסה. מקלידים אותו במסך שממנו ביקשת אותו.'],
        code: v(vars, 'code'),
        note: { tone: 'info', text: `הקוד בתוקף ${v(vars, 'minutes') || '10'} דקות. אין למסור אותו לאיש, גם לא לנציגי ${BRAND}. לא ביקשת קוד? אפשר להתעלם מההודעה.` },
        sms: codeText(vars),
      };

    case 'M17_reset':
      return {
        subject: `איפוס הסיסמה ב-${BRAND}`, preheader: 'הקישור בתוקף לזמן קצר ולשימוש אחד', kicker: 'account', title: 'בחירת סיסמה חדשה',
        lines: [hi(name), 'קיבלנו בקשה לאיפוס הסיסמה לחשבון שלך. אפשר לבחור סיסמה חדשה בכפתור.'],
        cta: { label: 'בחירת סיסמה חדשה', url: link },
        note: { tone: 'info', text: `הקישור בתוקף ${v(vars, 'minutes') || '30'} דקות ולשימוש אחד. לא ביקשת איפוס? אפשר להתעלם מההודעה, והסיסמה לא תשתנה.` },
        sms: `${BRAND}: לאיפוס הסיסמה: ${link} (בתוקף ${v(vars, 'minutes') || '30'} דקות)`,
      };

    // ---------- Team ----------
    case 'M18_staff_invite':
      return {
        subject: `הזמנה להצטרף לצוות של ${business}`, preheader: `${v(vars, 'inviter')} מזמינים אותך לצוות`, kicker: 'team', title: `הצטרפות לצוות של ${business}`,
        lines: [hi(name), `${v(vars, 'inviter')} הזמינו אותך להצטרף לצוות של ${business} ב-${BRAND}.`],
        details: [['תפקיד', v(vars, 'role')], ['בתוקף עד', v(vars, 'expires')]],
        cta: { label: 'לצפייה בהזמנה', url: link },
        sms: `${BRAND}: הזמנה להצטרף לצוות של ${business}: ${link}`,
      };
    case 'staff_invite_accepted':
      return { subject: `ההזמנה לצוות של ${business} התקבלה`, kicker: 'team', title: `${name} הצטרפו לצוות`, lines: [`${name} קיבלו את ההזמנה ומצטרפים לצוות של ${business}.`], details: [['תפקיד', v(vars, 'role')]], cta: { label: 'לעמוד הצוות', url: `${root}/biz/team` }, sms: `${BRAND}: ${name} הצטרפו לצוות של ${business}.` };
    case 'staff_invite_declined':
      return { subject: `ההזמנה לצוות של ${business} נדחתה`, kicker: 'team', title: 'ההזמנה נדחתה', lines: [`ההזמנה שנשלחה אל ${v(vars, 'email')} להצטרף לצוות של ${business} נדחתה.`, 'אם זו טעות, אפשר לשלוח הזמנה חדשה מעמוד הצוות.'], cta: { label: 'לעמוד הצוות', url: `${root}/biz/team` }, sms: `${BRAND}: ההזמנה אל ${v(vars, 'email')} נדחתה.` };
    case 'staff_invite_renewal_request':
      return { subject: `בקשה להזמנה חדשה לצוות של ${business}`, kicker: 'team', title: 'מבקשים הזמנה חדשה', lines: [`${v(vars, 'email')} מבקשים הזמנה חדשה לצוות של ${business}, כי ההזמנה הקודמת פגה או נדחתה.`], cta: { label: 'שליחת הזמנה חדשה', url: `${root}/biz/team` }, sms: `${BRAND}: ${v(vars, 'email')} מבקשים הזמנה חדשה לצוות.` };

    // ---------- Bookings ----------
    case 'M1_booking_confirmed':
    case 'M1_booking_rescheduled': {
      const moved = template === 'M1_booking_rescheduled';
      return {
        subject: moved ? `התור שלך ב${business} הועבר` : `התור שלך ב${business} אושר`,
        preheader: `${v(vars, 'treatment')}, ${when}`, kicker: 'booking', title: moved ? 'התור הועבר למועד חדש' : 'התור שלך אושר',
        lines: [hi(name), moved ? `התור ב${business} הועבר. אלה הפרטים המעודכנים:` : `שמרנו לך תור ב${business}. אלה הפרטים:`],
        details: bookingRows(),
        cta: { label: 'ניהול התור', url: link },
        note: { tone: 'info', text: 'צריך להעביר או לבטל? אפשר לעשות זאת מהכפתור, לפי מדיניות הביטול של העסק.' },
        sms: `${BRAND}: ${moved ? 'התור הועבר' : 'התור אושר'}. ${v(vars, 'treatment')} ב${business}, ${when}. הזמנה ${v(vars, 'ref')}. לניהול התור: ${link}`,
      };
    }

    case 'M2_reminder':
      return {
        subject: `תזכורת: התור שלך ב${business} מחר`, preheader: `${v(vars, 'treatment')}, ${when}`, kicker: 'booking', title: 'מתראים מחר',
        lines: [hi(name), `תזכורת לתור שלך מחר ב${business}.`],
        details: bookingRows(),
        cta: { label: 'ניהול התור', url: link },
        note: { tone: 'info', text: 'לא מסתדר? אפשר להעביר או לבטל מהכפתור, לפי מדיניות הביטול של העסק.' },
        sms: `${BRAND}: תזכורת לתור מחר ב${business}, ${when}. לניהול התור: ${link}`,
      };

    case 'M3_declaration_request':
      return {
        subject: `הצהרת בריאות לפני התור ב${business}`, preheader: 'כמה דקות, לפני שמגיעים', kicker: 'booking', title: 'הצהרת בריאות לפני הטיפול',
        lines: [hi(name), `לפני ${v(vars, 'treatment')} ב${business} צריך למלא הצהרת בריאות קצרה. זה לוקח כמה דקות.`],
        details: [['טיפול', v(vars, 'treatment')], ['מתי', when]],
        cta: { label: 'מילוי ההצהרה', url: link },
        note: { tone: 'info', text: 'הפרטים נשמרים מוצפנים, ורק הצוות המטפל יכול לראות אותם.' },
        sms: `${BRAND}: לפני התור ב${business} (${when}) צריך למלא הצהרת בריאות קצרה: ${link}`,
      };

    case 'M5_aftercare':
      return { subject: `הנחיות אחרי הטיפול ב${business}`, preheader: 'מה כדאי לעשות בימים הקרובים', kicker: 'booking', title: 'אחרי הטיפול', lines: [hi(name), `תודה שביקרת ב${business}. ריכזנו בשבילך את ההנחיות לימים שאחרי הטיפול.`], cta: { label: 'להנחיות', url: link }, sms: `${BRAND}: תודה שביקרת ב${business}. הנחיות אחרי הטיפול: ${link}` };

    case 'M6_review_request':
      return {
        subject: `איך היה ב${business}?`, preheader: 'ביקורת קצרה, פחות מדקה', kicker: 'booking', title: `איך היה ב${business}?`,
        lines: [hi(name), 'מקווים שנהנית מהטיפול. נשמח לשמוע איך היה: ביקורת קצרה עוזרת לאחרים לבחור, ולעסק להשתפר.'],
        cta: { label: 'לכתיבת ביקורת', url: link },
        note: { tone: 'info', text: 'רק מי שהגיעו לתור יכולים לכתוב ביקורת, ולכן הביקורות ב-BeautyFind אמינות.' },
        sms: `${BRAND}: איך היה ב${business}? נשמח לביקורת קצרה (פחות מדקה): ${link}`,
      };

    case 'M7_waitlist_offer':
      return {
        subject: 'התפנה תור מרשימת ההמתנה', preheader: `שמור לך ${v(vars, 'minutes')} דקות`, kicker: 'booking', title: 'התפנה לך תור',
        lines: [hi(name), 'התפנה תור שמתאים לבקשה שלך ברשימת ההמתנה.'],
        details: [['מתי', when], ['שמור לך', `${v(vars, 'minutes')} דקות`]],
        cta: { label: 'לאישור התור', url: link },
        note: { tone: 'warn', text: 'אם לא מאשרים בזמן, התור מוצע לבא/ה בתור.' },
        sms: `${BRAND}: התפנה תור ${when}, שמור לך ${v(vars, 'minutes')} דקות: ${link}`,
      };

    case 'M12_clinic_cancelled':
      return {
        subject: `התור ${v(vars, 'ref')} בוטל`, preheader: 'אם שולם פיקדון, הוא יוחזר במלואו', kicker: 'booking', title: 'העסק ביטל את התור',
        lines: ['שלום,', 'מצטערים, העסק ביטל את התור שלך.'],
        details: [['מספר הזמנה', v(vars, 'ref')], ['הסיבה', v(vars, 'reason')]],
        cta: { label: `לחיפוש תור חדש`, url: root },
        note: { tone: 'info', text: 'אם שולם פיקדון, הוא יוחזר במלואו לאמצעי התשלום.' },
        sms: `${BRAND}: העסק ביטל את התור ${v(vars, 'ref')}${v(vars, 'reason') ? ` (${v(vars, 'reason')})` : ''}. אם שולם פיקדון, הוא יוחזר במלואו.`,
      };

    case 'M13_client_cancelled': {
      const refunded = Number(v(vars, 'refunded') || '0');
      const late = v(vars, 'late') === '1';
      const money = refunded > 0 ? `${refunded.toLocaleString('en-US')} ₪ יוחזרו לאמצעי התשלום.` : late ? 'הביטול נעשה אחרי המועד שבמדיניות הביטול, ולכן הפיקדון לא מוחזר.' : '';
      return {
        subject: `התור ${v(vars, 'ref')} בוטל`, kicker: 'booking', title: 'התור בוטל',
        lines: [hi(name), 'ביטלנו את התור לפי בקשתך.'],
        details: [['מתי היה', when], ['מספר הזמנה', v(vars, 'ref')]],
        ...(money ? { note: { tone: refunded > 0 ? 'info' as const : 'warn' as const, text: money } } : {}),
        cta: { label: 'לקביעת תור חדש', url: root },
        sms: join(`${BRAND}: התור ${when} בוטל (הזמנה ${v(vars, 'ref')}).`, money),
      };
    }

    // ---------- Consultations ----------
    case 'M8_consult_details': {
      const reply = replyLine(vars);
      return { subject: `בקשת הייעוץ ב${business}`, kicker: 'consult', title: 'צריך עוד כמה פרטים', lines: [hi(name), `${business} צריכים עוד כמה פרטים כדי לטפל בבקשת הייעוץ שלך.`, reply.line].filter(Boolean), details: [['מספר בקשה', v(vars, 'ref')]], ...(reply.cta ? { cta: reply.cta } : {}), sms: join(`${BRAND}: ${business} צריכים עוד פרטים לבקשת הייעוץ ${v(vars, 'ref')}.`, reply.sms) };
    }
    case 'M9_consult_proposal': {
      const reply = replyLine(vars);
      return { subject: `בקשת הייעוץ ב${business}`, kicker: 'consult', title: `${business} הציעו מועד`, lines: [v(vars, 'text'), reply.line].filter(Boolean), details: [['מספר בקשה', v(vars, 'ref')]], ...(reply.cta ? { cta: reply.cta } : {}), sms: join(`${BRAND}: ${v(vars, 'text')}`, reply.sms) };
    }
    case 'M10_consult_declined':
      return { subject: `בקשת הייעוץ ב${business}`, kicker: 'consult', title: 'תשובה לבקשת הייעוץ', lines: [v(vars, 'text')], cta: { label: 'לחיפוש עסקים נוספים', url: root }, sms: `${BRAND}: ${v(vars, 'text')}` };
    case 'M_consult_reply':
      return {
        subject: `תשובה מ${name} לבקשת הייעוץ ${v(vars, 'ref')}`, kicker: 'consult', title: `${name} השיבו`,
        lines: [`${name} השיבו לבקשת הייעוץ ב${business}.`],
        details: [['תשובה', v(vars, 'answer')], ['המועד שהוצע', v(vars, 'proposed')], ['ההודעה', v(vars, 'text')], ['טלפון', v(vars, 'phone')], ['מספר בקשה', v(vars, 'ref')]],
        cta: { label: 'לתיבת הייעוצים', url: link },
        sms: `${BRAND}: ${name} השיבו לבקשת הייעוץ ${v(vars, 'ref')}: ${v(vars, 'answer')}. ${link}`,
      };

    // ---------- Payments ----------
    case 'M11_refund':
      return {
        subject: `החזר כספי מ-${BRAND}`, preheader: `${v(vars, 'amount')} ₪ בדרך אלייך`, kicker: 'payment', title: 'ביצענו החזר',
        lines: ['שלום,', 'ההחזר בוצע לאמצעי התשלום שבו שילמת.'],
        details: [['סכום', `${v(vars, 'amount')} ₪`], ['הסיבה', v(vars, 'reason')]],
        note: { tone: 'info', text: 'ההחזר מופיע בדרך כלל בחשבון תוך כמה ימי עסקים, לפי חברת האשראי. חשבונית הזיכוי נשמרת בחשבון שלך.' },
        sms: `${BRAND}: ביצענו החזר של ${v(vars, 'amount')} ₪ לאמצעי התשלום שלך.`,
      };

    case 'M23_payment_failed': {
      const step = v(vars, 'step');
      const hide = v(vars, 'hide_date');
      return {
        subject: step === '0' ? `החיוב ב-${BRAND} לא עבר` : `תזכורת: החיוב ב-${BRAND} לא עבר`, preheader: 'עדכון הכרטיס לוקח דקה', kicker: 'payment', title: step === '0' ? 'החיוב החודשי לא עבר' : 'החיוב עדיין לא עבר',
        lines: [hi(name), `ניסינו לחייב את המנוי של ${business} והחיוב לא עבר. בדרך כלל זה כרטיס שפג תוקפו או חסימה זמנית של חברת האשראי.`],
        cta: { label: 'לעדכון אמצעי התשלום', url: link },
        ...(hide ? { note: { tone: 'warn' as const, text: `אם החיוב לא יוסדר עד ${hide}, הפרופיל יוסתר מהחיפוש עד שיוסדר.` } } : {}),
        sms: `${BRAND}: החיוב של ${business} לא עבר. לעדכון הכרטיס: ${link}${hide ? ` (הפרופיל יוסתר ב-${hide} אם לא יוסדר)` : ''}`,
      };
    }

    // ---------- Gift cards ----------
    case 'M14_gift_card': {
      const recipient = v(vars, 'recipient');
      return {
        subject: `קיבלת כרטיס מתנה ל${business}`, preheader: `${v(vars, 'buyer')} שלחו לך ${v(vars, 'amount')}`, kicker: 'gift', title: 'קיבלת כרטיס מתנה',
        lines: [hi(recipient), `${v(vars, 'buyer')} שלחו לך כרטיס מתנה ל${business}.`, v(vars, 'message') ? `„${v(vars, 'message')}”` : ''].filter(Boolean),
        details: [['סכום', v(vars, 'amount')], ['איפה', business]],
        code: v(vars, 'code'),
        cta: { label: 'לבדיקת הכרטיס', url: link },
        note: { tone: 'info', text: 'אפשר לממש בקביעת תור באתר או בעסק עצמו. כדאי לשמור את המייל הזה.' },
        sms: `${BRAND}: ${v(vars, 'buyer')} שלחו לך כרטיס מתנה בסך ${v(vars, 'amount')} ל${business}. קוד: ${v(vars, 'code')}. פרטים: ${link}`,
      };
    }

    case 'M15_gift_expiry': {
      const days = v(vars, 'days');
      return {
        subject: `כרטיס המתנה ל${business} פג בעוד ${days} ימים`, preheader: `נשארו ${v(vars, 'amount')} בכרטיס`, kicker: 'gift', title: 'כרטיס המתנה שלך פג בקרוב',
        lines: [hi(name), `נשארה יתרה בכרטיס המתנה שלך ל${business}. כדאי לקבוע תור לפני שהתוקף פג.`],
        details: [['יתרה', v(vars, 'amount')], ['בתוקף עד', v(vars, 'expires')]],
        cta: { label: 'לבדיקת הכרטיס', url: link },
        sms: `${BRAND}: בכרטיס המתנה ל${business} נשארו ${v(vars, 'amount')}, בתוקף עד ${v(vars, 'expires')}. פרטים: ${link}`,
      };
    }

    // ---------- Businesses ----------
    case 'M4_clinic_checked_in':
      return { subject: `צ׳ק־אין לתור של ${v(vars, 'time')}`, kicker: 'business', title: 'הלקוח/ה הגיע/ה', lines: ['בוצע צ׳ק־אין לתור.'], details: [['שעה', v(vars, 'time')], ['מספר הזמנה', v(vars, 'ref')]], cta: { label: 'לתור', url: link }, sms: `${BRAND}: בוצע צ׳ק־אין לתור של ${v(vars, 'time')} (הזמנה ${v(vars, 'ref')}): ${link}` };
    case 'M4_clinic_declaration_flagged':
      return { subject: `הצהרת בריאות לבדיקה: הזמנה ${v(vars, 'ref')}`, kicker: 'business', title: 'הצהרת בריאות לבדיקה', lines: ['בהצהרת הבריאות לתור הזה יש סעיפים שצריך לבדוק לפני הטיפול.'], details: [['מתי', when], ['מספר הזמנה', v(vars, 'ref')]], cta: { label: 'לתור ולהצהרה', url: link }, note: { tone: 'warn', text: 'כדאי לעבור על ההצהרה לפני שהלקוח/ה מגיע/ה.' }, sms: `${BRAND}: בהצהרת הבריאות לתור ${v(vars, 'ref')} (${when}) יש סעיפים לבדיקה לפני הטיפול: ${link}` };

    case 'M_profile_lead':
      return {
        subject: `פנייה חדשה ל${business} מ-${BRAND}`, preheader: `${name} מחכים לתשובה`, kicker: 'business', title: 'פנייה חדשה',
        lines: [`פנייה חדשה הגיעה דרך הפרופיל של ${business}. כדאי לחזור מהר, לקוחות בוחרים בדרך כלל את מי שעונה ראשון.`],
        details: [['שם', name], ['טלפון', v(vars, 'phone')], ['אימייל', v(vars, 'email')], ['טיפול', v(vars, 'treatment')], ['הודעה', v(vars, 'message')]],
        cta: { label: 'לכל הפניות', url: v(vars, 'leads_link') || `${root}/biz/leads` },
        sms: `${BRAND}: פנייה חדשה מ${name} ל${business}. ${v(vars, 'leads_link')}`,
      };

    case 'M19_verification_outcome':
    case 'M20_claim_outcome': {
      const claim = template === 'M20_claim_outcome';
      const st = v(vars, 'status');
      const what = claim ? 'בקשת אישור הבעלות' : 'בקשת האימות';
      const verdict = st === 'approved' ? 'אושרה' : st === 'rejected' ? 'נדחתה' : 'נדרש מסמך';
      return {
        subject: `${what} ${v(vars, 'ref')}: ${verdict}`, kicker: 'business', title: `${what} ${verdict}`,
        lines: ['שלום,', STATUS_TEXT[st] ?? 'הבקשה עודכנה.'],
        details: [['מספר בקשה', v(vars, 'ref')], ['פירוט', v(vars, 'reason')]],
        cta: claim && st === 'approved' ? { label: 'להשלמת התשלום', url: `${root}/biz/billing` } : { label: 'ללוח הניהול', url: `${root}/biz` },
        ...(claim && st === 'approved' ? { note: { tone: 'warn' as const, text: 'נשאר צעד אחד: להשלים את התשלום על המסלול שבחרתם. לוח הבקרה נפתח לעריכה ברגע שהתשלום עובר.' } } : {}),
        ...(st === 'awaiting_document' ? { note: { tone: 'warn' as const, text: 'אפשר להעלות את המסמך מלוח הניהול. הבדיקה ממשיכה ברגע שהוא מגיע.' } } : {}),
        sms: `${BRAND}: ${what} ${v(vars, 'ref')}: ${STATUS_TEXT[st] ?? 'עודכנה.'}${claim && st === 'approved' ? ` להשלמת התשלום והפעלת לוח הבקרה: ${root}/biz/billing` : ''}`,
      };
    }

    case 'M22_sponsored_approved':
      return { subject: `המקום הממומן ${v(vars, 'ref')} אושר`, kicker: 'business', title: 'המקום הממומן אושר', lines: [hi(name), `המקום הממומן של ${business} אושר ויעלה לסליידר ״ממומן״ של העמוד שבחרתם.`, v(vars, 'card') === 'needed' ? `נשאר צעד אחד: לשמור כרטיס אשראי בלוח הבקרה, והמקום עולה מיד.${v(vars, 'free') ? ' החודש הראשון עלינו, והחיוב מתחיל רק בסופו.' : ''} בלי כרטיס המקום משתחרר אחרי שבוע.` : v(vars, 'free') ? 'החודש הראשון עלינו. החיוב החודשי מתחיל רק בסופו, ואפשר לבטל בכל רגע לפני כן.' : v(vars, 'later') ? `המקום עולה ב־${v(vars, 'start')}, והחיוב החודשי מתחיל באותו יום. אפשר לבטל בכל רגע מלוח הבקרה, ועד 48 שעות לפני ההתחלה בלי שום חיוב.` : 'החיוב החודשי מתבצע מהיום ובכל חודש באותו תאריך. אפשר לבטל בכל רגע מלוח הבקרה.'], details: [['איפה', v(vars, 'where')], ['מחיר', `${v(vars, 'price')} לחודש`], ['מספר', v(vars, 'ref')]], cta: { label: 'למקומות הממומנים שלי', url: link }, sms: `${BRAND}: המקום הממומן ${v(vars, 'ref')} (${v(vars, 'where')}) אושר.${v(vars, 'card') === 'needed' ? ' נשאר לשמור כרטיס כדי שיעלה:' : ''} ${link}` };
    case 'M22_sponsored_card':
      return { subject: `נשאר לשמור כרטיס: המקום הממומן ${v(vars, 'ref')}`, kicker: 'business', title: 'המקום שלכם מחכה לכרטיס', lines: [hi(name), `המקום הממומן של ${business} אושר, אבל עוד לא נשמר כרטיס אשראי, ולכן הוא לא מופיע באתר.${v(vars, 'free') ? ' החודש הראשון עדיין עלינו.' : ''} המקום שמור לכם עד ${v(vars, 'until')}, ואחרי זה הוא משתחרר לעסקים אחרים.`], details: [['איפה', v(vars, 'where')], ['מחיר', `${v(vars, 'price')} לחודש`], ['שמור עד', v(vars, 'until')]], cta: { label: 'לשמירת כרטיס', url: link }, sms: `${BRAND}: המקום הממומן ${v(vars, 'ref')} מחכה לכרטיס אשראי ושמור לכם עד ${v(vars, 'until')}: ${link}` };
    case 'M22_sponsored_payment_failed':
      return { subject: `החיוב על המקום הממומן ${v(vars, 'ref')} לא עבר`, kicker: 'business', title: 'החיוב החודשי לא עבר', lines: [hi(name), `לא הצלחנו לחייב את הכרטיס על המקום הממומן של ${business}. עדכנו כרטיס בלוח הבקרה והחיוב יבוצע מיד.`, v(vars, 'end') ? `בלי עדכון, הכרטיס יירד מהסליידר ב־${v(vars, 'end')}.` : 'בלי עדכון, המקום לא יעלה.'], details: [['איפה', v(vars, 'where')], ['סכום', v(vars, 'price')], ['מספר', v(vars, 'ref')]], cta: { label: 'לעדכון כרטיס', url: link }, sms: `${BRAND}: החיוב על המקום הממומן ${v(vars, 'ref')} לא עבר. לעדכון כרטיס: ${link}` };
    case 'M22_sponsored_rejected':
      return { subject: `המקום הממומן ${v(vars, 'ref')} לא אושר`, kicker: 'business', title: 'המקום הממומן לא אושר', lines: [hi(name), `המקום הממומן של ${business} לא אושר, ולא חויבתם עליו. אפשר לתקן ולשלוח שוב.`], details: [['איפה', v(vars, 'where')], ['הסיבה', v(vars, 'reason')], ['מספר', v(vars, 'ref')]], cta: { label: 'לתיקון ושליחה מחדש', url: link }, sms: `${BRAND}: המקום הממומן ${v(vars, 'ref')} לא אושר${v(vars, 'reason') ? `: ${v(vars, 'reason')}` : ''}. ${link}` };
    case 'M22_sponsored_started':
      return { subject: `המקום הממומן של ${business} באוויר`, kicker: 'business', title: 'המקום הממומן באוויר', lines: [hi(name), `מהיום ${business} מופיעים בסליידר ״ממומן״ של ${v(vars, 'where')}. בכל יום ראשון נשלח לכם דוח קצר עם ההצגות, הכניסות לפרופיל והפניות.`], details: [['איפה', v(vars, 'where')], ['מוצג עד', v(vars, 'end')]], cta: { label: 'לתוצאות', url: link }, sms: `${BRAND}: המקום הממומן של ${business} באוויר (${v(vars, 'where')}). ${link}` };
    case 'M22_sponsored_ended':
      return { subject: `המקום הממומן של ${business} הסתיים`, kicker: 'business', title: 'המקום הממומן הסתיים', lines: [hi(name), v(vars, 'why') === 'no_card' ? 'לא נשמר כרטיס אשראי בתוך שבוע מהאישור, ולכן המקום שוחרר. לא חויבתם. רוצים לחזור? אפשר להזמין שוב מלוח הבקרה בכל רגע.' : 'הכרטיס כבר לא מופיע בסליידר ולא יהיו חיובים נוספים. רוצים לחזור? אפשר להזמין שוב מלוח הבקרה בכל רגע.'], details: [['איפה', v(vars, 'where')]], cta: { label: 'להזמנה מחדש', url: link }, sms: `${BRAND}: המקום הממומן של ${business} הסתיים. להזמנה מחדש: ${link}` };
    case 'ops_alert':
      // Staff SMS from alertOps (sent as raw text); here so previews and the template check know it.
      return { subject: 'התראת מערכת', kicker: 'business', title: 'התראת מערכת', lines: [v(vars, 'text') || 'התראת מערכת'], sms: `${BRAND}: ${v(vars, 'text') || 'התראת מערכת'}` };
    case 'M22_sponsored_report':
      return { subject: `${business}: השבוע במקום הממומן`, kicker: 'business', title: 'השבוע במקום הממומן', lines: [hi(name), `כך עבד הכרטיס של ${business} בסליידר ״ממומן״ בשבוע האחרון.`], details: [['איפה', v(vars, 'where')], ['הצגות', v(vars, 'impressions')], ['כניסות לפרופיל', v(vars, 'clicks')], ['פניות', v(vars, 'contacts')]], cta: { label: 'לכל התוצאות', url: link }, note: { tone: 'info' as const, text: 'הצגה נספרת רק כשהכרטיס הופיע על המסך. פניות נספרות אצל מבקרים שאישרו קובצי מדידה.' }, sms: `${BRAND}: השבוע במקום הממומן של ${business}: ${v(vars, 'impressions')} הצגות, ${v(vars, 'clicks')} כניסות לפרופיל, ${v(vars, 'contacts')} פניות. ${link}` };

    case 'M_onboard_welcome':
      return {
        subject: `ברוכים הבאים ל-${BRAND}`, preheader: 'שלושה דברים שכדאי לעשות עכשיו', kicker: 'business', title: `ברוכים הבאים, ${business}`,
        lines: [hi(name), 'שמחים שהצטרפתם. אנחנו בודקים את הפרטים, ובינתיים כדאי להשלים את הפרופיל. פרופיל מלא מופיע גבוה יותר בחיפוש ומקבל יותר פניות.'],
        details: [['1', 'תמונות של המקום והעבודות'], ['2', 'תפריט טיפולים ומחירים'], ['3', 'שעות פעילות ודרכי יצירת קשר']],
        cta: { label: 'ללוח הניהול', url: link },
        sms: `${BRAND}: ברוכים הבאים! כדאי להשלים את הפרופיל של ${business} (תמונות, טיפולים, שעות): ${link}`,
      };
    case 'M_activation_payment': {
      const step = v(vars, 'step') || '0';
      const price = v(vars, 'price');
      return {
        subject: step === '0' ? `נשאר צעד אחד כדי ש־${business} יופיעו בחיפוש` : `תזכורת: ${business} עדיין לא מופיעים בחיפוש`,
        preheader: 'הפרופיל אושר, נשאר רק אמצעי תשלום', kicker: 'business', title: step === '0' ? 'הפרופיל אושר' : 'הפרופיל מחכה לכם',
        lines: [hi(name), `הפרופיל של ${business} אושר. כדי שיופיע בחיפוש ויתחיל לקבל פניות, נשאר להוסיף אמצעי תשלום למנוי.`, 'ברגע שהכרטיס נשמר והחיוב הראשון עובר, הפרופיל עולה לאוויר אוטומטית.'],
        details: [['מסלול', v(vars, 'plan')], ['מחיר', price]],
        cta: { label: 'להוספת אמצעי תשלום', url: link },
        note: { tone: 'info', text: 'אפשר לבטל בכל עת מעמוד החיובים. שאלות? אפשר להשיב למייל הזה.' },
        sms: `${BRAND}: הפרופיל של ${business} אושר. כדי שיופיע בחיפוש, נשאר להוסיף אמצעי תשלום${price ? ` (${price})` : ''}: ${link}`,
      };
    }
    case 'M_onboard_profile':
      return { subject: `הפרופיל של ${business} עדיין לא באוויר`, kicker: 'business', title: 'עוד קצת והפרופיל באוויר', lines: [hi(name), `הפרופיל של ${business} עדיין לא פורסם. ברגע שהוא מלא ומאושר, הוא עולה לחיפוש.`], details: [['מה חסר', v(vars, 'missing') || 'פרטים בסיסיים']], cta: { label: 'להשלמת הפרופיל', url: link }, sms: `${BRAND}: הפרופיל של ${business} עדיין לא באוויר. להשלמה: ${link}` };
    case 'M_onboard_card':
      return { subject: 'נשאר צעד אחד: אמצעי תשלום', kicker: 'business', title: 'נשאר צעד אחד', lines: [hi(name), `הפרופיל של ${business} באוויר, אבל עדיין לא שמור אמצעי תשלום למנוי.`], cta: { label: 'להוספת כרטיס', url: link }, note: { tone: 'warn', text: 'בלי כרטיס המנוי לא מתחדש, והפרופיל עלול לרדת מהחיפוש.' }, sms: `${BRAND}: להשארת ${business} בחיפוש צריך להוסיף אמצעי תשלום: ${link}` };

    case 'M_claim_welcome': {
      // SMS first (src/lib/server/welcomeSms.ts). Line-per-part layout so Hebrew and Latin never share a line
      // edge with punctuation: the link and the email each stand alone. Opt-out by link (the sender cannot get replies).
      const unsub = v(vars, 'unsubscribe');
      const cat = v(vars, 'category');
      const city = v(vars, 'city');
      const where = cat ? `בעמוד ${cat}${city ? ` ב${city}` : ''}` : `במדריך היופי${city ? ` ב${city}` : ''}`;
      return {
        subject: `ברוכים הבאים ל-${BRAND}`, kicker: 'invite', title: `${business} נבחרו להופיע ב-${BRAND}`,
        lines: ['שלום,', `העסק שלכם נבחר להופיע ${where}.`, 'קחו שליטה על הדף, עדכנו פרטים והוסיפו תמונות ומחירים כדי למשוך יותר לקוחות.'],
        cta: { label: 'לדף העסק', url: link },
        sms: ['פרסומת | ברוכים הבאים ל-BeautyFind', `העסק שלכם נבחר להופיע ${where}:`, link, 'קחו שליטה על הדף, עדכנו פרטים והוסיפו תמונות ומחירים כדי למשוך יותר לקוחות.', ...(unsub ? [`להסרה: ${unsub}`] : []), 'hello@beautyfind.co.il'].join('\n'),
        ...(unsub ? { unsubscribe: unsub } : {}),
      };
    }

    case 'M_claim_invite': {
      const unsub = v(vars, 'unsubscribe');
      return {
        subject: `${business} מופיעים ב-${BRAND}`, preheader: 'אישור בעלות על הפרופיל, בחינם', kicker: 'invite', title: `${business} כבר מופיעים אצלנו`,
        lines: ['שלום,', `${business} מופיעים במדריך ${BRAND}, שבו לקוחות מחפשים ומשווים טיפולי יופי ואסתטיקה בכל הארץ.`, 'אישור בעלות על הפרופיל הוא בחינם, ומאפשר לכם:'],
        details: [['✓', 'לעדכן תמונות, טיפולים ומחירים'], ['✓', 'לקבל פניות ותורים ישירות'], ['✓', 'להגיב לביקורות']],
        cta: { label: 'לאישור בעלות על הפרופיל', url: link },
        sms: `${BRAND}: ${business} מופיעים במדריך שלנו. לאישור בעלות בחינם ועדכון הפרופיל: ${link}${unsub ? ` להסרה: ${unsub}` : ''}`,
        ...(unsub ? { unsubscribe: unsub } : {}),
      };
    }

    // ---------- Support ----------
    case 'M_contact_receipt': {
      const reason = v(vars, 'reason');
      const sent = isContactReason(reason) ? reasonInfo(reason).sent : 'קיבלנו את הפנייה ונחזור אליכם בהקדם.';
      return { subject: `קיבלנו את הפנייה שלך (${v(vars, 'ref')})`, kicker: 'support', title: 'קיבלנו את הפנייה', lines: ['שלום,', sent, 'אפשר להשיב למייל הזה כדי להוסיף פרטים.'], details: [['מספר פנייה', v(vars, 'ref')]], sms: `${BRAND}: ${sent} מספר פנייה ${v(vars, 'ref')}.` };
    }

    // Marketing services (BeautyFind for Business): order paid, quote received, intake received, status change.
    case 'M_mk_order_paid':
      return {
        subject: `ההזמנה ${v(vars, 'ref')} התקבלה: ${v(vars, 'service')}`, preheader: 'השלב הבא: שאלון קצר כדי שנתחיל לעבוד', kicker: 'business', title: 'התשלום התקבל, מתחילים',
        lines: [hi(name), `תודה שבחרתם ב-${BRAND}. קיבלנו את ההזמנה של ${business || 'העסק'} לשירות ${v(vars, 'service')}.`, 'כדי שנוכל להתחיל, מלאו שאלון קצר על העסק, הקהל והחומרים שכבר יש לכם. זה לוקח כעשר דקות, ומשם נחזור אליכם עם תוכנית עבודה ולוח זמנים.'],
        details: [['שירות', v(vars, 'service')], ['חבילה', v(vars, 'package')], ['סכום', v(vars, 'amount')], ['מספר הזמנה', v(vars, 'ref')]],
        cta: { label: 'למילוי השאלון', url: link },
        note: { tone: 'info', text: 'הקבלה מ-Stripe נשלחת במייל נפרד. שאלות? אפשר להשיב למייל הזה.' },
        sms: `${BRAND}: ההזמנה ${v(vars, 'ref')} (${v(vars, 'service')}) התקבלה. לשאלון הפתיחה: ${link}`,
      };
    case 'M_mk_quote_received':
      return {
        subject: `קיבלנו את הבקשה להצעת מחיר (${v(vars, 'ref')})`, kicker: 'business', title: 'הבקשה התקבלה',
        lines: [hi(name), `קיבלנו את הבקשה של ${business || 'העסק'} להצעת מחיר לשירות ${v(vars, 'service')}.`, 'נעבור על הפרטים ונחזור אליכם תוך יום עסקים אחד עם הצעה מסודרת, או עם שאלה קצרה אם חסר משהו.'],
        details: [['שירות', v(vars, 'service')], ['מספר בקשה', v(vars, 'ref')]],
        sms: `${BRAND}: קיבלנו את הבקשה להצעת מחיר (${v(vars, 'ref')}) לשירות ${v(vars, 'service')}. נחזור אליכם תוך יום עסקים.`,
      };
    case 'M_mk_onboarding_received':
      return {
        subject: `השאלון התקבל (${v(vars, 'ref')})`, kicker: 'business', title: 'קיבלנו את כל הפרטים',
        lines: [hi(name), `השאלון של ${business || 'העסק'} לשירות ${v(vars, 'service')} התקבל. מנהל/ת הלקוח שלכם יעבור עליו ויחזור אליכם עם תוכנית עבודה.`, 'אם ביקשנו גישה לחשבונות (מטא, גוגל, האתר), אפשר להעניק אותה כבר עכשיו לפי ההוראות בעמוד ההזמנה.'],
        details: [['שירות', v(vars, 'service')], ['מספר הזמנה', v(vars, 'ref')]],
        cta: { label: 'לעמוד ההזמנה', url: link },
        sms: `${BRAND}: השאלון להזמנה ${v(vars, 'ref')} התקבל. נחזור אליכם עם תוכנית עבודה. ${link}`,
      };
    case 'M_mk_status':
      return {
        subject: `עדכון בהזמנה ${v(vars, 'ref')}: ${v(vars, 'status')}`, kicker: 'business', title: v(vars, 'status') || 'עדכון בהזמנה',
        lines: [hi(name), `יש עדכון בהזמנה של ${business || 'העסק'} לשירות ${v(vars, 'service')}.`, v(vars, 'note')].filter(Boolean),
        details: [['שירות', v(vars, 'service')], ['סטטוס', v(vars, 'status')], ['מספר הזמנה', v(vars, 'ref')]],
        cta: { label: 'לעמוד ההזמנה', url: link },
        sms: `${BRAND}: עדכון בהזמנה ${v(vars, 'ref')}: ${v(vars, 'status')}. ${link}`,
      };

    case 'messaggio_test':
    case 'twilio_test':
    case 'email_test':
      return { subject: `הודעת בדיקה מ-${BRAND}`, kicker: 'support', title: 'החיבור עובד', lines: ['זו הודעת בדיקה. אם היא הגיעה, החיבור עובד.'], sms: `הודעת בדיקה מ-${BRAND}: החיבור עובד.` };
  }
  return null;
}

// ---------- The email layout ----------

const KICKER: Record<Kicker, string> = {
  booking: 'התור שלך', consult: 'ייעוץ', gift: 'כרטיס מתנה', payment: 'תשלום', account: 'החשבון שלך',
  team: 'צוות', business: 'לעסקים', support: 'פנייה', invite: 'BeautyFind לעסקים',
};

const C = { navy: '#0B233D', teal: '#23BACC', tealDark: '#0F7F8C', text: '#1F2A37', muted: '#5B6B7B', line: '#E5E9EE', bg: '#F3F6F8', card: '#F7FAFB', infoBg: '#EAF8FA', warnBg: '#FFF6E5', warnText: '#7A4B00' };
const FONT = "'Assistant','Heebo',Arial,Helvetica,sans-serif";
// Hosted PNG of the logo for email clients (most do not render inline SVG).
const LOGO_EMAIL = 'https://beautyfind.co.il/assets/logo-email.png';
const SITE = 'https://beautyfind.co.il';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The email as HTML (600px RTL tables, inline styles, Arial fallback, Outlook-safe button) and as plain text. */
export function emailBody(r: Rendered): { html: string; text: string } {
  const title = r.title ?? r.subject;
  const p = (t: string) => `<p style="margin:0 0 14px;font-family:${FONT};font-size:16px;line-height:1.65;color:${C.text}">${esc(t)}</p>`;
  const rows = (r.details ?? []).filter(([, val]) => val && val.trim());
  const details = rows.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 20px;background:${C.card};border:1px solid ${C.line};border-radius:12px">`
      + rows.map(([k, val], i) => `<tr><td style="padding:12px 16px;${i ? `border-top:1px solid ${C.line};` : ''}font-family:${FONT};font-size:14px;color:${C.muted};width:34%;vertical-align:top">${esc(k)}</td><td style="padding:12px 16px;${i ? `border-top:1px solid ${C.line};` : ''}font-family:${FONT};font-size:15px;font-weight:bold;color:${C.text};vertical-align:top">${esc(val)}</td></tr>`).join('')
      + `</table>`
    : '';
  const code = r.code
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px"><tr><td align="center" style="padding:18px;background:${C.infoBg};border:1px dashed ${C.teal};border-radius:12px;font-family:'Courier New',Courier,monospace;font-size:28px;font-weight:bold;letter-spacing:4px;color:${C.navy};direction:ltr">${esc(r.code)}</td></tr></table>`
    : '';
  const button = r.cta?.url
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 6px"><tr><td align="center" bgcolor="${C.navy}" style="border-radius:10px">`
      + `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${esc(r.cta.url)}" style="height:48px;v-text-anchor:middle;width:260px" arcsize="20%" fillcolor="${C.navy}" stroke="f"><center style="color:#ffffff;font-family:Arial;font-size:16px;font-weight:bold">${esc(r.cta.label)}</center></v:roundrect><![endif]-->`
      + `<!--[if !mso]><!--><a href="${esc(r.cta.url)}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px;background:${C.navy}">${esc(r.cta.label)}</a><!--<![endif]-->`
      + `</td></tr></table>`
      + `<p style="margin:10px 0 18px;font-family:${FONT};font-size:12px;line-height:1.5;color:${C.muted}">הכפתור לא עובד? אפשר להעתיק את הקישור: <span style="direction:ltr;unicode-bidi:embed;word-break:break-all;color:${C.tealDark}">${esc(r.cta.url)}</span></p>`
    : '';
  const note = r.note
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 8px"><tr><td style="padding:14px 16px;border-radius:10px;background:${r.note.tone === 'warn' ? C.warnBg : C.infoBg};border-right:4px solid ${r.note.tone === 'warn' ? '#F0A500' : C.teal};font-family:${FONT};font-size:14px;line-height:1.6;color:${r.note.tone === 'warn' ? C.warnText : C.navy}">${esc(r.note.text)}</td></tr></table>`
    : '';
  const kicker = r.kicker ? `<p style="margin:0 0 8px;font-family:${FONT};font-size:13px;font-weight:bold;letter-spacing:.3px;color:${C.tealDark}">${esc(KICKER[r.kicker])}</p>` : '';
  const footLinks = `<a href="${SITE}/help" style="color:${C.muted};text-decoration:underline">מרכז עזרה</a> &nbsp;·&nbsp; <a href="${SITE}/privacy" style="color:${C.muted};text-decoration:underline">פרטיות</a> &nbsp;·&nbsp; <a href="${SITE}/terms" style="color:${C.muted};text-decoration:underline">תנאי שימוש</a>`;
  const footer = r.unsubscribe
    ? `קיבלתם את ההודעה כי העסק שלכם מופיע ב-BeautyFind. לא רוצים לקבל מאיתנו הודעות? <a href="${esc(r.unsubscribe)}" style="color:${C.muted};text-decoration:underline">להסרה</a>`
    : 'הודעת שירות מ-BeautyFind, מדריך היופי והאסתטיקה של ישראל. המידע באתר כללי ואינו ייעוץ רפואי.';
  const preheader = r.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(r.preheader)}${'&#8204;&nbsp;'.repeat(40)}</div>` : '';

  const html = `<!doctype html><html lang="he" dir="rtl" xmlns:v="urn:schemas-microsoft-com:vml"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(r.subject)}</title>`
    + `<style>@media (max-width:620px){.bf-pad{padding-left:20px!important;padding-right:20px!important}.bf-title{font-size:23px!important}}</style></head>`
    + `<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%">${preheader}`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:28px 12px">`
    + `<table role="presentation" width="600" cellpadding="0" cellspacing="0" dir="rtl" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;text-align:right">`
    + `<tr><td style="height:4px;background:${C.teal};line-height:4px;font-size:0">&nbsp;</td></tr>`
    + `<tr><td class="bf-pad" style="padding:26px 36px 4px;direction:ltr;text-align:right"><a href="${SITE}" style="text-decoration:none"><img src="${LOGO_EMAIL}" width="150" height="31" alt="BeautyFind" style="display:inline-block;border:0;outline:none;height:31px;width:150px"></a></td></tr>`
    + `<tr><td class="bf-pad" style="padding:22px 36px 8px">${kicker}<h1 class="bf-title" style="margin:0 0 18px;font-family:${FONT};font-size:27px;line-height:1.3;font-weight:bold;color:${C.navy}">${esc(title)}</h1>`
    + `${r.lines.map(p).join('')}${details}${code}${button}${note}</td></tr>`
    + `<tr><td class="bf-pad" style="padding:22px 36px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid ${C.line};padding-top:18px;font-family:${FONT};font-size:12px;line-height:1.7;color:${C.muted}">${footer}<br>${footLinks}</td></tr></table></td></tr>`
    + `</table></td></tr></table></body></html>`;

  const detailText = rows.map(([k, val]) => `${k}: ${val}`);
  const text = [
    title, '',
    ...r.lines, ...(detailText.length ? ['', ...detailText] : []),
    ...(r.code ? ['', `קוד: ${r.code}`] : []),
    ...(r.cta?.url ? ['', `${r.cta.label}: ${r.cta.url}`] : []),
    ...(r.note ? ['', r.note.text] : []),
    '', r.unsubscribe ? `להסרה: ${r.unsubscribe}` : 'הודעת שירות מ-BeautyFind',
  ].join('\n').replace(/\n{3,}/g, '\n\n');
  return { html, text };
}
