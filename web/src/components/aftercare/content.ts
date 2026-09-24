// Aftercare content sets (BeautyFind Aftercare.dc.html). Copy from the design, with names and
// clinic-specific promises removed: the clinic, practitioner and follow-up come from the booking.

export type AftercareKey = 'botox' | 'laser' | 'facial';

export interface AftercarePhase {
  key: 'first' | 'day' | 'weeks';
  name: string;
  /** This phase is "now" until this many hours after the treatment finished. */
  untilHours: number;
  dos: string[];
  donts: string[];
}

export interface AftercareSet {
  phases: [AftercarePhase, AftercarePhase, AftercarePhase];
  normal: string;
  red: string[];
  /** Out-of-hours line, before "…בקושי בנשימה או בבליעה". */
  after: string;
  follow: { title: string; body: string; cta: string } | null;
}

export const AFTERCARE: Record<AftercareKey, AftercareSet> = {
  botox: {
    phases: [
      { key: 'first', name: '4 השעות הראשונות', untilHours: 4, dos: ['להישאר בישיבה או בעמידה, לא לשכב', 'לכווץ ולהרפות את אזור הטיפול בעדינות מדי פעם'], donts: ['לגעת, לעסות או ללחוץ על האזור', 'להתכופף ממושכות או להרים משקל', 'איפור על נקודות ההזרקה'] },
      { key: 'day', name: 'היום הראשון', untilHours: 24, dos: ['לשתות מים כרגיל', 'אקמול לכאב קל, אם צריך'], donts: ['אימון, סאונה או ג׳קוזי', 'אלכוהול', 'אספירין ונורופן: מגבירים שטף דם'] },
      { key: 'weeks', name: 'שבועיים', untilHours: Infinity, dos: ['לצלם באותה תאורה ביום 3, 7 ו־14 להשוואה', 'לחכות: ההשפעה המלאה מגיעה אחרי 10–14 ימים'], donts: ['טיפול פנים, לייזר או פילינג באזור', 'הזרקה נוספת לפני ביקורת'] },
    ],
    normal: 'אדמומיות ובליטות קטנות בנקודות ההזרקה בשעה הראשונה, כאב ראש קל ביום הראשון, וכחול קטן שעובר תוך שבוע. ההשפעה מתחילה אחרי 3–5 ימים.',
    red: ['צניחה של העפעף או הגבה', 'ראייה כפולה או מטושטשת', 'נפיחות שמתגברת אחרי 48 שעות', 'חולשה בבליעה, בדיבור או בנשימה'],
    after: 'השאירו הודעה בוואטסאפ ונחזור אליכם.',
    follow: { title: 'ביקורת בעוד 14 ימים', body: 'בודקים שהתוצאה אחידה, ומתקנים אם צריך.', cta: 'קביעת ביקורת' },
  },
  laser: {
    phases: [
      { key: 'first', name: 'היום הראשון', untilHours: 24, dos: ['קירור עם מגבת לחה וקרירה', 'קרם הרגעה ללא בישום'], donts: ['מקלחת חמה, סאונה או בריכה', 'בגדים צמודים על האזור'] },
      { key: 'day', name: 'השבוע הראשון', untilHours: 24 * 7, dos: ['מקדם הגנה 50 בכל יציאה', 'לחות פעמיים ביום'], donts: ['שיזוף או מיטת שיזוף', 'שעווה, פינצטה או אפילציה: רק גילוח', 'פילינג באזור'] },
      { key: 'weeks', name: 'עד הטיפול הבא', untilHours: Infinity, dos: ['גילוח יום לפני הטיפול הבא', 'שיער שנושר בשבועיים הראשונים: תקין'], donts: ['שיזוף 4 שבועות לפני הטיפול הבא'] },
    ],
    normal: 'אדמומיות ונפיחות קלה סביב זקיקי השיער, שעוברות בדרך כלל תוך 24–48 שעות. תחושה של כוויית שמש קלה.',
    red: ['שלפוחיות או קרום על העור', 'כאב שמתגבר ולא עובר', 'שינוי צבע עור כהה או בהיר'],
    after: 'שלחו תמונה בוואטסאפ ונחזור אליכם בבוקר.',
    follow: { title: 'הטיפול הבא בעוד 6 שבועות', body: 'הסרת שיער בלייזר נעשית בסדרה. כדאי לקבוע את הטיפול הבא כבר עכשיו.', cta: 'קביעת הטיפול הבא' },
  },
  facial: {
    phases: [
      { key: 'first', name: 'הלילה', untilHours: 16, dos: ['שטיפה במים פושרים בלבד', 'קרם לחות עדין'], donts: ['איפור עד מחר בבוקר', 'חומצות, רטינול או קרצוף'] },
      { key: 'day', name: '3 הימים הקרובים', untilHours: 72, dos: ['מקדם הגנה כל בוקר', 'להחליף ציפית'], donts: ['סאונה ואימון מזיע ביום הראשון', 'לסחוט פצעונים'] },
      { key: 'weeks', name: 'שבועיים', untilHours: Infinity, dos: ['לחזור לשגרה הרגילה בהדרגה'], donts: ['פילינג ביתי לפני שעברו 7 ימים'] },
    ],
    normal: 'אדמומיות קלה עד כמה שעות, ולפעמים פצעון או שניים ביומיים הראשונים כשהעור מתנקה.',
    red: ['פריחה מגרדת או נפיחות', 'צריבה שלא עוברת אחרי יום'],
    after: 'שלחו הודעה ונחזור אליכם בבוקר.',
    follow: null,
  },
};

/** Closest content set for a treatment category: medical aesthetics → botox, hair removal → laser, else facial. */
export function aftercareKeyFor(categorySlug: string | null | undefined, isMedical: boolean): AftercareKey {
  if (categorySlug === 'medical-aesthetics') return 'botox';
  if (categorySlug === 'hair-removal') return 'laser';
  if (!categorySlug && isMedical) return 'botox';
  return 'facial';
}

/** Index of the phase that applies now, from the time since the treatment finished. */
export function phaseNow(set: AftercareSet, finishedAt: Date, now = new Date()) {
  const h = (now.getTime() - finishedAt.getTime()) / 3_600_000;
  const i = set.phases.findIndex(p => h < p.untilHours);
  return i === -1 ? 2 : i;
}
