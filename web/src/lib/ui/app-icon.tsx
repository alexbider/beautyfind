import { ImageResponse } from 'next/og';
import { ICON_B, ICON_DOT, ICON_F } from './iconPaths';

// App icon drawn in code: navy tile with "bf." cut from the logo, "b" in white, "f." in teal.
// `maskable` keeps the mark inside the central 60% safe zone that Android may crop to a circle.
export function appIcon(size: number, { maskable = false, radius = 0 } = {}) {
  const w = Math.round(size * (maskable ? 0.5 : 0.66));
  const h = Math.round((w * 92) / 118);
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0B233D', borderRadius: radius }}>
        <svg width={w} height={h} viewBox="0 0 118 92">
          <path fill="#FFFFFF" d={ICON_B} />
          <path fill="#23BACC" transform="translate(-300 0)" d={ICON_F} />
          <path fill="#23BACC" transform="translate(-451 0)" d={ICON_DOT} />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
