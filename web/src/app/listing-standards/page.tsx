import { contentMetadata } from '@/components/content/seo';
import { STANDARDS_VIEWS } from '@/components/content/data/standards';
import { StandardsPage } from '@/components/content/pages';

// Design: project/BeautyFind Standards.dc.html (view=standards)

export const revalidate = 3600;
export const metadata = contentMetadata(STANDARDS_VIEWS.standards);

export default function Page() {
  return <StandardsPage view="standards" />;
}
