import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addressDetails, addressProblems, composeHebrewAddress, parseGoogleAddress, streetLine } from '../../src/lib/import/address';

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

describe('hebrew addresses', () => {
  it('parses the Places components', () => {
    const g = google();
    assert.equal(g.route, 'הרצל');
    assert.equal(g.streetNumber, '5');
    assert.equal(g.locality, 'נתניה');
    assert.equal(g.postalCode, '4225802');
    assert.equal(parseGoogleAddress(null), null);
  });

  it('composes the display line from Google: street and number, kept details, the stored city; no country, no postal code', () => {
    const r = composeHebrewAddress(google(), 'Herzl St 5, Floor 3, Netanya, Israel', 'נתניה');
    assert.deepEqual(r, { address: 'הרצל 5, קומה 3, נתניה', postalCode: '4225802', source: 'google' });
    // Hebrew building details of the original stay; the city stored on the branch wins over Google's locality.
    const r2 = composeHebrewAddress(google(), 'Herzl 5, מתחם בית הפסנתר, Netanya', 'נתניה');
    assert.equal(r2.address, 'הרצל 5, מתחם בית הפסנתר, נתניה');
    // Google's own building name fills in when the original had none.
    const g3 = google({ addressComponents: [{ longText: 'קניון ערים', types: ['premise'] }, { longText: 'הגעתון', types: ['route'] }, { longText: '12', types: ['street_number'] }] });
    assert.equal(composeHebrewAddress(g3, 'HaGaaton Blvd 12, Nahariya', 'נהריה').address, 'הגעתון 12, קניון ערים, נהריה');
  });

  it('falls back to the dictionary, then to the city alone; an all-Hebrew line is kept', () => {
    const latinRoute = google({ addressComponents: [{ longText: 'Herzl', types: ['route'] }, { longText: '5', types: ['street_number'] }] });
    assert.deepEqual(composeHebrewAddress(latinRoute, 'Herzl St 5, Netanya', 'נתניה'), { address: 'רחוב הרצל 5, נתניה', postalCode: null, source: 'dictionary' });
    assert.deepEqual(composeHebrewAddress(null, 'Unknownstreet 7, Netanya', 'נתניה'), { address: 'נתניה', postalCode: null, source: 'city_only' });
    assert.deepEqual(composeHebrewAddress(null, 'רחוב הרצל 5, נתניה, ישראל', 'נתניה'), { address: 'רחוב הרצל 5, נתניה', postalCode: null, source: 'unchanged' });
  });

  it('keeps floor and building details only', () => {
    assert.deepEqual(addressDetails('הרצל 5, קומה 2, נתניה, 4225802, ישראל', 'נתניה', 'הרצל'), ['קומה 2']);
    assert.deepEqual(addressDetails('Herzl St 5, 2nd floor, Netanya', 'נתניה', null), ['קומה 2']);
    assert.deepEqual(addressDetails('Herzl St 5, Netanya', 'נתניה', null), []);
  });

  it('the schema street line drops the city; the validator catches Latin street words, city names and other Latin', () => {
    assert.equal(streetLine('הרצל 5, קומה 3, נתניה', 'נתניה'), 'הרצל 5, קומה 3');
    assert.equal(streetLine('נתניה', 'נתניה'), 'נתניה');
    assert.deepEqual(addressProblems('הרצל 5, נתניה'), []);
    assert.deepEqual(addressProblems('Herzl St 5, Netanya'), ['latin_street:St', 'latin_city:netanya', 'latin:Herzl']);
    assert.ok(addressProblems('Derech Raziel 5, נתניה').includes('latin_street:Derech'));
    assert.ok(addressProblems('הרצל 5, Tel Aviv').some(p => p.startsWith('latin_city:')));
    assert.deepEqual(addressProblems(''), []);
  });
});
