import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLAIM_LINK_LABEL, DEFAULT_MEDICAL_DISCLAIMER, LICENSE_TAG, MEDICAL_LABEL, MOH_REGISTRY_URL, medicalDoctor, medicalState, nextMedicalInfoOpen, REGISTRY_LINK_LABEL } from '../../src/lib/medical';
import { textProblems } from '../../src/lib/import/textRules';

const verified = { status: 'verified' };
const pending = { status: 'pending' };

describe('medical treatment disclaimer', () => {
  it('doctor verified: the medical responsible, or a doctor or nurse on staff with a verified license', () => {
    const d = medicalDoctor({ medicalResponsible: { displayName: 'מנאר קעואר', profession: 'doctor', license: verified }, staff: [] });
    assert.deepEqual(d, { name: 'מנאר קעואר', profession: 'doctor', licenseVerified: true });
    const s = medicalState(d);
    assert.equal(s.kind, 'verified');
    if (s.kind === 'verified') {
      assert.equal(s.badge, 'מבוצע בידי ד״ר מנאר קעואר');
      assert.equal(s.licenseTag, LICENSE_TAG);
    }
    // A title already in the name is not doubled.
    const t = medicalState({ name: 'ד"ר רוני מוסקונה', profession: 'doctor', licenseVerified: true });
    assert.equal(t.kind === 'verified' && t.badge, 'מבוצע בידי ד"ר רוני מוסקונה');
    // A nurse on staff with a verified license counts; a doctor on staff with a pending license does not.
    const n = medicalDoctor({ medicalResponsible: null, staff: [{ displayName: 'יוסי כהן', profession: 'doctor', license: pending }, { displayName: 'דנה לוי', profession: 'nurse', license: verified }] });
    assert.deepEqual(n, { name: 'דנה לוי', profession: 'nurse', licenseVerified: true });
    const ns = medicalState(n);
    assert.equal(ns.kind === 'verified' && ns.badge, 'מבוצע בידי דנה לוי');
    // A medical responsible whose license is still pending: named, without the license tag.
    const p = medicalState(medicalDoctor({ medicalResponsible: { displayName: 'אמיר מטר', profession: 'doctor', license: pending }, staff: [] }));
    assert.equal(p.kind === 'verified' && p.licenseTag, null);
  });

  it('no doctor on file: the label, also when the medical responsible is a cosmetician', () => {
    assert.equal(medicalDoctor({ medicalResponsible: null, staff: [] }), null);
    assert.equal(medicalDoctor({ medicalResponsible: { displayName: 'בתיה', profession: 'cosmetician', license: verified }, staff: [{ displayName: 'רונית', profession: 'cosmetician', license: verified }] }), null);
    const s = medicalState(null);
    assert.deepEqual(s, { kind: 'warning', label: MEDICAL_LABEL });
    assert.equal(MEDICAL_LABEL, 'טיפול רפואי');
  });

  it('the disclaimer text and links are what the brief says', () => {
    assert.ok(DEFAULT_MEDICAL_DISCLAIMER.startsWith('טיפול רפואי. טיפולי הזרקה אסתטיים'));
    assert.ok(DEFAULT_MEDICAL_DISCLAIMER.endsWith('בפנקס הרופאים של משרד הבריאות.'));
    assert.equal(REGISTRY_LINK_LABEL, 'לבדיקה בפנקס הרופאים');
    assert.equal(CLAIM_LINK_LABEL, 'בעלי העסק? אפשר להוסיף את פרטי הרופא בדף ניהול העסק');
    assert.match(MOH_REGISTRY_URL, /^https:\/\/practitioners\.health\.gov\.il\//);
    // Interface copy: no dashes, emoji or Latin words inside the Hebrew.
    assert.deepEqual(textProblems(DEFAULT_MEDICAL_DISCLAIMER, [], { strict: false }), []);
  });

  it('keyboard: Enter and Space toggle, Escape closes, other keys change nothing', () => {
    assert.equal(nextMedicalInfoOpen('Enter', false), true);
    assert.equal(nextMedicalInfoOpen(' ', false), true);
    assert.equal(nextMedicalInfoOpen('Enter', true), false);
    assert.equal(nextMedicalInfoOpen('Escape', true), false);
    assert.equal(nextMedicalInfoOpen('Escape', false), false);
    assert.equal(nextMedicalInfoOpen('Tab', true), true);
    assert.equal(nextMedicalInfoOpen('ArrowDown', false), false);
  });
});
