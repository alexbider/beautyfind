// Shared metadata for public pages: canonical, Open Graph and Twitter card from one call, so every
// template carries the same tags. Images are site-relative paths or absolute URLs; metadataBase in the
// root layout makes them absolute.

import type { Metadata } from 'next';

export const SITE_NAME = 'BeautyFind';
export const SITE_ORIGIN = 'https://beautyfind.co.il';
/** The fallback share image for pages without one of their own. */
export const DEFAULT_OG_IMAGE = '/assets/hero-clinic.jpg';

/** The first candidate that fits Google's title width with the brand suffix; the last one is used as is. */
export function fitTitle(candidates: string[], max = 60, suffix = ' | BeautyFind'): string {
  for (const c of candidates) if ([...c].length + suffix.length <= max) return c;
  return candidates[candidates.length - 1];
}

export const DESCRIPTION_MIN = 130;
export const DESCRIPTION_MAX = 155;

export interface PublicMeta {
  path: string; // canonical path, no query
  title: string | { absolute: string };
  description: string;
  image?: string | { url: string; alt?: string } | null;
  /** noindex,follow (search results, filtered lists, empty pages). */
  noindex?: boolean;
}

/** Metadata for a public page: title, description, canonical, Open Graph and Twitter card. */
export function publicMetadata(m: PublicMeta): Metadata {
  const titleText = typeof m.title === 'string' ? m.title : m.title.absolute;
  const image = m.image ? (typeof m.image === 'string' ? { url: m.image } : m.image) : { url: DEFAULT_OG_IMAGE };
  return {
    title: m.title,
    description: m.description,
    alternates: { canonical: m.path },
    ...(m.noindex ? { robots: { index: false, follow: true } } : {}),
    openGraph: { type: 'website', locale: 'he_IL', siteName: SITE_NAME, url: m.path, title: titleText, description: m.description, images: [image] },
    twitter: { card: 'summary_large_image', title: titleText, description: m.description, images: [image.url] },
  };
}

/**
 * A meta description between DESCRIPTION_MIN and DESCRIPTION_MAX characters from ordered sentence parts:
 * parts are added while they fit; `filler` sentences are appended when the text is still short; the result
 * is cut at a word boundary when nothing shorter fits.
 */
export function composeDescription(parts: Array<string | null | undefined>, filler: string[] = [], max = DESCRIPTION_MAX, min = DESCRIPTION_MIN): string {
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
  let text = '';
  for (const raw of parts) {
    if (!raw) continue;
    const p = clean(raw);
    const next = text ? `${text} ${p}` : p;
    if (next.length <= max) text = next;
    else if (!text) text = p; // the first part always goes in, cut below if needed
  }
  for (const f of filler) {
    if (text.length >= min) break;
    const c = clean(f);
    if (!c) continue;
    const next = text ? `${text} ${c}` : c;
    if (next.length <= max) text = next;
  }
  if (text.length > max) {
    const cut = text.slice(0, max);
    const at = cut.lastIndexOf(' ');
    text = (at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,:;·]+$/u, '');
    if (!/[.!?]$/.test(text)) text = `${text.length < max ? text : text.slice(0, max - 1).trimEnd()}.`;
  }
  return text;
}
