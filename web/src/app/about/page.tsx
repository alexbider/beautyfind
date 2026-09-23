import { contentMetadata } from '@/components/content/seo';
import { ABOUT_VIEWS } from '@/components/content/data/about';
import { AboutPage } from '@/components/content/pages';

// Design: project/BeautyFind About.dc.html (view=about)

export const revalidate = 3600;
export const metadata = contentMetadata(ABOUT_VIEWS.about);

export default function Page() {
  return <AboutPage view="about" />;
}
