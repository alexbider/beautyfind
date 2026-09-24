// Demo content for development: the Homepage design's 36 sample businesses with treatments,
// prices, Google ratings and a few verified reviews. Fictional. Never run in production.
// Usage: npm run db:seed:demo   (after npm run db:seed)
import { PrismaClient, type PriceType } from '@prisma/client';
import { CATEGORIES, CITIES } from '../src/lib/catalog';
import { seal } from '../src/lib/server/seal-core';
import { demoGallery } from './demo-gallery';

if (process.env.NODE_ENV === 'production') {
  console.error('seed-demo refuses to run in production');
  process.exit(1);
}

const db = new PrismaClient();

type Row = [name: string, city: string, cats: string[], google: number | null, googleCount: number];
const ROWS: Row[] = [
  ['סטודיו אור כרמיאל', 'כרמיאל', ['קוסמטיקה וטיפולי פנים', 'הסרת שיער'], 4.8, 146],
  ['מרפאת גליל אסתטיק', 'נהריה', ['אסתטיקה רפואית', 'עיצוב וחיטוב הגוף'], 4.7, 92],
  ['ספא כנרת', 'טבריה', ['ספא ועיסויים'], null, 0],
  ['שיער בעמק', 'עפולה', ['מספרות ועיצוב שיער', 'איפור מקצועי'], 4.9, 118],
  ['נייל בר עכו', 'עכו', ['ציפורניים, מניקור ופדיקור', 'גבות וריסים'], 4.6, 64],
  ['כרמל אסתטיקה', 'חיפה', ['אסתטיקה רפואית', 'אסתטיקה דנטלית'], 4.9, 287],
  ['לייזר סנטר קריות', 'קריית ביאליק', ['הסרת שיער'], 4.7, 131],
  ['סטודיו גבות חדרה', 'חדרה', ['גבות וריסים', 'איפור קבוע'], 4.8, 96],
  ['הדר ספא בוטיק', 'זכרון יעקב', ['ספא ועיסויים', 'שיזוף'], null, 0],
  ['מספרת בת גלים', 'חיפה', ['מספרות ועיצוב שיער'], 4.5, 58],
  ['שרון קליניק', 'רעננה', ['אסתטיקה רפואית', 'כירורגיה פלסטית'], 4.9, 204],
  ['נתניה ביוטי לאב', 'נתניה', ['קוסמטיקה וטיפולי פנים', 'איפור מקצועי'], 4.7, 152],
  ['סטודיו ריסים הרצליה', 'הרצליה', ['גבות וריסים'], 4.8, 88],
  ['בודי שייפ כפר סבא', 'כפר סבא', ['עיצוב וחיטוב הגוף', 'הסרת שיער'], 4.6, 73],
  ['הוד ספא', 'הוד השרון', ['ספא ועיסויים'], null, 0],
  ['רוטשילד אסתטיקה', 'תל אביב–יפו', ['אסתטיקה רפואית', 'קוסמטיקה וטיפולי פנים'], 4.9, 412],
  ['נייל סטודיו גבעתיים', 'גבעתיים', ['ציפורניים, מניקור ופדיקור'], 4.8, 196],
  ['מספרת דיזנגוף', 'תל אביב–יפו', ['מספרות ועיצוב שיער', 'איפור מקצועי'], 4.7, 233],
  ['קליניקת חיוך רמת גן', 'רמת גן', ['אסתטיקה דנטלית'], 4.9, 158],
  ['לייזר האוס פתח תקווה', 'פתח תקווה', ['הסרת שיער', 'שיזוף'], 4.6, 104],
  ['השתלות שיער חולון', 'חולון', ['השתלות שיער וטיפול בנשירה'], null, 0],
  ['מרכז אסתטיקה ירושלים', 'ירושלים', ['אסתטיקה רפואית', 'כירורגיה פלסטית'], 4.8, 176],
  ['סטודיו לק בית שמש', 'בית שמש', ['ציפורניים, מניקור ופדיקור', 'גבות וריסים'], 4.7, 82],
  ['ספא הרי יהודה', 'מבשרת ציון', ['ספא ועיסויים'], 4.9, 121],
  ['איפור קבוע ירושלים', 'ירושלים', ['איפור קבוע', 'איפור מקצועי'], 4.6, 59],
  ['מספרת רחביה', 'ירושלים', ['מספרות ועיצוב שיער'], null, 0],
  ['רחובות ביוטי קליניק', 'רחובות', ['קוסמטיקה וטיפולי פנים', 'אסתטיקה רפואית'], 4.8, 164],
  ['מודיעין לייזר', 'מודיעין', ['הסרת שיער'], 4.7, 97],
  ['נס ציונה נייל ארט', 'נס ציונה', ['ציפורניים, מניקור ופדיקור'], 4.9, 73],
  ['שפלה בודי סטודיו', 'רמלה', ['עיצוב וחיטוב הגוף'], 4.5, 46],
  ['יבנה ספא', 'יבנה', ['ספא ועיסויים', 'שיזוף'], null, 0],
  ['נגב אסתטיקה', 'באר שבע', ['אסתטיקה רפואית', 'אסתטיקה דנטלית'], 4.8, 198],
  ['אשדוד ביוטי האוס', 'אשדוד', ['קוסמטיקה וטיפולי פנים', 'גבות וריסים'], 4.7, 142],
  ['ספא ים המלח', 'ערד', ['ספא ועיסויים'], 4.9, 167],
  ['אילת סאן סטודיו', 'אילת', ['שיזוף', 'הסרת שיער'], 4.6, 88],
  ['מספרת אשקלון', 'אשקלון', ['מספרות ועיצוב שיער', 'איפור מקצועי'], null, 0],
];

const IMG: Record<string, string> = {
  facials: '/assets/biz-facial.jpg', 'medical-aesthetics': '/assets/biz-medical.jpg', 'plastic-surgery': '/assets/cat-plastic.jpg',
  'dental-aesthetics': '/assets/cat-dental.jpg', 'hair-restoration': '/assets/cat-hairrest.jpg', 'hair-salons': '/assets/biz-hair.jpg',
  'hair-removal': '/assets/biz-laser.jpg', 'brows-lashes': '/assets/cat-lashes.jpg', makeup: '/assets/cat-makeup.jpg',
  'permanent-makeup': '/assets/cat-pmu.jpg', nails: '/assets/biz-nails.jpg', 'spa-massage': '/assets/biz-spa.jpg',
  'body-contouring': '/assets/cat-body.jpg', tanning: '/assets/cat-tan.jpg',
};

// [name, shekels, minutes, priceType]
const MENU: Record<string, Array<[string, number, number, PriceType]>> = {
  facials: [['ניקוי עור עמוק', 420, 60, 'fixed'], ['פילינג כימי', 480, 45, 'fixed'], ['טיפול הידרה פייסיאל', 520, 60, 'fixed']],
  'medical-aesthetics': [['בוטוקס, אזור אחד', 1100, 20, 'per_area'], ['חומצה היאלורונית, 1 מ״ל', 1700, 30, 'per_ml'], ['מזותרפיה, מפגש', 750, 30, 'fixed']],
  'plastic-surgery': [['ייעוץ ניתוחי', 450, 40, 'fixed'], ['הרמת עפעפיים עליונים', 14000, 90, 'from']],
  'dental-aesthetics': [['הלבנת שיניים במרפאה', 1800, 60, 'fixed'], ['ציפוי חרסינה', 3200, 60, 'per_unit']],
  'hair-restoration': [['ייעוץ לנשירת שיער', 350, 30, 'fixed'], ['השתלת שיער FUE', 16500, 360, 'from']],
  'hair-salons': [['תספורת נשים', 220, 45, 'fixed'], ['צבע שורש', 320, 90, 'fixed'], ['החלקה אורגנית', 1100, 180, 'from']],
  'hair-removal': [['לייזר בית שחי', 190, 15, 'fixed'], ['לייזר רגליים מלאות', 690, 45, 'fixed']],
  'brows-lashes': [['הרמת ריסים', 240, 60, 'fixed'], ['עיצוב גבות', 90, 20, 'fixed']],
  makeup: [['איפור ערב', 450, 60, 'fixed'], ['איפור כלה', 1600, 120, 'from']],
  'permanent-makeup': [['מיקרובליידינג', 1400, 150, 'fixed'], ['פאודר ברוז', 1500, 150, 'fixed']],
  nails: [['לק ג׳ל', 160, 60, 'fixed'], ['בניית ציפורניים', 260, 90, 'fixed']],
  'spa-massage': [['עיסוי שוודי, 60 דקות', 320, 60, 'fixed'], ['עיסוי רקמות עמוקות', 380, 60, 'fixed']],
  'body-contouring': [['קריוליפוליזה', 900, 60, 'per_area'], ['מיצוק RF לגוף', 450, 45, 'fixed']],
  tanning: [['שיזוף בהתזה', 180, 30, 'fixed']],
};

const REVIEWS: Array<[string, number, string, string]> = [
  ['ד. לוי', 5, 'הסבר מדויק ויחס אישי', 'הסבירו לי בדיוק מה ייעשה ולמה, וקיבלתי סיכום בכתב. חזרתי לביקורת אחרי שבועיים בלי תוספת מחיר.'],
  ['ש. אזולאי', 4, 'טיפול מעולה, קצת המתנה', 'הטיפול עצמו מעולה והמקום נקי מאוד, אבל חיכיתי כעשרים דקות מעבר לשעה שנקבעה ולא עדכנו אותי.'],
  ['ר. מזרחי', 5, 'אמרו לי לא כשהיה צריך', 'הגעתי עם בקשה מוגזמת ואמרו לי בכבוד שזה לא יתאים לי. יצאתי עם תוצאה טבעית שאני מאוד אוהבת.'],
  ['מ. כהן', 5, 'מקצועיות ושקיפות במחיר', 'המחיר שראיתי באתר היה המחיר ששילמתי. צוות אדיב, קבעתי תור לפגישה הבאה עוד לפני שיצאתי.'],
];

const HOURS = [
  { open: '09:00', close: '19:00', closed: false }, { open: '09:00', close: '19:00', closed: false },
  { open: '09:00', close: '19:00', closed: false }, { open: '09:00', close: '20:00', closed: false },
  { open: '09:00', close: '20:00', closed: false }, { open: '09:00', close: '13:00', closed: false },
  { open: '', close: '', closed: true },
];

async function main() {
  let created = 0;
  for (const [i, [name, cityName, catNames, google, googleCount]] of ROWS.entries()) {
    const city = CITIES.find(c => c.name === cityName);
    const cats = catNames.map(n => CATEGORIES.find(c => c.name === n)).filter(c => !!c);
    if (!city || cats.length === 0) {
      console.warn('skip', name);
      continue;
    }
    const existing = await db.branch.findFirst({ where: { name }, select: { id: true, coverUrl: true, gallery: true } });
    if (existing) {
      // Demo rows from an earlier seed: give them the gallery once (never overwrites photos someone added).
      if (Array.isArray(existing.gallery) && existing.gallery.length === 0) {
        await db.branch.update({ where: { id: existing.id }, data: { gallery: demoGallery(existing.coverUrl ?? '') } });
      }
      continue;
    }
    const cityRow = await db.city.findUniqueOrThrow({ where: { slug: city.slug } });
    const slug = `${city.slug}-${cats[0].slug}-${i + 1}`;
    const medical = cats.some(c => c.isMedical);
    const claimed = google !== null;
    const biz = await db.business.create({ data: { status: 'live', type: medical ? 'clinic' : 'salon' } });
    const branch = await db.branch.create({
      data: {
        businessId: biz.id, name, slug, regionSlug: city.region, cityId: cityRow.id, cityName: city.name,
        address: `${city.name}`, phone: `+9723${String(5000000 + i * 7919).slice(0, 7)}`, whatsapp: claimed ? `+97250${String(1000000 + i * 104729).slice(0, 7)}` : null,
        hours: HOURS, status: 'live', isClaimed: claimed, coverUrl: IMG[cats[0].slug], coverAlt: name, gallery: demoGallery(IMG[cats[0].slug]),
        googleRating: google, googleReviewCount: googleCount || null, googleSyncedAt: google ? new Date() : null,
        description: claimed ? `${name} ב${city.name}. ${cats.map(c => c.name).join(' ו')}, עם מחירים גלויים ותורים מסודרים.` : null,
        categories: { create: cats.map(c => ({ categorySlug: c.slug })) },
      },
    });
    if (claimed) {
      let order = 0;
      for (const c of cats) {
        for (const [tn, price, dur, pt] of MENU[c.slug] ?? []) {
          await db.treatment.create({
            data: {
              branchId: branch.id, categorySlug: c.slug, name: tn, priceType: pt, priceAgorot: price * 100, durationMin: dur,
              isMedical: c.isMedical, onlineBookable: !c.isMedical, requiresDeclaration: c.isMedical, sortOrder: order++,
            },
          });
        }
      }
      const nReviews = i % 3 === 0 ? 3 : i % 3 === 1 ? 1 : 0;
      for (let r = 0; r < nReviews; r++) {
        const [author, rating, title, body] = REVIEWS[(i + r) % REVIEWS.length];
        await db.review.create({
          data: {
            branchId: branch.id, authorName: author, rating, title, body, status: 'published',
            treatmentName: MENU[cats[0].slug]?.[0]?.[0] ?? null, createdAt: new Date(Date.now() - (r + 1) * 9 * 86_400_000),
          },
        });
      }
    }
    created++;
  }
  console.log(`demo: ${created} businesses added`);
}


// ---------- Phase 4 demo: practitioners, deposit policies, sandbox payments ----------
// Every live demo business gets bookable staff and a sandbox payment + invoicing connection,
// so booking, deposits, refunds and gift cards can be tried end to end without real providers.

const PRACTITIONER_NAMES = ['מאיה כהן', 'רוני לוי', 'שירן אזולאי', 'דנה ברק', 'הילה מזרחי', 'נועם פרץ'];
const DOCTOR_NAMES = ['ד״ר יעל שמיר', 'ד״ר אורי בן דוד', 'ד״ר מיכל רוזן'];

async function phase4() {
  const businesses = await db.business.findMany({
    where: { status: 'live' },
    include: { branches: { include: { categories: { include: { category: true } } } }, staff: true, depositPolicy: true },
  });
  let i = 0;
  for (const biz of businesses) {
    const branch = biz.branches[0];
    if (!branch) continue;
    const medical = branch.categories.some(c => c.category.isMedical);
    const cosmetic = branch.categories.some(c => !c.category.isMedical);
    const practitioners = biz.staff.filter(s => ['doctor', 'nurse', 'cosmetician', 'technician'].includes(s.profession) && s.status === 'active');

    if (cosmetic && !practitioners.some(s => s.profession === 'cosmetician' || s.profession === 'technician')) {
      for (let k = 0; k < 2; k++) {
        await db.staffMember.create({ data: { businessId: biz.id, displayName: PRACTITIONER_NAMES[(i + k) % PRACTITIONER_NAMES.length], profession: 'cosmetician', preset: 'practitioner', branchIds: [branch.id] } });
      }
    }
    if (medical && !branch.medicalResponsibleId) {
      const license = await db.license.create({ data: { kind: 'doctor', number: String(30000 + i * 17), nameOnRecord: DOCTOR_NAMES[i % DOCTOR_NAMES.length].replace('ד״ר ', ''), status: 'verified', verifiedAt: new Date(), nextCheckAt: new Date(Date.now() + 90 * 86_400_000), source: 'moh_doctors' } });
      const doc = await db.staffMember.create({ data: { businessId: biz.id, displayName: DOCTOR_NAMES[i % DOCTOR_NAMES.length], profession: 'doctor', preset: 'practitioner', branchIds: [branch.id], licenseId: license.id } });
      await db.branch.update({ where: { id: branch.id }, data: { medicalResponsibleId: doc.id } });
    }
    if (!biz.depositPolicy) {
      // Mix of policies so every deposit path is visible in the demo.
      const variant = i % 3;
      await db.depositPolicy.create({
        data: variant === 0
          ? { businessId: biz.id, enabled: false }
          : variant === 1
            ? { businessId: biz.id, enabled: true, mode: 'fixed', value: 10000, scope: 'all', refundWindowHours: 24 }
            : { businessId: biz.id, enabled: true, mode: 'percent', value: 20, scope: 'all', refundWindowHours: 48 },
      });
    }
    const plan = biz.depositPolicy?.enabled === false || i % 3 === 0 ? 'basic' : 'advanced';
    await db.subscription.upsert({
      where: { businessId: biz.id },
      create: { businessId: biz.id, plan, pricePerBranchAgorot: plan === 'basic' ? 14900 : 24900 },
      update: {},
    });
    for (const kind of ['payments', 'invoicing'] as const) {
      await db.providerConnection.upsert({
        where: { businessId_kind_provider: { businessId: biz.id, kind, provider: 'sandbox' } },
        create: { businessId: biz.id, kind, provider: 'sandbox', credentialsEnc: seal({}), status: 'connected', label: 'סביבת בדיקה' },
        update: {},
      });
    }
    i++;
  }
  console.log(`demo phase 4: ${i} businesses bookable`);
}

main()
  .then(phase4)
  .finally(() => db.$disconnect());
