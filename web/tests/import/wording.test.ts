import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { textProblems } from '../../src/lib/import/textRules';
import { businessCount, businessPlural } from '../../src/lib/seo/businessNoun';
import { mean, trimOutliers, trimmedMean } from '../../src/lib/stats';
import { nis } from '../../src/lib/format';
import { applyWording } from '../../scripts/import/wordingCleanup';

const wording = (t: string) => textProblems(t, [], { strict: false }).filter(p => p.code === 'wording').map(p => p.match);

describe('sitewide wording', () => {
  it('the validator flags the banned words in generated text and in interface copy alike', () => {
    assert.deepEqual(wording('במידה והלקוחה מאחרת, התור הינו מבוטל'), ['במידה ו', 'הינו']);
    assert.deepEqual(wording('הסלון, אשר נפתח ב־2019, מציע גם איפור. כמו כן יש חניה.'), ['אשר', 'כמו כן']);
    assert.deepEqual(wording('כאשר מגיעים, באשר לחניה'), []); // other words
    assert.deepEqual(wording('המחיר האמצעי הוא 180 ₪ ודירוג Google 4.5'), ['אמצעי', 'דירוג Google']);
    assert.deepEqual(wording('מחירים ממוצעים ודירוג ממוצע בגוגל'), []);
    assert.deepEqual(wording('אמצעי יצירת קשר: טלפון'), []); // "means", not "average"
    assert.deepEqual(wording('312 ביקורות ב־Google, תל אביב–יפו, ₪180, החציון'), ['ב־Google', 'תל אביב–יפו', '₪ לפני המספר', 'חציון']);
  });

  it('counts businesses in natural Hebrew per category', () => {
    assert.equal(businessCount(3, 'hair-salons'), '3 מספרות');
    assert.equal(businessCount(1, 'hair-salons'), 'מספרה אחת');
    assert.equal(businessCount(2, 'hair-salons'), 'שתי מספרות');
    assert.equal(businessCount(5, 'facials'), '5 קוסמטיקאיות');
    assert.equal(businessCount(4, 'medical-aesthetics'), '4 מרפאות אסתטיקה');
    assert.equal(businessCount(2, 'nails'), 'שני סלוני ציפורניים');
    assert.equal(businessCount(6), '6 עסקי יופי ואסתטיקה');
    assert.equal(businessCount(1, null), 'עסק יופי ואסתטיקה אחד');
    assert.equal(businessCount(1200, 'makeup'), '1,200 מאפרות');
    assert.equal(businessPlural('plastic-surgery'), 'מנתחים פלסטיים');
  });

  it('the trimmed mean drops outliers with the 1.5 IQR rule and needs three prices', () => {
    assert.equal(mean([100, 200, 300]), 200);
    assert.deepEqual(trimOutliers([100, 110, 120, 130, 1000]), [100, 110, 120, 130]);
    assert.equal(trimmedMean([100, 110, 120, 130, 1000]), 115);
    assert.equal(trimmedMean([100, 200]), null);
    assert.equal(trimmedMean([100, 200, 300]), 200);
  });

  it('prices are written as number, space, sign', () => {
    assert.equal(nis(1200), '1,200 ₪');
    assert.equal(nis(180), '180 ₪');
  });

  it('the stored-content pass replaces the exact phrases and nothing else', () => {
    const r = applyWording('המחיר האמצעי הוא ₪1,200 ודירוג Google 4.5 מתוך 5 (312 ביקורות ב־Google). אמצעי יצירת קשר: טלפון. תל אביב–יפו.');
    assert.equal(r.out, 'המחיר הממוצע הוא 1,200 ₪ ודירוג בגוגל 4.5 מתוך 5 (312 ביקורות בגוגל). אמצעי יצירת קשר: טלפון. תל אביב-יפו.');
    assert.deepEqual(r.hits, { 'המחיר האמצעי': 1, 'דירוג Google': 1, 'ב־Google': 1, 'תל אביב–יפו': 1, '₪ לפני המספר': 1 });
    assert.equal(applyWording('טיפול פנים 250 ₪').out, 'טיפול פנים 250 ₪');
  });
});
