// Titles, SEO names and meta descriptions: deterministic shapes within the limits search engines show.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { composeDescription, publicMetadata } from '../../src/lib/seo/meta';
import { META_ACTION, composeMetaDescription, inHe, joinHe, metaDescriptionOk, metaDescriptionProblems, metaLead, repeatsTitle, tidySentence } from '../../src/lib/seo/metaRules';
import { capWords, sameNameAcrossScripts, seoCityName, seoName } from '../../src/lib/seo/seoName';
import { treatmentNameProblem } from '../../src/lib/seo/treatmentHygiene';
import { dedupeTreatments, hebrewTreatmentName, hebrewTreatmentNames, sameTreatment } from '../../src/lib/seo/treatmentNames';

describe('seo name', () => {
  it('strips keyword tails, slogans, lists and duplicate scripts, and caps the length', () => {
    assert.equal(seoName('מספרת רון | מספרה בחיפה, תספורות, צבע'), 'מספרת רון');
    assert.equal(seoName('קליניקת גלואו - אסתטיקה רפואית בנתניה'), 'קליניקת גלואו');
    assert.equal(seoName('סטודיו דנה, מניקור, פדיקור, לק ג׳ל'), 'סטודיו דנה');
    assert.equal(seoName('מספרת רון שיער Ron Hair Salon'), 'מספרת רון שיער');
    assert.equal(seoName('Glow Clinic'), 'Glow Clinic', 'a Latin-only name stays');
    assert.equal(seoName('קוסמטיקאית Genin cosmotology'), 'Genin cosmotology', 'a leading profession word goes');
    assert.equal(seoName('מאפרת דנה לוי'), 'דנה לוי');
    assert.equal(seoName('ד״ר מנאר קעואר - מומחה בכירורגיה פלסטית'), 'ד״ר מנאר קעואר', 'a title stays');
    assert.equal(seoName('קוסמטיקאית'), 'קוסמטיקאית', 'a lone profession word is kept rather than emptied');
    assert.equal(seoName('פרו אסתטיקס טיפולים אסתטיים מתקדמים צפת'), 'פרו אסתטיקס', 'descriptor tail and city go');
    assert.equal(seoName('דנה מכון יופי'), 'דנה');
    assert.equal(seoName('Grace Cosmetology Nahariya'), 'Grace Cosmetology', 'a Latin city tail goes');
    assert.equal(seoName('Barak clinic - קליניקה לאסתטיקה מתקדמת בנהריה'), 'Barak clinic');
    assert.equal(seoName('גלואו קליניקה לאסתטיקה'), 'גלואו');
    assert.equal(seoName('ניילס בחיפה'), 'ניילס');
    assert.equal(seoName('מכון יופי'), 'מכון יופי', 'a name that is only a descriptor stays');
    assert.equal(seoName('סטודיו Glow'), 'סטודיו Glow', 'one Latin brand word inside a Hebrew name stays');
    assert.equal(seoName('ד"ר שיין'), 'ד״ר שיין');
    // A hyphen glued to one side is a separator too; a hyphen inside a word is not.
    assert.equal(seoName('אניגמה- מרכז לאסתטיקה מתקדמת'), 'אניגמה');
    assert.equal(seoName('יוסי כהן -מומחה לשיער'), 'יוסי כהן');
    assert.equal(seoName('שרית אטיאס-עיצוב גבות'), 'שרית אטיאס', 'a glued hyphen tail that names a treatment goes');
    assert.equal(seoName('ניילס-בניית ציפורניים'), 'ניילס');
    assert.equal(seoName('פרדס חנה-כרכור קוסמטיקה'), 'פרדס חנה-כרכור קוסמטיקה', 'a glued hyphen inside a place name stays');
    assert.equal(seoName('ADM-אחים ואחיות עד הבית'), 'ADM-אחים ואחיות עד הבית');
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

  it('composes the pattern and shrinks the treatment list so the action always fits', () => {
    const lead = (t: string[]) => metaLead('nails', 'סלון דוגמה 91', 'תל אביב-יפו', t);
    const long = composeMetaDescription({ lead, treatments: ['טיפול פנים קלאסי', 'הרמת ריסים', 'עיצוב גבות'], rating: 'דירוג 4.0 בגוגל (100 ביקורות).', facts: ['פתוח ראשון עד חמישי.'] });
    assert.ok(long.endsWith(META_ACTION) && metaDescriptionOk(long, { title: 'סלון דוגמה 91 בתל אביב-יפו: מניקור ופדיקור' }), long);
    assert.ok(long.startsWith('טיפול פנים קלאסי'), 'leads with the treatments, not the title');
    const thin = composeMetaDescription({ lead: t => metaLead(null, 'נתבע', 'חיפה', t), treatments: [], facts: ['פתוח בימים ראשון עד חמישי.', 'העסק נמצא ברחוב הרצל 5.', 'השירות ניתן בעברית וברוסית.', 'העסק פועל באזור חיפה.'] });
    assert.ok(metaDescriptionOk(thin) && !thin.includes('  '), thin);
    assert.ok(thin.endsWith(META_ACTION), 'the action is the last sentence even after padding');
    // A fragment is never used as padding; a sentence is.
    const padded = composeMetaDescription({ lead: () => 'מספרה בחיפה.', treatments: [], facts: ['גם מניקור.', 'ברחוב 1.', 'יש חניה חינם במקום.', 'השירות ניתן בעברית וברוסית.', 'העסק פועל מאז 2010.', 'פתוח בימים ראשון עד חמישי.'] });
    assert.ok(!padded.includes('גם מניקור') && !padded.includes('ברחוב 1.') && padded.includes('יש חניה חינם במקום.') && padded.endsWith(META_ACTION), padded);
    assert.ok(metaDescriptionOk(padded), JSON.stringify(metaDescriptionProblems(padded)));
  });

  it('opens by category, never with the title, and joins Hebrew lists naturally', () => {
    assert.equal(joinHe(['תספורת', 'צבע לשיער', 'פן']), 'תספורת, צבע לשיער ופן');
    assert.equal(joinHe(['מניקור', 'Hydrafacial']), 'מניקור ו־Hydrafacial');
    assert.equal(metaLead('hair-salons', 'רון', 'חיפה', ['תספורת', 'צבע לשיער', 'פן']), 'תספורת, צבע לשיער ופן במספרת רון בחיפה.');
    assert.equal(metaLead('hair-salons', 'מספרת רון', 'חיפה', ['תספורת']), 'תספורת במספרת רון בחיפה.');
    assert.equal(metaLead('medical-aesthetics', 'Glow Clinic', 'נתניה', ['בוטוקס', 'חומרי מילוי']), 'בוטוקס וחומרי מילוי ב־Glow Clinic בנתניה, מרפאה לאסתטיקה רפואית.');
    assert.equal(metaLead('facials', 'דנה כהן', 'חיפה', []), 'קוסמטיקה וטיפולי פנים בחיפה אצל דנה כהן.');
    const shapes = ['facials', 'hair-salons', 'nails', 'medical-aesthetics', 'brows-lashes', 'spa-massage', 'makeup', 'hair-removal'].map(c => metaLead(c, 'דוגמה', 'חיפה', ['א', 'ב']).replace('א וב', 'T'));
    assert.equal(new Set(shapes).size, shapes.length, 'every category has its own sentence shape');
    assert.ok(repeatsTitle('מספרת רון בחיפה: תספורות ועוד.', 'מספרת רון בחיפה: מספרה | BeautyFind'));
    assert.ok(!repeatsTitle('תספורת, צבע לשיער ופן במספרת רון בחיפה.', 'מספרת רון בחיפה: מספרה | BeautyFind'));
    assert.ok(metaDescriptionProblems('מספרת רון בחיפה: מספרה. תספורת ופן. דירוג 4.8 בגוגל (212 ביקורות). השוו מחירים וביקורות ב־BeautyFind. פתוח ראשון עד חמישי.', { title: 'מספרת רון בחיפה: מספרה' }).some(p => p.code === 'title_repeat'));
    // Latin: a brand, a device or the business name passes; any other English word fails.
    const ok = 'טיפולי פנים בחיפה: Hydrafacial ומיקרונידלינג אצל Noa Levin Studio. דירוג 4.8 בגוגל (212 ביקורות). השוו מחירים וביקורות ב־BeautyFind. יש חניה חינם במקום.';
    assert.deepEqual(metaDescriptionProblems(ok, { allow: ['Noa Levin Studio'] }).map(p => p.code), []);
    assert.ok(metaDescriptionProblems(ok).some(p => p.code === 'latin' && p.match === 'Noa'), 'the business name must be allowed explicitly');
    assert.ok(metaDescriptionProblems(ok.replace('ומיקרונידלינג', 'ו־Microneedling'), { allow: ['Noa Levin Studio'] }).some(p => p.code === 'latin' && p.match === 'Microneedling'));
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
    assert.equal(hebrewTreatmentName('מתמחה בטיפולי פנים מתקדמים ופילינג.'), null, 'a sentence is not a treatment name');
    assert.equal(hebrewTreatmentName('הסרת שיער בלייזר חבילת 6 מפגשים'), null, 'a package line is not a treatment name');
    assert.equal(hebrewTreatmentName('Классический массаж'), null);
    assert.deepEqual(hebrewTreatmentNames(['Hairstyling', 'Unknown Thing', 'Hair colouring', 'hairstyling', 'Haircut', 'Keratin'], 3), ['עיצוב שיער', 'צבע לשיער', 'תספורת']);
    assert.equal(hebrewTreatmentName('Brazilian'), 'ברזילאית');
    assert.equal(hebrewTreatmentName('Brazilian wax'), 'שעווה ברזילאית');
  });

  it('keeps one name per meaning, the shorter one', () => {
    assert.deepEqual(dedupeTreatments(['טיפול פנים', 'טיפולי פנים', 'ניקוי פנים עמוק']), ['טיפול פנים', 'ניקוי פנים עמוק']);
    assert.deepEqual(dedupeTreatments(['טיפול פנים קלאסי', 'מניקור', 'טיפול פנים']), ['טיפול פנים', 'מניקור']);
    assert.deepEqual(dedupeTreatments(['גוונים והבהרות', 'גוונים', 'בלונד והבהרה', 'הבהרות']), ['גוונים', 'הבהרות']);
    assert.deepEqual(dedupeTreatments(['תספורת', 'תספורות נשים', 'צבע לשיער', 'צביעת שיער', 'פן', 'פן ועיצוב']), ['תספורת', 'צבע לשיער', 'פן']);
    assert.ok(!sameTreatment('עיסוי שוודי', 'עיסוי רקמות עמוק') && !sameTreatment('הסרת שיער בלייזר', 'הסרת שיער בשעווה') && sameTreatment('טיפולי פנים', 'טיפול פנים'));
    assert.deepEqual(hebrewTreatmentNames(['Facial', 'טיפולי פנים', 'Highlights', 'גוונים והבהרות', 'פדיקור'], 3), ['טיפול פנים', 'גוונים', 'פדיקור']);
  });
});

describe('treatment name hygiene', () => {
  it('flags products, sentences, article titles and lone function words, and keeps treatments', () => {
    assert.equal(treatmentNameProblem('קרם לחות ליום'), 'product');
    assert.equal(treatmentNameProblem('סרום ויטמין C'), 'product');
    assert.equal(treatmentNameProblem('קרם לילה מזין ללילה'), 'product');
    assert.equal(treatmentNameProblem('מתמחה בטיפולי פנים מתקדמים ופילינג.'), 'sentence');
    assert.equal(treatmentNameProblem('אנחנו מציעים מגוון טיפולים'), 'sentence');
    assert.equal(treatmentNameProblem('היתרונות של טיפול בוטוקס'), 'article');
    assert.equal(treatmentNameProblem('איך לבחור קוסמטיקאית'), 'article');
    assert.equal(treatmentNameProblem('מה זה הידרה פייסיאל?'), 'article');
    assert.equal(treatmentNameProblem('בלבד'), 'function_word');
    assert.equal(treatmentNameProblem('ועוד'), 'function_word');
    assert.equal(treatmentNameProblem('הסרת שיער בלייזר חבילת 6 מפגשים'), 'package');
    for (const ok of ['טיפול פנים', 'לק ג׳ל', 'הסרת שיער בלייזר', 'Hydrafacial', 'בוטוקס אזור אחד', 'מניקור ג׳ל', 'החלקת קרטין', 'מסכת פנים מזינה']) assert.equal(treatmentNameProblem(ok), null, ok);
    assert.equal(hebrewTreatmentName('קרם לחות ליום'), null, 'a product never reaches a description');
    assert.deepEqual(hebrewTreatmentNames(['בלבד', 'היתרונות של בוטוקס', 'פדיקור', 'סרום לפנים', 'מניקור'], 3), ['פדיקור', 'מניקור']);
  });
});

describe('sentence tidying and titled names', () => {
  it('collapses doubled periods and uses אצל before a titled person', () => {
    assert.equal(metaLead('nails', 'לירן איפור קבוע ובניית ציפורניים.', 'אשדוד', ['מניקור']), 'מניקור בסטודיו לירן איפור קבוע ובניית ציפורניים באשדוד.');
    assert.equal(tidySentence('תספורת במספרת רון.. דירוג 4.8 .'), 'תספורת במספרת רון. דירוג 4.8.');
    assert.equal(inHe('ד״ר יעל כהן'), 'אצל ד״ר יעל כהן');
    assert.equal(inHe('פרופ׳ לוי'), 'אצל פרופ׳ לוי');
    assert.equal(inHe('Dr. Allan Schuman'), 'אצל Dr. Allan Schuman');
    assert.equal(inHe('מספרת רון'), 'במספרת רון');
    assert.equal(metaLead('medical-aesthetics', 'ד״ר יעל כהן', 'נתניה', ['בוטוקס']), 'בוטוקס אצל ד״ר יעל כהן בנתניה, מרפאה לאסתטיקה רפואית.');
    assert.equal(metaLead('dental-aesthetics', 'ד״ר אמיר מטר', 'נהריה', ['הלבנת שיניים']), 'אסתטיקה דנטלית בנהריה: הלבנת שיניים אצל ד״ר אמיר מטר.');
    const d = composeMetaDescription({ lead: t => metaLead('nails', 'סטודיו דנה.', 'חיפה', t), treatments: ['מניקור', 'פדיקור'], rating: 'דירוג 4.8 בגוגל (12 ביקורות).', facts: ['פתוח בימים ראשון עד חמישי.'] });
    assert.ok(!d.includes('..') && d.endsWith(META_ACTION), d);
  });
});
