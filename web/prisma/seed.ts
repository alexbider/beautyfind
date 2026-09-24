import { PrismaClient, type RegionSlug } from '@prisma/client';
import { CATEGORIES, CITIES, GROUP_ORDER, REGIONS } from '../src/lib/catalog';
import { demoGallery } from './demo-gallery';

const db = new PrismaClient();

const HOURS_DEFAULT = [
  { open: '09:00', close: '19:00', closed: false },
  { open: '09:00', close: '19:00', closed: false },
  { open: '09:00', close: '19:00', closed: false },
  { open: '09:00', close: '20:00', closed: false },
  { open: '09:00', close: '20:00', closed: false },
  { open: '09:00', close: '13:00', closed: false },
  { open: '', close: '', closed: true },
];

// Existing listings a business can find and claim (the Claim design's sample set).
// Fictional names and numbers.
const LISTINGS: Array<{ name: string; slug: string; cat: string; city: string; phone: string; img: string; claimed: boolean; email?: string }> = [
  { name: 'שרון קליניק', slug: 'sharon-clinic', cat: 'medical-aesthetics', city: 'raanana', phone: '+97297482210', img: '/assets/biz-medical.jpg', claimed: false, email: 'info@sharon-clinic.co.il' },
  { name: 'סטודיו נחלת בנימין', slug: 'nachalat-binyamin-studio', cat: 'hair-salons', city: 'tel-aviv', phone: '+97235164420', img: '/assets/biz-hair.jpg', claimed: false },
  { name: 'פלורנטין סקין', slug: 'florentin-skin', cat: 'facials', city: 'tel-aviv', phone: '+97236827714', img: '/assets/biz-facial.jpg', claimed: true },
  { name: 'לייזר האוס פתח תקווה', slug: 'laser-house-petah-tikva', cat: 'hair-removal', city: 'petah-tikva', phone: '+97239305567', img: '/assets/biz-laser.jpg', claimed: false },
  { name: 'ניילס על הים', slug: 'nails-on-the-sea', cat: 'nails', city: 'tel-aviv', phone: '+97235279903', img: '/assets/biz-nails.jpg', claimed: false },
  { name: 'ספא הדרים', slug: 'hadarim-spa', cat: 'spa-massage', city: 'petah-tikva', phone: '+97239142288', img: '/assets/biz-spa.jpg', claimed: false },
  { name: 'כרמל אסתטיקה', slug: 'carmel-aesthetics', cat: 'medical-aesthetics', city: 'haifa', phone: '+97248551190', img: '/assets/hero-clinic.jpg', claimed: false, email: 'info@carmel-aesthetics.co.il' },
  { name: 'ביאליק ביוטי', slug: 'bialik-beauty', cat: 'facials', city: 'ramat-gan', phone: '+97236734401', img: '/assets/hero-skin.jpg', claimed: false },
];

async function main() {
  for (const [i, r] of REGIONS.entries()) {
    await db.region.upsert({ where: { slug: r.slug }, create: { slug: r.slug, name: r.name, sortOrder: i }, update: { name: r.name, sortOrder: i } });
  }
  for (const [i, ct] of CITIES.entries()) {
    await db.city.upsert({
      where: { slug: ct.slug },
      create: { slug: ct.slug, name: ct.name, regionSlug: ct.region as RegionSlug, sortOrder: i },
      update: { name: ct.name, regionSlug: ct.region as RegionSlug, sortOrder: i },
    });
  }
  for (const [i, cat] of CATEGORIES.entries()) {
    const data = { name: cat.name, groupName: cat.group, isMedical: cat.isMedical, sortOrder: GROUP_ORDER.indexOf(cat.group) * 100 + i };
    await db.category.upsert({ where: { slug: cat.slug }, create: { slug: cat.slug, ...data }, update: data });
  }

  for (const l of LISTINGS) {
    const city = await db.city.findUniqueOrThrow({ where: { slug: l.city } });
    const existing = await db.branch.findUnique({ where: { slug: l.slug } });
    if (existing) {
      if (l.email && !existing.email) await db.branch.update({ where: { id: existing.id }, data: { email: l.email } });
      if (Array.isArray(existing.gallery) && existing.gallery.length === 0) {
        await db.branch.update({ where: { id: existing.id }, data: { gallery: demoGallery(existing.coverUrl ?? l.img) } });
      }
      continue;
    }
    const biz = await db.business.create({ data: { status: 'live', type: CATEGORIES.find(c => c.slug === l.cat)?.isMedical ? 'clinic' : 'salon' } });
    await db.branch.create({
      data: {
        businessId: biz.id,
        name: l.name,
        slug: l.slug,
        regionSlug: city.regionSlug,
        cityId: city.id,
        cityName: city.name,
        address: city.name,
        phone: l.phone,
        email: l.email,
        hours: HOURS_DEFAULT,
        status: 'live',
        isClaimed: l.claimed,
        coverUrl: l.img,
        coverAlt: l.name,
        gallery: demoGallery(l.img),
        categories: { create: [{ categorySlug: l.cat }] },
      },
    });
  }
  console.log(`seeded ${REGIONS.length} regions, ${CITIES.length} cities, ${CATEGORIES.length} categories, ${LISTINGS.length} listings`);
}

main().finally(() => db.$disconnect());
