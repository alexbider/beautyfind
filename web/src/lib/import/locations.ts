// Branch blocks on a chain's website. A "סניפים" page lists every location with its own address, phone,
// email and hours; the import record is one branch, so its facts must come from the block that names
// its city, not from the site's central number. Pure text work; the crawler reads the page, the
// website stage picks the block.

import { CITIES } from '../catalog';
import { extractEmails } from './email';
import { normCityName } from './geo';
import { findPhones } from './phone';
import { hoursFromText } from './siteExtract';
import type { DayHours } from './rules';

export interface LocationBlock {
  heading: string; // the block's first line, usually the branch name ("אמריקן לייזר תל אביב")
  text: string; // the block's text, trimmed
  cities: string[]; // catalog city slugs named in the block
  phones: string[]; // E.164
  emails: string[];
  address: string | null;
  hours: DayHours[] | null;
  url: string;
}

/** Link text or path of a page that lists a chain's locations. */
export const BRANCHES_LINK = /(branch|location|our-clinics|clinics|centers|centres|stores|סניפ|מוקד|מרכזים|הקליניקות|קליניקות|מיקומ|אזורי\s*שירות|איפה\s*אנחנו)/i;

const STREET = /(רחוב|רח['׳]|שדרות|שד['׳]|דרך|כיכר|סמטת|קניון|מרכז מסחרי|street|st\.|road|rd\.|blvd|avenue|ave\.)/i;
const ADDRESS_LINE = /^(?:כתובת\s*[:：]\s*)?(.{4,90}?\d{1,4}.{0,60})$/;

const CITY_INDEX = CITIES.map(c => ({ slug: c.slug, key: normCityName(c.name) }));
const CITY_ALIAS: Array<{ slug: string; key: string }> = [
  { slug: 'tel-aviv', key: normCityName('תל אביב') }, { slug: 'tel-aviv', key: normCityName('תל-אביב יפו') }, { slug: 'tel-aviv', key: 'tel aviv' },
  { slug: 'jerusalem', key: 'jerusalem' }, { slug: 'haifa', key: 'haifa' }, { slug: 'petah-tikva', key: normCityName('פ"ת') }, { slug: 'rishon-lezion', key: normCityName('ראשל"צ') },
  { slug: 'beer-sheva', key: normCityName('ב"ש') }, { slug: 'kfar-saba', key: normCityName('כ"ס') }, { slug: 'modiin', key: normCityName('מודיעין מכבים רעות') },
  { slug: 'pardes-hanna', key: normCityName('פרדס חנה') }, { slug: 'nazareth', key: normCityName('נוף הגליל') },
];

/** Catalog cities named in a piece of text (longest names first, so "קריית ים" is not "ים"). */
export function citiesIn(text: string): string[] {
  const t = ` ${normCityName(text)} `;
  const out: string[] = [];
  for (const c of [...CITY_INDEX, ...CITY_ALIAS].sort((a, b) => b.key.length - a.key.length)) {
    if (c.key.length < 3 || out.includes(c.slug)) continue;
    if (t.includes(` ${c.key} `) || t.includes(` ב${c.key} `) || t.includes(` ל${c.key} `) || t.includes(` מ${c.key} `)) out.push(c.slug);
  }
  return out;
}

/**
 * Splits page text into blocks (blank lines and heading-like short lines start a new block) and keeps
 * the ones that read like one location: a phone or an address, and a city or a heading. A page with
 * two or more such blocks is a branches page.
 */
export function extractLocations(text: string, url: string): LocationBlock[] {
  const lines = text.split('\n').map(l => l.trim());
  const blocks: string[][] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length) blocks.push(cur);
    cur = [];
  };
  for (const l of lines) {
    if (!l) {
      flush();
      continue;
    }
    // A short line without digits after a block that already holds a phone or address starts the next location.
    // A heading-like line: short, no digits, no address or label punctuation. Emails, labels ending with a
    // colon and hour ranges never start a block.
    const startsNew = cur.length > 0 && l.length <= 48 && !/[\d@:]/.test(l) && cur.some(x => findPhones(x).length || (STREET.test(x) && /\d/.test(x)));
    if (startsNew) flush();
    cur.push(l);
  }
  flush();

  const out: LocationBlock[] = [];
  for (const b of blocks) {
    const t = b.join('\n');
    if (b.length > 40 || t.length > 1500) continue;
    const phones = findPhones(t);
    const addressLine = b.find(l => STREET.test(l) && /\d/.test(l) && ADDRESS_LINE.test(l)) ?? null;
    if (!phones.length && !addressLine) continue;
    const cities = citiesIn(t);
    const heading = b[0].slice(0, 80);
    if (!cities.length && !/[א-תa-z]{3,}/i.test(heading)) continue;
    out.push({
      heading,
      text: t.slice(0, 1500),
      cities,
      phones: [...new Set(phones)],
      emails: extractEmails(t),
      address: addressLine ? addressLine.replace(/^כתובת\s*[:：]\s*/, '').slice(0, 160) : null,
      hours: hoursFromText(t)?.value ?? null,
      url,
    });
    if (out.length >= 60) break;
  }
  return out;
}

/**
 * The block for one import record: the block whose city is the record's, the one whose heading holds
 * the record's own name suffix ("... תל אביב"), or the one whose address shares the record's street.
 * Null when the site has no block for this branch (or only one location at all: then the site's
 * ordinary facts apply).
 */
export function pickLocation(blocks: LocationBlock[], rec: { citySlug: string | null; cityName: string | null; name: string; address: string | null }): LocationBlock | null {
  if (blocks.length < 2) return null;
  const city = rec.citySlug ?? (rec.cityName ? citiesIn(rec.cityName)[0] ?? null : null);
  const street = rec.address ? normCityName(rec.address).split(' ').filter(w => w.length >= 4 && !/^\d+$/.test(w))[0] ?? null : null;
  const inCity = city ? blocks.filter(b => b.cities.includes(city)) : [];
  if (inCity.length === 1) return inCity[0];
  if (inCity.length > 1 && street) {
    const byStreet = inCity.find(b => normCityName(b.text).includes(street));
    if (byStreet) return byStreet;
  }
  if (inCity.length > 1) return inCity[0];
  // No city match: the record's name often ends with the branch label ("אמריקן לייזר- תל אביב").
  const tail = normCityName(rec.name).split(' ').slice(-2).join(' ');
  if (tail.length >= 3) {
    // Only a suffix that singles out one block counts; the brand name itself heads every block.
    const byName = blocks.filter(b => normCityName(b.heading).includes(tail) || normCityName(b.text.slice(0, 120)).includes(tail));
    if (byName.length === 1) return byName[0];
  }
  if (street) {
    const byStreet = blocks.find(b => b.address && normCityName(b.address).includes(street));
    if (byStreet) return byStreet;
  }
  return null;
}
