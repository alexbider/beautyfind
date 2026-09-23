import type { KeyboardEvent } from 'react';

/**
 * Arrow-key navigation for a role="radiogroup" of buttons (roving tabindex).
 * RTL: ArrowLeft moves forward, ArrowRight back. The newly focused radio is selected, as native radios do.
 */
export function radioKeys(e: KeyboardEvent<HTMLElement>) {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  if (!keys.includes(e.key)) return;
  const radios = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'));
  if (radios.length === 0) return;
  const i = radios.indexOf(document.activeElement as HTMLButtonElement);
  let n = i;
  if (e.key === 'Home') n = 0;
  else if (e.key === 'End') n = radios.length - 1;
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') n = (i + 1) % radios.length;
  else n = (i - 1 + radios.length) % radios.length;
  e.preventDefault();
  radios[n].focus();
  radios[n].click();
}

/** tabIndex for item `i` of a radiogroup whose selected index is `sel` (-1 = none selected). */
export const rove = (i: number, sel: number) => (sel === -1 ? (i === 0 ? 0 : -1) : i === sel ? 0 : -1);

const NUM_RE = /([₪+]?\d[\d/:.,\-–]*\d|[₪+]?\d)/g;

/** Plain stored text with every number, time, date and amount wrapped in an LTR span. */
export function LtrText({ text }: { text: string }) {
  const parts = text.split(NUM_RE);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} className="ltr tnum">{p}</span>
        ) : (
          p
        ),
      )}
    </>
  );
}
