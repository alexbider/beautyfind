// The primary-category resolver that decides canonical profile URLs, card badges and category pages.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { orderCategories, primaryCategory, profileHref, withPrimary } from '../../src/lib/category';

describe('primary category', () => {
  it('prefers the flagged row over catalog order', () => {
    const cats = [{ categorySlug: 'facials', isPrimary: false }, { categorySlug: 'hair-salons', isPrimary: true }];
    assert.equal(primaryCategory(cats), 'hair-salons');
    assert.equal(profileHref({ regionSlug: 'dan', slug: 'ei-co-salon', categories: cats }), '/dan/hair-salons/ei-co-salon');
  });

  it('falls back to catalog order only when nothing is flagged, and ignores unknown slugs', () => {
    assert.equal(primaryCategory([{ categorySlug: 'nails' }, { categorySlug: 'facials' }]), 'facials');
    assert.equal(primaryCategory([{ categorySlug: 'bogus', isPrimary: true }, { categorySlug: 'nails' }]), 'nails');
    assert.equal(primaryCategory([]), null);
    assert.equal(profileHref({ regionSlug: 'haifa', slug: 'x', categories: [] }), '/haifa/biz/x');
  });

  it('takes the first known slug of an ordered import list', () => {
    assert.equal(primaryCategory(['beauty_salon', 'hair-salons', 'facials']), 'hair-salons');
  });

  it('orders the primary first so cards and URLs agree', () => {
    const cats = [{ categorySlug: 'facials', isPrimary: false }, { categorySlug: 'spa-massage', isPrimary: false }, { categorySlug: 'nails', isPrimary: true }];
    assert.deepEqual(orderCategories(cats).map(c => c.categorySlug), ['nails', 'facials', 'spa-massage']);
    const unflagged = [{ categorySlug: 'spa-massage' }, { categorySlug: 'hair-salons' }];
    assert.deepEqual(orderCategories(unflagged).map(c => c.categorySlug), ['hair-salons', 'spa-massage']);
    assert.equal(orderCategories(unflagged)[0].categorySlug, primaryCategory(unflagged));
  });

  it('keeps the current primary across a category edit and flags the first slug otherwise', () => {
    assert.deepEqual(withPrimary(['facials', 'nails'], 'nails'), [{ categorySlug: 'facials', isPrimary: false }, { categorySlug: 'nails', isPrimary: true }]);
    assert.deepEqual(withPrimary(['hair-salons', 'nails'], 'facials'), [{ categorySlug: 'hair-salons', isPrimary: true }, { categorySlug: 'nails', isPrimary: false }]);
    assert.deepEqual(withPrimary(['nails', 'nails', 'bogus'], null), [{ categorySlug: 'nails', isPrimary: true }]);
  });
});
