'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { haptic } from '../shell/haptics';
import { mergeLocalSaved, setSavedAction } from '../saved/actions';
import styles from './SaveHeart.module.css';

// Saved clinics store shared by every heart on the page (and by /saved).
// - Signed-in client: SavedClinic rows, read once via GET /saved/api, written via a server action.
// - Guest (or business account): localStorage['bf-saved'] = [branchId, ...], as in the prototype.
// On the first load as a signed-in client, any ids left in localStorage are merged into the
// account once and then cleared.

const KEY = 'bf-saved';
const EVENT = 'bf-saved-change';
const STALE_MS = 20_000;

export interface SavedSnapshot {
  ready: boolean; // the signed-in check has finished
  signedIn: boolean;
  ids: string[]; // newest first for accounts; insertion order for guests
}

const SERVER_SNAP: SavedSnapshot = { ready: false, signedIn: false, ids: [] };
let snap: SavedSnapshot = SERVER_SNAP;
let checkedAt = 0;
let inflight: Promise<void> | null = null;
let listening = false;
const subs = new Set<() => void>();

function readLocal(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeLocal(ids: string[]) {
  try {
    if (ids.length) localStorage.setItem(KEY, JSON.stringify(ids));
    else localStorage.removeItem(KEY);
  } catch {}
}

function setSnap(next: Partial<SavedSnapshot>) {
  snap = { ...snap, ...next };
  subs.forEach(f => f());
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

/** Re-checks who is signed in (and their saved ids). Deduplicated; cheap to call on mount. */
export function refreshSaved(force = false): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (!listening) {
    listening = true;
    window.addEventListener('storage', e => {
      if (e.key === KEY && !snap.signedIn) setSnap({ ids: readLocal() });
    });
  }
  if (inflight) return inflight;
  if (!force && snap.ready && Date.now() - checkedAt < STALE_MS) return Promise.resolve();
  if (!snap.ready) setSnap({ ids: readLocal() }); // show the browser list while checking
  inflight = (async () => {
    try {
      const res = await fetch('/saved/api', { cache: 'no-store', credentials: 'same-origin' });
      const j = res.ok ? ((await res.json()) as { signedIn?: boolean; ids?: string[] }) : null;
      if (!j?.signedIn) {
        setSnap({ ready: true, signedIn: false, ids: readLocal() });
      } else {
        let ids = Array.isArray(j.ids) ? j.ids : [];
        const local = readLocal();
        if (local.length) {
          const merged = await mergeLocalSaved(local);
          if (merged.ok) {
            writeLocal([]);
            ids = merged.ids;
          }
        }
        setSnap({ ready: true, signedIn: true, ids });
      }
    } catch {
      setSnap({ ready: true, signedIn: false, ids: readLocal() });
    } finally {
      checkedAt = Date.now();
      inflight = null;
    }
  })();
  return inflight;
}

/** Save (on = true) or unsave a branch. Optimistic; reverts if the server refuses. */
export async function setSaved(id: string, on: boolean): Promise<boolean> {
  if (!snap.ready) await refreshSaved();
  const before = snap.ids;
  const has = before.includes(id);
  if (has === on) return true;
  if (!snap.signedIn) {
    const local = readLocal().filter(x => x !== id);
    const next = on ? [...local, id] : local;
    writeLocal(next);
    setSnap({ ids: next });
    return true;
  }
  setSnap({ ids: on ? [id, ...before] : before.filter(x => x !== id) });
  try {
    const r = await setSavedAction(id, on);
    if (r.ok) return true;
    if (r.reason === 'signed_out') {
      // Session ended in another tab: fall back to the browser list.
      await refreshSaved(true);
      return setSaved(id, on);
    }
  } catch {}
  setSnap({ ids: before });
  return false;
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

/** The whole saved list. */
export function useSavedIds(): SavedSnapshot {
  const s = useSyncExternalStore(subscribe, () => snap, () => SERVER_SNAP);
  useEffect(() => {
    void refreshSaved();
  }, []);
  return s;
}

/** Toggle is optimistic (the store flips first); resolves false when the server refused and it rolled back. */
export function useSaved(id: string) {
  const { ids } = useSavedIds();
  const saved = ids.includes(id);
  return { saved, toggle: () => setSaved(id, !saved) };
}

/**
 * Save heart (07-rules component spec): 44px circle, translucent white + blur, navy outline when off,
 * teal filled with a #CDEFF3 ring when on. Stops click propagation so it works inside a card link.
 * Instant feedback (light haptic, optimistic fill); a refused write rolls back with a toast above the bars.
 */
export function SaveHeart({ id, name, className }: { id: string; name: string; className?: string }) {
  const { saved, toggle } = useSaved(id);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    haptic('light');
    const wasSaved = saved;
    void toggle().then(ok => {
      if (ok) return;
      if (timer.current) clearTimeout(timer.current);
      setToast(wasSaved ? 'לא הצלחנו להסיר מהמועדפים. נסו שוב.' : 'לא הצלחנו להוסיף למועדפים. נסו שוב.');
      timer.current = setTimeout(() => setToast(null), 3200);
    });
  };

  return (
    <>
      <button
        type="button"
        className={`${styles.heart} ${className ?? ''}`}
        data-on={saved || undefined}
        aria-pressed={saved}
        aria-label={saved ? `הסרה מהמועדפים: ${name}` : `הוספה למועדפים: ${name}`}
        onClick={onClick}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 20.3s-7.6-4.6-7.6-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.6 2.5c0 5.6-7.6 10.2-7.6 10.2z" />
        </svg>
      </button>
      {/* Portal: a heart inside a transformed card would otherwise position the toast against the card. */}
      {toast &&
        createPortal(
          <div className={styles.toastWrap} role="status" aria-live="polite">
            <div className={styles.toast}>{toast}</div>
          </div>,
          document.body,
        )}
    </>
  );
}
