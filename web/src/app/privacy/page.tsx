import { contentMetadata } from '@/components/content/seo';
import { applySeo } from '@/lib/server/seo';
import { LEGAL_VIEWS } from '@/components/content/data/legal';
import { LegalPage } from '@/components/content/pages';

// Design: project/BeautyFind Legal.dc.html (view=privacy). Copy lives in components/content/data/legal.ts.

export const generateMetadata = () => applySeo('/privacy', contentMetadata(LEGAL_VIEWS.privacy));

export default function Page() {
  return <LegalPage view="privacy" />;
}
