import type { Metadata, Viewport } from 'next';
import { Assistant, Frank_Ruhl_Libre, Jost, Open_Sans } from 'next/font/google';
import { CookieConsent } from '@/components/cookie-consent/CookieConsent';
import { AppShell } from '@/components/shell/AppShell';
import './globals.css';

// Titles use Open Sans (variable weight). Frank Ruhl Libre stays only for the drawn signature in SignaturePad, so it is not preloaded.
const openSans = Open_Sans({ subsets: ['hebrew', 'latin'], variable: '--font-open-sans', display: 'swap' });
const frank = Frank_Ruhl_Libre({ subsets: ['hebrew', 'latin'], weight: ['500'], variable: '--font-frank', display: 'swap', preload: false });
const assistant = Assistant({ subsets: ['hebrew', 'latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-assistant', display: 'swap' });
const jost = Jost({ subsets: ['latin'], weight: ['300', '400'], variable: '--font-jost', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL('https://beautyfind.co.il'),
  title: { default: 'BeautyFind', template: '%s | BeautyFind' },
  applicationName: 'BeautyFind',
  // Shared share-card defaults; every public page sets its own title, description and image on top (src/lib/seo/meta.ts).
  openGraph: { type: 'website', locale: 'he_IL', siteName: 'BeautyFind', images: ['/assets/hero-clinic.jpg'] },
  twitter: { card: 'summary_large_image', images: ['/assets/hero-clinic.jpg'] },
  appleWebApp: { capable: true, title: 'BeautyFind', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover', // content under the notch is padded with env(safe-area-inset-*)
  interactiveWidget: 'resizes-content', // the on-screen keyboard shrinks the layout, so sticky bars stay visible
  themeColor: '#FFFFFF',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${openSans.variable} ${frank.variable} ${assistant.variable} ${jost.variable}`}>
      <body>
        {process.env.STAGING === '1' && (
          <div role="note" style={{ padding: '6px 16px', background: 'var(--navy)', color: '#fff', fontSize: 13, fontWeight: 700, textAlign: 'center' }}>
            סביבת בדיקה · הנתונים והעסקים באתר הזה לדוגמה בלבד
          </div>
        )}
        {children}
        <AppShell />
        <CookieConsent />
      </body>
    </html>
  );
}
