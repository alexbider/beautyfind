// Sample-data gallery shared by seed.ts and seed-demo.ts: 7 photos after the cover, so every sample
// profile shows the full photo grid (8 photos). Never used for real businesses.
const GALLERY_POOL: Array<[string, string]> = [
  ['/assets/hero-clinic.jpg', 'חדר הטיפולים'],
  ['/assets/biz-medical.jpg', 'טיפול אסתטי בקליניקה'],
  ['/assets/biz-facial.jpg', 'טיפול פנים'],
  ['/assets/biz-laser.jpg', 'טיפול בלייזר'],
  ['/assets/biz-spa.jpg', 'חדר העיסויים'],
  ['/assets/biz-hair.jpg', 'עמדות העיצוב'],
  ['/assets/biz-nails.jpg', 'עמדת הציפורניים'],
  ['/assets/hero-consult.jpg', 'פגישת ייעוץ'],
  ['/assets/hero-skin.jpg', 'טיפוח העור'],
];
export const demoGallery = (cover: string) =>
  GALLERY_POOL.filter(([url]) => url !== cover).slice(0, 7).map(([url, alt]) => ({ url, alt, tag: 'הקליניקה' }));

