// Titles, SEO names and meta descriptions: deterministic shapes within the limits search engines show.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { composeDescription, publicMetadata } from '../../src/lib/seo/meta';
import { META_ACTION, metaDescriptionOk, metaDescriptionProblems } from '../../src/lib/seo/metaRules';
import { capWords, sameNameAcrossScripts, seoCityName, seoName } from '../../src/lib/seo/seoName';
import { hebrewTreatmentName, hebrewTreatmentNames } from '../../src/lib/seo/treatmentNames';

describe('seo name', () => {
  it('strips keyword tails, slogans, lists and duplicate scripts, and caps the length', () => {
    assert.equal(seoName('מספרת רון | מספרה בחיפה, תספורות, צבע'), 'מספרת רון');
    assert.equal(seoName('קליניקת גלואו - אסתטיקה רפואית בנתניה'), 'קליניקת גלואו');
    assert.equal(seoName('סטודיו דנה, מניקור, פדיקור, לק ג׳ל'), 'סטודיו דנה');
    assert.equal(seoName('מספרת רון שיער Ron Hair Salon'), 'מספרת רון שיער');
    assert.equal(seoName('Glow Clinic'), 'Glow Clinic', 'a Latin-only name stays');
    assert.equal(seoName('סטודיו Glow'), 'סטודיו Glow', 'one Latin brand word inside a Hebrew name stays');
    assert.equal(seoName('ד"ר שיין'), 'ד״ר שיין');
    // A hyphen glued to one side is a separator too; a hyphen inside a word is not.
    assert.equal(seoName('אניגמה- מרכז לאסתטיקה מתקדמת'), 'אניגמה');
    assert.equal(seoName('יוסי כהן -מומחה לשיער'), 'יוסי כהן');
    assert.equal(seoName('שרית אטיאס-עיצוב גבות'), 'שרית אטיאס-עיצוב גבות');
    assert.equal(seoName('מספרה - אנה עיצוב שיער | салон Анна'), 'מספרה אנה עיצוב שיער', 'a lone kind word keeps the name after the separator');
    // A Latin or Cyrillic copy of the Hebrew name is dropped; a different foreign name is not.
    assert.equal(seoName('Glow Clinic | קליניקת גלואו'), 'קליניקת גלואו');
    assert.equal(seoName('Rivky Blau רבקי בלאו'), 'רבקי בלאו');
    assert.equal(seoName('Dr. Allan Schuman - ד״ר אלן שומן'), 'ד״ר אלן שומן');
    assert.equal(seoName('אנה דיזיין Анна Дизайн'), 'אנה דיזיין');
    assert.equal(seoName('Lumiere לומייר'), 'לומייר');
    assert.equal(seoName('Barak clinic - קליניקה לאסתטיקה מתקדמת בנהריה'), 'Barak clinic', 'a Hebrew slogan is not the name');
    assert.equal(seoName('Shiran Ben Yehuda איפור קבוע'), 'Shiran Ben Yehuda איפור קבוע', 'a Hebrew category after a foreign name stays');
    assert.ok(sameNameAcrossScripts(['Mona', 'Medical', 'Jerusalem'], ['מונה', 'מדיקל', 'ירושלים']));
    assert.ok(!sameNameAcrossScripts(['Tamar', 'Cosmetics'], ['קוסמטיקאית', 'פרא', 'רפואית']));
    const long = seoName('המרכז הבינלאומי לרפואה אסתטית ולכירורגיה פלסטית של פרופסור ישראלי');
    assert.ok(long.length <= 35 && long.startsWith('המרכז הבינלאומי'), long);
    assert.equal(capWords('אבג דהו זחט', 7), 'אבג דהו');
    assert.equal(seoCityName('תל אביב–יפו'), 'תל אביב-יפו');
  });
});

describe('meta descriptions and share cards', () => {
  it('lands between 130 and 155 characters when the facts allow', () => {
    const d = composeDescription(
      ['קליניקה לדוגמה בתל אביב-יפו: אסתטיקה רפואית.', 'בוטוקס, חומרי מילוי, ניקוי פנים ועוד.', 'דירוג 4.8 בגוגל (212 ביקורות).', META_ACTION],
      ['כל הטיפולים והמחירים של קליניקה לדוגמה במקום אחד.'],
    );
    assert.ok(d.length >= 130 && d.length <= 155, `${d.length}: ${d}`);
    assert.ok(metaDescriptionOk(d), JSON.stringify(metaDescriptionProblems(d)));
    const short = composeDescription(['מספרה בחיפה.'], ['כל הטיפולים והמחירים של מספרה בחיפה במקום אחד.', 'מספרות בחיפה להשוואה.', META_ACTION]);
    assert.ok(short.length >= 100 && short.length <= 155, short);
    const long = composeDescription(['א'.repeat(90) + ' ' + 'ב'.repeat(90)]);
    assert.ok(long.length <= 155 && long.endsWith('.'), long);
  });

  it('writes canonical, Open Graph and Twitter tags from one call', () => {
    const m = publicMetadata({ path: '/dan/tel-aviv/nails', title: 'מניקור ופדיקור בתל אביב-יפו: מחירים והשוואה', description: 'x'.repeat(140), image: '/assets/region-dan.jpg', noindex: true });
    assert.equal(m.alternates?.canonical, '/dan/tel-aviv/nails');
    const og = m.openGraph as { locale: string; siteName: string; url: string; images: Array<{ url: string }> };
    assert.equal(og.locale, 'he_IL');
    assert.equal(og.siteName, 'BeautyFind');
    assert.equal(og.url, '/dan/tel-aviv/nails');
    assert.equal(og.images[0].url, '/assets/region-dan.jpg');
    const tw = m.twitter as { card: string; images: string[] };
    assert.equal(tw.card, 'summary_large_image');
    assert.equal(tw.images[0], '/assets/region-dan.jpg');
    assert.deepEqual(m.robots, { index: false, follow: true });
    assert.equal((publicMetadata({ path: '/', title: 'a', description: 'b' }).openGraph as { images: Array<{ url: string }> }).images[0].url, '/assets/hero-clinic.jpg');
  });
});

describe('meta description rules', () => {
  it('rejects missing data, booking, contact channels, phone only, the ratings line and the wrong length', () => {
    const codes = (t: string) => metaDescriptionProblems(t).map(p => p.code);
    const base = 'מספרת רון בחיפה: מספרה. תספורת, צבע לשיער, פן ועוד. דירוג 4.8 בגוגל (212 ביקורות). ' + META_ACTION;
    assert.deepEqual(codes(`${base} כל הטיפולים והמחירים במקום אחד.`), []);
    assert.ok(codes(`${base} המחירים לא פורסמו.`).includes('missing_info'));
    assert.ok(codes(`${base} השוו מחירים וקבעו תור ב־BeautyFind.`).includes('booking'));
    assert.ok(codes(`${base} קביעת תור אונליין בעסקים שמציעים אותה.`).includes('booking'));
    assert.ok(codes(`${base} טלפון, וואטסאפ וניווט בעמוד.`).includes('contact'));
    assert.ok(codes(`${base} פרטי קשר ומחירים כפי שהעסק פרסם.`).includes('contact'));
    assert.ok(codes(`${base} טלפון בלבד.`).includes('phone_only'));
    assert.ok(codes(`${base} ללא טלפון.`).includes('phone_only'));
    assert.ok(codes(`${base} דירוג Google וביקורות BeautyFind בנפרד.`).includes('ratings_line'));
    assert.ok(codes('מספרה בחיפה.').includes('short'));
    assert.ok(codes(`${base} ${'א'.repeat(80)}`).includes('long'));
  });
});

describe('treatment names in Hebrew', () => {
  it('translates English names through the catalog, keeps brands and devices, and drops what it cannot write in Hebrew', () => {
    assert.equal(hebrewTreatmentName('Hairstyling'), 'עיצוב שיער');
    assert.equal(hebrewTreatmentName('Hair colouring'), 'צבע לשיער');
    assert.equal(hebrewTreatmentName("Men's haircut"), 'תספורת גברים');
    assert.equal(hebrewTreatmentName('Gel Manicure'), 'מניקור ג׳ל');
    assert.equal(hebrewTreatmentName('Deep cleansing facial 60 min'), 'ניקוי פנים עמוק');
    assert.equal(hebrewTreatmentName('Hydrafacial'), 'Hydrafacial', 'a brand stays');
    assert.equal(hebrewTreatmentName('Hydrafacial treatment'), 'טיפול Hydrafacial');
    assert.equal(hebrewTreatmentName('טיפול Morpheus8'), 'טיפול Morpheus8', 'a device inside a Hebrew name stays');
    assert.equal(hebrewTreatmentName("לק ג'ל"), 'לק ג׳ל', 'Hebrew names get their typography');
    assert.equal(hebrewTreatmentName('Something Unknown'), null);
    assert.equal(hebrewTreatmentName('Классический массаж'), null);
    assert.deepEqual(hebrewTreatmentNames(['Hairstyling', 'Unknown Thing', 'Hair colouring', 'hairstyling', 'Haircut', 'Keratin'], 3), ['עיצוב שיער', 'צבע לשיער', 'תספורת']);
  });
});
