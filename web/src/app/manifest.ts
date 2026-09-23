import type { MetadataRoute } from 'next';

// Web app manifest (responsive spec §5). Links under the scope, including /b/:token, /w/:token,
// /review/:token and /invite/:token, open in the installed app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'BeautyFind',
    short_name: 'BeautyFind',
    description: 'קליניקות יופי ואסתטיקה מאומתות, ביקורות אמיתיות וקביעת תור אונליין.',
    lang: 'he',
    dir: 'rtl',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: '#FFFFFF',
    background_color: '#F6F8F9',
    categories: ['lifestyle', 'health', 'beauty'],
    icons: [
      { src: '/icons/192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'חיפוש קליניקה', url: '/search', icons: [{ src: '/icons/192.png', sizes: '192x192' }] },
      { name: 'התורים שלי', url: '/account', icons: [{ src: '/icons/192.png', sizes: '192x192' }] },
    ],
  };
}
