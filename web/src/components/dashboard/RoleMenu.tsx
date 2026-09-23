'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setPreviewRole } from './actions';
import styles from './RoleMenu.module.css';

type Opt = { key: string; name: string; sub: string };

/**
 * Shows the signed-in role. Owners can preview what each role sees (design: "מחובר/ת כ־").
 * The preview only narrows permissions; server actions still check the real role.
 */
export function RoleMenu({ current, canPreview, options }: { current: string; canPreview: boolean; options: Opt[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const cur = options.find(o => o.key === current) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const pick = (key: string) => {
    setOpen(false);
    start(async () => {
      await setPreviewRole(key);
      router.push('/biz');
      router.refresh();
    });
  };

  return (
    <div ref={ref} className={styles.wrap}>
      <button
        type="button"
        className={styles.btn}
        aria-expanded={canPreview ? open : undefined}
        aria-haspopup={canPreview ? 'menu' : undefined}
        onClick={() => canPreview && setOpen(o => !o)}
        disabled={pending}
      >
        <span aria-hidden="true" className={styles.initial}>{cur.name.slice(0, 1)}</span>
        <span className={styles.as}>מחובר/ת כ־</span>
        <span className={styles.name}>{cur.name}</span>
        {canPreview && (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 4.2 6 8.2l4-4" />
          </svg>
        )}
      </button>
      {open && (
        <div role="menu" className={styles.menu}>
          {options.map(o => {
            const on = o.key === current;
            return (
              <button key={o.key} type="button" role="menuitem" className={styles.item} data-on={on || undefined} onClick={() => pick(o.key)}>
                <span aria-hidden="true" className={styles.mark}>{on ? '✓' : ''}</span>
                <span className={styles.itemText}>
                  <span className={styles.itemName}>{o.name}</span>
                  <span className={styles.itemSub}>{o.sub}</span>
                </span>
              </button>
            );
          })}
          <span className={styles.note}>החלפת תפקיד מציגה בדיוק את מה שאותו משתמש רואה, לפי ההרשאות שנקבעו במסך צוות והרשאות.</span>
        </div>
      )}
    </div>
  );
}
