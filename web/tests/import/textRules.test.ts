// The text rules for published Hebrew copy and the checks that apply them to the writer's drafts.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkOutput, repairMessage, templateDraft, textRuleViolations, type EvidencePacket } from '../../src/lib/import/editorial';
import { latinInsideHebrew, normalizeHebrew, textProblems } from '../../src/lib/import/textRules';

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
  });
});
