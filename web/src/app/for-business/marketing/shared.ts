// Shared by the marketing quote, order and onboarding forms (client) and their server actions.

import { EMAIL_RE, IL_PHONE_RE } from '@/lib/format';

export const BUSINESS_TYPES = [
  'מכון יופי',
  'קוסמטיקאית',
  'קליניקה לאסתטיקה',
  'מרפאה לאסתטיקה רפואית',
  'סטודיו לציפורניים',
  'ריסים וגבות',
  'מספרה או סלון שיער',
  'ברברשופ',
  'הסרת שיער ולייזר',
  'איפור קבוע',
  'ספא ועיסוי',
  'אחר',
] as const;

export type ContactInput = {
  name: string;
  email: string;
  phone: string;
  business: string;
  businessType: string;
  city: string;
  website: string;
  message: string;
  consent: boolean;
  /** Honeypot. */
  company_url: string;
};

export type FieldErrors = Partial<Record<keyof ContactInput, string>>;

export const LIMITS = { name: 80, email: 120, phone: 20, business: 120, city: 60, website: 200, message: 2000 };

export function validateContact(c: ContactInput, needsMessage = false): FieldErrors {
  const e: FieldErrors = {};
  if (c.name.trim().length < 2) e.name = 'נא למלא שם מלא';
  if (!EMAIL_RE.test(c.email.trim())) e.email = 'כתובת אימייל לא תקינה';
  const phone = c.phone.replace(/[^\d+]/g, '');
  if (!IL_PHONE_RE.test(c.phone.trim()) && !/^\+9725\d{8}$/.test(phone) && !/^05\d{8}$/.test(phone)) e.phone = 'מספר טלפון לא תקין';
  if (c.business.trim().length < 2) e.business = 'נא למלא את שם העסק';
  if (c.website.trim() && !/^(https?:\/\/)?[^\s.]+\.[^\s]{2,}/i.test(c.website.trim())) e.website = 'כתובת אתר לא תקינה';
  if (needsMessage && c.message.trim().length < 10) e.message = 'ספרו לנו בכמה מילים מה אתם צריכים';
  if (!c.consent) e.consent = 'נדרש אישור כדי שנוכל לחזור אליכם';
  return e;
}

export const emptyContact = (): ContactInput => ({ name: '', email: '', phone: '', business: '', businessType: '', city: '', website: '', message: '', consent: false, company_url: '' });

export type ActionResult = { ok: true; ref: string | null; url?: string } | { ok: false; message: string; errors?: FieldErrors };
