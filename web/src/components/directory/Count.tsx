import { fmtNum } from './copy';

/** Hebrew count phrase with the number in an LTR span: "עסק אחד" · "שני עסקים" · "12 עסקים". */
export function Count({ n, f }: { n: number; f: { one: string; two: string; many: string } }) {
  if (n === 1) return <>{f.one}</>;
  if (n === 2) return <>{f.two}</>;
  return (
    <>
      <span className="ltr">{fmtNum(n)}</span> {f.many}
    </>
  );
}
