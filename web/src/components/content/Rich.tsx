import Link from 'next/link';
import type { ReactNode } from 'react';
import { PENDING, PENDING_REVIEW } from './meta';
import styles from './content.module.css';

/*
 * Plain content strings → inline markup, so the content files stay free of JSX:
 *  - `[label](/href)` becomes a link (internal = next/link, mailto:/tel:/http = <a>);
 *  - PENDING / PENDING_REVIEW become a visible placeholder mark;
 *  - Latin words, numbers, prices, emails and time ranges get an isolated LTR span.
 */

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const TOKEN = '[A-Za-z0-9₪](?:[A-Za-z0-9₪.,:%/+@_\\-–]*[A-Za-z0-9₪%])?';
const LTR = new RegExp(`${TOKEN}(?: ${TOKEN})*`, 'g');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PLACEHOLDER = new RegExp(`(${escapeRe(PENDING)}|${escapeRe(PENDING_REVIEW)})`);

function ltrRuns(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(LTR)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(<span key={`${key}-l${i++}`} className="ltr">{m[0]}</span>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function withPlaceholders(text: string, key: string): ReactNode[] {
  return text.split(PLACEHOLDER).flatMap((part, i): ReactNode[] => {
    if (!part) return [];
    if (part === PENDING || part === PENDING_REVIEW) return [<mark key={`${key}-p${i}`} className={styles.pending}>{part}</mark>];
    return ltrRuns(part, `${key}-${i}`);
  });
}

export function rich(text: string, key = 'r'): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(LINK)) {
    const at = m.index ?? 0;
    if (at > last) out.push(...withPlaceholders(text.slice(last, at), `${key}-t${i}`));
    const [, label, href] = m;
    const inner = withPlaceholders(label, `${key}-a${i}`);
    out.push(
      href.startsWith('/') || href.startsWith('#') ? (
        <Link key={`${key}-k${i}`} href={href} className={styles.inlineLink}>{inner}</Link>
      ) : (
        <a key={`${key}-k${i}`} href={href} className={styles.inlineLink}>{inner}</a>
      ),
    );
    last = at + m[0].length;
    i++;
  }
  if (last < text.length) out.push(...withPlaceholders(text.slice(last), `${key}-t${i}`));
  return out;
}

/** Renders a content string with links, placeholders and LTR isolation applied. */
export function Rich({ text }: { text: string }) {
  return <>{rich(text)}</>;
}

/** Hebrew-carrying values stay RTL; pure latin/number values are isolated LTR. */
export const isHebrew = (s: string) => /[֐-׿]/.test(s);
