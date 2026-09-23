import type { Metadata, Viewport } from 'next';
import { Assistant, Frank_Ruhl_Libre, Jost } from 'next/font/google';
import { CookieConsent } from '@/components/cookie-consent/CookieConsent';
import { AppShell } from '@/components/shell/AppShell';
import './globals.css';

const frank = Frank_Ruhl_Libre({ subsets: ['hebrew', 'latin'], weight: ['400', '500', '700'], variable: '--font-frank', display: 'swap' });
const assistant = Assistant({ subsets: ['hebrew', 'latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-assistant', display: 'swap' });
const jost = Jost({ subsets: ['latin'], weight: ['300', '400'], variable: '--font-jost', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL('https://beautyfind.co.il'),
  title: { default: 'BeautyFind', template: '%s | BeautyFind' },
  applicationName: 'BeautyFind',
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
    <html lang="he" dir="rtl" className={`${frank.variable} ${assistant.variable} ${jost.variable}`}>
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
