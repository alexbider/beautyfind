// How a practitioner's license or certificate is presented (Practitioner design: PEOPLE.doctor / PEOPLE.cosmetic).
// 04-permissions: "אחריות רפואית" only for a doctor with a verified license, "איש מקצוע אחראי" only for a
// verified certificate. An unverified license is never presented as a claim: `verified: false` renders no badge,
// no number and no source.

import type { PractitionerProfession } from '@/components/profile/format';

export type PractitionerType = 'doctor' | 'cosmetic';

export interface LicenseView {
  verified: boolean;
  type: PractitionerType; // design prop practitionerType
  badge: string | null;
  badgeTone: 'ok' | 'teal';
  respLabel: string | null;
  licType: string;
  number: string | null;
  source: string | null; // "נבדק מול"
  mohVerified: boolean; // "מאומת מול משרד הבריאות"
}

interface LicenseRow {
  kind: 'doctor' | 'nurse' | 'cosmetician_cert';
  number: string;
  status: 'pending' | 'verified' | 'rejected' | 'expired';
}

export function licenseView(profession: PractitionerProfession, lic: LicenseRow | null): LicenseView {
  const type: PractitionerType = profession === 'doctor' || profession === 'nurse' ? 'doctor' : 'cosmetic';
  const verified = lic?.status === 'verified';
  // A license of the wrong kind for the profession is not shown as verified.
  const matches = lic && (profession === 'doctor' ? lic.kind === 'doctor' : profession === 'nurse' ? lic.kind === 'nurse' : lic.kind === 'cosmetician_cert');
  const ok = !!(verified && matches);
  const licType = profession === 'doctor' ? 'רישיון רופא' : profession === 'nurse' ? 'רישיון סיעוד' : profession === 'cosmetician' ? 'תעודת קוסמטיקה מוסמכת' : 'תעודה מקצועית';
  if (!ok || !lic) {
    return { verified: false, type, badge: null, badgeTone: 'teal', respLabel: null, licType, number: null, source: null, mohVerified: false };
  }
  if (profession === 'doctor') {
    return { verified: true, type, badge: 'רישיון רופא מאומת', badgeTone: 'ok', respLabel: 'אחריות רפואית', licType, number: lic.number, source: 'פנקס הרופאים, משרד הבריאות', mohVerified: true };
  }
  if (profession === 'nurse') {
    return { verified: true, type, badge: 'רישיון סיעוד מאומת', badgeTone: 'ok', respLabel: 'רישיון מקצועי', licType, number: lic.number, source: 'פנקס האחיות, משרד הבריאות', mohVerified: true };
  }
  return { verified: true, type, badge: 'הסמכה מקצועית אומתה', badgeTone: 'teal', respLabel: 'איש מקצוע אחראי', licType, number: lic.number, source: 'תעודה שהועלתה ונבדקה ידנית', mohVerified: false };
}

/** Footnote under the license card (design licNote). `doctorName` = the branch's verified medical responsible. */
export function licenseNote(profession: PractitionerProfession, doctorName: string | null): string {
  if (profession === 'doctor') return 'הזרקה היא פעולה רפואית, ורק רופא/ה או אח/ות בפיקוח רשאים לבצעה.';
  if (profession === 'nurse') return `אחיות ואחים מבצעים הזרקות בפיקוח רופא/ה${doctorName ? `. האחריות הרפואית בעסק: ${doctorName}` : ''}.`;
  return `קוסמטיקאיות וקוסמטיקאים אינם רשאים להזריק.${doctorName ? ` טיפולי הזרקה בעסק מבוצעים באחריות ${doctorName}.` : ''}`;
}
