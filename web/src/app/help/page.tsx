import type { Metadata } from 'next';
import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { ROUTES } from '@/lib/routes';
import { isAudience, type Audience } from './content';
import { HelpCenter } from './HelpCenter';
import styles from './page.module.css';

// Design: project/BeautyFind Help.dc.html

export const metadata: Metadata = {
  title: 'מרכז עזרה',
  description:
    'מרכז העזרה של BeautyFind: שאלות נפוצות ללקוחות ולעסקים על תורים, מקדמות, ביקורות, שוברים, חשבוניות, פרטיות ורישום עסק.',
  alternates: { canonical: ROUTES.help },
};

export default async function HelpPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const audience: Audience = isAudience(sp.audience) ? sp.audience : 'client';
  const q = typeof sp.q === 'string' ? sp.q.slice(0, 80) : '';

  return (
    <div className={styles.root}>
      <SiteHeader variant="public" />
      <HelpCenter key={audience} initialAudience={audience} initialQuery={q} />
      <SiteFooter wide note="מידע כללי בלבד, לא ייעוץ רפואי" />
    </div>
  );
}
