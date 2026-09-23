'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BOOKING_LIVE } from '@/lib/features';
import { relHe } from '@/components/profile/format';
import { setSaved, useSavedIds } from '../save-heart/SaveHeart';
import { Toast, useToast } from '../account/ui';
import { publicSavedCards } from './actions';
import { MAX_COMPARE, clinicsLabel, ratingText, type SavedCard } from './types';
import styles from './saved.module.css';

type Filter = 'all' | 'med' | 'cos' | 'online';
const FILTERS: Array<[Filter, string]> = [
  ['all', 'הכל'],
  ['med', 'אסתטיקה רפואית'],
  ['cos', 'קוסמטיקה ולייזר'],
  // Until booking is live no page may filter on it (lib/features.ts).
  ...(BOOKING_LIVE ? ([['online', 'קביעה אונליין']] as Array<[Filter, string]>) : []),
];

export const compareHref = (ids: string[]) => (ids.length ? `/saved/compare?ids=${ids.join(',')}` : '/saved/compare');

/** Segmented list / compare switcher shared by both views. */
export function SavedTabs({ current, cmp }: { current: 'list' | 'compare'; cmp: string[] }) {
  return (
    <nav aria-label="תצוגה" className={styles.tabs}>
      <Link href={cmp.length ? `/saved?ids=${cmp.join(',')}` : '/saved'} className={styles.tab} aria-current={current === 'list' ? 'page' : undefined}>
        שמורות
      </Link>
      <Link href={compareHref(cmp)} className={styles.tab} aria-current={current === 'compare' ? 'page' : undefined}>
        השוואה · <span className="ltr tnum">{cmp.length}</span>
      </Link>
    </nav>
  );
}

export function HeartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20.3s-7.3-4.4-9.2-9.1C1.5 7.9 3.6 4.5 7 4.5c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.4 0 5.5 3.4 4.2 6.7-1.9 4.7-9.2 9.1-9.2 9.1z" fill="currentColor" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Saved list (design "view: list"). Signed-in clients get server-rendered cards; guests read their
 * localStorage ids through the shared store and fetch public cards for them.
 */
export function SavedView({ initialCards, initialCmp, serverSignedIn }: { initialCards: SavedCard[]; initialCmp: string[]; serverSignedIn: boolean }) {
  const router = useRouter();
  const store = useSavedIds();
  const [cache, setCache] = useState<Map<string, SavedCard>>(() => new Map(initialCards.map(c => [c.id, c])));
  const [missing, setMissing] = useState<Set<string>>(new Set()); // ids the server did not return (no longer public)
  const [cmp, setCmp] = useState<string[]>(initialCmp.slice(0, MAX_COMPARE));
  const [filter, setFilter] = useState<Filter>('all');
  const { toast, show, hide } = useToast();
  const loading = useRef(false);

  // Until the store has checked the session, show what the server rendered.
  const ids = store.ready ? (store.signedIn ? store.ids : [...store.ids].reverse()) : initialCards.map(c => c.id);
  const signedIn = store.ready ? store.signedIn : serverSignedIn;

  useEffect(() => {
    const need = ids.filter(id => !cache.has(id) && !missing.has(id));
    if (!store.ready || !need.length || loading.current) return;
    loading.current = true;
    publicSavedCards(need)
      .then(cards => {
        setCache(prev => {
          const next = new Map(prev);
          cards.forEach(c => next.set(c.id, c));
          return next;
        });
        const got = new Set(cards.map(c => c.id));
        setMissing(prev => new Set([...prev, ...need.filter(id => !got.has(id))]));
      })
      .catch(() => setMissing(prev => new Set([...prev, ...need])))
      .finally(() => {
        loading.current = false;
      });
  }, [ids, cache, missing, store.ready]);

  const saved = useMemo(() => ids.flatMap(id => (cache.has(id) ? [cache.get(id)!] : [])), [ids, cache]);
  const pending = store.ready && ids.some(id => !cache.has(id) && !missing.has(id));
  const shown = saved.filter(c => filter === 'all' || (filter === 'med' && c.medical) || (filter === 'cos' && !c.medical) || (filter === 'online' && c.online));
  const cmpLive = cmp.filter(id => saved.some(c => c.id === id));
  const now = new Date();

  const unsave = (c: SavedCard) => {
    void setSaved(c.id, false).then(ok => {
      if (!ok) return show('לא הצלחנו להסיר. נסו שוב.');
      setCmp(x => x.filter(id => id !== c.id));
      show(`${c.name} הוסרה מהשמורות`, { label: 'ביטול', run: () => void setSaved(c.id, true) });
    });
  };

  const toggleCmp = (id: string) => setCmp(x => (x.includes(id) ? x.filter(y => y !== id) : x.length >= MAX_COMPARE ? x : [...x, id]));

  const trayText =
    cmpLive.length === 1 ? 'נבחרה קליניקה אחת · בחרו עוד אחת לפחות' : `${clinicsLabel(cmpLive.length)} להשוואה${cmpLive.length === MAX_COMPARE ? ' · מקסימום' : ''}`;

  return (
    <>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.h1}>קליניקות שמורות</h1>
          <p className={styles.sub}>
            {store.ready || initialCards.length ? `${saved.length === 1 ? 'קליניקה אחת שמורה' : `${clinicsLabel(saved.length)} שמורות`}. סמנו עד שלוש להשוואה.` : 'טוען את הרשימה…'}
          </p>
        </div>
        <SavedTabs current="list" cmp={cmpLive} />
      </div>

      {store.ready && !signedIn && (
        <p className={styles.guestNote}>
          הרשימה נשמרת בדפדפן הזה בלבד. <Link href="/login?next=/saved">התחברו</Link> כדי לשמור אותה בחשבון ולראות אותה בכל מכשיר.
        </p>
      )}

      <div className={styles.filters}>
        {FILTERS.map(([k, name]) => (
          <button key={k} type="button" className={styles.chip} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {name}
          </button>
        ))}
      </div>

      {store.ready && !pending && shown.length === 0 && (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>{saved.length ? 'אין קליניקות שמורות בסינון הזה' : 'אין כאן קליניקות שמורות'}</p>
          <p className={styles.emptyText}>לחצו על הלב בכל כרטיס קליניקה כדי לשמור אותה כאן ולהשוות מאוחר יותר.</p>
          {saved.length ? (
            <button type="button" className={styles.btnPrimary} onClick={() => setFilter('all')}>הצגת הכל</button>
          ) : (
            <Link href="/search" className={styles.btnPrimary}>לחיפוש קליניקות</Link>
          )}
        </div>
      )}

      <div className={styles.grid} aria-busy={pending || !store.ready || undefined}>
        {shown.map(c => {
          const on = cmp.includes(c.id);
          const locked = !on && cmpLive.length >= MAX_COMPARE;
          return (
            <article key={c.id} className={styles.card} data-cmp={on || undefined}>
              <div className={styles.media}>
                {c.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.coverUrl} alt={c.coverAlt} loading="lazy" className={styles.img} />
                ) : (
                  <span className={styles.ph} aria-hidden="true">{c.name}</span>
                )}
                <button type="button" className={styles.unsave} aria-pressed="true" aria-label={`הסרת ${c.name} מהשמורות`} onClick={() => unsave(c)}>
                  <HeartIcon />
                </button>
              </div>
              <div className={styles.body}>
                <span className={styles.nameRow}>
                  <Link href={c.href} className={styles.name}>{c.name}</Link>
                </span>
                <span className={styles.meta}>{[c.cats, c.city].filter(Boolean).join(' · ')}</span>
                <span className={styles.ratings}>
                  {c.google && (
                    <span>
                      Google <span className="ltr tnum">★ {ratingText(c.google.rating)}</span> <span className={styles.count}>(<span className="ltr tnum">{c.google.count.toLocaleString('en-US')}</span>)</span>
                    </span>
                  )}
                  {c.beautyfind && (
                    <span>
                      BeautyFind <span className="ltr tnum">★ {ratingText(c.beautyfind.rating)}</span> <span className={styles.count}>(<span className="ltr tnum">{c.beautyfind.count.toLocaleString('en-US')}</span>)</span>
                    </span>
                  )}
                  {!c.google && !c.beautyfind && <span className={styles.count}>עדיין אין דירוג</span>}
                </span>
                {c.responsible && <span className={styles.note}>{c.responsible}</span>}
                {c.savedIso && <span className={styles.savedAt}>נשמרה {relHe(new Date(c.savedIso), now)}</span>}
              </div>
              <div className={styles.foot}>
                <button type="button" role="checkbox" aria-checked={on} aria-disabled={locked || undefined} className={styles.cmpToggle} onClick={() => !locked && toggleCmp(c.id)}>
                  <span className={styles.box} aria-hidden="true">{on ? '✓' : ''}</span>
                  <span>להשוואה</span>
                </button>
                <Link href={c.bookHref} className={styles.cta}>{c.bookLabel}</Link>
              </div>
            </article>
          );
        })}
        {(!store.ready || pending) && !shown.length && [0, 1, 2].map(i => <div key={i} className={styles.skeleton} aria-hidden="true" />)}
      </div>

      {cmpLive.length > 0 && (
        <div role="region" aria-label="סל השוואה" className={styles.tray}>
          <span className={styles.trayText}>{trayText}</span>
          <button type="button" className={styles.trayClear} onClick={() => setCmp([])}>ניקוי</button>
          <button type="button" className={styles.trayGo} disabled={cmpLive.length < 2} onClick={() => router.push(compareHref(cmpLive))}>
            השוואה
          </button>
        </div>
      )}

      <Toast toast={toast} onHide={hide} raised={cmpLive.length > 0} />
    </>
  );
}
