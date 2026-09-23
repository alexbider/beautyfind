import type { Metadata, Viewport } from 'next';
import { Assistant, Frank_Ruhl_Libre, Jost } from 'next/font/google';
import { CookieConsent } from '@/components/cookie-consent/CookieConsent';
import './globals.css';

const frank = Frank_Ruhl_Libre({ subsets: ['hebrew', 'latin'], weight: ['400', '500', '700'], variable: '--font-frank', display: 'swap' });
const assistant = Assistant({ subsets: ['hebrew', 'latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-assistant', display: 'swap' });
const jost = Jost({ subsets: ['latin'], weight: ['300', '400'], variable: '--font-jost', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL('https://beautyfind.co.il'),
  title: { default: 'BeautyFind', template: '%s | BeautyFind' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${frank.variable} ${assistant.variable} ${jost.variable}`}>
      <body>
        {children}
        <CookieConsent />
      </body>
    </html>
  );
}
