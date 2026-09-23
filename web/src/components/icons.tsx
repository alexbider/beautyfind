// Inline SVG icons used across screens. Arrows point left for "forward" (RTL).

type P = { size?: number; className?: string };

export function ArrowForward({ size = 15, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M12 7H2M6 3 2 7l4 4" />
    </svg>
  );
}

export function ArrowBack({ size = 15, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M2 7h10M8 3l4 4-4 4" />
    </svg>
  );
}

export function ChevronDown({ size = 12, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M2.5 4.5 6 8l3.5-3.5" />
    </svg>
  );
}

export function Check({ size = 11, strokeWidth = 1.9, className }: P & { strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M2.5 7.4 5.4 10.3 11.5 4" />
    </svg>
  );
}

const STAR = 'M8 1.3l2.06 4.3 4.69.62-3.43 3.24.87 4.66L8 11.9 3.81 14.12l.87-4.66L1.25 6.22l4.69-.62z';

/** Five Google-yellow stars. Always rendered LTR. */
export function Stars({ width = 85, height = 16 }: { width?: number; height?: number }) {
  return (
    <span dir="ltr" aria-hidden="true" style={{ display: 'inline-block', width, height, flex: 'none' }}>
      <svg width={width} height={height} viewBox="0 0 85 16" fill="#FBBC04" aria-hidden="true" style={{ display: 'block' }}>
        {[0, 17, 34, 51, 68].map(x => <path key={x} transform={x ? `translate(${x},0)` : undefined} d={STAR} />)}
      </svg>
    </span>
  );
}

/** Multi-path line icon on a 24px grid (feature cards). */
export function PathIcon({ paths, size = 21, stroke = '#0B7A87', strokeWidth = 1.5 }: { paths: string[]; size?: number; stroke?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths.map(d => <path key={d} d={d} />)}
    </svg>
  );
}
