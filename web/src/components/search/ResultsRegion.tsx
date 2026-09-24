'use client';

import { MAP_VIEW } from './params';
import { useSearch } from './SearchProvider';
import s from './search.module.css';

/**
 * Wraps the server-rendered result list: applies the list / grid / map view, dims the old
 * results while a new URL renders, and shows the map placeholder.
 */
export function ResultsRegion({ hasResults, children }: { hasResults: boolean; children: React.ReactNode }) {
  const { view, pending, loadingMore } = useSearch();
  const mapOn = MAP_VIEW && view === 'map';
  // Adding cards keeps the list as it is (the skeletons under it show the loading).
  const dim = pending && !loadingMore;
  return (
    <div className={s.resultsRegion} data-view={view} data-pending={dim || undefined} aria-busy={pending}>
      {dim && (
        <p className={s.loadingLine} aria-hidden="true">
          <span className={s.spinner} />
          <span>טוענים תוצאות…</span>
        </p>
      )}
      {mapOn && hasResults && (
        // TODO(map): Branch.lat / Branch.lng are still empty. Once businesses add their location,
        // render pins here (rating label per pin, same order as the list below). No map provider yet.
        <figure className={s.map}>
          <span aria-hidden="true" className={s.mapGrid} />
          <figcaption className={s.mapEmpty}>
            <span aria-hidden="true" className={s.mapIcon}>
              <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 14.5s4.8-4.2 4.8-7.7A4.8 4.8 0 0 0 3.2 6.8C3.2 10.3 8 14.5 8 14.5Z" />
                <path d="M8 8.6a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6" />
              </svg>
            </span>
            <span className={s.mapTitle}>המפה תופיע כשהעסקים יוסיפו את המיקום שלהם</span>
            <span className={s.mapBody}>אנחנו אוספים כתובות מדויקות מהעסקים עצמם. בינתיים אפשר לסנן לפי אזור ועיר, והתוצאות מופיעות ברשימה למטה.</span>
          </figcaption>
        </figure>
      )}
      {children}
    </div>
  );
}
