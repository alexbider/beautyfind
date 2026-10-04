// Alt text for business images: stored alt first, then "{seoName} ב{city}" and "{seoName}: {tag}".

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { coverAlt, galleryAlts } from '../../src/lib/seo/imageAlt';

describe('image alt text', () => {
  it('uses the stored cover alt, else the SEO name and the city with a plain hyphen', () => {
    assert.equal(coverAlt({ name: 'מספרת רון | מספרה בחיפה', cityName: 'תל אביב-יפו', coverAlt: null }), 'מספרת רון בתל אביב-יפו');
    assert.equal(coverAlt({ name: 'מספרת רון', cityName: 'חיפה', coverAlt: 'חזית המספרה ברחוב הרצל' }), 'חזית המספרה ברחוב הרצל');
  });

  it('numbers gallery photos only when their words repeat', () => {
    assert.deepEqual(galleryAlts('סטודיו דנה', [{ alt: '', tag: 'הקליניקה' }, { alt: 'עמדת מניקור', tag: 'הקליניקה' }, { alt: null, tag: 'הקליניקה' }, { alt: null, tag: 'לפני/אחרי' }]), [
      'סטודיו דנה: הקליניקה 1',
      'עמדת מניקור',
      'סטודיו דנה: הקליניקה 2',
      'סטודיו דנה: לפני/אחרי',
    ]);
    assert.deepEqual(galleryAlts('סטודיו דנה', [{ alt: null, tag: null }]), ['סטודיו דנה: תמונה']);
  });
});
