// Treatment names in Russian, as price lists of Russian-speaking salons spell them, in Hebrew for the writer's
// packet: a body-area glossary (спина is the back, not the spine; ноги are legs), the procedures (воск and
// шугаринг are waxing and sugaring, лазер is laser hair removal, ботулинотерапия is botulinum injections)
// and the (ж)/(м) markers for women and men. "Лазер X" becomes "הסרת שיער בלייזר ב־X". A name with a word
// the glossary does not know returns null, and the packet leaves it out rather than carrying Cyrillic.
// Pure, shared by the packet builder, the medical classifier's tests and the reports.

export const CYRILLIC = /[Ѐ-ӿ]/;

/** Multi-word phrases first, then single words. Keys are lower case, one space, no punctuation. */
const PHRASES: Array<[string, string]> = [
  ['полоска на животе', 'פס הבטן'], ['пальцы на ногах', 'אצבעות הרגליים'], ['пальцы на руках', 'אצבעות הידיים'], ['руки до локтя', 'ידיים עד המרפק'], ['ноги до колена', 'רגליים עד הברך'],
  ['руки полностью', 'ידיים מלאות'], ['ноги полностью', 'רגליים מלאות'], ['лицо полностью', 'פנים מלאות'], ['всё тело', 'כל הגוף'], ['все тело', 'כל הגוף'],
  ['глубокое бикини', 'ביקיני עמוק'], ['бикини глубокое', 'ביקיני עמוק'], ['бикини классика', 'ביקיני קלאסי'], ['классическое бикини', 'ביקיני קלאסי'], ['бикини среднее', 'ביקיני בינוני'],
  ['голени бедра', 'שוקיים וירכיים'], ['поясница ягодицы', 'גב תחתון וישבן'], ['верхняя губа', 'שפה עליונה'], ['уголки губ', 'זוויות הפה'], ['десневая улыбка', 'חיוך חניכיים'],
  ['удаление старого филлера', 'הסרת פילר ישן'], ['удаление филлера', 'הסרת פילר'], ['чистка лица', 'ניקוי פנים'], ['уход за лицом', 'טיפול פנים'], ['коррекция бровей', 'עיצוב גבות'], ['окрашивание бровей', 'צביעת גבות'],
  ['наращивание ресниц', 'הארכת ריסים'], ['ламинирование ресниц', 'הרמת ריסים'], ['ламинирование бровей', 'למינציית גבות'], ['гиалуроновая кислота', 'חומצה היאלורונית'], ['увеличение губ', 'מילוי שפתיים'],
  ['1 зона', 'אזור אחד'], ['2 зоны', 'שני אזורים'], ['3 зоны', 'שלושה אזורים'], ['консультация лазер', 'ייעוץ להסרת שיער בלייזר'],
];
const WORDS: Record<string, string> = {
  спина: 'גב', ноги: 'רגליים', нога: 'רגל', руки: 'ידיים', рука: 'יד', бикини: 'ביקיני', подмышки: 'בתי השחי', голени: 'שוקיים', бедра: 'ירכיים', бёдра: 'ירכיים', живот: 'בטן', ареолы: 'עטרות',
  лицо: 'פנים', грудь: 'חזה', поясница: 'גב תחתון', ягодицы: 'ישבן', шея: 'צוואר', подбородок: 'סנטר', лоб: 'מצח', щеки: 'לחיים', щёки: 'לחיים', губы: 'שפתיים', глаза: 'עיניים', нос: 'אף', плечи: 'כתפיים',
  кисти: 'כפות הידיים', стопы: 'כפות הרגליים', усики: 'שפם', зона: 'אזור', зоны: 'אזורים', дао: 'זוויות הפה', позвоночник: 'גב', позвоночника: 'גב', коррекция: 'תיקון', комплекс: 'חבילה', мини: 'מיני', макси: 'מקסי', хит: 'היט', тотал: 'טוטאל', хэци: 'חצי', классика: 'קלאסי',
  среднее: 'בינוני', глубокое: 'עמוק', полностью: 'מלא', консультация: 'ייעוץ', маникюр: 'מניקור', педикюр: 'פדיקור', массаж: 'עיסוי', пилинг: 'פילינג', брови: 'גבות', ресницы: 'ריסים', стрижка: 'תספורת',
  окрашивание: 'צבע לשיער', укладка: 'פן', ботулинотерапия: 'הזרקות בוטוקס', ботокс: 'בוטוקס', филлер: 'פילר', филлеры: 'פילרים', биоревитализация: 'ביורויטליזציה', скинбустер: 'סקינבוסטר', скинбустеры: 'סקינבוסטרים',
  мезотерапия: 'מזותרפיה', липолитики: 'ליפוליטיקה', эпиляция: 'הסרת שיער', депиляция: 'הסרת שיער', воск: 'שעווה', шугаринг: 'סוכר', лазер: 'לייזר', ж: 'לנשים', м: 'לגברים', женщины: 'לנשים', мужчины: 'לגברים',
  и: 'ו', для: 'ל', на: 'על', с: 'עם', без: 'ללא',
};

// Cyrillic lower-cased for the glossary; Latin words (a brand such as RRS Eyes) keep their case.
const norm = (s: string) => s.replace(/[А-ЯЁ]/g, c => c.toLowerCase()).replace(/[^A-Za-zа-яё0-9\s]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** Translates the Cyrillic words of a phrase; null when one is unknown. Latin words (a brand such as RRS) stay. */
function translateWords(text: string): string | null {
  let t = ` ${norm(text)} `;
  for (const [ru, he] of PHRASES) t = t.split(` ${ru} `).join(` ${he} `);
  const out: string[] = [];
  for (const w of t.trim().split(' ')) {
    if (!w) continue;
    if (!CYRILLIC.test(w)) {
      out.push(w);
      continue;
    }
    const he = WORDS[w];
    if (!he) return null;
    out.push(he);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * The Hebrew name of a Russian treatment, or null when the name has no Cyrillic (not this module's job) or a
 * word the glossary does not know. "Лазер Подмышки (ж)" = הסרת שיער בלייזר ב־בתי השחי לנשים;
 * "Голени/Бедра (ж) Воск/Шугаринг" = הסרת שיער בשעווה או בסוכר ב־שוקיים וירכיים לנשים.
 */
export function translateCyrillicTreatment(raw: string): string | null {
  if (!CYRILLIC.test(raw)) return null;
  let name = raw.replace(/\s+/g, ' ').trim();
  // The gender markers first, then every other parenthetical: a price list often repeats the name in
  // parentheses ("Лицо ( зона) (ж) Воск/Шугаринг(Лицо (1 зона) (ж) Воск/Шугаринг)"), innermost first.
  const gender = /\(\s*ж\s*\)/iu.test(name) ? 'לנשים' : /\(\s*м\s*\)/iu.test(name) ? 'לגברים' : '';
  name = name.replace(/\(\s*[жм]\s*\)/giu, ' ');
  for (let i = 0; i < 5; i++) {
    const next = name.replace(/\([^()]*\)/gu, ' ');
    if (next === name) break;
    name = next;
  }
  name = name.replace(/\s+/g, ' ').trim();
  const area = (s: string) => {
    const t = translateWords(s);
    return t == null ? null : t;
  };
  const withGender = (s: string) => `${s}${gender ? ` ${gender}` : ''}`.replace(/\s+/g, ' ').trim();
  const join = (head: string, rest: string | null) => (rest == null ? null : rest ? withGender(`${head} ב־${rest}`) : withGender(head));

  const laser = name.match(/^лазер\s*(.*)$/iu);
  if (laser) return join('הסרת שיער בלייזר', area(laser[1]));
  const wax = /воск|шугаринг/iu.test(name);
  if (wax) {
    const rest = name.replace(/воск\s*\/?\s*шугаринг|шугаринг\s*\/?\s*воск|воск|шугаринг/giu, ' ').replace(/\s+/g, ' ').trim();
    const both = /воск/iu.test(name) && /шугаринг/iu.test(name);
    return join(both ? 'הסרת שיער בשעווה או בסוכר' : /воск/iu.test(name) ? 'הסרת שיער בשעווה' : 'הסרת שיער בסוכר', area(rest));
  }
  const botox = name.match(/^ботулинотерапия\s*(.*)$/iu);
  if (botox) return join('הזרקות בוטוקס', area(botox[1]));
  const t = area(name);
  return t ? withGender(t) : null;
}
