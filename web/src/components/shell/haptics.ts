// Light haptics where the platform supports them (Android browsers, installed PWA). No-op elsewhere.
const PATTERNS = { light: 8, success: [10, 40, 18], warning: [22, 50, 22] } as const;

export function haptic(kind: keyof typeof PATTERNS = 'light') {
  try {
    // Browsers refuse (and log an error) before the user has interacted with the page, e.g. right
    // after returning from a payment redirect.
    const active = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? true;
    if (active && 'vibrate' in navigator && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      navigator.vibrate(PATTERNS[kind] as number | number[]);
    }
  } catch {
    /* unsupported */
  }
}
