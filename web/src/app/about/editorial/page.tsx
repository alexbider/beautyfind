import { contentMetadata } from '@/components/content/seo';
import { ABOUT_VIEWS } from '@/components/content/data/about';
import { AboutPage } from '@/components/content/pages';

// Design: project/BeautyFind About.dc.html (view=editorial)

export const metadata = contentMetadata(ABOUT_VIEWS.editorial);

export default function Page() {
  return <AboutPage view="editorial" />;
}
