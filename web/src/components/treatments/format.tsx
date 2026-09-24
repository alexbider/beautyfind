// Small presentational helpers shared by the Region, Treatments and Treatment Category pages.

import { nis } from '@/lib/format';

export const ORIGIN = 'https://beautyfind.co.il'; // matches metadataBase in app/layout.tsx

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

/** ₪1,200 inside an LTR span. */
export function Price({ shekels, className }: { shekels: number; className?: string }) {
  return <span className={`ltr tnum ${className ?? ''}`}>{nis(shekels)}</span>;
}

/** Percentage change of `value` against `base`, rounded. */
export const pctDelta = (value: number, base: number) => Math.round(((value - base) / base) * 100);

export function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** BreadcrumbList JSON-LD. The last crumb is the current page. */
export function breadcrumbLd(items: Array<{ name: string; path: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: ORIGIN + it.path })),
  };
}

export function faqLd(faqs: Array<{ q: string; a: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}

export function JsonLd({ data }: { data: object }) {
  // `<` is escaped so a string can never close the script tag.
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}
