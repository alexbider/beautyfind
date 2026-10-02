import { contentMetadata } from '@/components/content/seo';
import { applySeo } from '@/lib/server/seo';
import { STANDARDS_VIEWS } from '@/components/content/data/standards';
import { StandardsPage } from '@/components/content/pages';

// Design: project/BeautyFind Standards.dc.html (view=standards)

export const revalidate = 3600;
export const generateMetadata = () => applySeo('/listing-standards', contentMetadata(STANDARDS_VIEWS.standards));

export default function Page() {
  return <StandardsPage view="standards" />;
}
