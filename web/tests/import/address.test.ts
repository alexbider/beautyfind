import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addressDetails, addressProblems, catalogCityFor, cityMatches, composeHebrewAddress, hebrewStreetName, looseKey, parseGoogleAddress, streetLine } from '../../src/lib/import/address';

const google = (over: Record<string, unknown> = {}) =>
  parseGoogleAddress({
    formattedAddress: 'הרצל 5, נתניה, 4225802, ישראל',
    addressComponents: [
      { longText: '5', shortText: '5', types: ['street_number'] },
      { longText: 'הרצל', shortText: 'הרצל', types: ['route'] },
      { longText: 'נתניה', shortText: 'נתניה', types: ['locality', 'political'] },
      { longText: 'ישראל', shortText: 'IL', types: ['country', 'political'] },
      { longText: '4225802', shortText: '4225802', types: ['postal_code'] },
    ],
    ...over,
  })!;
const line = (r: { address: string }) => r.address;

describe('hebrew addresses', () => {
  it('parses the Places components', () => {
    const g = google();
    assert.equal(g.route, 'הרצל');
    assert.equal(g.streetNumber, '5');
    assert.equal(g.locality, 'נתניה');
    assert.equal(g.postalCode, '4225802');
    assert.equal(parseGoogleAddress(null), null);
  });

  it('composes the line from Google in one style: street and number, kept details, the city; no country, no postal code, no רחוב', () => {
    const r = composeHebrewAddress(google(), 'Herzl St 5, Floor 3, Netanya, Israel', 'נתניה');
    assert.equal(r.address, 'הרצל 5, קומה 3, נתניה');
    assert.equal(r.postalCode, '4225802');
    assert.equal(r.source, 'google');
    assert.equal(r.cityMismatch, false);
    assert.equal(line(composeHebrewAddress(google(), 'Herzl 5, מתחם בית הפסנתר, Netanya', 'נתניה')), 'הרצל 5, מתחם בית הפסנתר, נתניה');
    const g3 = google({ addressComponents: [{ longText: 'קניון ערים', types: ['premise'] }, { longText: 'שדרות הגעתון', types: ['route'] }, { longText: '12', types: ['street_number'] }] });
    assert.equal(line(composeHebrewAddress(g3, 'HaGaaton Blvd 12, Nahariya', 'נהריה')), 'שדרות הגעתון 12, קניון ערים, נהריה');
    // Google's route with a רחוב prefix loses it; Hebrew typography is normalized (צה"ל becomes צה״ל).
    const g4 = google({ addressComponents: [{ longText: 'רחוב צה"ל', types: ['route'] }, { longText: '26', types: ['street_number'] }, { longText: 'אשדוד', types: ['locality'] }] });
    assert.equal(line(composeHebrewAddress(g4, 'Tsahal St 26, Ashdod', 'אשדוד')), 'צה״ל 26, אשדוד');
  });

  it('keeps Google\'s city when it differs from the stored one and reports the mismatch', () => {
    const g = google({ addressComponents: [{ longText: 'צה"ל', types: ['route'] }, { longText: '26', types: ['street_number'] }, { longText: 'גן יבנה', types: ['locality'] }] });
    const r = composeHebrewAddress(g, 'שי בשקל, Tsahal St 26, קומה 1, Gan Yavne', 'אשדוד');
    assert.equal(r.address, 'צה״ל 26, קומה 1, גן יבנה');
    assert.equal(r.cityMismatch, true);
    assert.equal(r.googleCity, 'גן יבנה');
    assert.equal(r.city, 'גן יבנה');
    // A quarter Google read as the locality from a business-supplied line is not a mismatch when the formatted address names the stored city.
    const q = composeHebrewAddress({ formatted: 'הצוללים 5 אשדוד, ים', route: null, streetNumber: null, locality: 'ים', postalCode: null, premise: null, subpremise: null }, 'הצוללים 5 אשדוד, ים', 'אשדוד');
    assert.deepEqual([q.address, q.cityMismatch, q.source], ['הצוללים 5, אשדוד', false, 'original']);
    assert.ok(cityMatches('תל אביב', 'תל אביב-יפו'));
    assert.ok(cityMatches('תל אביב–יפו', 'תל אביב-יפו'));
    assert.ok(!cityMatches('אשדוד', 'גן יבנה'));
    assert.equal(catalogCityFor('נהריה')?.slug, 'nahariya');
  });

  it('falls back to the dictionary (exact or loose transliteration), then to the city alone; a Hebrew original is restyled', () => {
    const latinRoute = google({ addressComponents: [{ longText: 'Herzl', types: ['route'] }, { longText: '5', types: ['street_number'] }] });
    const d = composeHebrewAddress(latinRoute, 'Herzl St 5, Netanya', 'נתניה');
    assert.equal(d.address, 'הרצל 5, נתניה');
    assert.equal(d.source, 'dictionary');
    assert.equal(line(composeHebrewAddress(null, 'Rothschild Blvd 20, Tel Aviv', 'תל אביב')), 'שדרות רוטשילד 20, תל אביב');
    assert.equal(line(composeHebrewAddress(null, 'Derech Raziel 5, Netanya', 'נתניה')), 'דרך רזיאל 5, נתניה');
    // Loose transliteration: both spellings reach העצמאות, with the number before or after the name.
    assert.equal(looseKey('haatsmaout'), looseKey("Ha'Atzma'ut"));
    assert.equal(hebrewStreetName('haatsmaout'), 'העצמאות');
    assert.equal(line(composeHebrewAddress(null, "Ha'Atzma'ut 87, Ashdod", 'אשדוד')), 'העצמאות 87, אשדוד');
    assert.equal(line(composeHebrewAddress(null, '87 haatsmaout, Ashdod, 7777700', 'אשדוד')), 'העצמאות 87, אשדוד');
    const c = composeHebrewAddress(null, 'Unknownstreet 7, Netanya', 'נתניה');
    assert.deepEqual([c.address, c.source], ['נתניה', 'city_only']);
    const o = composeHebrewAddress(null, 'רחוב הרצל 5, נתניה, ישראל', 'נתניה');
    assert.deepEqual([o.address, o.source], ['הרצל 5, נתניה', 'original']);
    // A mixed line keeps its Hebrew street; Latin words, the postal code and the city inside the part go.
    const m = composeHebrewAddress(null, 'K-Tower שדרות ירושלים 18 אשדוד, ים, 7752311', 'אשדוד');
    assert.deepEqual([m.address, m.source], ['שדרות ירושלים 18, אשדוד', 'original']);
    assert.equal(line(composeHebrewAddress(null, 'גן העיר, Ha-Gdud ha-Ivri St 5, Ashdod, 7745511', 'אשדוד')), 'אשדוד');
    assert.equal(line(composeHebrewAddress(null, 'Herzl St 5, קניון הסיטי, Netanya', 'נתניה')), 'הרצל 5, קניון הסיטי, נתניה');
    // A Latin city name alone, or an address in another script, is never read as a street.
    assert.deepEqual([composeHebrewAddress(null, 'Haifa', 'חיפה').address, composeHebrewAddress(null, 'Haifa', 'חיפה').source], ['חיפה', 'city_only']);
    assert.equal(line(composeHebrewAddress(null, 'جادة موريا 100, Haifa', 'חיפה')), 'חיפה');
  });

  it('keeps floor and building details only', () => {
    assert.deepEqual(addressDetails('הרצל 5, קומה 2, נתניה, 4225802, ישראל', 'נתניה', 'הרצל'), ['קומה 2']);
    assert.deepEqual(addressDetails('Herzl St 5, 2nd floor, Netanya', 'נתניה', null), ['קומה 2']);
    assert.deepEqual(addressDetails('Herzl St 5, Netanya', 'נתניה', null), []);
  });

  it('the schema street line drops the city; the validator catches Latin street words, city names and other Latin', () => {
    assert.equal(streetLine('הרצל 5, קומה 3, נתניה', 'נתניה'), 'הרצל 5, קומה 3');
    assert.equal(streetLine('צה״ל 26, גן יבנה', 'אשדוד'), 'צה״ל 26'); // Google's city, a catalog city
    assert.equal(streetLine('נתניה', 'נתניה'), 'נתניה');
    assert.deepEqual(addressProblems('הרצל 5, נתניה'), []);
    assert.deepEqual(addressProblems('Herzl St 5, Netanya'), ['latin_street:St', 'latin_city:netanya', 'latin:Herzl']);
    assert.ok(addressProblems('Derech Raziel 5, נתניה').includes('latin_street:Derech'));
    assert.ok(addressProblems('הרצל 5, Tel Aviv').some(p => p.startsWith('latin_city:')));
    assert.deepEqual(addressProblems(''), []);
  });
});
