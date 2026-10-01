// Content rules for sponsored placements (Sponsored page, listing standards): what a sponsored line
// may not say. Pure, so the admin review and the business-side form can run the same checks, and the
// tests can cover every rule.

export type CheckResult = { result: 'ok' | 'warn' | 'bad'; text: string };

export const SPONSORED_LINE_MAX = 60;

const RULES: Array<{ re: RegExp; why: string }> = [
  { re: /ללא\s*כאב|בלי\s*כאב|לא\s*כואב/u, why: '״ללא כאב״ · הבטחה רפואית' },
  { re: /ללא\s*סיכון|בלי\s*סיכון|אפס\s*סיכון/u, why: '״ללא סיכון״ · הבטחה רפואית' },
  { re: /מובטח|מובטחת|הבטחה|ערובה|100%|מאה\s*אחוז/u, why: 'הבטחת תוצאה' },
  { re: /הטוב\s*ביותר|הטובה\s*ביותר|מספר\s*1|מס['׳]\s*1|המובילים?\s*בישראל|הכי\s*טוב/u, why: 'טענת עליונות' },
  { re: /חינם|בחינם|ללא\s*עלות|0\s*₪|₪\s*0\b/u, why: '״חינם״ · מחיר רפואי חינם אסור בפרסום' },
  { re: /לפני\s*ו?אחרי|before\s*(and|&)\s*after/iu, why: 'תמונות או הבטחת ״לפני ואחרי״ בטיפול רפואי' },
  { re: /ריפוי|מרפא|תרופה\s*ל/u, why: 'טענה רפואית (ריפוי)' },
];

/** The content checks on a sponsored line and its featured treatment name. */
export function contentChecks(line: string, featured?: string | null): CheckResult[] {
  const out: CheckResult[] = [];
  const text = `${line} ${featured ?? ''}`.trim();
  if (!line.trim()) out.push({ result: 'bad', text: 'חסרה שורת פרסום' });
  else if ([...line].length > SPONSORED_LINE_MAX) out.push({ result: 'bad', text: `השורה ארוכה מ־${SPONSORED_LINE_MAX} תווים` });
  const hits = RULES.filter(r => r.re.test(text));
  for (const h of hits) out.push({ result: 'bad', text: h.why });
  if (!hits.length && line.trim()) out.push({ result: 'ok', text: 'ללא הבטחת תוצאה או טענת עליונות' });
  return out;
}

/** Discount for longer campaigns (02-data-model.md: 10% from four weeks). */
export const discountPctFor = (weeks: number) => (weeks >= 4 ? 10 : 0);

/** Sunday 00:00 Asia/Jerusalem on or after the given date, as a Date. */
export function nextWeekStart(from = new Date()): Date {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(from).map(p => [p.type, p.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const utcMidnight = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  const sunday = new Date(utcMidnight + (dow === 0 ? 0 : 7 - dow) * 86_400_000);
  // Local midnight in Israel is UTC midnight minus the offset (2 or 3 hours).
  const local = new Date(sunday.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const utc = new Date(sunday.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(sunday.getTime() - (local.getTime() - utc.getTime()));
}

export const weekEnd = (weekStart: Date, weeks: number) => new Date(weekStart.getTime() + weeks * 7 * 86_400_000 - 1);
