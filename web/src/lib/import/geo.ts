// Geography for the import: search areas per catalog city, and mapping a Google place back to
// our city and region. Centres are approximate (a few hundred metres); radii cover the built-up area.

import { CITIES, type RegionSlug } from '../catalog';

// A type alias (not an interface) so it can be stored as Prisma JSON.
export type Box = {
  s: number; // south lat
  w: number; // west lng
  n: number; // north lat
  e: number; // east lng
};

/** slug -> [lat, lng, radius km] */
export const CITY_AREA: Record<string, [number, number, number]> = {
  nahariya: [33.006, 35.095, 3], akko: [32.927, 35.083, 3], karmiel: [32.919, 35.296, 3], tzfat: [32.965, 35.496, 3],
  tiberias: [32.795, 35.531, 3], 'kiryat-shmona': [33.207, 35.571, 2.5], nazareth: [32.700, 35.303, 4.5], afula: [32.608, 35.289, 3],
  'migdal-haemek': [32.676, 35.241, 2], 'beit-shean': [32.497, 35.497, 2], yokneam: [32.659, 35.107, 2.5],
  haifa: [32.794, 34.990, 7], 'kiryat-bialik': [32.833, 35.085, 2], 'kiryat-motzkin': [32.837, 35.077, 2], 'kiryat-ata': [32.809, 35.106, 3],
  'kiryat-yam': [32.849, 35.069, 2], nesher: [32.766, 35.041, 2.5], 'tirat-carmel': [32.760, 34.972, 2], hadera: [32.434, 34.919, 4],
  'zichron-yaakov': [32.572, 34.954, 2.5], 'pardes-hanna': [32.473, 34.973, 3], binyamina: [32.522, 34.950, 2],
  netanya: [32.321, 34.853, 5], raanana: [32.184, 34.871, 3], 'kfar-saba': [32.175, 34.907, 3], herzliya: [32.166, 34.825, 4],
  'hod-hasharon': [32.150, 34.892, 3], 'ramat-hasharon': [32.146, 34.839, 2.5], 'even-yehuda': [32.270, 34.888, 2], 'kfar-yona': [32.317, 34.935, 2],
  'tel-mond': [32.254, 34.918, 2],
  'tel-aviv': [32.080, 34.781, 7], 'ramat-gan': [32.068, 34.824, 3.5], givatayim: [32.071, 34.810, 1.5], 'bnei-brak': [32.084, 34.834, 2],
  'petah-tikva': [32.087, 34.887, 4.5], holon: [32.011, 34.779, 3.5], 'bat-yam': [32.017, 34.745, 2.5], 'rishon-lezion': [31.964, 34.804, 5],
  'rosh-haayin': [32.095, 34.957, 3], 'or-yehuda': [32.030, 34.855, 2], 'kiryat-ono': [32.064, 34.855, 1.5], 'givat-shmuel': [32.078, 34.848, 1.2],
  jerusalem: [31.778, 35.215, 9], 'beit-shemesh': [31.747, 34.988, 4], 'maale-adumim': [31.777, 35.298, 3], 'mevaseret-zion': [31.802, 35.150, 2],
  'beitar-illit': [31.697, 35.116, 2], 'givat-zeev': [31.861, 35.169, 2],
  rehovot: [31.894, 34.811, 3.5], 'ness-ziona': [31.930, 34.799, 2.5], modiin: [31.899, 35.010, 5], lod: [31.951, 34.895, 3],
  ramla: [31.929, 34.866, 3], yavne: [31.878, 34.739, 3], gedera: [31.814, 34.778, 2], shoham: [31.999, 34.946, 2],
  ashdod: [31.804, 34.655, 5.5], ashkelon: [31.669, 34.571, 5], 'kiryat-gat': [31.610, 34.764, 3], 'beer-sheva': [31.252, 34.791, 7],
  ofakim: [31.314, 34.620, 2.5], netivot: [31.421, 34.588, 2.5], sderot: [31.525, 34.596, 2], dimona: [31.067, 35.033, 3],
  arad: [31.259, 35.213, 3], eilat: [29.557, 34.952, 5], 'mitzpe-ramon': [30.610, 34.801, 2], lehavim: [31.370, 34.816, 2],
};

/** Rough outline of Israel for the whole-country grid (lng, lat). Cells fully outside it are skipped. */
export const ISRAEL_OUTLINE: Array<[number, number]> = [
  [35.10, 33.09], [35.50, 33.10], [35.62, 33.25], [35.83, 33.34], [35.90, 32.95], [35.64, 32.69], [35.57, 32.40],
  [35.55, 31.80], [35.45, 31.45], [35.40, 31.10], [35.18, 30.60], [35.02, 29.95], [34.96, 29.50], [34.90, 29.49],
  [34.26, 31.22], [34.49, 31.60], [34.57, 31.78], [34.73, 32.10], [34.86, 32.60], [34.95, 32.83], [35.07, 32.86],
];

const KM_LAT = 110.574;
const kmLng = (lat: number) => 111.32 * Math.cos((lat * Math.PI) / 180);

export function boxAround(lat: number, lng: number, km: number): Box {
  const dLat = km / KM_LAT;
  const dLng = km / kmLng(lat);
  return { s: lat - dLat, n: lat + dLat, w: lng - dLng, e: lng + dLng };
}

export const cityBox = (slug: string): Box | null => {
  const a = CITY_AREA[slug];
  return a ? boxAround(a[0], a[1], a[2]) : null;
};

export const boxCenter = (b: Box) => ({ lat: (b.s + b.n) / 2, lng: (b.w + b.e) / 2 });

/** Radius in metres of the circle that covers the box. */
export function boxRadius(b: Box): number {
  const c = boxCenter(b);
  return Math.ceil(distanceKm(c.lat, c.lng, b.n, b.e) * 1000);
}

export const boxSideKm = (b: Box) => Math.max((b.n - b.s) * KM_LAT, (b.e - b.w) * kmLng((b.s + b.n) / 2));

export function splitBox(b: Box): Box[] {
  const { lat, lng } = boxCenter(b);
  return [
    { s: b.s, w: b.w, n: lat, e: lng },
    { s: b.s, w: lng, n: lat, e: b.e },
    { s: lat, w: b.w, n: b.n, e: lng },
    { s: lat, w: lng, n: b.n, e: b.e },
  ];
}

/** Square cells of `km` over the box. */
export function tileBox(b: Box, km: number): Box[] {
  const out: Box[] = [];
  const dLat = km / KM_LAT;
  for (let s = b.s; s < b.n; s += dLat) {
    const dLng = km / kmLng(s);
    for (let w = b.w; w < b.e; w += dLng) out.push({ s, w, n: Math.min(s + dLat, b.n), e: Math.min(w + dLng, b.e) });
  }
  return out;
}

export const boxKey = (b: Box) => [b.s, b.w, b.n, b.e].map(x => x.toFixed(5)).join(',');

export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function inPolygon(lng: number, lat: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Keep a cell when its centre or any corner is on land inside the outline. */
export function boxTouchesIsrael(b: Box): boolean {
  const c = boxCenter(b);
  const pts: Array<[number, number]> = [[c.lng, c.lat], [b.w, b.s], [b.e, b.s], [b.w, b.n], [b.e, b.n]];
  return pts.some(([x, y]) => inPolygon(x, y, ISRAEL_OUTLINE));
}

export const ISRAEL_BOX: Box = { s: 29.45, w: 34.25, n: 33.35, e: 35.92 };

/** Hebrew place names compare badly as typed: קרית/קריית, dashes, maqaf, "יפו". */
export function normCityName(s: string): string {
  return s
    .replace(/[֑-ׇ]/g, '') // niqqud
    .replace(/[־–—\-'"׳״.,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/יי/g, 'י')
    .replace(/וו/g, 'ו')
    .replace(/ יפו$/, '')
    .replace(/^קרית /, 'קרית ');
}

const CITY_BY_NAME = new Map(CITIES.map(c => [normCityName(c.name), c]));
const CITY_ALIASES: Record<string, string> = {
  [normCityName('תל אביב')]: 'tel-aviv', [normCityName('יפו')]: 'tel-aviv', [normCityName('פרדס חנה כרכור')]: 'pardes-hanna',
  [normCityName('מודיעין מכבים רעות')]: 'modiin', [normCityName('נוף הגליל')]: 'nazareth', [normCityName('עכו')]: 'akko',
};

export interface PlaceCity {
  cityName: string | null;
  citySlug: string | null;
  regionSlug: RegionSlug;
}

/**
 * Our city and region for a place. The Google locality wins when it names a catalog city; otherwise
 * the nearest catalog city decides the region and the locality stays as free text.
 */
export function resolveCity(locality: string | null, lat: number, lng: number): PlaceCity {
  if (locality) {
    const n = normCityName(locality);
    const hit = CITY_BY_NAME.get(n) ?? CITIES.find(c => c.slug === CITY_ALIASES[n]);
    if (hit) return { cityName: hit.name, citySlug: hit.slug, regionSlug: hit.region };
  }
  let best: { slug: string; d: number } | null = null;
  for (const [slug, [la, ln]] of Object.entries(CITY_AREA)) {
    const d = distanceKm(lat, lng, la, ln);
    if (!best || d < best.d) best = { slug, d };
  }
  const near = CITIES.find(c => c.slug === best!.slug)!;
  // Inside a catalog city's own area: that city, even when the provider spells the locality in
  // English or transliteration ("Tel Aviv-Yafo"). The coordinates decide, the spelling does not.
  if (best && best.d <= CITY_AREA[near.slug][2]) return { cityName: near.name, citySlug: near.slug, regionSlug: near.region };
  return { cityName: locality, citySlug: null, regionSlug: near.region };
}
