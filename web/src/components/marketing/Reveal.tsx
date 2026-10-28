'use client';

import { useEffect, useRef, type CSSProperties, type ElementType, type ReactNode } from 'react';

// Scroll reveal for the marketing pages: the element renders visible on the server (no flash, readable
// without JS), and on the client hides until it enters the viewport, then plays the CSS in
// marketing.module.css ([data-reveal] / [data-in]). Reduced motion skips straight to visible.

type Props = {
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  /** Delay in ms, for staggering siblings. */
  delay?: number;
  /** rise (default), fade, scale, left, right. */
  kind?: 'rise' | 'fade' | 'scale' | 'left' | 'right';
  children: ReactNode;
  id?: string;
  'aria-labelledby'?: string;
  'aria-label'?: string;
  /** Extra data-* attributes, e.g. { featured: '' } renders data-featured. */
  data?: Record<string, string | undefined>;
};

export function Reveal({ as: Tag = 'div', className, style, delay = 0, kind = 'rise', children, data, ...rest }: Props) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.92) return; // already in view on load: leave it alone
    el.dataset.reveal = kind;
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.dataset.in = '';
            io.disconnect();
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [kind]);
  return (
    <Tag ref={ref} className={className} style={{ ...style, ['--d' as string]: `${delay}ms` }} {...rest} {...Object.fromEntries(Object.entries(data ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [`data-${k}`, v]))}>
      {children}
    </Tag>
  );
}
