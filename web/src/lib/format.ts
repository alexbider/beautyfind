// Formatting and validation shared by client and server code.

/** ₪1,200 style. Input in whole shekels. */
export const nis = (shekels: number) => '₪' + Math.round(shekels).toLocaleString('en-US');

/** ₪1,200 style from integer agorot. */
export const nisFromAgorot = (agorot: number) => nis(agorot / 100);

/** Israeli local phone as typed (050-123-4567, 03 5551234). Same rule the designs validate with. */
export const IL_PHONE_RE = /^0\d{1,2}[- ]?\d{3}[- ]?\d{4}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** 050-123-4567 → +972501234567. Returns null when it is not a valid local number. */
export function toE164(local: string): string | null {
  const t = local.trim();
  if (t.startsWith('+972')) {
    const rest = t.slice(4).replace(/\D/g, '');
    return rest.length >= 8 && rest.length <= 9 ? '+972' + rest : null;
  }
  if (!IL_PHONE_RE.test(t)) return null;
  return '+972' + t.replace(/\D/g, '').slice(1);
}

/** +972501234567 → 050-123-4567 for display (always inside a dir="ltr" span). */
export function fromE164(e164: string): string {
  if (!e164.startsWith('+972')) return e164;
  const d = '0' + e164.slice(4);
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  return d;
}

/** tel: href in international form without spaces, e.g. tel:+972977411180 */
export const telHref = (e164: string) => 'tel:' + e164.replace(/\s/g, '');

/** ח.פ. / ע.מ.: exactly 9 digits. */
export const isCompanyNo = (v: string) => /^\d{9}$/.test(v.replace(/\D/g, ''));
