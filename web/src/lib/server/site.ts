import 'server-only';

/** Absolute origin for links in emails and messages. */
export function siteUrl(): string {
  const url = process.env.SITE_URL;
  if (!url) {
    if (process.env.NODE_ENV === 'production') throw new Error('SITE_URL is not set');
    return 'http://localhost:3000';
  }
  return url.replace(/\/$/, '');
}
