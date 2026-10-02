import { contentMetadata } from '@/components/content/seo';
import { applySeo } from '@/lib/server/seo';
import { STANDARDS_VIEWS } from '@/components/content/data/standards';
import { StandardsPage } from '@/components/content/pages';

// Design: project/BeautyFind Standards.dc.html (view=sponsorship). FAQPage JSON-LD is emitted by StandardsPage.

export const generateMetadata = () => applySeo('/listing-standards/sponsorship', contentMetadata(STANDARDS_VIEWS.sponsorship));

export default function Page() {
  return <StandardsPage view="sponsorship" />;
}
