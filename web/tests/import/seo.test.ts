// Titles, SEO names and meta descriptions: deterministic shapes within the limits search engines show.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { composeDescription, publicMetadata } from '../../src/lib/seo/meta';
import { capWords, seoCityName, seoName } from '../../src/lib/seo/seoName';

describe('seo name', () => {
  it('strips keyword tails, slogans, lists and duplicate scripts, and caps the length', () => {
    assert.equal(seoName('מספרת רון | מספרה בחיפה, תספורות, צבע'), 'מספרת רון');
    assert.equal(seoName('קליניקת גלואו - אסתטיקה רפואית בנתניה'), 'קליניקת גלואו');
    assert.equal(seoName('סטודיו דנה, מניקור, פדיקור, לק ג׳ל'), 'סטודיו דנה');
    assert.equal(seoName('מספרת רון שיער Ron Hair Salon'), 'מספרת רון שיער');
    assert.equal(seoName('Glow Clinic'), 'Glow Clinic', 'a Latin-only name stays');
    assert.equal(seoName('סטודיו Glow'), 'סטודיו Glow', 'one Latin brand word inside a Hebrew name stays');
    assert.equal(seoName('ד"ר שיין'), 'ד״ר שיין');
    const long = seoName('המרכז הבינלאומי לרפואה אסתטית ולכירורגיה פלסטית של פרופסור ישראלי');
    assert.ok(long.length <= 35 && long.startsWith('המרכז הבינלאומי'), long);
    assert.equal(capWords('אבג דהו זחט', 7), 'אבג דהו');
    assert.equal(seoCityName('תל אביב–יפו'), 'תל אביב-יפו');
  });
});

describe('meta descriptions and share cards', () => {
  it('lands between 130 and 155 characters when the facts allow', () => {
    const d = composeDescription(
      ['קליניקה לדוגמה בתל אביב-יפו: אסתטיקה רפואית.', 'בוטוקס, חומרי מילוי, ניקוי פנים ועוד.', 'דירוג 4.8 בגוגל (212 ביקורות).', 'השוו מחירים וקבעו תור ב־BeautyFind.'],
      ['טלפון, וואטסאפ וניווט בעמוד.'],
    );
    assert.ok(d.length >= 130 && d.length <= 155, `${d.length}: ${d}`);
    const short = composeDescription(['מספרה בחיפה.'], ['שעות פעילות, טלפון וניווט בעמוד.', 'פרטי קשר ומחירים כפי שהעסק פרסם.', 'השוו מחירים וקבעו תור ב־BeautyFind.']);
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
