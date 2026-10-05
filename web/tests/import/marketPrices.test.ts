import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MARKET_PRICES_SEED,
  MarketPricesSchema,
  barShape,
  categoryBounds,
  currentMonth,
  headlineRange,
  isWideRange,
  marketPriceUnits,
  needsRecheck,
  priceSpeech,
  priceText,
  publicItems,
  trackPosition,
  updatedLabel,
} from '../../src/lib/marketPrices';

const NB = ' ';

describe('market price ranges', () => {
  it('the seed parses: 14 categories, 70 rows, every max at least its min', () => {
    const cats = Object.keys(MARKET_PRICES_SEED.categories);
    assert.equal(cats.length, 14);
    assert.equal(cats.reduce((n, c) => n + MARKET_PRICES_SEED.categories[c].length, 0), 70);
    assert.equal(MARKET_PRICES_SEED.meta.version, 2);
    assert.equal(MARKET_PRICES_SEED.meta.updated, '2026-10');
    assert.ok(marketPriceUnits(MARKET_PRICES_SEED).includes('לטיפול'));
    const bad = MarketPricesSchema.safeParse({ ...MARKET_PRICES_SEED, categories: { nails: [{ label: 'לק', min: 200, max: 100, unit: 'לטיפול', medical: false }] } });
    assert.equal(bad.success, false);
  });

  it('formats the price as number, en dash, number, non-breaking space, sign; about and from forms', () => {
    assert.equal(priceText({ min: 250, max: 350 }), `250–350${NB}₪`);
    assert.equal(priceText({ min: 1500, max: 3800 }), `1,500–3,800${NB}₪`);
    assert.equal(priceText({ min: 10000, max: 10000 }), `כ־10,000${NB}₪`);
    assert.equal(priceText({ min: 20000, max: null }), `מ־20,000${NB}₪`);
    assert.equal(priceText({ min: 20000, max: null }, { plain: true }), 'מ־20,000 ₪');
    assert.equal(priceSpeech({ min: 1500, max: 3800 }), 'בין 1,500 ל־3,800 שקלים');
    assert.equal(priceSpeech({ min: 10000, max: 10000 }), 'כ־10,000 שקלים');
    assert.equal(priceSpeech({ min: 20000, max: null }), 'החל מ־20,000 שקלים');
  });

  it('badges: wide range above 2.5x; staff rows to re-check are low confidence or sourced before 2024', () => {
    assert.ok(isWideRange({ min: 200, max: 1000 }));
    assert.ok(!isWideRange({ min: 250, max: 350 }));
    assert.ok(!isWideRange({ min: 20000, max: null }));
    assert.ok(needsRecheck({ confidence: 'low' }));
    assert.ok(needsRecheck({ confidence: 'medium', sourceYear: 2023 }));
    assert.ok(!needsRecheck({ confidence: 'medium', sourceYear: 2025 }));
    const recheck = Object.entries(MARKET_PRICES_SEED.categories).flatMap(([c, items]) => items.filter(needsRecheck).map(i => `${c}:${i.label}`));
    assert.deepEqual(recheck, ['plastic-surgery:ניתוח אף אסתטי', 'plastic-surgery:הרמת חזה', 'hair-salons:תספורת אישה', 'body-contouring:סדרת טיפולי מכשור להצרת היקפים', 'body-contouring:המסת שומן בגלי רדיו']);
  });

  it('the track spans the category, log scale above a tenfold spread, and the bar shapes follow min and max', () => {
    const linear = categoryBounds([{ min: 80, max: 170 }, { min: 50, max: 80 }, { min: 130, max: 300 }]);
    assert.deepEqual(linear, { lo: 50, hi: 300, log: false });
    assert.equal(trackPosition(50, linear), 0);
    assert.equal(trackPosition(300, linear), 100);
    assert.equal(trackPosition(175, linear), 50);
    const log = categoryBounds([{ min: 10, max: 15 }, { min: 10000, max: 10000 }, { min: 500, max: 5500 }]);
    assert.equal(log.log, true);
    assert.equal(trackPosition(10, log), 0);
    assert.equal(trackPosition(10000, log), 100);
    assert.ok(Math.abs(trackPosition(316, log) - 50) < 1); // the geometric middle of 10 and 10,000
    assert.deepEqual(barShape({ min: 10000, max: 10000 }, log), { kind: 'dot', at: 100 });
    assert.deepEqual(barShape({ min: 20000, max: null }, { lo: 5500, hi: 50000, log: false }), { kind: 'open', from: 32.6 });
    assert.deepEqual(barShape({ min: 50, max: 80 }, linear), { kind: 'range', from: 0, to: 12 });
    const scales = Object.fromEntries(Object.entries(MARKET_PRICES_SEED.categories).map(([c, items]) => [c, categoryBounds(items).log]));
    assert.deepEqual(Object.entries(scales).filter(([, log]) => log).map(([c]) => c), ['dental-aesthetics', 'hair-restoration', 'hair-salons', 'hair-removal', 'makeup', 'tanning']);
  });

  it('public rows carry no staff fields; the chips and the one-line summaries read right', () => {
    const pub = publicItems(MARKET_PRICES_SEED.categories['plastic-surgery']);
    assert.deepEqual(Object.keys(pub[0]).sort(), ['label', 'max', 'medical', 'min', 'note', 'unit']);
    assert.ok(!JSON.stringify(pub).includes('confidence') && !JSON.stringify(pub).includes('.co.il'));
    assert.equal(updatedLabel('2026-10'), 'עודכן באוקטובר 2026');
    assert.match(currentMonth(new Date('2026-10-05T07:00:00Z')), /^2026-10$/);
    assert.deepEqual(headlineRange(MARKET_PRICES_SEED, 'nails'), { label: 'מניקור קלאסי', text: `80–170${NB}₪`, plain: '80–170 ₪' });
    assert.equal(headlineRange(MARKET_PRICES_SEED, 'nope'), null);
  });
});
