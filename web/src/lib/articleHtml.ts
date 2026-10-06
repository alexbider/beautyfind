import { Parser } from 'htmlparser2';
import sanitizeHtml from 'sanitize-html';
import { SITE_ORIGIN } from './seo/meta';

// The magazine's HTML rules, pure so the tests and the admin can share them. An article body is
// stored sanitized: only the tags below survive, external links carry rel="nofollow noopener noreferrer"
// and open in a new tab, internal links lose any rel, images keep src/alt/size, and every h2/h3 gets a
// stable id for the table of contents. JSON-LD scripts in the body are not kept inline: they are parsed
// and returned apart (the article stores them in jsonLdExtra and the page adds them to its graph), so
// no script ever reaches the rendered HTML.

export const ARTICLE_PATH_PREFIX = '/magazine/';
export const articlePath = (slug: string) => `${ARTICLE_PATH_PREFIX}${slug}`;
/** The canonical URL of an article: the permalink, percent-encoded for Hebrew slugs. */
export const articleCanonical = (slug: string) => `${SITE_ORIGIN}${ARTICLE_PATH_PREFIX}${encodeURIComponent(slug)}`;

export const ALLOWED_TAGS = ['h2', 'h3', 'p', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'strong', 'em', 'a', 'figure', 'img', 'figcaption', 'blockquote', 'br', 'hr'] as const;
const ALLOWED_ATTRS: Record<string, string[]> = {
  a: ['href', 'rel', 'target', 'title'],
  img: ['src', 'alt', 'width', 'height', 'loading'],
  th: ['scope', 'colspan', 'rowspan'],
  td: ['colspan', 'rowspan'],
  h2: ['id'],
  h3: ['id'],
  ol: ['start'],
};
const VOID = new Set(['br', 'hr', 'img']);
const EXTERNAL_REL = 'nofollow noopener noreferrer';

/** A slug is Hebrew letters and digits, or lowercase Latin letters and digits, with single hyphens between words. */
export const SLUG_RE = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*|[א-ת0-9]+(?:-[א-ת0-9]+)*)$/u;
export const isValidSlug = (s: string) => s.length >= 1 && s.length <= 120 && SLUG_RE.test(s);

/** A slug from a title: Hebrew titles keep their letters, Latin titles are lower-cased; everything else becomes a hyphen. */
export function slugify(text: string): string {
  const t = text.normalize('NFKC').replace(/[֑-ׇ]/g, '').replace(/['’׳"״]/g, '').trim(); // drop Hebrew points; apostrophes and geresh join the word (צ'קליסט becomes צקליסט)
  const hebrew = /[א-ת]/.test(t);
  const kept = hebrew ? t.replace(/[^א-ת0-9]+/gu, '-') : t.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return kept.replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-').slice(0, 120).replace(/-+$/, '');
}

/** A file name for an uploaded image: lowercase Latin letters, digits and hyphens. Hebrew input falls back to the given default. */
export function fileSlug(text: string | null | undefined, fallback: string): string {
  const s = (text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\.(webp|jpe?g|png|avif)$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-').slice(0, 80);
  return s || fallback;
}

export const isInternalHref = (href: string) => href.startsWith('/') ? !href.startsWith('//') : href.startsWith(`${SITE_ORIGIN}/`) || href === SITE_ORIGIN;
/** The site path of an internal href (without query or fragment), or null for external links. */
export function internalPath(href: string): string | null {
  if (!isInternalHref(href)) return null;
  const raw = href.startsWith('/') ? href : href.slice(SITE_ORIGIN.length) || '/';
  const path = raw.split('#')[0].split('?')[0].replace(/\/+$/, '') || '/';
  try { return decodeURI(path); } catch { return path; }
}

export interface SanitizedArticle {
  html: string;
  /** JSON-LD objects found in <script type="application/ld+json"> blocks, in order. */
  jsonLd: unknown[];
  /** Things the input had that could not be kept (invalid JSON-LD, scripts of other types). */
  errors: string[];
}

const LD_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

/** Sanitizes an article body. Deterministic: sanitizing the output again yields the same string. */
export function sanitizeArticleHtml(input: string): SanitizedArticle {
  const jsonLd: unknown[] = [];
  const errors: string[] = [];
  const stripped = input.replace(LD_SCRIPT, (_m, attrs: string, body: string) => {
    if (/type\s*=\s*["']?application\/ld\+json/i.test(attrs)) {
      try {
        const parsed = JSON.parse(body.trim());
        if (Array.isArray(parsed)) jsonLd.push(...parsed); else jsonLd.push(parsed);
      } catch {
        errors.push('invalid JSON-LD script removed');
      }
    } else {
      errors.push('script removed');
    }
    return '';
  });
  const html = sanitizeHtml(stripped, {
    allowedTags: [...ALLOWED_TAGS, 'h1'],
    allowedAttributes: ALLOWED_ATTRS,
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['https', 'http'] },
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: false,
    enforceHtmlBoundary: true,
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'],
    transformTags: {
      // The title is the page's only H1: a heading the writer marked h1 in the body becomes an h2.
      h1: () => ({ tagName: 'h2', attribs: {} }),
      a: (tag, attribs) => {
        const { href: rawHref, rel: _r, target: _t, ...rest } = attribs;
        const href = (rawHref ?? '').trim();
        const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1].toLowerCase();
        if (!href || (scheme && !['http', 'https', 'mailto', 'tel'].includes(scheme))) return { tagName: tag, attribs: rest }; // no link at all rather than a dangling rel
        if (isInternalHref(href)) return { tagName: tag, attribs: { ...rest, href } };
        return { tagName: tag, attribs: { ...rest, href, rel: EXTERNAL_REL, target: '_blank' } };
      },
      img: (tag, attribs) => {
        const out: Record<string, string> = { ...attribs };
        if (out.alt === undefined) out.alt = '';
        if (!out.loading) out.loading = 'lazy';
        for (const k of ['width', 'height']) if (out[k] !== undefined && !/^\d{1,5}$/.test(out[k])) delete out[k];
        return { tagName: tag, attribs: out };
      },
    },
  });
  return { html: withHeadingIds(html), jsonLd, errors };
}

/** Adds an id to every h2/h3 that has none, from its text; duplicates get -2, -3. */
export function withHeadingIds(html: string): string {
  const used = new Set<string>();
  return html.replace(/<(h2|h3)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi, (m, tag: string, attrs: string | undefined, inner: string) => {
    const existing = /\sid\s*=\s*"([^"]*)"/i.exec(attrs ?? '');
    if (existing) { used.add(existing[1]); return m; }
    const text = inner.replace(/<[^>]+>/g, '').trim();
    let base = slugify(text) || 'section';
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    base = id;
    return `<${tag}${attrs ?? ''} id="${base}">${inner}</${tag}>`;
  });
}

export interface ArticleAnalysis {
  wordCount: number;
  readingTimeMinutes: number;
  h1Count: number;
  headings: Array<{ level: 2 | 3; id: string | null; text: string }>;
  images: Array<{ src: string; alt: string | null }>;
  links: Array<{ href: string; text: string; internal: boolean; path: string | null; rel: string | null }>;
  /** Tags the parser had to close itself (the input left them open). */
  unclosed: string[];
  text: string;
}

const WORD = /[\p{L}\p{N}]+(?:['’"״׳-][\p{L}\p{N}]+)*/gu;
export const countWords = (text: string) => (text.match(WORD) ?? []).length;
/** Hebrew readers manage about 200 words a minute; one minute at least. */
export const readingMinutes = (words: number) => Math.max(1, Math.ceil(words / 200));

/** Reads an article body: words, headings, images, links and tags left open. Works on raw and on sanitized HTML. */
export function analyzeArticleHtml(html: string): ArticleAnalysis {
  const headings: ArticleAnalysis['headings'] = [];
  const images: ArticleAnalysis['images'] = [];
  const links: ArticleAnalysis['links'] = [];
  const unclosed: string[] = [];
  let h1Count = 0;
  const textParts: string[] = [];
  const stack: Array<{ name: string; text: string[]; attrs: Record<string, string> }> = [];
  let skip = 0;
  const parser = new Parser({
    onopentag(name, attrs) {
      if (name === 'script' || name === 'style') { skip++; return; }
      if (name === 'h1') h1Count++;
      if (name === 'img') images.push({ src: attrs.src ?? '', alt: attrs.alt === undefined ? null : attrs.alt });
      if (VOID.has(name)) return;
      stack.push({ name, text: [], attrs });
    },
    ontext(t) {
      if (skip) return;
      textParts.push(t);
      for (const s of stack) s.text.push(t);
    },
    onclosetag(name, isImplied) {
      if (name === 'script' || name === 'style') { skip = Math.max(0, skip - 1); return; }
      if (VOID.has(name)) return;
      const i = stack.map(s => s.name).lastIndexOf(name);
      if (i < 0) return;
      const [el] = stack.splice(i, 1);
      if (isImplied && !['li', 'p', 'tr', 'td', 'th', 'thead', 'tbody'].includes(name)) unclosed.push(name);
      else if (isImplied && name === 'p' && stack.length === 0) unclosed.push(name);
      const text = el.text.join('').replace(/\s+/g, ' ').trim();
      if (name === 'h2' || name === 'h3') headings.push({ level: name === 'h2' ? 2 : 3, id: el.attrs.id ?? null, text });
      if (name === 'a') {
        const href = (el.attrs.href ?? '').trim();
        links.push({ href, text, internal: isInternalHref(href), path: internalPath(href), rel: el.attrs.rel ?? null });
      }
    },
  }, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  parser.write(html);
  parser.end();
  const text = textParts.join(' ').replace(/\s+/g, ' ').trim();
  const wordCount = countWords(text);
  return { wordCount, readingTimeMinutes: readingMinutes(wordCount), h1Count, headings, images, links, unclosed: [...new Set(unclosed)], text };
}

/** Plain text of an HTML fragment (for excerpts and schema descriptions). */
export const htmlToText = (html: string) => analyzeArticleHtml(html).text;

// ---------- time ----------

const TZ = 'Asia/Jerusalem';
const dtf = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** The wall clock in Jerusalem for an instant, as a UTC timestamp of the same digits. */
function wallClock(t: number): number {
  const p = Object.fromEntries(dtf.formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}

/**
 * Parses a scheduling time. "2026-10-20T09:30" (no zone) is Jerusalem wall time; an ISO string with Z or an
 * offset is taken as is. Returns null for anything else.
 */
export function parseJerusalemTime(input: string): Date | null {
  const s = input.trim();
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  let t = guess - (wallClock(guess) - guess);
  t = guess - (wallClock(t) - t); // a second pass settles a DST edge
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "2026-10-20T09:30+03:00": the instant as Jerusalem local time with its offset. */
export function formatJerusalem(d: Date): string {
  const wall = wallClock(d.getTime());
  const offMin = Math.round((wall - d.getTime()) / 60_000);
  const sign = offMin >= 0 ? '+' : '-';
  const a = Math.abs(offMin);
  const iso = new Date(wall).toISOString().slice(0, 19);
  return `${iso}${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

/** "20 באוקטובר 2026" for bylines. */
export const dateHe = (d: Date) => d.toLocaleDateString('he-IL', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' });
