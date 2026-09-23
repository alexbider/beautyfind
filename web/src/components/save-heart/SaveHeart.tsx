'use client';

import { useEffect, useState } from 'react';
import styles from './SaveHeart.module.css';

// Interim storage until client accounts and the SavedClinic table land (phase 4).
// Key and shape match the prototype: localStorage['bf-saved'] = [branchId, ...].
const KEY = 'bf-saved';
const EVENT = 'bf-saved-change';

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function useSaved(id: string) {
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const sync = () => setSaved(read().includes(id));
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [id]);
  const toggle = () => {
    const list = read();
    const next = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
    window.dispatchEvent(new Event(EVENT));
  };
  return { saved, toggle };
}

/**
 * Save heart (07-rules component spec): 44px circle, translucent white + blur, navy outline when off,
 * teal filled with a #CDEFF3 ring when on. Stops click propagation so it works inside a card link.
 */
export function SaveHeart({ id, name, className }: { id: string; name: string; className?: string }) {
  const { saved, toggle } = useSaved(id);
  return (
    <button
      type="button"
      className={`${styles.heart} ${className ?? ''}`}
      data-on={saved || undefined}
      aria-pressed={saved}
      aria-label={saved ? `הסרה מהשמורים: ${name}` : `שמירה: ${name}`}
      onClick={e => {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 20.3s-7.6-4.6-7.6-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.6 2.5c0 5.6-7.6 10.2-7.6 10.2z" />
      </svg>
    </button>
  );
}
