// Google Maps Embed API (place mode) URL and query. Pure: shared by the map component and tests.
// The key is a browser key restricted to our domains and the Maps Embed API; no Places or geocoding
// call is made to build this.

export function mapsEmbedUrl(key: string, q: string): string {
  const params = new URLSearchParams({ key, q, language: 'he', region: 'IL', zoom: '16' });
  return `https://www.google.com/maps/embed/v1/place?${params}`;
}

/** q is place_id:… when the branch's Google place id is known, else the business name and full address. */
export const mapQuery = (b: { googlePlaceId: string | null; name: string; address: string; cityName: string }) =>
  b.googlePlaceId ? `place_id:${b.googlePlaceId}` : `${b.name}, ${b.address}${b.address.includes(b.cityName) ? '' : `, ${b.cityName}`}`;
