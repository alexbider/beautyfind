// Static geography and category catalog. Mirrors the `regions`, `cities` and
// `categories` tables (prisma/seed.ts writes these same values), so UI that only
// needs names and slugs (menus, footers, pickers) does not hit the database.

export type RegionSlug = 'north' | 'haifa' | 'sharon' | 'dan' | 'jerusalem' | 'shfela' | 'south';

export interface Region {
  slug: RegionSlug;
  name: string;
}

export interface City {
  name: string;
  slug: string;
  region: RegionSlug;
}

export interface Category {
  slug: string;
  name: string;
  group: string;
  isMedical: boolean;
}

export const REGIONS: Region[] = [
  { slug: 'north', name: 'צפון' },
  { slug: 'haifa', name: 'חיפה' },
  { slug: 'sharon', name: 'שרון' },
  { slug: 'dan', name: 'גוש דן' },
  { slug: 'jerusalem', name: 'ירושלים' },
  { slug: 'shfela', name: 'שפלה' },
  { slug: 'south', name: 'דרום' },
];

/** Order used by public menus (most searched first). */
export const MENU_REGION_ORDER: RegionSlug[] = ['dan', 'sharon', 'haifa', 'jerusalem', 'shfela', 'north', 'south'];

const c = (name: string, region: RegionSlug, slug: string): City => ({ name, region, slug });

export const CITIES: City[] = [
  c('נהריה', 'north', 'nahariya'), c('עכו', 'north', 'akko'), c('כרמיאל', 'north', 'karmiel'), c('צפת', 'north', 'tzfat'),
  c('טבריה', 'north', 'tiberias'), c('קריית שמונה', 'north', 'kiryat-shmona'), c('נצרת', 'north', 'nazareth'),
  c('עפולה', 'north', 'afula'), c('מגדל העמק', 'north', 'migdal-haemek'), c('בית שאן', 'north', 'beit-shean'),
  c('יקנעם', 'north', 'yokneam'),
  c('חיפה', 'haifa', 'haifa'), c('קריית ביאליק', 'haifa', 'kiryat-bialik'), c('קריית מוצקין', 'haifa', 'kiryat-motzkin'),
  c('קריית אתא', 'haifa', 'kiryat-ata'), c('קריית ים', 'haifa', 'kiryat-yam'), c('נשר', 'haifa', 'nesher'),
  c('טירת כרמל', 'haifa', 'tirat-carmel'), c('חדרה', 'haifa', 'hadera'), c('זכרון יעקב', 'haifa', 'zichron-yaakov'),
  c('פרדס חנה־כרכור', 'haifa', 'pardes-hanna'), c('בנימינה', 'haifa', 'binyamina'),
  c('נתניה', 'sharon', 'netanya'), c('רעננה', 'sharon', 'raanana'), c('כפר סבא', 'sharon', 'kfar-saba'),
  c('הרצליה', 'sharon', 'herzliya'), c('הוד השרון', 'sharon', 'hod-hasharon'), c('רמת השרון', 'sharon', 'ramat-hasharon'),
  c('אבן יהודה', 'sharon', 'even-yehuda'), c('כפר יונה', 'sharon', 'kfar-yona'), c('תל מונד', 'sharon', 'tel-mond'),
  c('תל אביב–יפו', 'dan', 'tel-aviv'), c('רמת גן', 'dan', 'ramat-gan'), c('גבעתיים', 'dan', 'givatayim'),
  c('בני ברק', 'dan', 'bnei-brak'), c('פתח תקווה', 'dan', 'petah-tikva'), c('חולון', 'dan', 'holon'),
  c('בת ים', 'dan', 'bat-yam'), c('ראשון לציון', 'dan', 'rishon-lezion'), c('ראש העין', 'dan', 'rosh-haayin'),
  c('אור יהודה', 'dan', 'or-yehuda'), c('קריית אונו', 'dan', 'kiryat-ono'), c('גבעת שמואל', 'dan', 'givat-shmuel'),
  c('ירושלים', 'jerusalem', 'jerusalem'), c('בית שמש', 'jerusalem', 'beit-shemesh'), c('מעלה אדומים', 'jerusalem', 'maale-adumim'),
  c('מבשרת ציון', 'jerusalem', 'mevaseret-zion'), c('ביתר עילית', 'jerusalem', 'beitar-illit'), c('גבעת זאב', 'jerusalem', 'givat-zeev'),
  c('רחובות', 'shfela', 'rehovot'), c('נס ציונה', 'shfela', 'ness-ziona'), c('מודיעין', 'shfela', 'modiin'),
  c('לוד', 'shfela', 'lod'), c('רמלה', 'shfela', 'ramla'), c('יבנה', 'shfela', 'yavne'), c('גדרה', 'shfela', 'gedera'),
  c('שוהם', 'shfela', 'shoham'),
  c('אשדוד', 'south', 'ashdod'), c('אשקלון', 'south', 'ashkelon'), c('קריית גת', 'south', 'kiryat-gat'),
  c('באר שבע', 'south', 'beer-sheva'), c('אופקים', 'south', 'ofakim'), c('נתיבות', 'south', 'netivot'),
  c('שדרות', 'south', 'sderot'), c('דימונה', 'south', 'dimona'), c('ערד', 'south', 'arad'), c('אילת', 'south', 'eilat'),
  c('מצפה רמון', 'south', 'mitzpe-ramon'), c('להבים', 'south', 'lehavim'),
];

export const GROUPS = {
  skin: 'פנים ועור',
  med: 'רפואה ואסתטיקה',
  hair: 'שיער',
  beauty: 'יופי ואיפור',
  body: 'גוף ורוגע',
} as const;

/** Menu order of the category groups. */
export const GROUP_ORDER: string[] = [GROUPS.skin, GROUPS.med, GROUPS.hair, GROUPS.beauty, GROUPS.body];

// The 14 service categories. Medical ones require a verified doctor as אחריות רפואית.
export const CATEGORIES: Category[] = [
  { slug: 'facials', name: 'קוסמטיקה וטיפולי פנים', group: GROUPS.skin, isMedical: false },
  // Get Listed's prototype menu groups this under פנים ועור; Treatments and Homepage (the
  // taxonomy pages) put it under רפואה ואסתטיקה, which is what we follow everywhere.
  { slug: 'medical-aesthetics', name: 'אסתטיקה רפואית', group: GROUPS.med, isMedical: true },
  { slug: 'plastic-surgery', name: 'כירורגיה פלסטית', group: GROUPS.med, isMedical: true },
  { slug: 'dental-aesthetics', name: 'אסתטיקה דנטלית', group: GROUPS.med, isMedical: true },
  { slug: 'hair-restoration', name: 'השתלות שיער וטיפול בנשירה', group: GROUPS.med, isMedical: true },
  { slug: 'hair-salons', name: 'מספרות ועיצוב שיער', group: GROUPS.hair, isMedical: false },
  { slug: 'hair-removal', name: 'הסרת שיער', group: GROUPS.hair, isMedical: false },
  { slug: 'brows-lashes', name: 'גבות וריסים', group: GROUPS.beauty, isMedical: false },
  { slug: 'makeup', name: 'איפור מקצועי', group: GROUPS.beauty, isMedical: false },
  { slug: 'permanent-makeup', name: 'איפור קבוע', group: GROUPS.beauty, isMedical: false },
  { slug: 'nails', name: 'ציפורניים, מניקור ופדיקור', group: GROUPS.beauty, isMedical: false },
  { slug: 'spa-massage', name: 'ספא ועיסויים', group: GROUPS.body, isMedical: false },
  { slug: 'body-contouring', name: 'עיצוב וחיטוב הגוף', group: GROUPS.body, isMedical: false },
  { slug: 'tanning', name: 'שיזוף', group: GROUPS.body, isMedical: false },
];

export const regionBySlug = (slug: string) => REGIONS.find(r => r.slug === slug);
export const citiesOf = (region: RegionSlug) => CITIES.filter(ct => ct.region === region);
export const categoryBySlug = (slug: string) => CATEGORIES.find(ct => ct.slug === slug);
export const categoriesInGroup = (group: string) => CATEGORIES.filter(ct => ct.group === group);

export const cityHref = (ct: City) => `/${ct.region}/${ct.slug}`;
export const categoryHref = (ct: Category) => `/treatments/${ct.slug}`;
