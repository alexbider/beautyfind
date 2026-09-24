'use client';

import { useEffect, useRef } from 'react';
import { Skeleton } from '@/components/shell/Skeleton';
import { SHELL_MQ } from '@/lib/ui/shell';
import { MAX_PAGE } from './params';
import { useSearch } from './SearchProvider';
import { useMedia } from './useMedia';
import s from './search.module.css';

/**
 * "Load more" raises the page param; the server renders page × perLoad cards, so the URL keeps the list length.
 * In the app shell the next page loads by itself when the end of the list scrolls into view, with
 * skeleton cards in place of the button (responsive spec §3.1); the button stays on desktop.
 */
export function LoadMore({ shown, total, perLoad }: { shown: number; total: number; perLoad: number }) {
  const { state, update, pending, loadingMore } = useSearch();
  const shell = useMedia(SHELL_MQ);
  const sentinel = useRef<HTMLDivElement>(null);
  const rest = Math.max(0, total - shown);
  const next = Math.min(perLoad, rest);
  const capped = state.page >= MAX_PAGE;
  const canLoad = rest > 0 && !capped;
  const pct = Math.round(Math.min(1, shown / Math.max(1, total)) * 100);
  const label = next === 1 ? 'הצגת תוצאה נוספת' : next === 2 ? 'הצגת שתי תוצאות נוספות' : `הצגת ${next} תוצאות נוספות`;

  useEffect(() => {
    const el = sentinel.current;
    if (!shell || !canLoad || pending || !el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && update({ page: state.page + 1 }), { rootMargin: '0px 0px 600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [shell, canLoad, pending, state.page, update]);

  if (total === 0) return null;
  return (
    <>
      {canLoad && (
        <div ref={sentinel} className={`${s.autoMore} bf-shell-only`} aria-hidden="true">
          {Array.from({ length: loadingMore || !shell ? Math.min(next, 2) : 1 }, (_, i) => (
            <div key={i} className={s.skelPhone}>
              <Skeleton height="auto" radius={16} className={s.skelPhoneImg} />
              <Skeleton width="58%" height={16} />
              <Skeleton width="38%" height={13} />
            </div>
          ))}
        </div>
      )}
      <div className={s.more}>
        {canLoad && (
          <button type="button" className={`${s.moreBtn} bf-desk-only`} disabled={pending} aria-busy={pending} onClick={() => update({ page: state.page + 1 }, { focus: { card: shown } })}>
            {pending ? 'טוענים…' : label}
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
    </>
  );
}
