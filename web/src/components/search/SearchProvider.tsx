'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from 'react';
import { searchHref, type SearchState, type ViewKey } from './params';

type FocusTarget = 'results' | { card: number };

interface SearchCtx {
  /** URL state, optimistically updated the moment a control changes. */
  state: SearchState;
  /** Total matches for the state the server last rendered. */
  total: number;
  /** A server render for a new URL is in flight. */
  pending: boolean;
  /** The pending render only adds cards ("load more" or infinite scroll): the list stays as it is. */
  loadingMore: boolean;
  /** Changes URL state (router.replace, no scroll). Resets "load more" unless `page` is given. */
  update: (patch: Partial<SearchState>, opts?: { focus?: FocusTarget }) => void;
  view: ViewKey;
  setView: (v: ViewKey) => void;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
}

const Ctx = createContext<SearchCtx | null>(null);

export function useSearch() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSearch outside SearchProvider');
  return c;
}

/**
 * Client state for the search page. The server page owns the data; this only turns control
 * changes into URL changes (inside a transition, so the old results stay on screen, dimmed,
 * until the new ones arrive) and moves focus once they land.
 */
export function SearchProvider({ state: serverState, total, children }: { state: SearchState; total: number; children: React.ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setOptimistic] = useOptimistic(serverState);
  // The view is presentation only: switching it rewrites the URL without a server round trip.
  const [view, setViewState] = useState<ViewKey>(serverState.view);
  const [panelOpen, setPanelOpen] = useState(false);
  const [more, setMore] = useState(false);
  const focusRef = useRef<FocusTarget | null>(null);

  const update = useCallback(
    (patch: Partial<SearchState>, opts?: { focus?: FocusTarget }) => {
      const next: SearchState = { ...state, ...patch, view, page: patch.page ?? 1 };
      focusRef.current = opts?.focus ?? null;
      setMore(Object.keys(patch).length === 1 && patch.page != null);
      startTransition(() => {
        setOptimistic(next);
        router.replace(searchHref(next), { scroll: false });
      });
    },
    [state, view, router, setOptimistic],
  );

  const setView = useCallback(
    (v: ViewKey) => {
      setViewState(v);
      try {
        window.history.replaceState(null, '', searchHref({ ...state, view: v }));
      } catch {}
    },
    [state],
  );

  // Focus management: after a change that removes the control the user was on (clear all,
  // removing an active chip) focus goes to the results heading; after "load more" it goes to
  // the first new card. Toggling a chip keeps focus on the chip.
  useEffect(() => {
    if (pending || !focusRef.current) return;
    const target = focusRef.current;
    focusRef.current = null;
    requestAnimationFrame(() => {
      const el =
        target === 'results'
          ? document.getElementById('h-results')
          : document.querySelector<HTMLElement>(`[data-card-index="${target.card}"] h3 a`);
      el?.focus();
    });
  }, [pending, serverState]);

  const value = useMemo<SearchCtx>(
    () => ({ state, total, pending, loadingMore: pending && more, update, view, setView, panelOpen, setPanelOpen }),
    [state, total, pending, more, update, view, setView, panelOpen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
