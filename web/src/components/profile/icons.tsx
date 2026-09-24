// Icons for the Business Profile and Practitioner pages. Paths are the design's own
// (BeautyFind Business Profile.dc.html); the social glyphs are the real brand marks.

type P = { size?: number; className?: string };

export function WhatsAppGlyph({ size = 18, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        fill="currentColor"
        d="M12 2.2A9.7 9.7 0 0 0 3.6 16.8L2.3 21.7l5-1.3A9.7 9.7 0 1 0 12 2.2zm0 17.7c-1.5 0-2.9-.4-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 19.9zm4.4-6c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.5.1l-.8 1c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 2s.8 2.3.9 2.5c.1.2 1.6 2.5 4 3.5 1.5.6 2 .7 2.8.6.4-.1 1.4-.6 1.6-1.1.2-.5.2-1 .1-1.1z"
      />
    </svg>
  );
}

export function PhoneGlyph({ size = 17, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M5 3.5h3.2l1.6 4-2 1.3a11 11 0 0 0 5.4 5.4l1.3-2 4 1.6V17a2.5 2.5 0 0 1-2.7 2.5A15.5 15.5 0 0 1 2.5 6.2 2.5 2.5 0 0 1 5 3.5z" />
    </svg>
  );
}

export function NavGlyph({ size = 15, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M16 2 2 8l6 1.9L10 16z" />
    </svg>
  );
}

export function PinGlyph({ size = 15, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M9 16s5.2-4.4 5.2-8.2A5.2 5.2 0 0 0 3.8 7.8C3.8 11.6 9 16 9 16" />
      <circle cx="9" cy="7.6" r="1.9" />
    </svg>
  );
}

/** Filled speech bubble for the contact-form call to action. */
export function MessageGlyph({ size = 17, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M5.5 3h13A2.5 2.5 0 0 1 21 5.5v9a2.5 2.5 0 0 1-2.5 2.5H9.4l-4.3 3.6A.7.7 0 0 1 4 20v-3.1A2.5 2.5 0 0 1 3 14.5v-9A2.5 2.5 0 0 1 5.5 3zm2 5.2a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zm4.5 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zm4.5 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z" />
    </svg>
  );
}

export function ExternalGlyph({ size = 14, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M9 2H2v7M2 2l6.5 6.5M5 12h7V5" />
    </svg>
  );
}

export function CloseGlyph({ size = 12, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true" className={className}>
      <path d="M3 3l8 8M11 3l-8 8" />
    </svg>
  );
}

/** Chevron pointing right (visually "previous" in RTL). */
export function ChevronRight({ size = 15, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M6 3l5 5-5 5" />
    </svg>
  );
}

export function ChevronLeft({ size = 15, className }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M10 3 5 8l5 5" />
    </svg>
  );
}

export function CheckMark({ size = 13, strokeWidth = 1.9, className }: P & { strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M2.5 7.4 5.4 10.3 11.5 4" />
    </svg>
  );
}

export const INSTAGRAM_PATH =
  'M12 2.2c3.2 0 3.6 0 4.9.07 1.2.06 1.8.25 2.2.42.6.23 1 .5 1.5.95.45.45.72.9.95 1.5.17.4.36 1 .42 2.2.07 1.3.07 1.7.07 4.9s0 3.6-.07 4.9c-.06 1.2-.25 1.8-.42 2.2-.23.6-.5 1-.95 1.5-.45.45-.9.72-1.5.95-.4.17-1 .36-2.2.42-1.3.07-1.7.07-4.9.07s-3.6 0-4.9-.07c-1.2-.06-1.8-.25-2.2-.42a4 4 0 0 1-1.5-.95 4 4 0 0 1-.95-1.5c-.17-.4-.36-1-.42-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.07-4.9c.06-1.2.25-1.8.42-2.2.23-.6.5-1 .95-1.5.45-.45.9-.72 1.5-.95.4-.17 1-.36 2.2-.42C8.4 2.2 8.8 2.2 12 2.2m0 1.98c-3.14 0-3.5.01-4.73.07-.92.04-1.4.19-1.72.32-.43.17-.7.36-1 .67-.3.3-.5.57-.67 1-.13.32-.28.8-.32 1.72-.06 1.23-.07 1.6-.07 4.73s.01 3.5.07 4.73c.04.92.19 1.4.32 1.72.17.43.36.7.67 1 .3.3.57.5 1 .67.32.13.8.28 1.72.32 1.23.06 1.6.07 4.73.07s3.5-.01 4.73-.07c.92-.04 1.4-.19 1.72-.32.43-.17.7-.36 1-.67.3-.3.5-.57.67-1 .13-.32.28-.8.32-1.72.06-1.23.07-1.6.07-4.73s-.01-3.5-.07-4.73c-.04-.92-.19-1.4-.32-1.72a2.7 2.7 0 0 0-.67-1 2.7 2.7 0 0 0-1-.67c-.32-.13-.8-.28-1.72-.32-1.23-.06-1.6-.07-4.73-.07m0 3.37a5.03 5.03 0 1 1 0 10.06 5.03 5.03 0 0 1 0-10.06m0 1.98a3.05 3.05 0 1 0 0 6.1 3.05 3.05 0 0 0 0-6.1m6.4-2.2a1.17 1.17 0 1 1-2.35 0 1.17 1.17 0 0 1 2.35 0';

export const WEBSITE_PATH =
  'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-2.9a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4c.8 1.2 1.5 2.5 1.9 4h-3.8c.4-1.5 1.1-2.8 1.9-4zM4.3 14a8.2 8.2 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4H4.3zm.8 2h2.9c.3 1.3.8 2.5 1.4 3.6A8 8 0 0 1 5.1 16zM8 8H5.1a8 8 0 0 1 4.3-3.6C8.8 5.5 8.3 6.7 8 8zm4 12c-.8-1.2-1.5-2.5-1.9-4h3.8c-.4 1.5-1.1 2.8-1.9 4zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4zm.3 5.6c.6-1.1 1.1-2.3 1.4-3.6h2.9a8 8 0 0 1-4.3 3.6zm1.7-5.6a16.5 16.5 0 0 0 0-4h3.4a8.2 8.2 0 0 1 0 4h-3.4z';

const STAR_SM = 'M8 1.3l2.06 4.3 4.69.62-3.43 3.24.87 4.66L8 11.9 3.81 14.12l.87-4.66L1.25 6.22l4.69-.62z';
const STAR_LG = 'M9.5 1.6l2.45 5.1 5.57.74-4.07 3.85 1.03 5.53L9.5 14.1l-4.98 2.64 1.03-5.53L1.48 7.44l5.57-.74z';

/**
 * Five stars filled to `rating` (grey #DADCE0 track, Google-yellow fill), always LTR.
 * Each star gets its own fill, so 4.7 shows four full stars and 70% of the fifth
 * (one clip over the whole row would ignore the gaps between the stars).
 * `lg` is the review-summary size (102×19); the default is the inline size (92×17 / 85×16).
 */
export function RatingStars({ rating, width = 92, height = 17, lg = false }: { rating: number; width?: number; height?: number; lg?: boolean }) {
  const d = lg ? STAR_LG : STAR_SM;
  const step = lg ? 21 : 17;
  const r = Math.max(0, Math.min(5, rating));
  return (
    <svg width={width} height={height} viewBox={lg ? '0 0 102 19' : '0 0 85 16'} aria-hidden="true" style={{ display: 'block', flex: 'none', maxWidth: 'none' }}>
      {[0, 1, 2, 3, 4].map(i => {
        const f = Math.round(Math.max(0, Math.min(1, r - i)) * 100);
        const fill = f === 100 ? '#FBBC04' : f === 0 ? '#DADCE0' : `url(#bf-star-${f})`;
        return (
          <g key={i} transform={i ? `translate(${i * step},0)` : undefined}>
            {f > 0 && f < 100 && (
              <defs>
                {/* The id depends only on the fill level, so repeats on one page are identical. */}
                <linearGradient id={`bf-star-${f}`} x1="0" x2="1" y1="0" y2="0">
                  <stop offset={`${f}%`} stopColor="#FBBC04" />
                  <stop offset={`${f}%`} stopColor="#DADCE0" />
                </linearGradient>
              </defs>
            )}
            <path d={d} fill={fill} />
          </g>
        );
      })}
    </svg>
  );
}

const STAR_14 = 'M7 1.2l1.8 3.75 4.1.54-3 2.84.76 4.07L7 10.5l-3.66 1.94.76-4.07-3-2.84 4.1-.54z';

/** Five 13px stars for a single review (whole stars). */
export function SmallStars({ rating, size = 13 }: { rating: number; size?: number }) {
  return (
    <span dir="ltr" role="img" aria-label={`${rating} מתוך 5`} style={{ display: 'inline-flex', gap: 1 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <svg key={n} width={size} height={size} viewBox="0 0 14 14" fill={n <= rating ? '#FBBC04' : '#DADCE0'} aria-hidden="true">
          <path d={STAR_14} />
        </svg>
      ))}
    </span>
  );
}

export function StarGlyph({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="#FBBC04" aria-hidden="true">
      <path d={STAR_14} />
    </svg>
  );
}

/** Service-category line icons (24px grid), from the design; generic sparkle for the rest. */
export const CATEGORY_ICONS: Record<string, string[]> = {
  'medical-aesthetics': ['M13.8 3.6l6.6 6.6', 'M11.7 5.7l6.6 6.6', 'M16.4 8.1l-8.6 8.6L3.6 20.4l3.7-4.2 8.6-8.6', 'M9.2 11.3l3.5 3.5'],
  facials: ['M12 4.2c4 4.6 6 7.4 6 10a6 6 0 0 1-12 0c0-2.6 2-5.4 6-10z', 'M9.4 14.8a2.6 2.6 0 0 0 2.6 2.6'],
  'hair-removal': ['M9.2 3.6h5.6l-1.1 5.6h-3.4z', 'M12 9.2v3.4', 'M8.8 16.4c.9-1.1 2-1.7 3.2-1.7s2.3.6 3.2 1.7', 'M5.4 20.4h13.2'],
  'body-contouring': ['M7.4 3.6c1.9 3.1 1.9 5.3 0 8.4s-1.9 5.3 0 8.4', 'M16.6 3.6c-1.9 3.1-1.9 5.3 0 8.4s1.9 5.3 0 8.4', 'M9.6 12h4.8'],
  'brows-lashes': ['M3.4 12.6c3-4.4 14.2-4.4 17.2 0', 'M6.2 9.6 4.8 7.4', 'M12 8.2V5.6', 'M17.8 9.6l1.4-2.2', 'M9.6 16.6h4.8'],
};
export const DEFAULT_CATEGORY_ICON = ['M12 3.4 14 7l4 .6-2.9 2.8.7 4L12 12.5 8.2 14.4l.7-4L6 7.6 10 7z', 'M5 19.6h14'];
