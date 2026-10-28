// The marketing services catalog (BeautyFind for Business), in display order. Copy lives in ./services.

import { branding } from './services/branding';
import { contentCreative } from './services/content-creative';
import { geo } from './services/geo';
import { googleAds } from './services/google-ads';
import { leadGeneration } from './services/lead-generation';
import { seo } from './services/seo';
import { socialAds } from './services/social-ads';
import { socialVideos } from './services/social-videos';
import { websites } from './services/websites';
import type { MarketingService, ServiceSlug } from './types';

// Every service has a short silent explainer loop next to its hero image (public/assets/marketing, made with Higgsfield).
const withVideo = (s: MarketingService): MarketingService =>
  s.heroVideo ? s : { ...s, heroVideo: { src: `/assets/marketing/${s.slug}.mp4`, poster: s.heroImage.src, label: `סרטון קצר: ${s.name} לעסקי יופי` } };

export const SERVICES: MarketingService[] = [socialAds, leadGeneration, googleAds, seo, geo, websites, branding, socialVideos, contentCreative].map(withVideo);

const BY_SLUG = new Map<ServiceSlug, MarketingService>(SERVICES.map(s => [s.slug, s]));

export function getService(slug: ServiceSlug): MarketingService {
  const s = BY_SLUG.get(slug);
  if (!s) throw new Error(`unknown marketing service ${slug}`);
  return s;
}

/** Groups for the hub page. */
export const SERVICE_GROUPS: Array<{ title: string; line: string; slugs: ServiceSlug[] }> = [
  { title: 'להביא לקוחות עכשיו', line: 'קמפיינים ממומנים ומערכות לידים שממלאות את היומן כבר בחודש הראשון.', slugs: ['social-ads', 'lead-generation', 'google-ads'] },
  { title: 'להופיע כשמחפשים אתכם', line: 'נוכחות בגוגל, בגוגל מפות ובתשובות של מנועי AI, שממשיכה לעבוד לאורך זמן.', slugs: ['seo', 'geo', 'websites'] },
  { title: 'להיראות כמו שאתם באמת', line: 'מיתוג, סרטונים ותוכן שמראים את העבודה שלכם בצורה הכי טובה.', slugs: ['branding', 'social-videos', 'content-creative'] },
];
