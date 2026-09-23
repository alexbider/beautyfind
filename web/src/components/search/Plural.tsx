import { priceOptionParts } from './params';

// Hebrew singular / dual / plural with the number isolated LTR.
// <Plural n={n} one="עסק אחד" two="שני עסקים" many="עסקים" /> → "עסק אחד" · "שני עסקים" · "12 עסקים"

export function Plural({ n, one, two, many }: { n: number; one: string; two: string; many: string }) {
  if (n === 1) return <>{one}</>;
  if (n === 2) return <>{two}</>;
  return (
    <>
      <span className="ltr tnum">{n.toLocaleString('en-US')}</span> {many}
    </>
  );
}

export const BizCount = ({ n }: { n: number }) => <Plural n={n} one="עסק אחד" two="שני עסקים" many="עסקים" />;
export const ResultCount = ({ n }: { n: number }) => <Plural n={n} one="תוצאה אחת" two="שתי תוצאות" many="תוצאות" />;

/** "עד ₪300 · חסכוני" with the amount isolated LTR. */
export function PriceOption({ max }: { max: number }) {
  const p = priceOptionParts(max);
  return (
    <>
      עד <span className="ltr tnum">{p.amount}</span>
      {p.tier ? ` · ${p.tier}` : ''}
    </>
  );
}
