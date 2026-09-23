import { ImageResponse } from 'next/og';

// App icon drawn in code: navy tile, "bf" in white with the teal dot of the wordmark.
// `maskable` keeps the mark inside the central 60% safe zone that Android may crop to a circle.
export function appIcon(size: number, { maskable = false, radius = 0 } = {}) {
  const mark = Math.round(size * (maskable ? 0.36 : 0.5));
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0C243E',
          borderRadius: radius,
          color: '#FFFFFF',
          fontSize: mark,
          fontWeight: 700,
          letterSpacing: -mark * 0.04,
        }}
      >
        <span style={{ display: 'flex' }}>
          b<span style={{ color: '#14B3C6' }}>f</span>
          <span style={{ color: '#14B3C6' }}>.</span>
        </span>
      </div>
    ),
    { width: size, height: size },
  );
}
