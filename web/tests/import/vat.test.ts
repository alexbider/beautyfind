// Consumer prices: which stored amounts get VAT added, and the labels that follow the display flag.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PRICES_INCLUDE_VAT, VAT_LABEL } from '../../src/lib/features';
import { consumerAgorot, storedIncludesVat, withConsumerPrices } from '../../src/lib/vat';

describe('consumer prices and VAT', () => {
  it('adds VAT only to amounts stored before VAT', () => {
    assert.equal(storedIncludesVat({ taxIncluded: true, source: 'owner' }), true);
    assert.equal(storedIncludesVat({ taxIncluded: false, source: 'website' }), false);
    assert.equal(storedIncludesVat({ taxIncluded: null, source: 'owner' }), false, 'the menu editor takes prices before VAT');
    assert.equal(storedIncludesVat({ taxIncluded: null, source: 'website' }), true, 'published consumer prices include VAT');
    if (PRICES_INCLUDE_VAT) {
      assert.equal(consumerAgorot(10000, { taxIncluded: false }, 18), 11800);
      assert.equal(consumerAgorot(10000, { taxIncluded: null, source: 'owner' }, 17), 11700);
      assert.equal(consumerAgorot(10000, { taxIncluded: true }, 18), 10000);
      assert.equal(consumerAgorot(10000, { taxIncluded: null, source: 'dataforseo' }, 18), 10000);
      const t = withConsumerPrices({ priceAgorot: 40000, priceMaxAgorot: 60000, taxIncluded: false, source: 'owner', priceType: 'range' }, 18);
      assert.deepEqual([t.priceAgorot, t.priceMaxAgorot, t.taxIncluded], [47200, 70800, true]);
      assert.equal(VAT_LABEL, 'כולל מע״מ');
    } else {
      assert.equal(consumerAgorot(10000, { taxIncluded: false }, 18), 10000);
      assert.equal(VAT_LABEL, 'לא כולל מע״מ');
    }
  });
});
