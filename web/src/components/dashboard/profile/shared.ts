// Profile editor: form shape and validation rules.
// Imported by the client editor and by the server action so both apply the same rules.

import { CATEGORIES } from '@/lib/catalog';
import { EMAIL_RE, toE164 } from '@/lib/format';

export const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export const GAL_TAGS = ['הקליניקה', 'צוות', 'לפני/אחרי'] as const;
export type GalTag = (typeof GAL_TAGS)[number];

export const MAX_GALLERY = 12;
export const ABOUT_MAX = 600;
/** Below this the "what is missing" card flags the description as short (design: 180). */
export const ABOUT_RECOMMENDED = 180;

export interface HoursRow { open: string; close: string; closed: boolean }
export interface GalleryItem { url: string; alt: string; tag: GalTag }

export interface ProfileForm {
  name: string;
  cats: string[];
  address: string;
  phone: string;
  whatsapp: string;
  email: string;
  instagram: string;
  description: string;
  wazeOn: boolean;
  wazeUrl: string;
  accessible: boolean;
  freeParking: boolean;
  onlineBooking: boolean;
  hours: HoursRow[];
  coverUrl: string;
  coverAlt: string;
  logoUrl: string;
  gallery: GalleryItem[];
}

export type FieldKey =
  | 'name' | 'cats' | 'address' | 'phone' | 'whatsapp' | 'email' | 'instagram' | 'description' | 'wazeUrl'
  | 'hours' | 'coverAlt' | 'gallery' | 'media';

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Only our own public upload URLs are accepted for cover, logo and gallery. */
export const MEDIA_URL_RE = /^\/media\/[0-9a-f-]{36}$/;
const WAZE_RE = /^https:\/\/((www|ul)\.)?waze\.com\/\S+$/i;
const IG_RE = /^@?[A-Za-z0-9._]{1,30}$/;

export const isGalTag = (v: unknown): v is GalTag => typeof v === 'string' && (GAL_TAGS as readonly string[]).includes(v);

/** "@noaclinic" or "noaclinic" → "noaclinic". Stored without the @. */
export const normalizeInstagram = (v: string) => v.trim().replace(/^@/, '');

export function validateProfile(f: ProfileForm) {
  const errors: Partial<Record<FieldKey, string>> = {};
  const name = f.name.trim();
  if (name.length < 2 || name.length > 120) errors.name = 'נדרש שם עסק, בין 2 ל־120 תווים';
  const cats = CATEGORIES.filter(c => f.cats.includes(c.slug));
  if (cats.length === 0 || cats.length !== f.cats.length) errors.cats = 'בחרו לפחות קטגוריה אחת';
  const address = f.address.trim();
  if (address.length < 4 || address.length > 200) errors.address = 'נדרשת כתובת מלאה: רחוב ומספר';
  if (!toE164(f.phone)) errors.phone = 'מספר הטלפון אינו תקין. לדוגמה 09-774-1180';
  if (f.whatsapp.trim() && !toE164(f.whatsapp)) errors.whatsapp = 'מספר הוואטסאפ אינו תקין. לדוגמה 052-441-9930';
  if (f.email.trim() && (!EMAIL_RE.test(f.email.trim()) || f.email.length > 160)) errors.email = 'כתובת הדוא״ל אינה תקינה';
  if (f.instagram.trim() && !IG_RE.test(f.instagram.trim())) errors.instagram = 'שם משתמש באינסטגרם: אותיות לועזיות, ספרות, נקודה וקו תחתון';
  if (f.description.length > ABOUT_MAX) errors.description = `עד ${ABOUT_MAX} תווים`;
  if (f.wazeOn && (!WAZE_RE.test(f.wazeUrl.trim()) || f.wazeUrl.length > 500)) errors.wazeUrl = 'הדביקו קישור שיתוף מ־Waze, שמתחיל ב־https://waze.com';

  const badHours = f.hours
    .map((h, i) => (h.closed || (TIME_RE.test(h.open) && TIME_RE.test(h.close) && h.open < h.close) ? -1 : i))
    .filter(i => i >= 0);
  if (f.hours.length !== 7) errors.hours = 'נדרשות שעות לכל שבעת הימים';
  else if (badHours.length) errors.hours = 'שעות בפורמט 09:00, ושעת הסגירה אחרי שעת הפתיחה';

  if (f.coverUrl && f.coverAlt.trim().length < 3) errors.coverAlt = 'נדרש תיאור נגישות לתמונת הכיסוי';
  if (f.coverAlt.length > 200) errors.coverAlt = 'עד 200 תווים';

  const badGallery = f.gallery.map((g, i) => (g.alt.trim().length >= 3 && g.alt.length <= 200 ? -1 : i)).filter(i => i >= 0);
  if (badGallery.length) errors.gallery = 'לכל תמונה בגלריה נדרש תיאור של שלושה תווים לפחות';
  if (f.gallery.length > MAX_GALLERY) errors.gallery = `עד ${MAX_GALLERY} תמונות בגלריה`;

  const urls = [f.coverUrl, f.logoUrl, ...f.gallery.map(g => g.url)].filter(Boolean);
  if (urls.some(u => !MEDIA_URL_RE.test(u)) || f.gallery.some(g => !g.url || !isGalTag(g.tag))) errors.media = 'אחת התמונות אינה תקינה. העלו אותה מחדש';

  return { ok: Object.keys(errors).length === 0, errors, badHours, badGallery };
}
