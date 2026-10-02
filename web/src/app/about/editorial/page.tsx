import { contentMetadata } from '@/components/content/seo';
import { applySeo } from '@/lib/server/seo';
import { ABOUT_VIEWS } from '@/components/content/data/about';
import { AboutPage } from '@/components/content/pages';

// Design: project/BeautyFind About.dc.html (view=editorial)

export const generateMetadata = () => applySeo('/about/editorial', contentMetadata(ABOUT_VIEWS.editorial));

export default function Page() {
  return <AboutPage view="editorial" />;
}
