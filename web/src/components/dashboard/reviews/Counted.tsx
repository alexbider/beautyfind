import type { Counted } from './stats';

/** Renders "לפני # ימים" with the number in an .ltr span. */
export function CountedText({ c }: { c: Counted }) {
  if (c.n === null) return <>{c.text}</>;
  const [before, after] = c.text.split('#');
  return (
    <>
      {before}
      <span className="ltr tnum">{c.n.toLocaleString('en-US')}</span>
      {after}
    </>
  );
}
