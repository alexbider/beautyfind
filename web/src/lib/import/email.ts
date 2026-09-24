// Email addresses found on business websites. Pure functions; the MX lookup lives in the worker.

const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]{0,63}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}/gi;

// Look like addresses but are asset names, tracking ids or placeholders.
const JUNK_TLD = /\.(png|jpe?g|gif|webp|svg|avif|css|js|ico|mp4|webm|woff2?)$/i;
const JUNK_DOMAIN = /(^|\.)(example\.(com|org)|domain\.com|email\.com|yourdomain\.|sentry(-next)?\.(io|wixpress\.com)|wixpress\.com|sentry\.io|godaddy\.com|mysite\.com|site\.com|test\.com)$/i;
const JUNK_LOCAL = /^(noreply|no-reply|donotreply|do-not-reply|postmaster|mailer-daemon|abuse|example|user|name|your(name|email)?|email|test)$/i;

/** Free mail providers. An address there is normal for a small salon, so it is not a domain mismatch. */
export const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'walla.co.il', 'walla.com', 'hotmail.com', 'hotmail.co.il', 'outlook.com', 'outlook.co.il',
  'live.com', 'yahoo.com', 'yahoo.co.il', 'icloud.com', 'me.com', 'mac.com', 'bezeqint.net', 'netvision.net.il',
  'zahav.net.il', '013net.net', '012.net.il', 'inter.net.il', 'smile.net.il', 'barak.net.il', 'actcom.co.il', 'msn.com',
  'aol.com', 'protonmail.com', 'proton.me', 'gmx.com', 'mail.com', 'yandex.com',
]);

export function cleanEmail(raw: string): string | null {
  const e = raw.trim().replace(/^mailto:/i, '').split('?')[0].replace(/[.,;:)\]]+$/, '').toLowerCase();
  let decoded = e;
  try {
    decoded = decodeURIComponent(e);
  } catch {
    /* keep as is */
  }
  const m = decoded.match(/^[a-z0-9][a-z0-9._%+-]{0,63}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/);
  if (!m) return null;
  const [local, domain] = decoded.split('@');
  if (JUNK_TLD.test(decoded) || JUNK_DOMAIN.test(domain) || JUNK_LOCAL.test(local)) return null;
  if (/^[0-9a-f]{24,}$/.test(local)) return null; // hashes (Sentry DSNs and the like)
  return decoded;
}

/** Cloudflare "email protection" hides addresses as a hex string in data-cfemail. */
export function decodeCfEmail(hex: string): string | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 4) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

/** Every address in an HTML page: mailto links, Cloudflare-protected ones, plain text, simple [at] obfuscation. */
export function extractEmails(html: string): string[] {
  const found = new Set<string>();
  const add = (s: string | null) => {
    const c = s ? cleanEmail(s) : null;
    if (c) found.add(c);
  };
  for (const m of html.matchAll(/mailto:([^"'\s>]+)/gi)) add(m[1]);
  for (const m of html.matchAll(/data-cfemail=["']([0-9a-f]+)["']/gi)) add(decodeCfEmail(m[1]));
  for (const m of html.matchAll(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi)) add(decodeCfEmail(m[1]));
  const text = html
    .replace(/&#64;|&#x40;|\s*\[\s*at\s*\]\s*|\s*\(\s*at\s*\)\s*/gi, '@')
    .replace(/&#46;|\s*\[\s*dot\s*\]\s*/gi, '.');
  for (const m of text.matchAll(EMAIL_RE)) add(m[0]);
  return [...found];
}

export const emailDomain = (email: string) => email.split('@')[1] ?? '';

/** Registrable-ish host: strips www. and the path. */
export function siteHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/** True when the address belongs to the website's own domain (or a subdomain of it). */
export function sameDomain(email: string, website: string | null | undefined): boolean {
  const host = siteHost(website);
  const d = emailDomain(email);
  if (!host || !d) return false;
  return host === d || host.endsWith('.' + d) || d.endsWith('.' + host);
}

/**
 * Best address for the listing: one on the site's own domain first, then a free-mail address,
 * then anything else (flagged for review by the caller). Order inside a tier keeps page order.
 */
export function pickEmail(emails: string[], website: string | null | undefined): { email: string; tier: 'own' | 'free' | 'other' } | null {
  const own = emails.find(e => sameDomain(e, website));
  if (own) return { email: own, tier: 'own' };
  const free = emails.find(e => FREE_MAIL.has(emailDomain(e)));
  if (free) return { email: free, tier: 'free' };
  return emails[0] ? { email: emails[0], tier: 'other' } : null;
}
