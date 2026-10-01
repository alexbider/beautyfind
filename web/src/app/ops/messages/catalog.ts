// The message catalog (05-messages.md): every message the platform sends, its trigger, audience,
// channels and type (service or marketing), and the template ids the code already sends with. Pure.

export type TemplateType = 'S' | 'M';
export interface TemplateSpec {
  id: string; // M1 ... M25
  name: string;
  trigger: string;
  to: string;
  channels: string;
  type: TemplateType;
  target: string;
  codeIds: string[]; // template ids used by the code (messaging adapter), empty when not sent yet
}

export const TEMPLATES: TemplateSpec[] = [
  { id: 'M1', name: 'אישור תור / תור הועבר', trigger: 'תור אושר או הוזז', to: 'לקוחה', channels: 'WhatsApp + אימייל', type: 'S', target: 'ניהול תור', codeIds: ['M1_booking_confirmed', 'M1_booking_rescheduled'] },
  { id: 'M2', name: 'תזכורת', trigger: '24 שעות לפני (ניתן לשינוי)', to: 'לקוחה', channels: 'WhatsApp', type: 'S', target: 'ניהול תור', codeIds: [] },
  { id: 'M3', name: 'בקשת הצהרת בריאות', trigger: 'תור שדורש הצהרה; שוב 24 שעות לפני', to: 'לקוחה', channels: 'WhatsApp', type: 'S', target: 'הצהרת בריאות', codeIds: ['M3_declaration_request'] },
  { id: 'M4', name: 'לקליניקה: תור חדש / צ׳ק־אין / הצהרה מסומנת', trigger: 'אירועי תור', to: 'צוות', channels: 'באפליקציה + WhatsApp', type: 'S', target: 'תור בקליניקה', codeIds: [] },
  { id: 'M5', name: 'הנחיות אחרי טיפול', trigger: 'תור הושלם', to: 'לקוחה', channels: 'WhatsApp', type: 'S', target: 'הנחיות', codeIds: [] },
  { id: 'M6', name: 'בקשת ביקורת', trigger: '3 ימים אחרי השלמה', to: 'לקוחה', channels: 'WhatsApp', type: 'S', target: 'ביקורת', codeIds: [] },
  { id: 'M7', name: 'הצעת תור מרשימת המתנה', trigger: 'תור התפנה ומתאים', to: 'לקוחה', channels: 'WhatsApp', type: 'S', target: 'רשימת המתנה', codeIds: [] },
  { id: 'M8', name: 'ייעוץ: בקשת פרטים נוספים', trigger: 'פעולת קליניקה', to: 'לקוחה', channels: 'WhatsApp', type: 'S', target: 'תשובה בצ׳אט', codeIds: [] },
  { id: 'M9', name: 'ייעוץ: הצעת מועד', trigger: 'פעולת קליניקה', to: 'לקוחה', channels: 'WhatsApp', type: 'S', target: 'אישור בצ׳אט', codeIds: [] },
  { id: 'M10', name: 'ייעוץ: דחייה עם הסבר', trigger: 'פעולת קליניקה', to: 'לקוחה', channels: 'WhatsApp', type: 'S', target: '—', codeIds: [] },
  { id: 'M11', name: 'החזר וחשבונית זיכוי', trigger: 'ביטול בזמן', to: 'לקוחה', channels: 'אימייל', type: 'S', target: 'קבלה', codeIds: ['M11_refund'] },
  { id: 'M12', name: 'הקליניקה ביטלה את התור', trigger: 'ביטול על ידי הקליניקה', to: 'לקוחה', channels: 'WhatsApp + אימייל', type: 'S', target: 'הזמנה', codeIds: ['M12_clinic_cancelled'] },
  { id: 'M13', name: 'חשבונית מס / קבלה', trigger: 'כל תשלום', to: 'משלם', channels: 'אימייל', type: 'S', target: 'קבלה', codeIds: ['M13_client_cancelled'] },
  { id: 'M14', name: 'משלוח כרטיס מתנה', trigger: 'הגיע מועד השליחה', to: 'מקבל/ת', channels: 'WhatsApp או אימייל', type: 'S', target: 'מימוש', codeIds: ['M14_gift_card'] },
  { id: 'M15', name: 'כרטיס מתנה נפתח / פג בקרוב', trigger: '90 ו־30 יום לפני', to: 'קונה / מחזיק', channels: 'אימייל', type: 'S', target: 'כרטיסי מתנה', codeIds: [] },
  { id: 'M16', name: 'קוד OTP', trigger: 'כניסה, הזמנת צוות', to: 'משתמש', channels: 'WhatsApp / SMS', type: 'S', target: '—', codeIds: ['M16_otp'] },
  { id: 'M17', name: 'איפוס סיסמה', trigger: 'בקשה (30 דק׳, חד־פעמי)', to: 'משתמש עסקי', channels: 'אימייל', type: 'S', target: 'כניסה', codeIds: [] },
  { id: 'M18', name: 'הזמנת איש צוות', trigger: 'בעלים מזמין (7 ימים)', to: 'מוזמן/ת', channels: 'אימייל', type: 'S', target: 'הזמנת צוות', codeIds: [] },
  { id: 'M19', name: 'תוצאת אימות', trigger: 'אישור / דחייה / מסמך נדרש', to: 'עסק', channels: 'אימייל + באפליקציה', type: 'S', target: 'לוח ניהול', codeIds: ['M19_verification_outcome'] },
  { id: 'M20', name: 'תוצאת תביעת בעלות', trigger: 'החלטה', to: 'תובע/ת + בעלים קודם', channels: 'אימייל', type: 'S', target: 'לוח ניהול', codeIds: ['M20_claim_outcome'] },
  { id: 'M21', name: 'ביקורת פורסמה / נדחתה; תגובת העסק', trigger: 'מודרציה', to: 'כותב/ת / עסק', channels: 'WhatsApp / אימייל', type: 'S', target: 'פרופיל', codeIds: [] },
  { id: 'M22', name: 'ממומן: אושר / נדחה / התחיל / דוח', trigger: 'אירועי קמפיין', to: 'עסק', channels: 'אימייל', type: 'S', target: 'ממומן', codeIds: [] },
  { id: 'M23', name: 'חיוב נכשל (יום 0, 3, 7, 14)', trigger: 'מנוי', to: 'בעלים + הנהלת חשבונות', channels: 'אימייל + WhatsApp', type: 'S', target: 'חיוב', codeIds: [] },
  { id: 'M24', name: 'מבצעים / ניוזלטר של הקליניקה', trigger: 'הקליניקה שולחת', to: 'לקוחות שהסכימו', channels: 'WhatsApp / אימייל / SMS', type: 'M', target: 'הסרה מדיוור', codeIds: [] },
  { id: 'M25', name: 'המגזין של BeautyFind', trigger: 'מערכת', to: 'משתמשים שהסכימו', channels: 'אימייל', type: 'M', target: 'הסרה מדיוור', codeIds: [] },
];

export const RULES = [
  'הסכמה לדיוור נאספת לכל קליניקה בנפרד בזמן ההזמנה (לא מסומן כברירת מחדל).',
  'הסרה מדיוור לכל קליניקה או לכולן, לכל ערוץ; בתוקף מיד ועד שלושה ימי עסקים. תשובת ״הסר״ בכל ערוץ = הסרה לאותו שולח ואותו ערוץ.',
  'אין הודעות שיווק בשבת ובחגים; שעות שקט 21:00 עד 08:00 לכל הודעה שאינה דחופה.',
  'תבניות WhatsApp דורשות אישור Meta: utility להודעות שירות, marketing לשיווק.',
  'אימיילים: טבלאות עם עיצוב מוטבע, 560px, rtl, גופן Arial כגיבוי, גרסת טקסט; שולח = שם הקליניקה דרך mail.beautyfind.co.il.',
];
