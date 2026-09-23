// Light haptics where the platform supports them (Android browsers, installed PWA). No-op elsewhere.
const PATTERNS = { light: 8, success: [10, 40, 18], warning: [22, 50, 22] } as const;

export function haptic(kind: keyof typeof PATTERNS = 'light') {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      navigator.vibrate(PATTERNS[kind] as number | number[]);
    }
  } catch {
    /* unsupported */
  }
}
