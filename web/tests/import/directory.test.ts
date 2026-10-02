// Directory URL state: real pages instead of a client-side "show more", with canonical and pager rules.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PAGE, canonicalHref, dirHref, hasParams, pageCount, pagerItems, parseQuery } from '../../src/components/directory/params';
import { relFor } from '../../src/lib/routes';

describe('directory paging', () => {
  it('parses ?page=, ignores the old ?show=, and builds the same URL back', () => {
    assert.deepEqual(parseQuery({}), { filters: [], sort: 'recommended', page: 1 });
    assert.equal(parseQuery({ page: '3' }).page, 3);
    assert.equal(parseQuery({ page: '0' }).page, 1);
    assert.equal(parseQuery({ page: '999' }).page, 200);
    assert.equal(parseQuery({ show: '48' }).page, 1);
    const q = parseQuery({ page: '2', sort: 'rating', verified: '1' });
    assert.equal(dirHref('/dan/tel-aviv/nails', q), '/dan/tel-aviv/nails?verified=1&sort=rating&page=2');
    assert.equal(dirHref('/dan/tel-aviv', { filters: [], sort: 'recommended', page: 1 }), '/dan/tel-aviv');
  });

  it('page 2 and on are indexable with their own canonical; filters and sorts are not', () => {
    assert.equal(hasParams({ filters: [], sort: 'recommended', page: 2 }), false);
    assert.equal(hasParams({ filters: ['verified'], sort: 'recommended', page: 1 }), true);
    assert.equal(canonicalHref('/dan/tel-aviv', { filters: [], sort: 'recommended', page: 1 }), '/dan/tel-aviv');
    assert.equal(canonicalHref('/dan/tel-aviv', { filters: ['verified'], sort: 'rating', page: 2 }), '/dan/tel-aviv?page=2');
    assert.equal(PAGE, 48);
    assert.equal(pageCount(0), 1);
    assert.equal(pageCount(48), 1);
    assert.equal(pageCount(49), 2);
  });

  it('the pager shows every page up to seven, then a window with gaps', () => {
    assert.deepEqual(pagerItems(1, 5), [1, 2, 3, 4, 5]);
    assert.deepEqual(pagerItems(6, 12), [1, null, 4, 5, 6, 7, 8, null, 12]);
    assert.deepEqual(pagerItems(1, 12), [1, 2, 3, null, 12]);
  });

  it('links to app screens carry nofollow', () => {
    assert.equal(relFor('/account'), 'nofollow');
    assert.equal(relFor('/saved'), 'nofollow');
    assert.equal(relFor('/for-business/claim?branch=x'), 'nofollow');
    assert.equal(relFor('/more'), 'nofollow');
    assert.equal(relFor('/for-business'), undefined);
    assert.equal(relFor('/dan/tel-aviv'), undefined);
  });
});
