// The magazine's starting data: the default author, the 17 categories (three general ones and one per
// treatment page) and the first tags. Pure data, applied by scripts/magazine-seed.ts locally and through
// the MCP tools (upsert_author, upsert_category, create_tag) in production. Idempotent by slug.

export const DEFAULT_AUTHOR = { slug: 'koral-kardi', name: 'קורל קרדי' } as const;

export interface SeedCategory { slug: string; name: string; description: string; parentPagePath: string | null }

export const SEED_CATEGORIES: SeedCategory[] = [
  { slug: 'choosing-a-provider', name: 'בחירת עסק ויועץ', description: 'איך בוחרים מכון, קליניקה או איש מקצוע: רישיונות, ניסיון, שאלות ודגלים אדומים.', parentPagePath: null },
  { slug: 'prices-and-costs', name: 'מחירים ועלויות', description: 'מה עולה כמה בשוק הישראלי, ממה המחיר מורכב ואיך משווים הצעות.', parentPagePath: null },
  { slug: 'consultation-and-prep', name: 'ייעוץ והכנה לטיפול', description: 'מה לשאול בפגישת הייעוץ, איך להתכונן לטיפול ומה קורה אחריו.', parentPagePath: null },
  { slug: 'medical-aesthetics', name: 'אסתטיקה רפואית', description: 'בוטוקס, חומרי מילוי וטיפולי מחט: מי מורשה, מה המחירים ומה לבדוק.', parentPagePath: '/treatments/medical-aesthetics' },
  { slug: 'facials', name: 'קוסמטיקה וטיפולי פנים', description: 'ניקוי פנים, פילינג, מזותרפיה וטיפוח העור אצל קוסמטיקאית.', parentPagePath: '/treatments/facials' },
  { slug: 'plastic-surgery', name: 'כירורגיה פלסטית', description: 'ניתוחים אסתטיים: בחירת מנתח, תהליך ההחלטה, עלויות והחלמה.', parentPagePath: '/treatments/plastic-surgery' },
  { slug: 'dental-aesthetics', name: 'אסתטיקה דנטלית', description: 'הלבנות, ציפויים ועיצוב חיוך: מה לבדוק אצל רופא השיניים ומה המחירים.', parentPagePath: '/treatments/dental-aesthetics' },
  { slug: 'hair-restoration', name: 'השתלות שיער וטיפול בנשירה', description: 'השתלות FUE ו־FUT, טיפולים בנשירה ומה לשאול לפני שמחליטים.', parentPagePath: '/treatments/hair-restoration' },
  { slug: 'hair-salons', name: 'מספרות ועיצוב שיער', description: 'תספורות, צבע, החלקות ועיצוב לאירועים: איך בוחרים מספרה ומה המחירים.', parentPagePath: '/treatments/hair-salons' },
  { slug: 'hair-removal', name: 'הסרת שיער', description: 'לייזר, IPL ואלקטרוליזה: סוגי המכשירים, מספר הטיפולים והעלויות.', parentPagePath: '/treatments/hair-removal' },
  { slug: 'brows-lashes', name: 'גבות וריסים', description: 'עיצוב גבות, הרמת ריסים ותוספות: מה כולל כל טיפול וכמה הוא מחזיק.', parentPagePath: '/treatments/brows-lashes' },
  { slug: 'makeup', name: 'איפור מקצועי', description: 'איפור כלות, אירועים וצילומים: איך בוחרים מאפרת ומה לתאם מראש.', parentPagePath: '/treatments/makeup' },
  { slug: 'permanent-makeup', name: 'איפור קבוע', description: 'מיקרובליידינג, פאודר ברואוז ושפתיים: תהליך, ריפוי, החזקה ומחירים.', parentPagePath: '/treatments/permanent-makeup' },
  { slug: 'nails', name: 'ציפורניים, מניקור ופדיקור', description: 'לק ג׳ל, בנייה וטיפולי כף רגל: היגיינה, חומרים ומה לבדוק במכון.', parentPagePath: '/treatments/nails' },
  { slug: 'spa-massage', name: 'ספא ועיסויים', description: 'סוגי עיסוי, חבילות ספא ומה מתאים למי.', parentPagePath: '/treatments/spa-massage' },
  { slug: 'body-contouring', name: 'עיצוב וחיטוב הגוף', description: 'קריוליפוליזה, HIFU, רדיו־פרקוונסי וחיטוב שרירים: מה עובד, למי ובאיזה מחיר.', parentPagePath: '/treatments/body-contouring' },
  { slug: 'tanning', name: 'שיזוף', description: 'שיזוף בהתזה ובקרם: הכנה, תחזוקה ומה לשאול לפני התור.', parentPagePath: '/treatments/tanning' },
];

export const SEED_TAGS = ['מדריך', 'הסבר', 'צ\'קליסט', 'השוואה', 'שאלות ותשובות'] as const;
