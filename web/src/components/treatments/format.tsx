// Small presentational helpers shared by the Region, Treatments and Treatment Category pages.

import { nis } from '@/lib/format';
import { breadcrumbNode, faqNode, graph, webPageNode, type Crumb, type WebPageInput } from '@/lib/seo/schema';

export const fmtInt = (n: number) => n.toLocaleString('en-US');

/** Hebrew count phrase with the number isolated LTR: "עסק אחד" · "12 עסקים". */
export function Count({ n, one, many, zero }: { n: number; one: string; many: string; zero?: string }) {
  if (n === 0 && zero) return <>{zero}</>;
  if (n === 1) return <>{one}</>;
  return (
    <>
      <span className="ltr tnum">{fmtInt(n)}</span> {many}
    </>
  );
}

/** Same as <Count> but as a plain string (metadata, aria labels, JSON-LD). */
export function countText(n: number, one: string, many: string, zero?: string) {
  if (n === 0 && zero) return zero;
  if (n === 1) return one;
  return `${fmtInt(n)} ${many}`;
}

export const BIZ = { one: 'עסק אחד', many: 'עסקים', zero: 'עדיין אין עסקים' };

/** "1,200 ₪" inside an LTR span. */
export function Price({ shekels, className }: { shekels: number; className?: string }) {
  return <span className={`ltr tnum ${className ?? ''}`}>{nis(shekels)}</span>;
}

/** Percentage change of `value` against `base`, rounded. */
export const pctDelta = (value: number, base: number) => Math.round(((value - base) / base) * 100);


/**
 * The page's structured data as one graph: a WebPage that belongs to the site, its BreadcrumbList (the
 * last crumb is the page itself) and, when given, its FAQPage. Node ids derive from the page path.
 */
export function pageLd(p: Omit<WebPageInput, 'breadcrumb'> & { crumbs: Crumb[]; faqs?: Array<{ q: string; a: string }> }) {
  const { crumbs, faqs, ...page } = p;
  return graph([webPageNode({ ...page, breadcrumb: true }), breadcrumbNode(p.path, crumbs), ...(faqs?.length ? [faqNode(p.path, faqs)] : [])]);
}

export function JsonLd({ data }: { data: object }) {
  // `<` is escaped so a string can never close the script tag.
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}
