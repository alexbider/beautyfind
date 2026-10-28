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
