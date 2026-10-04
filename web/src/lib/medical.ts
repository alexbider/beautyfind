// The medical treatment disclaimer. Every published treatment flagged isMedical (Botox, fillers,
// mesotherapy, skin boosters and the like, whatever the language of its name) carries one of two states on
// the public pages: "doctor verified" when the listing names a medical responsible, or has an active doctor
// or nurse on staff with a verified license, and "no doctor on file" otherwise, which shows the "טיפול
// רפואי" label with a popover that explains the law and points to the Ministry of Health registry. The
// state is derived at render time, so a business that claims its listing and adds a doctor switches to the
// badge without anyone touching the treatment. Pure: shared by the profile page, the cards, the settings
// schema and the tests.

/** The Ministry of Health practitioner registry (doctors, nurses and the other licensed professions). */
export const MOH_REGISTRY_URL = 'https://practitioners.health.gov.il/Practitioners/';

/** The label next to the treatment name when no doctor is on file. */
export const MEDICAL_LABEL = 'טיפול רפואי';

/** The popover text; the live copy is the platform setting medicalDisclaimer, this is its default. */
export const DEFAULT_MEDICAL_DISCLAIMER =
  'טיפול רפואי. טיפולי הזרקה אסתטיים, כמו בוטוקס וחומרי מילוי, נחשבים בישראל לטיפולים רפואיים ויש לבצע אותם בידי רופא מורשה. העסק לא מסר לנו את פרטי הרופא המבצע. לפני הטיפול כדאי לבקש את שם הרופא ומספר הרישיון שלו ולבדוק אותם בפנקס הרופאים של משרד הבריאות.';

export const REGISTRY_LINK_LABEL = 'לבדיקה בפנקס הרופאים';
export const CLAIM_LINK_LABEL = 'בעלי העסק? אפשר להוסיף את פרטי הרופא בדף ניהול העסק';
export const LICENSE_TAG = 'רישיון נבדק';

export interface MedicalPerson {
  displayName: string;
  profession: string;
  license: { status: string } | null;
}

export interface MedicalDoctor {
  name: string;
  profession: 'doctor' | 'nurse';
  licenseVerified: boolean;
}

export type MedicalState = { kind: 'verified'; badge: string; licenseTag: string | null } | { kind: 'warning'; label: string };

const isMedicalProfession = (p: string): p is 'doctor' | 'nurse' => p === 'doctor' || p === 'nurse';

/**
 * The doctor (or nurse) who answers for the medical treatments: the listing's medical responsible when
 * that person is a doctor or nurse, otherwise the first active doctor or nurse on staff whose license is
 * verified. A medical responsible who is a cosmetician does not count. Null means no doctor on file.
 */
export function medicalDoctor(p: { medicalResponsible: MedicalPerson | null; staff: MedicalPerson[] }): MedicalDoctor | null {
  const m = p.medicalResponsible;
  if (m && isMedicalProfession(m.profession)) return { name: m.displayName, profession: m.profession, licenseVerified: m.license?.status === 'verified' };
  const s = p.staff.find(x => isMedicalProfession(x.profession) && x.license?.status === 'verified');
  return s && isMedicalProfession(s.profession) ? { name: s.displayName, profession: s.profession, licenseVerified: true } : null;
}

const TITLED = /^(ד["״]ר|דר['׳]|ד״ר|dr\.?|פרופ['׳]?)\s/iu;

/** What the treatment row shows: the "performed by" badge, or the label that opens the disclaimer. */
export function medicalState(doctor: MedicalDoctor | null): MedicalState {
  if (!doctor) return { kind: 'warning', label: MEDICAL_LABEL };
  const name = doctor.profession === 'doctor' && !TITLED.test(doctor.name) ? `ד״ר ${doctor.name}` : doctor.name;
  return { kind: 'verified', badge: `מבוצע בידי ${name}`, licenseTag: doctor.licenseVerified ? LICENSE_TAG : null };
}

/**
 * Keyboard rule of the disclaimer popover: Enter and Space on the trigger toggle it (the native button
 * behaviour), Escape closes it, every other key leaves it as it is.
 */
export function nextMedicalInfoOpen(key: string, open: boolean): boolean {
  if (key === 'Escape' || key === 'Esc') return false;
  if (key === 'Enter' || key === ' ' || key === 'Spacebar') return !open;
  return open;
}
