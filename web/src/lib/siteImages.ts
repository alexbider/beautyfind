import cityHeroImages from '@/data/city-hero-images.json';
import staticImageAlts from '@/data/static-image-alts.json';

// The site's own landmark and treatment photos, written by scripts/fetch_beautyfind_images.py:
// a hero per city page (keyed by its path, e.g. /north/akko) and the Hebrew alt text of the
// replaced region and treatment photos (keyed by their /assets path).

export interface CityHero { src: string; fallback: string; alt: string; width: number; height: number }

const CITY_HERO: Record<string, CityHero> = cityHeroImages;

/** Alt text for a site photo by its /assets path, when the photo has a fixed description. */
export const STATIC_IMAGE_ALT: Record<string, string> = staticImageAlts;

/** The landmark hero of a city page, or null when the city has none and the page keeps the region image. */
export function cityHero(path: string): CityHero | null {
  return CITY_HERO[path] ?? null;
}

/** The region hero (/assets/region-<slug>.jpg) and its alt text. */
export function regionHero(slug: string): { src: string; alt: string | null } {
  const src = `/assets/region-${slug}.jpg`;
  return { src, alt: STATIC_IMAGE_ALT[src] ?? null };
}
