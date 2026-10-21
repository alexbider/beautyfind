// The text of every message the platform sends, rendered from a template id and its vars: an email (subject,
// RTL HTML, plain text) and a short SMS. Pure, so it is shared by the senders and the tests. Codes and personal
// details appear only in the message itself, never in logs.

import { reasonInfo, isContactReason } from '@/components/contact/reasons';

export interface Rendered {
  subject: string;
  /** Paragraphs of the email body, in order. */
  lines: string[];
  cta?: { label: string; url: string };
  /** The SMS version: one short message, link included. */
  sms: string;
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

  switch (template) {
    case 'M16_otp':
      return { subject: `קוד האימות שלך ב-${BRAND}`, lines: [`קוד האימות שלך: ${v(vars, 'code')}`, `הקוד בתוקף ${v(vars, 'minutes') || '10'} דקות. אין למסור אותו לאיש, גם לא לנציגי ${BRAND}.`, 'אם לא ביקשת קוד, אפשר להתעלם מההודעה.'], sms: codeText(vars) };

    case 'M17_reset':
      return {
        subject: `איפוס הסיסמה ב-${BRAND}`,
        lines: [hi(name), 'קיבלנו בקשה לאיפוס הסיסמה לחשבון שלך.', `הקישור בתוקף ${v(vars, 'minutes') || '30'} דקות ואפשר להשתמש בו פעם אחת.`, 'אם לא ביקשת איפוס, אפשר להתעלם מההודעה. הסיסמה לא תשתנה.'],
        cta: { label: 'בחירת סיסמה חדשה', url: link },
        sms: `${BRAND}: לאיפוס הסיסמה: ${link} (בתוקף ${v(vars, 'minutes') || '30'} דקות)`,
      };

    case 'M18_staff_invite':
      return {
        subject: `הזמנה להצטרף לצוות של ${business}`,
        lines: [hi(name), `קיבלת הזמנה מ${v(vars, 'inviter')} להצטרף לצוות של ${business} ב-${BRAND}${v(vars, 'role') ? ` בתפקיד ${v(vars, 'role')}` : ''}.`, `ההזמנה בתוקף עד ${v(vars, 'expires')}.`],
        cta: { label: 'לצפייה בהזמנה', url: link },
        sms: `${BRAND}: הזמנה להצטרף לצוות של ${business}: ${link}`,
      };

    case 'staff_invite_accepted':
      return { subject: `ההזמנה לצוות של ${business} התקבלה`, lines: [`${name} מצטרפים לצוות של ${business}${v(vars, 'role') ? ` בתפקיד ${v(vars, 'role')}` : ''}.`], cta: { label: 'לעמוד הצוות', url: `${root}/biz/team` }, sms: `${BRAND}: ${name} הצטרפו לצוות של ${business}.` };
    case 'staff_invite_declined':
      return { subject: `ההזמנה לצוות של ${business} נדחתה`, lines: [`ההזמנה שנשלחה אל ${v(vars, 'email')} להצטרף לצוות של ${business} נדחתה.`], cta: { label: 'לעמוד הצוות', url: `${root}/biz/team` }, sms: `${BRAND}: ההזמנה אל ${v(vars, 'email')} נדחתה.` };
    case 'staff_invite_renewal_request':
      return { subject: `בקשה להזמנה חדשה לצוות של ${business}`, lines: [`${v(vars, 'email')} מבקשים הזמנה חדשה לצוות של ${business}, כי ההזמנה הקודמת פגה או נדחתה.`, 'אפשר לשלוח הזמנה חדשה מעמוד הצוות.'], cta: { label: 'לעמוד הצוות', url: `${root}/biz/team` }, sms: `${BRAND}: ${v(vars, 'email')} מבקשים הזמנה חדשה לצוות.` };

    case 'M1_booking_confirmed':
    case 'M1_booking_rescheduled': {
      const moved = template === 'M1_booking_rescheduled';
      const who = v(vars, 'practitioner') ? ` אצל ${v(vars, 'practitioner')}` : '';
      return {
        subject: moved ? `התור שלך ב${business} הועבר` : `התור שלך ב${business} אושר`,
        lines: [hi(name), `${moved ? 'התור הועבר' : 'התור נקבע'}: ${v(vars, 'treatment')} ב${business}, ${when}${who}.`, `מספר הזמנה: ${v(vars, 'ref')}`, 'אפשר להעביר או לבטל את התור מהקישור, לפי מדיניות הביטול של העסק.'],
        cta: { label: 'ניהול התור', url: link },
        sms: `${BRAND}: ${moved ? 'התור הועבר' : 'התור אושר'}. ${v(vars, 'treatment')} ב${business}, ${when}. הזמנה ${v(vars, 'ref')}. לניהול התור: ${link}`,
      };
    }

    case 'M3_declaration_request':
      return {
        subject: `הצהרת בריאות לפני התור ב${business}`,
        lines: [hi(name), `לפני ${v(vars, 'treatment')} ב${business} (${when}) צריך למלא הצהרת בריאות קצרה.`, 'המילוי לוקח כמה דקות, והפרטים נשמרים מוצפנים ונגישים רק לצוות המטפל.'],
        cta: { label: 'מילוי ההצהרה', url: link },
        sms: `${BRAND}: לפני התור ב${business} (${when}) צריך למלא הצהרת בריאות קצרה: ${link}`,
      };

    case 'M4_clinic_checked_in':
      return { subject: `צ׳ק־אין לתור של ${v(vars, 'time')}`, lines: [`בוצע צ׳ק־אין לתור של ${v(vars, 'time')} (הזמנה ${v(vars, 'ref')}).`], cta: { label: 'לתור', url: link }, sms: `${BRAND}: בוצע צ׳ק־אין לתור של ${v(vars, 'time')} (הזמנה ${v(vars, 'ref')}): ${link}` };
    case 'M4_clinic_declaration_flagged':
      return { subject: `הצהרת בריאות לבדיקה: הזמנה ${v(vars, 'ref')}`, lines: [`בהצהרת הבריאות לתור ${v(vars, 'ref')} (${when}) יש סעיפים שצריך לבדוק לפני הטיפול.`], cta: { label: 'לתור', url: link }, sms: `${BRAND}: בהצהרת הבריאות לתור ${v(vars, 'ref')} (${when}) יש סעיפים לבדיקה לפני הטיפול: ${link}` };

    case 'M5_aftercare':
      return { subject: `הנחיות אחרי הטיפול ב${business}`, lines: [hi(name), `תודה שביקרת ב${business}. ריכזנו את ההנחיות לימים שאחרי הטיפול.`], cta: { label: 'להנחיות', url: link }, sms: `${BRAND}: תודה שביקרת ב${business}. הנחיות אחרי הטיפול: ${link}` };

    case 'M7_waitlist_offer':
      return {
        subject: 'התפנה תור מרשימת ההמתנה',
        lines: [hi(name), `התפנה תור ${when}. הוא שמור לך ${v(vars, 'minutes')} דקות.`],
        cta: { label: 'לאישור התור', url: link },
        sms: `${BRAND}: התפנה תור ${when}, שמור לך ${v(vars, 'minutes')} דקות: ${link}`,
      };

    case 'M8_consult_details': {
      const reply = replyLine(vars);
      return { subject: `בקשת הייעוץ ב${business}`, lines: [hi(name), `${business} צריכים עוד כמה פרטים כדי לטפל בבקשת הייעוץ (מספר ${v(vars, 'ref')}).`, reply.line].filter(Boolean), ...(reply.cta ? { cta: reply.cta } : {}), sms: join(`${BRAND}: ${business} צריכים עוד פרטים לבקשת הייעוץ ${v(vars, 'ref')}.`, reply.sms) };
    }
    case 'M9_consult_proposal': {
      const reply = replyLine(vars);
      return { subject: `בקשת הייעוץ ב${business}`, lines: [v(vars, 'text'), reply.line].filter(Boolean), ...(reply.cta ? { cta: reply.cta } : {}), sms: join(`${BRAND}: ${v(vars, 'text')}`, reply.sms) };
    }
    case 'M10_consult_declined':
      return { subject: `בקשת הייעוץ ב${business}`, lines: [v(vars, 'text')], sms: `${BRAND}: ${v(vars, 'text')}` };

    case 'M_consult_reply': {
      const rows = [`תשובה: ${v(vars, 'answer')}`, v(vars, 'proposed') && `המועד שהוצע: ${v(vars, 'proposed')}`, v(vars, 'text') && `ההודעה: ${v(vars, 'text')}`, `טלפון: ${v(vars, 'phone')}`].filter((x): x is string => !!x);
      return { subject: `תשובה מ${name} לבקשת הייעוץ ${v(vars, 'ref')}`, lines: [`${name} השיבו לבקשת הייעוץ ${v(vars, 'ref')} ב${business}:`, ...rows], cta: { label: 'לתיבת הייעוצים', url: link }, sms: `${BRAND}: ${name} השיבו לבקשת הייעוץ ${v(vars, 'ref')}: ${v(vars, 'answer')}. ${link}` };
    }

    case 'M2_reminder': {
      const who = v(vars, 'practitioner') ? ` אצל ${v(vars, 'practitioner')}` : '';
      return {
        subject: `תזכורת: התור שלך ב${business} מחר`,
        lines: [hi(name), `תזכורת לתור מחר: ${v(vars, 'treatment')} ב${business}, ${when}${who}.`, v(vars, 'address') ? `כתובת: ${v(vars, 'address')}` : '', `מספר הזמנה: ${v(vars, 'ref')}`, 'צריך להעביר או לבטל? אפשר לעשות זאת מהקישור, לפי מדיניות הביטול של העסק.'].filter(Boolean),
        cta: { label: 'ניהול התור', url: link },
        sms: `${BRAND}: תזכורת לתור מחר ב${business}, ${when}. לניהול התור: ${link}`,
      };
    }

    case 'M11_refund':
      return { subject: `החזר כספי מ-${BRAND}`, lines: ['שלום,', `ביצענו החזר של ${v(vars, 'amount')} ₪ לאמצעי התשלום שלך${v(vars, 'reason') ? ` (${v(vars, 'reason')})` : ''}.`, 'ההחזר מופיע בדרך כלל בחשבון תוך כמה ימי עסקים, לפי חברת האשראי. חשבונית הזיכוי נשמרת בחשבון שלך.'], sms: `${BRAND}: ביצענו החזר של ${v(vars, 'amount')} ₪ לאמצעי התשלום שלך.` };

    case 'M12_clinic_cancelled':
      return { subject: `התור ${v(vars, 'ref')} בוטל`, lines: ['שלום,', `העסק ביטל את התור (הזמנה ${v(vars, 'ref')})${v(vars, 'reason') ? `. הסיבה: ${v(vars, 'reason')}` : ''}.`, 'אם שולם פיקדון, הוא יוחזר במלואו.'], cta: { label: `לחיפוש תור חדש ב-${BRAND}`, url: root }, sms: `${BRAND}: העסק ביטל את התור ${v(vars, 'ref')}${v(vars, 'reason') ? ` (${v(vars, 'reason')})` : ''}. אם שולם פיקדון, הוא יוחזר במלואו.` };

    case 'M13_client_cancelled': {
      const refunded = Number(v(vars, 'refunded') || '0');
      const late = v(vars, 'late') === '1';
      const money = refunded > 0 ? `${refunded.toLocaleString('en-US')} ₪ יוחזרו לאמצעי התשלום.` : late ? 'הביטול נעשה אחרי המועד שבמדיניות הביטול, ולכן הפיקדון לא מוחזר.' : '';
      return { subject: `התור ${v(vars, 'ref')} בוטל`, lines: [hi(name), `התור ${when} בוטל (הזמנה ${v(vars, 'ref')}).`, money].filter(Boolean), sms: join(`${BRAND}: התור ${when} בוטל (הזמנה ${v(vars, 'ref')}).`, money) };
    }

    case 'M14_gift_card': {
      const recipient = v(vars, 'recipient');
      return {
        subject: `קיבלת כרטיס מתנה ל${business}`,
        lines: [hi(recipient), `${v(vars, 'buyer')} שלחו לך כרטיס מתנה בסך ${v(vars, 'amount')} ל${business}.`, v(vars, 'message') ? `ההקדשה: ${v(vars, 'message')}` : '', `קוד הכרטיס: ${v(vars, 'code')}`, 'אפשר לממש אותו בקביעת תור באתר או בעסק עצמו.'].filter(Boolean),
        cta: { label: 'לבדיקת הכרטיס', url: link },
        sms: `${BRAND}: ${v(vars, 'buyer')} שלחו לך כרטיס מתנה בסך ${v(vars, 'amount')} ל${business}. קוד: ${v(vars, 'code')}. פרטים: ${link}`,
      };
    }

    case 'M19_verification_outcome':
    case 'M20_claim_outcome': {
      const claim = template === 'M20_claim_outcome';
      const st = v(vars, 'status');
      return {
        subject: `${claim ? 'בקשת אישור הבעלות' : 'בקשת האימות'} ${v(vars, 'ref')}: ${st === 'approved' ? 'אושרה' : st === 'rejected' ? 'נדחתה' : 'נדרש מסמך'}`,
        lines: ['שלום,', `${claim ? 'עדכון על בקשת אישור הבעלות' : 'עדכון על בקשת האימות'} (מספר ${v(vars, 'ref')}): ${STATUS_TEXT[st] ?? 'הבקשה עודכנה.'}`, v(vars, 'reason') ? `פירוט: ${v(vars, 'reason')}` : ''].filter(Boolean),
        cta: { label: 'ללוח הניהול', url: `${root}/biz` },
        sms: `${BRAND}: ${claim ? 'בקשת אישור הבעלות' : 'בקשת האימות'} ${v(vars, 'ref')}: ${STATUS_TEXT[st] ?? 'עודכנה.'}`,
      };
    }

    case 'M_contact_receipt': {
      const reason = v(vars, 'reason');
      const sent = isContactReason(reason) ? reasonInfo(reason).sent : 'קיבלנו את הפנייה ונחזור אליכם בהקדם.';
      return { subject: `קיבלנו את הפנייה שלך (${v(vars, 'ref')})`, lines: ['שלום,', sent, `מספר הפנייה: ${v(vars, 'ref')}. אפשר להשיב למייל הזה כדי להוסיף פרטים.`], sms: `${BRAND}: ${sent} מספר פנייה ${v(vars, 'ref')}.` };
    }

    case 'M_profile_lead': {
      const rows = [`שם: ${name}`, v(vars, 'phone') && `טלפון: ${v(vars, 'phone')}`, v(vars, 'email') && `אימייל: ${v(vars, 'email')}`, v(vars, 'treatment') && `טיפול: ${v(vars, 'treatment')}`, v(vars, 'message') && `הודעה: ${v(vars, 'message')}`].filter((x): x is string => !!x);
      return { subject: `פנייה חדשה ל${business} מ-${BRAND}`, lines: [`פנייה חדשה הגיעה דרך הפרופיל של ${business}:`, ...rows], cta: { label: 'לכל הפניות', url: v(vars, 'leads_link') || `${root}/biz/leads` }, sms: `${BRAND}: פנייה חדשה מ${name} ל${business}. ${v(vars, 'leads_link')}` };
    }

    case 'messaggio_test':
    case 'twilio_test':
    case 'email_test':
      return { subject: `הודעת בדיקה מ-${BRAND}`, lines: ['זו הודעת בדיקה. אם היא הגיעה, החיבור עובד.'], sms: `הודעת בדיקה מ-${BRAND}: החיבור עובד.` };
  }
  return null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The email as HTML (one 560px RTL table, inline styles, Arial fallback) and as plain text. */
export function emailBody(r: Rendered): { html: string; text: string } {
  const p = (t: string) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#1f2a37">${esc(t)}</p>`;
  const button = r.cta?.url ? `<p style="margin:22px 0 8px"><a href="${esc(r.cta.url)}" style="display:inline-block;background:#0f7a7a;color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:12px 22px;border-radius:10px">${esc(r.cta.label)}</a></p><p style="margin:0 0 14px;font-size:13px;color:#5b6b7b;direction:ltr;text-align:right;word-break:break-all">${esc(r.cta.url)}</p>` : '';
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(r.subject)}</title></head>`
    + `<body style="margin:0;padding:0;background:#f4f6f8"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8"><tr><td align="center" style="padding:24px 12px">`
    + `<table role="presentation" width="560" cellpadding="0" cellspacing="0" dir="rtl" style="width:100%;max-width:560px;background:#ffffff;border-radius:14px;font-family:Arial,Helvetica,sans-serif;text-align:right">`
    + `<tr><td style="padding:22px 28px 6px;font-size:22px;font-weight:bold;color:#0f7a7a;direction:ltr;text-align:right">beautyfind.</td></tr>`
    + `<tr><td style="padding:12px 28px 20px">${r.lines.map(p).join('')}${button}</td></tr>`
    + `<tr><td style="padding:14px 28px 22px;border-top:1px solid #e5e9ee;font-size:12px;color:#5b6b7b">הודעת שירות מ-BeautyFind. מידע כללי בלבד, לא ייעוץ רפואי.</td></tr>`
    + `</table></td></tr></table></body></html>`;
  const text = [...r.lines, r.cta?.url ? `${r.cta.label}: ${r.cta.url}` : '', '', 'הודעת שירות מ-BeautyFind'].filter((x, i, a) => x || (i > 0 && a[i - 1])).join('\n');
  return { html, text };
}
