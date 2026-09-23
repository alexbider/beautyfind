import { contentMetadata } from '@/components/content/seo';
import { LEGAL_VIEWS } from '@/components/content/data/legal';
import { LegalPage } from '@/components/content/pages';

// Design: project/BeautyFind Legal.dc.html (view=accessibility). Copy lives in components/content/data/legal.ts.

export const metadata = contentMetadata(LEGAL_VIEWS.accessibility);

export default function Page() {
  return <LegalPage view="accessibility" />;
}
