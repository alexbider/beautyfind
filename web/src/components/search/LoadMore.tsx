'use client';

import { MAX_PAGE } from './params';
import { useSearch } from './SearchProvider';
import s from './search.module.css';

/** "Load more" raises the page param; the server renders page × perLoad cards, so the URL keeps the list length. */
export function LoadMore({ shown, total, perLoad }: { shown: number; total: number; perLoad: number }) {
  const { state, update, pending } = useSearch();
  const rest = Math.max(0, total - shown);
  const next = Math.min(perLoad, rest);
  const capped = state.page >= MAX_PAGE;
  const pct = Math.round(Math.min(1, shown / Math.max(1, total)) * 100);
  const label = next === 1 ? 'הצגת תוצאה נוספת' : next === 2 ? 'הצגת שתי תוצאות נוספות' : `הצגת ${next} תוצאות נוספות`;

  if (total === 0) return null;
  return (
    <div className={s.more}>
      {rest > 0 && !capped && (
        <button type="button" className={s.moreBtn} disabled={pending} aria-busy={pending} onClick={() => update({ page: state.page + 1 }, { focus: { card: shown } })}>
          {pending ? 'טוען…' : label}
        </button>
      )}
      <div role="presentation" className={s.progress}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <span className={s.shownLine}>
        <span className="ltr tnum">{shown}</span> מתוך <span className="ltr tnum">{total}</span>
      </span>
      {rest > 0 && capped && <p className={s.cappedNote}>כדי לראות עוד עסקים, צמצמו את החיפוש לאזור, לעיר או לתחום טיפול.</p>}
    </div>
  );
}
