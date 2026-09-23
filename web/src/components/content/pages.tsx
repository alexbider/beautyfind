import 'server-only';

import { listingCounts } from '@/lib/server/public';
import { ROUTES } from '@/lib/routes';
import { ContentPage, type Crumb } from './ContentPage';
import { ABOUT_TABS, ABOUT_VIEWS, LIVE_COUNT, type AboutKey } from './data/about';
import { LEGAL_TABS, LEGAL_VIEWS, type LegalKey } from './data/legal';
import { SPONSORSHIP_FAQS, STANDARDS_TABS, STANDARDS_VIEWS, type StandardsKey } from './data/standards';
import { COMPANY, DOC_UPDATED, formatDate } from './meta';
import { breadcrumbJsonLd, faqJsonLd, organizationJsonLd } from './seo';
import type { ContentView, Stat } from './types';
import styles from './content.module.css';

/** Live listing total for the hero stats. A database hiccup shows an ellipsis instead of failing the page. */
async function liveStats(stats: Stat[]): Promise<Stat[]> {
  if (!stats.some(s => s.value === LIVE_COUNT)) return stats;
  let value = '…';
  try {
    value = (await listingCounts()).total.toLocaleString('en-US');
  } catch {
    // Keep the ellipsis; the rest of the page is static.
  }
  return stats.map(s => (s.value === LIVE_COUNT ? { ...s, value } : s));
}

function Effective({ date, version, label }: { date: string; version: string; label: string }) {
  return (
    <p className={styles.effective}>
      {label} <time dateTime={date} className="ltr">{formatDate(date)}</time> · גרסה <span className="ltr">{version}</span>
    </p>
  );
}

export async function AboutPage({ view: key }: { view: AboutKey }) {
  const view = ABOUT_VIEWS[key];
  const crumbs: Crumb[] = [{ name: 'ראשי', href: '/' }, { name: 'אודות', href: '/about' }];
  if (key !== 'about') crumbs.push({ name: view.name });
  const jsonLd: object[] = [breadcrumbJsonLd(crumbs, view.href)];
  if (key === 'about') jsonLd.unshift(organizationJsonLd(view.description));
  return (
    <ContentPage
      variant="content"
      crumbs={crumbs}
      tabs={ABOUT_TABS}
      view={view as ContentView}
      stats={await liveStats(view.stats)}
      statsLabel="במספרים"
      tocTitle="בעמוד הזה"
      tocLabel="בעמוד הזה"
      jsonLd={jsonLd}
    />
  );
}

export async function StandardsPage({ view: key }: { view: StandardsKey }) {
  const view = STANDARDS_VIEWS[key];
  const crumbs: Crumb[] = [{ name: 'ראשי', href: '/' }, { name: 'לעסקים', href: ROUTES.forBusiness }, { name: view.name }];
  const jsonLd: object[] = [breadcrumbJsonLd(crumbs, view.href)];
  if (key === 'sponsorship') jsonLd.push(faqJsonLd(SPONSORSHIP_FAQS));
  const { date, version } = DOC_UPDATED.standards;
  return (
    <ContentPage
      variant="content"
      crumbs={crumbs}
      tabs={STANDARDS_TABS}
      view={view as ContentView}
      stats={await liveStats(view.stats)}
      introExtra={<Effective label="עודכן לאחרונה" date={date} version={version} />}
      statsLabel="במספרים"
      tocTitle="בעמוד הזה"
      tocLabel="בעמוד הזה"
      jsonLd={jsonLd}
    />
  );
}

export function LegalPage({ view: key }: { view: LegalKey }) {
  const view = LEGAL_VIEWS[key];
  const crumbs: Crumb[] = [{ name: 'ראשי', href: '/' }, { name: view.name }];
  const { date, version } = DOC_UPDATED[key];
  return (
    <ContentPage
      variant="legal"
      crumbs={crumbs}
      tabs={LEGAL_TABS}
      view={view as ContentView}
      introExtra={
        key === 'accessibility' ? (
          <p className={styles.effective}>
            ההצהרה עודכנה לאחרונה ב־<time dateTime={date} className="ltr">{formatDate(date)}</time> · גרסה <span className="ltr">{version}</span>
            {' · '}
            בדיקת נגישות אחרונה:{' '}
            {COMPANY.accessibilityReviewedAt ? (
              <time dateTime={COMPANY.accessibilityReviewedAt} className="ltr">{formatDate(COMPANY.accessibilityReviewedAt)}</time>
            ) : (
              <mark className={styles.pending}>יעודכן לפני העלייה לאוויר</mark>
            )}
          </p>
        ) : undefined
      }
      statsLabel="פרטי המסמך"
      tocTitle="סעיפים"
      tocLabel="סעיפי המסמך"
      jsonLd={[breadcrumbJsonLd(crumbs, view.href)]}
    />
  );
}
