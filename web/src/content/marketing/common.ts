import type { OnboardingField } from './types';

// The first step of every intake questionnaire: the business, its customers and what has been tried.
// Each service adds its own second step (services/*.ts, onboarding.fields).

export const COMMON_ONBOARDING: OnboardingField[] = [
  { key: 'contact_role', label: 'מי איש/אשת הקשר מול הצוות שלנו?', type: 'text', placeholder: 'שם ותפקיד, אם זה לא מי שמילא את ההזמנה' },
  { key: 'treatments', label: 'אילו טיפולים או שירותים הכי חשוב לכם לקדם?', type: 'textarea', required: true, help: 'רשמו את 3 עד 5 הטיפולים המרכזיים, ואם יש, גם את המחיר הממוצע של כל אחד.' },
  { key: 'audience', label: 'מי הלקוחות שאתם רוצים יותר מהם?', type: 'textarea', required: true, placeholder: 'למשל: נשים בנות 25 עד 45 מהאזור, כלות, גברים שמגיעים לטיפולי פנים' },
  { key: 'area', label: 'מאיזה אזור מגיעים הלקוחות שלכם?', type: 'text', required: true, placeholder: 'עיר ושכונות, או רדיוס בקילומטרים' },
  { key: 'differentiator', label: 'למה לקוחות בוחרים בכם ולא במתחרים?', type: 'textarea', required: true },
  { key: 'competitors', label: 'מתחרים שאתם מכירים, ואתרים או עמודים שאתם אוהבים', type: 'textarea' },
  { key: 'channels', label: 'איפה העסק נמצא היום?', type: 'multi', options: ['אתר', 'אינסטגרם', 'פייסבוק', 'טיקטוק', 'Google Business Profile', 'וואטסאפ עסקי', 'מערכת זימון תורים', 'BeautyFind'] },
  { key: 'links', label: 'קישורים: אתר, אינסטגרם, פייסבוק, פרופיל בגוגל', type: 'textarea', placeholder: 'כל קישור בשורה' },
  { key: 'tried', label: 'מה כבר ניסיתם בשיווק, ומה עבד או לא עבד?', type: 'textarea' },
  { key: 'goal', label: 'מה ייחשב הצלחה בעוד שלושה חודשים?', type: 'textarea', required: true, placeholder: 'למשל: 30 פניות חדשות בחודש, יומן מלא בימי שלישי, השקת טיפול חדש' },
  { key: 'medical', label: 'האם העסק מציע טיפולים רפואיים (בוטוקס, חומצה היאלורונית, לייזר רפואי) שמבצע/ת רופא/ה?', type: 'select', options: ['לא', 'כן', 'חלק מהטיפולים'], required: true, help: 'פרסום של טיפולים רפואיים כפוף לכללים מחמירים יותר, ואנחנו בונים את התוכן בהתאם.' },
  { key: 'assets', label: 'יש לכם לוגו, תמונות וסרטונים מקצועיים?', type: 'multi', options: ['לוגו בקובץ איכותי', 'תמונות של המקום', 'תמונות של עבודות', 'סרטונים', 'תמונות לפני ואחרי עם הסכמה בכתב', 'אין עדיין'] },
  { key: 'contact_pref', label: 'איך הכי נוח לכם לקבל עדכונים?', type: 'select', options: ['וואטסאפ', 'אימייל', 'טלפון'], required: true },
];
