// Addresses in Hebrew for the writer. Import records often carry a Google address in Latin letters
// ("Derech Raziel 5, Netanya", "Herzl St 12, Haifa"); the writer must never see one, because the text it
// writes is Hebrew and a street name it transliterates on its own is a guess. This module turns the common
// Israeli street names into their Hebrew spelling from a fixed dictionary, keeps the house number, and
// uses the Hebrew city name the record already has. A street the dictionary does not know is dropped: the
// packet then carries the city alone and the text says nothing about the street, which is better than an
// English or an invented one. Pure, shared by the packet builder, the template draft and the tests.

import { CITIES } from '../catalog';
import { LATIN_ADDRESS, normalizeHebrew } from './textRules';

const HEBREW = /[א-ת]/u;

/** Street-type words, Latin and transliterated, with the Hebrew word that leads the Hebrew form. */
const STREET_TYPES: Array<[RegExp, string]> = [
  [/^(?:st|st\.|street|rehov|rechov|rekhov|rh\.?)$/i, ''], // plain streets carry no prefix (Google's style)
  [/^(?:rd|rd\.|road|derech|derekh|drch\.?)$/i, 'דרך'],
  [/^(?:ave|ave\.|avenue|blvd|blvd\.|boulevard|sderot|shderot|sd\.?)$/i, 'שדרות'],
  [/^(?:sq|sq\.|square|kikar)$/i, 'כיכר'],
  [/^(?:aly|alley|simtat|simta)$/i, 'סמטת'],
  [/^(?:hwy|highway|kvish)$/i, 'כביש'],
];

/** Common street names, lower-case Latin (apostrophes and hyphens removed) to Hebrew. */
export const STREET_NAMES: Record<string, string> = {
  // people
  herzl: 'הרצל', herzel: 'הרצל', theodorherzl: 'הרצל', rothschild: 'רוטשילד', rotschild: 'רוטשילד', dizengoff: 'דיזנגוף', dizengof: 'דיזנגוף', allenby: 'אלנבי', alenbi: 'אלנבי',
  benyehuda: 'בן יהודה', bengurion: 'בן גוריון', bengurian: 'בן גוריון', jabotinsky: 'ז׳בוטינסקי', zabotinsky: 'ז׳בוטינסקי', zhabotinsky: 'ז׳בוטינסקי', weizmann: 'ויצמן', weizman: 'ויצמן', vaitzman: 'ויצמן',
  sokolov: 'סוקולוב', sokolow: 'סוקולוב', arlozorov: 'ארלוזורוב', arlozerov: 'ארלוזורוב', bialik: 'ביאליק', ahadhaam: 'אחד העם', achadhaam: 'אחד העם', nordau: 'נורדאו', ibngabirol: 'אבן גבירול', ibngvirol: 'אבן גבירול',
  kinggeorge: 'המלך ג׳ורג׳', hamelechgeorge: 'המלך ג׳ורג׳', yehudahalevi: 'יהודה הלוי', shlomohamelech: 'שלמה המלך', davidhamelech: 'דוד המלך', kingdavid: 'דוד המלך', kingsolomon: 'שלמה המלך',
  begin: 'בגין', menachembegin: 'מנחם בגין', rabin: 'רבין', yitzhakrabin: 'יצחק רבין', itzhakrabin: 'יצחק רבין', moshedayan: 'משה דיין', dayan: 'דיין', golda: 'גולדה', goldameir: 'גולדה מאיר',
  levieshkol: 'לוי אשכול', eshkol: 'אשכול', shazar: 'שז״ר', zalmanshazar: 'זלמן שז״ר', bialikst: 'ביאליק', usishkin: 'אוסישקין', ussishkin: 'אוסישקין', pinsker: 'פינסקר', smolenskin: 'סמולנסקין',
  trumpeldor: 'טרומפלדור', brenner: 'ברנר', mapu: 'מאפו', frishman: 'פרישמן', gordon: 'גורדון', bograshov: 'בוגרשוב', shenkin: 'שינקין', sheinkin: 'שינקין', nahalatbinyamin: 'נחלת בנימין',
  levinsky: 'לוינסקי', lilienblum: 'לילינבלום', montefiore: 'מונטיפיורי', yehudamaccabi: 'יהודה המכבי', yehudahamaccabi: 'יהודה המכבי', basel: 'בזל', bazel: 'בזל', zamenhof: 'זמנהוף', zamenhoff: 'זמנהוף',
  shaulhamelech: 'שאול המלך', kaplan: 'קפלן', carlebach: 'קרליבך', karlibach: 'קרליבך', hashmonaim: 'החשמונאים', hahashmonaim: 'החשמונאים', derechhashalom: 'דרך השלום', hashalom: 'השלום',
  menachembegindr: 'מנחם בגין', derechmenachembegin: 'מנחם בגין', derechnamir: 'דרך נמיר', namir: 'נמיר', petahtikva: 'פתח תקווה', petachtikva: 'פתח תקווה', petahtiqwa: 'פתח תקווה',
  jerusalem: 'ירושלים', yerushalayim: 'ירושלים', haifa: 'חיפה', hayarkon: 'הירקון', yarkon: 'הירקון', hahagana: 'ההגנה', hahaganah: 'ההגנה', hagana: 'ההגנה',
  weizmanst: 'ויצמן', sokolovst: 'סוקולוב', smilansky: 'סמילנסקי', smilanski: 'סמילנסקי', tchernichovsky: 'טשרניחובסקי', tchernihovsky: 'טשרניחובסקי', shamai: 'שמאי', hillel: 'הלל', benzion: 'בן ציון',
  katznelson: 'כצנלסון', katzenelson: 'כצנלסון', borochov: 'בורוכוב', borochow: 'בורוכוב', remez: 'רמז', ruppin: 'רופין', rupin: 'רופין', balfour: 'בלפור', balfur: 'בלפור',
  raziel: 'רזיאל', davidraziel: 'דוד רזיאל', stern: 'שטרן', avrahamstern: 'אברהם שטרן', yair: 'יאיר', hagiborim: 'הגיבורים', agrippas: 'אגריפס', agripas: 'אגריפס', yafo: 'יפו', jaffa: 'יפו',
  haneviim: 'הנביאים', hanevi: 'הנביאים', emekrefaim: 'עמק רפאים', derechhevron: 'דרך חברון', hevron: 'חברון', hebron: 'חברון', derechbeitlehem: 'דרך בית לחם', beitlehem: 'בית לחם', bethlehem: 'בית לחם',
  derechbethlehem: 'דרך בית לחם', benyehudaj: 'בן יהודה', azza: 'עזה', gaza: 'עזה', hapalmach: 'הפלמ״ח', palmach: 'הפלמ״ח', rachelimenu: 'רחל אמנו', harakevet: 'הרכבת', hamasger: 'המסגר', hamelacha: 'המלאכה',
  harishon: 'הראשון', hashuk: 'השוק', hashook: 'השוק', hashaked: 'השקד', hagaaton: 'הגעתון', telaviv: 'תל אביב', telavivst: 'תל אביב', haifast: 'חיפה', jerusalemst: 'ירושלים', hagaton: 'הגעתון', sderothagaaton: 'שדרות הגעתון', hashaqed: 'השקד', hashqed: 'השקד', hatiqva: 'התקווה', hatziyonut: 'הציונות', weissburg: 'וייסבורג', wingate: 'וינגייט', pinkas: 'פנקס', eilat: 'אילת', beersheva: 'באר שבע',
  // the Ha- words
  hanassi: 'הנשיא', hanasi: 'הנשיא', haatzmaut: 'העצמאות', haatsmaut: 'העצמאות', haatzmauth: 'העצמאות', hahistadrut: 'ההסתדרות', histadrut: 'ההסתדרות', hamaapilim: 'המעפילים', maapilim: 'המעפילים',
  hatzionut: 'הציונות', hazionut: 'הציונות', hameyasdim: 'המייסדים', hagalil: 'הגליל', hanegev: 'הנגב', hasharon: 'השרון', hacarmel: 'הכרמל', hakarmel: 'הכרמל', carmel: 'הכרמל',
  haavoda: 'העבודה', haavodah: 'העבודה', haarava: 'הערבה', hahagan: 'הגן', hagefen: 'הגפן', hatamar: 'התמר', hazayit: 'הזית', hazait: 'הזית', harimon: 'הרימון', haoranim: 'האורנים', habrosh: 'הברוש',
  haerez: 'הארז', haalon: 'האלון', hadekel: 'הדקל', hashita: 'השיטה', hatavor: 'התבור', hagilboa: 'הגלבוע', hahermon: 'החרמון', hameron: 'המירון', hayarden: 'הירדן', hakishon: 'הקישון',
  hatikva: 'התקווה', hatikvah: 'התקווה', hashomer: 'השומר', hashofet: 'השופט', hamagid: 'המגיד', hamagen: 'המגן', harav: 'הרב', haravkook: 'הרב קוק', ravkook: 'הרב קוק', harabi: 'הרב',
  hachalutzim: 'החלוצים', hahalutzim: 'החלוצים', haporzim: 'הפורצים', habanim: 'הבנים', habonim: 'הבונים', haorgim: 'האורגים', hasadna: 'הסדנא', hasadnah: 'הסדנא', hatasia: 'התעשייה', hataasia: 'התעשייה',
  hataasiya: 'התעשייה', haomanut: 'האומנות', haumanut: 'האומנות', hamada: 'המדע', hahoresh: 'החורש', hayotzrim: 'היוצרים', hayozrim: 'היוצרים', hamifal: 'המפעל', hadfus: 'הדפוס', hamanof: 'המנוף',
  hashikma: 'השקמה', hashikmim: 'השקמים', hagiva: 'הגבעה', hamayan: 'המעיין', hapardes: 'הפרדס', hakerem: 'הכרם', hasade: 'השדה', hamoshava: 'המושבה', hamoshavot: 'המושבות', derechhamoshavot: 'דרך המושבות',
  derechhayam: 'דרך הים', hayam: 'הים', derechhaatzmaut: 'דרך העצמאות', derechhanassi: 'דרך הנשיא', derechjabotinsky: 'דרך ז׳בוטינסקי', derechherzl: 'דרך הרצל', derechhahagana: 'דרך ההגנה',
  derechmoshedayan: 'דרך משה דיין', derechbegin: 'דרך בגין', derechshlomo: 'דרך שלמה', derechlod: 'דרך לוד', derechramatayim: 'דרך רמתיים', ramatayim: 'רמתיים', derechhatayasim: 'דרך הטייסים',
  hatayasim: 'הטייסים', derechyitzhakrabin: 'דרך יצחק רבין', derechbeersheva: 'דרך באר שבע', derechhaifa: 'דרך חיפה', derechyafo: 'דרך יפו', derechjaffa: 'דרך יפו', derechbenzvi: 'דרך בן צבי', benzvi: 'בן צבי',
  yitzhakbenzvi: 'יצחק בן צבי', derechhazmaut: 'דרך העצמאות', derechakko: 'דרך עכו', akko: 'עכו', acre: 'עכו', derechkibutzgaluyot: 'דרך קיבוץ גלויות', kibutzgaluyot: 'קיבוץ גלויות', kibbutzgaluyot: 'קיבוץ גלויות',
  // Haifa and the north
  moriah: 'מוריה', moria: 'מוריה', horev: 'חורב', hanassiave: 'הנשיא', wedgwood: 'ווג׳ווד', vedgvud: 'ווג׳ווד', hatishbi: 'התשבי', tishbi: 'התשבי', hameginim: 'המגינים', jaffaroad: 'דרך יפו',
  khoury: 'ח׳ורי', hertzliya: 'הרצליה', herzliya: 'הרצליה', haziyonut: 'הציונות', hazionutave: 'הציונות', shderothazionut: 'שדרות הציונות', hamoriah: 'מוריה',
  // Beersheba and the south
  rager: 'רגר', yitzhakrager: 'יצחק רגר', itzhakrager: 'יצחק רגר', hadassa: 'הדסה', hadassah: 'הדסה', hertzelbs: 'הרצל', keren: 'קרן', kerenkayemet: 'קרן קיימת', kkl: 'קק״ל', bnai: 'בני', shmuelhanagid: 'שמואל הנגיד',
  // Jerusalem and the center
  hamelechgeorgest: 'המלך ג׳ורג׳', yafost: 'יפו', hillelst: 'הלל', shlomzion: 'שלומציון', shlomzionhamalka: 'שלומציון המלכה', hapalmah: 'הפלמ״ח', keremhateimanim: 'כרם התימנים', kaufman: 'קאופמן',
  weizmannblvd: 'ויצמן', hamerkaz: 'המרכז', merkaz: 'המרכז', kikarhamedina: 'כיכר המדינה', hamedina: 'המדינה', hahadarim: 'ההדרים', ahuza: 'אחוזה', ahuzah: 'אחוזה',
  achuza: 'אחוזה', hadar: 'הדר', hashahar: 'השחר', hanarkis: 'הנרקיס', hakalanit: 'הכלנית', hazavit: 'הזווית', hayasmin: 'היסמין', harakefet: 'הרקפת', hanurit: 'הנורית',
  smilanskyst: 'סמילנסקי', bilu: 'ביל״ו', biluim: 'הביל״ויים', emekayalon: 'עמק איילון', ayalon: 'איילון', shivatzion: 'שיבת ציון', herzliyast: 'הרצליה', hanassiblvd: 'הנשיא',
  sapir: 'ספיר', pinchassapir: 'פנחס ספיר', pinhassapir: 'פנחס ספיר', hashikun: 'השיכון', shikun: 'שיכון', kaplanst: 'קפלן', hasneh: 'הסנה', hazamir: 'הזמיר', hatzvi: 'הצבי',
  haemek: 'העמק', hashaar: 'השער', shaarhagai: 'שער הגיא', mota: 'מוטה', motagur: 'מוטה גור', motta: 'מוטה', mottagur: 'מוטה גור', gur: 'גור', hasivim: 'הסיבים', shlomo: 'שלמה', hamehoga: 'המחוגה',
  hamehogah: 'המחוגה', yoseftal: 'יוספטל', giorayoseftal: 'גיורא יוספטל', zeev: 'זאב', jabotinskyst: 'ז׳בוטינסקי', hameyasdimst: 'המייסדים', natanelsky: 'נתנאלסקי', ahimeir: 'אחימאיר', abbahillel: 'אבא הלל',
  abahilel: 'אבא הלל', abbahillelsilver: 'אבא הלל סילבר', bialikramat: 'ביאליק', krinitzi: 'קריניצי', krinizi: 'קריניצי', hertzelramat: 'הרצל', derechzeevjabotinsky: 'דרך זאב ז׳בוטינסקי',
  ariksharon: 'אריק שרון', arielsharon: 'אריאל שרון', sharon: 'שרון', haneviimst: 'הנביאים', hashalomrd: 'השלום', yigalalon: 'יגאל אלון', igalalon: 'יגאל אלון', alon: 'אלון',
  habarzel: 'הברזל', hanechoshet: 'הנחושת', hanehoshet: 'הנחושת', raoulwallenberg: 'ראול ולנברג', raulwalenberg: 'ראול ולנברג', wallenberg: 'ולנברג', habima: 'הבימה',
  brodetsky: 'ברודצקי', brodetski: 'ברודצקי', einstein: 'איינשטיין', albertainstein: 'אלברט איינשטיין', chaimlevanon: 'חיים לבנון', haimlevanon: 'חיים לבנון', levanon: 'לבנון', nordauav: 'נורדאו',
  bneydan: 'בני דן', bneidan: 'בני דן', pinkasst: 'פנקס', ehadhaam: 'אחד העם', lincoln: 'לינקולן', hahashmonaimst: 'החשמונאים', yehudahaleviblvd: 'יהודה הלוי', hamasgerst: 'המסגר', shoken: 'שוקן',
  schocken: 'שוקן', salame: 'סלמה', salameh: 'סלמה', shlavim: 'שלבים', herzlst: 'הרצל', eilatst: 'אילת', derechsalame: 'דרך סלמה', derechshlomohamelech: 'דרך שלמה', harishonim: 'הראשונים',
  weizmanblvd: 'ויצמן', hamelech: 'המלך', hamalka: 'המלכה', hamelechshlomo: 'המלך שלמה', hamelechdavid: 'המלך דוד', hamelechhizkiyahu: 'המלך חזקיהו', hamelechshaul: 'המלך שאול',
};

const strip = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * A loose transliteration key: "haatsmaout", "Ha'Atzma'ut" and "haatzmaut" all become the same string.
 * Consonant spellings are unified (ts/tz, ch/kh, c/k/q, w/v, y/i, ph/f, th/t), vowel pairs and runs
 * collapse, doubled letters collapse, a final h goes. Both the dictionary keys and the input get it.
 */
export function looseKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/sh/g, 'S')
    .replace(/[ck]h/g, 'h')
    .replace(/zh|j/g, 'z')
    .replace(/t[sz]/g, 'z')
    .replace(/ck|q|c/g, 'k')
    .replace(/w/g, 'v')
    .replace(/y/g, 'i')
    .replace(/ou|oo/g, 'u')
    .replace(/ee/g, 'i')
    .replace(/([aeiou])[aeiou]+/g, '$1')
    .replace(/(.)\1+/g, '$1')
    .replace(/h$/, '')
    .toLowerCase();
}
const LOOSE: Map<string, string> = new Map();
for (const [k, v] of Object.entries(STREET_NAMES)) if (!LOOSE.has(looseKey(k))) LOOSE.set(looseKey(k), v);
/** Exact dictionary hit, then the loose transliteration. */
const lookup = (latin: string): string | null => STREET_NAMES[strip(latin)] ?? LOOSE.get(looseKey(latin)) ?? null;

/** A dictionary value with its type word in front, when the Latin had one (Blvd, Derech, Kikar); plain streets get none. */
const withType = (name: string, type: string) => (!type || name.startsWith(type) ? name : `${type} ${name}`);

/** The Hebrew spelling of a Latin street name, or null when neither the dictionary nor the loose transliteration knows it. */
export function hebrewStreetName(latin: string): string | null {
  const words = latin.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  // The whole name first (with or without a leading street type word), then the name beside its type word.
  const whole = lookup(words.join(''));
  if (whole) return whole;
  const typed = words.length > 1 ? STREET_TYPES.find(([re]) => re.test(words[0])) : null;
  if (typed) {
    const rest = lookup(words.slice(1).join(''));
    return rest ? withType(rest, typed[1]) : null;
  }
  const tailTyped = words.length > 1 ? STREET_TYPES.find(([re]) => re.test(words[words.length - 1])) : null;
  if (tailTyped) {
    const rest = lookup(words.slice(0, -1).join(''));
    if (rest) return withType(rest, tailTyped[1]);
  }
  return null;
}

/** The Hebrew form of a Latin-script street in Google's style: "Herzl St" = הרצל, "Derech Raziel" = דרך רזיאל, "Rothschild Blvd" = שדרות רוטשילד. */
function hebrewStreet(latin: string): string | null {
  const name = hebrewStreetName(latin);
  if (!name) return null;
  if (/^(?:דרך|שדרות|כיכר|סמטת|כביש)\s/u.test(name)) return name;
  const words = latin.trim().split(/\s+/);
  const type = STREET_TYPES.find(([re]) => re.test(words[0])) ?? (words.length > 1 ? STREET_TYPES.find(([re]) => re.test(words[words.length - 1])) : undefined);
  return withType(name, type?.[1] ?? '');
}

/**
 * The address the writer gets: Hebrew street and number with the Hebrew city, or the city alone when the
 * street is in Latin letters that the dictionary cannot translate. An address already in Hebrew is kept
 * (the trailing "ישראל" and a Latin city name after the Hebrew street are dropped). Returns '' when
 * nothing usable is left.
 */
export function hebrewAddress(raw: string | null | undefined, city: string | null): string {
  const cleaned = (raw ?? '').replace(/,?\s*(?:ישראל|Israel)\s*$/iu, '').replace(/\s+/g, ' ').trim();
  const parts = cleaned.split(/\s*,\s*/).filter(Boolean);
  const hebrewParts = parts.filter(p => HEBREW.test(p) && !/[A-Za-z]/.test(p));
  if (hebrewParts.length === parts.length && parts.length) return parts.join(', ');
  // Mixed or Latin: translate the street part (the first part with letters), keep digits, use the Hebrew city.
  const street = parts.find(p => /[A-Za-z]/.test(p) && /[A-Za-z]{2}/.test(p)) ?? '';
  // The house number after the name ("Herzl St 5") or before it ("87 haatsmaout").
  const m = street.match(/^(.*?)(\d+[A-Za-z]?(?:\/\d+)?)?\s*$/);
  const lead = street.match(/^(\d+[A-Za-z]?(?:\/\d+)?)\s+(.+)$/);
  const latinName = (lead ? lead[2] : (m?.[1] ?? street)).replace(/\d+[A-Za-z]?\s*/g, '').trim();
  const number = lead ? lead[1] : (m?.[2] ?? '');
  const hebrew = hebrewParts.length ? hebrewParts.join(', ') : '';
  if (hebrew) {
    // A Hebrew street with a Latin city name after it: keep the Hebrew, drop the Latin.
    return city && !hebrew.includes(city) ? `${hebrew}, ${city}` : hebrew;
  }
  const translated = latinName && !/[A-Za-z]/.test(city ?? '') ? hebrewStreet(latinName) : null;
  if (translated) return `${translated}${number ? ` ${number}` : ''}${city ? `, ${city}` : ''}`;
  return city ?? '';
}

// ---------- Google Places (language he) and the stored display line ----------

/** What Place Details returns for the address, already in Hebrew when asked with languageCode=he. */
export interface GoogleAddress {
  formatted: string | null;
  route: string | null;
  streetNumber: string | null;
  locality: string | null;
  postalCode: string | null;
  premise: string | null;
  subpremise: string | null;
}

/** The address parts of a Places API (New) place body (formattedAddress, addressComponents with types). */
export function parseGoogleAddress(body: unknown): GoogleAddress | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { formattedAddress?: unknown; addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }> };
  const comp = (t: string) => b.addressComponents?.find(c => Array.isArray(c.types) && c.types.includes(t))?.longText?.trim() || null;
  return {
    formatted: typeof b.formattedAddress === 'string' ? b.formattedAddress : null,
    route: comp('route'),
    streetNumber: comp('street_number'),
    locality: comp('locality') ?? comp('administrative_area_level_2'),
    postalCode: comp('postal_code'),
    premise: comp('premise'),
    subpremise: comp('subpremise'),
  };
}

/** How the display line was made: google (Place Details), dictionary (the street dictionary), original (the Hebrew of the stored line, restyled), city_only, owner (entered by the owner, never rewritten). */
export type AddressSource = 'google' | 'dictionary' | 'original' | 'city_only' | 'owner';
export interface ResolvedAddress {
  address: string;
  postalCode: string | null;
  source: AddressSource;
  /** The city the line ends with: the stored city, or Google's locality when the two differ. */
  city: string;
  googleCity: string | null;
  /** Google's locality names another city than the one stored on the branch (staff decide about a move). */
  cityMismatch: boolean;
}

const COUNTRY = /,?\s*(?:ישראל|Israel)\s*$/iu;
const POSTAL = /^\d{5,7}$/;
const HEBREW_ONLY = (s: string) => HEBREW.test(s) && !/[A-Za-z]/.test(s);
/** Floor, building, mall, entrance: the details worth keeping from the original line. */
const DETAIL_WORDS = /(?<![א-ת])(קומה|קומת|מתחם|בניין|בנין|מרכז|קניון|חנות|כניסה|דירה|אגף|מגדל|בית\s[א-ת]|פארק|מול)(?![א-ת])/u;
const LATIN_FLOOR = /^(?:floor|fl\.?)\s*(\d+)$|^(\d+)(?:st|nd|rd|th)?\s*floor$/i;
const CITY_HE = new Set(CITIES.map(c => c.name));

/** One style for every source, Google's: no "רחוב" or "רח׳" before a plain street; שדרות, דרך and כיכר stay as part of the name. */
export const styleStreet = (s: string) => s.replace(/^(?:רחוב|רח['׳"״]?)\s+/u, '').replace(/\s+/g, ' ').trim();

/** Two Hebrew city names for the same city: dashes, quotes and the "-יפו" tail aside ("תל אביב" and "תל אביב-יפו"). */
export function cityMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string) => s.normalize('NFKC').replace(/[\u2013\u2014\-]/g, ' ').replace(/['׳"״]/g, '').replace(/\s+/g, ' ').replace(/\s*יפו$/u, '').trim();
  const x = norm(a ?? '');
  const y = norm(b ?? '');
  if (!x || !y) return false;
  return x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `);
}

/** The catalog city whose name is Google's locality, for a move proposal; null when it has no city page. */
export const catalogCityFor = (name: string | null | undefined) => (name ? CITIES.find(c => cityMatches(c.name, name)) ?? null : null);

/**
 * The floor and building details of the original line that the Hebrew line keeps ("קומה 3", "מתחם בית
 * הפסנתר", "Floor 2" as קומה 2). The city, the country, a postal code, the street itself and Latin parts
 * the dictionary or Google already replaced are not details.
 */
export function addressDetails(original: string, city: string | null, route: string | null): string[] {
  const parts = (original ?? '').replace(COUNTRY, '').split(/\s*,\s*/).map(p => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if ((city && cityMatches(p, city)) || POSTAL.test(p)) continue;
    const floor = p.match(LATIN_FLOOR);
    if (floor) {
      out.push(`קומה ${floor[1] ?? floor[2]}`);
      continue;
    }
    if (!HEBREW_ONLY(p)) continue;
    if (route && p.includes(route)) continue;
    if (DETAIL_WORDS.test(p)) out.push(p);
  }
  return [...new Set(out)];
}

/** The display line without its trailing city (the stored one or any catalog city), for the schema's streetAddress. */
export function streetLine(address: string, city: string | null): string {
  const a = address.replace(COUNTRY, '').trim();
  const parts = a.split(/\s*,\s*/).filter(Boolean);
  const last = parts[parts.length - 1];
  // The stored city, a catalog city, or (Google's locality for a city without a page) a short last part with no digit and no building detail.
  const cityLike = !!last && (!!city && cityMatches(last, city) || CITY_HE.has(last) || (!/\d/.test(last) && !DETAIL_WORDS.test(last) && last.split(' ').length <= 3));
  if (parts.length > 1 && cityLike) return parts.slice(0, -1).join(', ');
  return a;
}

/**
 * The stored display line for a listing, in one style for every source (Google's: street and number with no
 * "רחוב", details, city; Hebrew typography normalized, no country, no postal code). Google's Hebrew street
 * comes first, with the original's floor and building details or Google's own building name; without a
 * usable Google answer the Hebrew of the original is kept and restyled, a Latin street the dictionary knows
 * (exactly or by loose transliteration) is translated, and an unknown street leaves the city alone. The line
 * ends with the stored city, unless Google's locality names another city: then Google's city stays and the
 * mismatch is reported for staff.
 */
export function composeHebrewAddress(google: GoogleAddress | null, original: string, storedCity: string): ResolvedAddress {
  const cleaned = (original ?? '').replace(COUNTRY, '').replace(/\s+/g, ' ').trim();
  const googleCity = google?.locality && HEBREW_ONLY(google.locality) ? google.locality.trim() : null;
  const cityMismatch = !!googleCity && !!storedCity && !cityMatches(storedCity, googleCity);
  const city = cityMismatch ? googleCity! : storedCity;
  const isCity = (p: string) => cityMatches(p, storedCity) || cityMatches(p, googleCity);
  const finish = (parts: string[], source: AddressSource, postalCode: string | null = null): ResolvedAddress => ({
    address: normalizeHebrew([...parts.map(styleStreet).filter(Boolean), city].filter(Boolean).join(', ')),
    postalCode,
    source,
    city,
    googleCity,
    cityMismatch,
  });

  if (google?.route && HEBREW_ONLY(google.route)) {
    const street = `${styleStreet(google.route)}${google.streetNumber ? ` ${google.streetNumber}` : ''}`;
    const details = addressDetails(cleaned, city, google.route);
    if (!details.length && google.premise && HEBREW_ONLY(google.premise) && google.premise !== google.route) details.push(google.premise);
    return finish([street, ...details], 'google', google.postalCode && POSTAL.test(google.postalCode) ? google.postalCode : null);
  }
  if (!city) return { address: normalizeHebrew(cleaned), postalCode: null, source: 'original', city: '', googleCity, cityMismatch: false };
  const parts = cleaned.split(/\s*,\s*/).map(p => p.trim()).filter(Boolean);
  if (cleaned && HEBREW_ONLY(cleaned)) return finish(parts.filter(p => !isCity(p) && !POSTAL.test(p)), 'original');
  // A mixed line ("K-Tower שדרות ירושלים 18 אשדוד, ים, 7752311"): the Hebrew words of each part stay, Latin
  // words, the postal code and the city inside a part go; a Hebrew street (a number or a street type word)
  // is kept as the street, other Hebrew parts are details.
  const esc = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hebrewParts = [...new Set(parts
    .filter(p => HEBREW.test(p))
    .map(p => p.replace(/[A-Za-z][A-Za-z'’.&-]*/g, ' ').replace(/\s+/g, ' ').replace(new RegExp(`(?:^|\\s)${esc}(?=\\s|$)`, 'u'), ' ').replace(/^[\s,.\-]+|[\s,.\-]+$/g, '').trim())
    .filter(p => p && !isCity(p) && !POSTAL.test(p)))];
  const streetLike = (p: string) => /\d/.test(p) || /^(?:רחוב|רח['׳]|דרך|שדרות|שד['׳]|סמטת|כיכר|כביש)\s/u.test(p);
  const hebrewStreetPart = hebrewParts.find(streetLike);
  if (hebrewStreetPart) return finish([hebrewStreetPart, ...hebrewParts.filter(p => p !== hebrewStreetPart && DETAIL_WORDS.test(p))], 'original');
  // The Latin parts go to the dictionary, except a city or country name (never a street) and a part in
  // another script (Arabic, Cyrillic) the dictionary cannot read.
  const latinParts = parts.filter(p => !HEBREW.test(p) && /[A-Za-z]/.test(p) && !isLatinCity(p));
  const dict = hebrewAddress(latinParts.join(', '), city);
  if (dict && dict !== city) {
    const details = [...addressDetails(cleaned, city, null), ...hebrewParts.filter(p => DETAIL_WORDS.test(p))];
    return finish([streetLine(dict, city), ...new Set(details)], 'dictionary');
  }
  return finish([], 'city_only');
}

/** True when the whole part is a city or country name in Latin letters ("Haifa", "Tel Aviv", "Israel"). */
const isLatinCity = (part: string) => LATIN_CITIES.has(part.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim());

const LATIN_CITIES = new Set([...CITIES.flatMap(c => [c.slug.replace(/-/g, ' '), c.slug.replace(/-/g, '')]), 'israel', 'tel aviv', 'telaviv', 'tel aviv yafo', 'tel aviv jaffa', 'jerusalem', 'haifa', 'beersheba', 'beer sheva', 'netanya', 'ashdod', 'eilat', 'petah tikva', 'rishon lezion', 'holon', 'ramat gan', 'bat yam', 'herzliya', 'kfar saba', 'raanana', 'nahariya', 'nahariyya', 'acre', 'akko', 'tiberias', 'nazareth', 'afula', 'modiin', 'rehovot', 'ashkelon', 'hadera', 'lod', 'ramla', 'bnei brak', 'givatayim', 'yavne', 'nes ziona', 'kiryat ono', 'hod hasharon', 'rosh haayin', 'beit shemesh', 'kiryat gat', 'dimona', 'sderot', 'ofakim', 'arad', 'kiryat ata', 'kiryat bialik', 'kiryat motzkin', 'kiryat yam', 'nesher', 'tirat carmel', 'karmiel', 'safed', 'tzfat', 'kiryat shmona', 'migdal haemek', 'beit shean', 'yokneam', 'zichron yaakov', 'pardes hanna', 'or akiva', 'binyamina', 'gan yavne']);

/**
 * Why an address may not be shown: a Latin street word (St, Rd, Derech, Rehov...), a Latin city or country
 * name, or any other Latin word. Empty means the line is Hebrew (digits and punctuation allowed).
 */
export function addressProblems(address: string | null | undefined): string[] {
  const a = (address ?? '').trim();
  if (!a) return [];
  const out: string[] = [];
  const street = a.match(LATIN_ADDRESS);
  if (street) out.push(`latin_street:${street[0]}`);
  const words = a.split(/[\s,]+/).map(w => w.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '')).filter(w => /^[A-Za-z]{2,}$/.test(w));
  const lower = a.toLowerCase();
  for (const c of LATIN_CITIES) if (new RegExp(`(?<![a-z])${c}(?![a-z])`, 'i').test(lower)) out.push(`latin_city:${c}`);
  const streetWords = new Set((street ? [street[0]] : []).map(w => w.toLowerCase()));
  for (const w of words) if (!streetWords.has(w.toLowerCase()) && ![...LATIN_CITIES].some(c => c.split(' ').includes(w.toLowerCase()))) out.push(`latin:${w}`);
  return [...new Set(out)];
}
