// The text rules for published Hebrew copy and the checks that apply them to the writer's drafts.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyProofread, checkOutput, repairMessage, templateDraft, textRuleViolations, type EvidencePacket } from '../../src/lib/import/editorial';
import { STRAIGHT_QUOTE_ABBREVIATION, latinInsideHebrew, normalizeHebrew, textProblems } from '../../src/lib/import/textRules';

const codes = (t: string, allow: string[] = []) => textProblems(t, allow).map(p => p.code);

describe('text rules', () => {
  it('flags every sentence pattern about missing information or the data itself', () => {
    for (const s of [
      'המידע שבדחיפה זו מבוסס אך ורק על השדות והנתונים הזמינים בחבילת המידע.',
      'המחירים לא פורסמו במקורות הזמינים.',
      'לא צוינו שעות פעילות.',
      'אין תיעוד זמין לגבי הצוות.',
      'נכון לעת בדיקה, העסק פעיל.',
      'עמוד העסק כולל שמונה תמונות.',
      'הפרופיל כולל גלריה.',
      'תיאור זה נכתב עבור הקליניקה.',
      "השם '' לא ברור.",
      'במידע שנבדק אין פירוט.',
      'המחיר שסופק הוא 200.',
    ]) assert.ok(codes(s).includes('missing_info'), s);
    assert.deepEqual(codes('הקליניקה פתוחה בימים ראשון עד חמישי ומציעה טיפולי פנים, הזרקות ומניקור.'), []);
  });

  it('flags record language: the text speaks about the business, never about a record or listing', () => {
    for (const s of [
      'ברשומה מצוין שהסלון מציע תספורות נשים.',
      'ברשומת העסק נרשמה כתובת בתל אביב.',
      'העסק נרשם כסטודיו לציפורניים.',
      'הקליניקה מופיעה בקטגוריה אסתטיקה רפואית.',
      'העסק מופיע כמספרה.',
      'השירותים תוארו ככוללים מניקור ופדיקור.',
      'הרשומה איננה מפרטת מחירים.',
      'הרשימה אינה מפרטת שעות.',
      'אין פירוט של הצוות.',
      'המחיר לא מפורט.',
      'כפי שמצוין, המקום נגיש.',
      'הסטודיו מציין שהטיפול נמשך שעה.',
      'השירות מצוינת.',
    ]) assert.ok(codes(s).includes('record') || codes(s).includes('missing_info'), s);
    assert.deepEqual(codes('הסלון מתמחה בתספורות נשים ובצבע, ופתוח בימים ראשון עד חמישי.'), []);
    assert.deepEqual(codes('הרופאה מציעה ייעוץ ראשון ללא עלות; הטיפולים מתאימים לעור רגיש.'), []); // מציעה is not מציינת
    assert.deepEqual(codes('הקליניקה נמצאת ברחוב הרצל 12 ומופיעה גם בגוגל מפות.').filter(c => c !== 'record'), [], 'other codes stay quiet');
    assert.ok(codes('העסק מופיע כבר שנים').includes('record') === false, 'מופיע כבר (appears already) is not a record phrase: כ is part of כבר');
  });

  it('flags street words in Latin letters', () => {
    for (const s of ['הכתובת: Herzl St 5, Haifa.', 'הסטודיו ברחוב Derech Raziel 5.', 'הסלון נמצא ב־Rothschild Blvd 22.', 'Rehov Sokolov 7', 'Weizmann Ave 3']) assert.ok(codes(s, ['Herzl St 5']).includes('address'), s);
    assert.deepEqual(codes('הכתובת: דרך רזיאל 5, נתניה.'), []);
    assert.ok(!codes('הסטודיו Streetwise בתל אביב', ['Streetwise']).includes('address'), 'a longer Latin word is not a street word');
  });

  it('flags English inside Hebrew but not business names, brands or domains', () => {
    assert.deepEqual(latinInsideHebrew('העסק מופיע under הקטגוריה קוסמטיקה'), ['under']);
    assert.deepEqual(latinInsideHebrew('הכתובת: Derech Raziel 5, Netanya.'), ['Derech', 'Raziel', 'Netanya']);
    assert.deepEqual(latinInsideHebrew('הקליניקה Glow Clinic נמצאת בנתניה', ['Glow Clinic']), []);
    assert.deepEqual(latinInsideHebrew('תור נקבע דרך BeautyFind או בוואטסאפ, והאתר הוא glow.co.il'), []);
    assert.deepEqual(latinInsideHebrew('HydraFacial הוא טיפול פנים', ['HydraFacial']), []);
    assert.deepEqual(latinInsideHebrew('Opening hours: 9 to 5'), []); // an English line is not Hebrew prose
    assert.ok(codes('מספרת רון מציעה haircut לנשים').includes('latin'));
  });

  it('flags dashes, emoji and the house spellings, and fixes typography in place', () => {
    assert.ok(codes('תל אביב – מרכז').includes('dash'));
    assert.ok(codes('יופי ✨ ואסתטיקה').includes('emoji'));
    assert.ok(codes('השירות המצויין שלהם').includes('spelling'));
    assert.ok(codes('אפשר לפנות בווטסאפ').includes('spelling'));
    assert.deepEqual(codes('אפשר לפנות בוואטסאפ'), []);
    assert.equal(normalizeHebrew('ד"ר כהן, מע"מ, 30 דק\', המצויין, בווטסאפ'), 'ד״ר כהן, מע״מ, 30 דק׳, המצוין, בוואטסאפ');
    assert.equal(normalizeHebrew('דוא"ל, אא"ג, ד"ר לוי, לק ג\'ל, ד\'\'ר חנקין, ד”ר חסן, ג’ל'), 'דוא״ל, אא״ג, ד״ר לוי, לק ג׳ל, ד״ר חנקין, ד״ר חסן, ג׳ל');
    assert.equal(normalizeHebrew('מכון "גזום" פתוח'), 'מכון "גזום" פתוח', 'quotes around a word stay');
    assert.ok(STRAIGHT_QUOTE_ABBREVIATION.test('פנו בדוא"ל') && STRAIGHT_QUOTE_ABBREVIATION.test("לק ג'ל") && !STRAIGHT_QUOTE_ABBREVIATION.test('פנו בדוא״ל'));
  });

  it('the writer checks carry the text rules and the repair message names them', () => {
    const packet: EvidencePacket = {
      name: 'סטודיו דנה', city: 'נתניה', address: 'Derech Raziel 5, Netanya', categories: ['ציפורניים, מניקור ופדיקור'], businessType: null,
      services: [{ name: 'מניקור ג׳ל', category: 'ציפורניים, מניקור ופדיקור', priceNis: 120, priceType: 'fixed', durationMin: 45, isMedical: false }],
      hours: null, phone: true, email: false, whatsapp: true, website: null, bookingOnline: false, bookingLink: false, socials: [], team: [], languages: [], establishedYear: null,
      accessible: null, freeParking: null, sourceDescription: null, sourceFaqs: [], rating: null, photos: 0, videos: 0, claimed: false,
    };
    const d = templateDraft(packet);
    assert.deepEqual(textRuleViolations(checkOutput(d, packet)), [], 'the template obeys the rules, and skips a Latin address');
    assert.ok(!d.description.includes('Derech'));
    const bad = { ...d, description: `${d.description}\n\nשעות הפעילות לא פורסמו במקורות שנבדקו. הסטודיו נמצא under הקטגוריה ציפורניים – ברחוב Derech Raziel.` };
    const v = textRuleViolations(checkOutput(bad, packet));
    assert.ok(v.some(x => x.startsWith('text:missing_info:')) && v.some(x => x.startsWith('text:latin:under')) && v.some(x => x.startsWith('text:dash')), v.join(','));
    const msg = repairMessage(v);
    assert.ok(msg.includes('missing, unpublished or unverified') && msg.includes('"under"') && msg.includes('em dash'));
    const rec = { ...d, description: `${d.description}\n\nברשומה מצוין שהסטודיו מציע מניקור. הכתובת Raziel St 5.` };
    const vr = textRuleViolations(checkOutput(rec, packet));
    assert.ok(vr.some(x => x.startsWith('text:record:')) && vr.some(x => x.startsWith('text:address:')), vr.join(','));
    assert.ok(repairMessage(vr, packet).includes('Record language') && repairMessage(vr, packet).includes('street word'));
  });

  it('the proofreading pass is merged only when facts and length are unchanged', () => {
    const packet: EvidencePacket = {
      name: 'סטודיו דנה', city: 'נתניה', address: 'דרך רזיאל 5, נתניה', categories: ['ציפורניים, מניקור ופדיקור'], businessType: null,
      services: [{ name: 'מניקור ג׳ל', category: 'ציפורניים, מניקור ופדיקור', priceNis: 120, priceType: 'fixed', durationMin: 45, isMedical: false }],
      hours: null, phone: true, email: false, whatsapp: true, website: null, bookingOnline: false, bookingLink: false, socials: [], team: [], languages: [], establishedYear: null,
      accessible: null, freeParking: null, sourceDescription: null, sourceFaqs: [], rating: null, photos: 0, videos: 0, claimed: false,
    };
    const d = templateDraft(packet);
    const same = { description: d.description, faqs: d.faqs.map(f => ({ q: f.q, a: f.a })), metaTitle: d.metaTitle, metaDescription: d.metaDescription, serviceSummaries: d.serviceSummaries, unknownWords: [], changes: 0 };
    // A spelling fix keeps everything else: applied.
    const fixed = applyProofread(d, { ...same, description: d.description.replace('סטודיו דנה היא', 'סטודיו דנה הוא') });
    assert.equal(fixed.applied, true);
    assert.ok(fixed.output.description.includes('סטודיו דנה הוא'));
    // A changed number, a dropped FAQ or a much longer text: the draft stays as it was.
    assert.equal(applyProofread(d, { ...same, description: d.description.replace('120', '130') }).applied, false);
    assert.equal(applyProofread(d, { ...same, faqs: same.faqs.slice(1) }).reason, 'faq_count');
    assert.equal(applyProofread(d, { ...same, description: `${d.description} ${'מילה '.repeat(40)}` }).reason, 'length');
  });
});
