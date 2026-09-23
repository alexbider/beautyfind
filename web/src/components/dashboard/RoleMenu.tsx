'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BottomSheet } from '../shell/BottomSheet';
import { setPreviewRole } from './actions';
import { useSheetMode } from './media';
import styles from './RoleMenu.module.css';

export type RoleOpt = { key: string; name: string; sub: string };

export const ROLE_NOTE = 'החלפת תפקיד מציגה בדיוק את מה שאותו משתמש רואה, לפי ההרשאות שנקבעו במסך צוות והרשאות.';

/** Owner preview: switch the dashboard to what another role sees. Shared by the desktop menu and the phone switcher sheet. */
export function usePreviewRole() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const pick = (key: string, after?: () => void) => {
    after?.();
    start(async () => {
      await setPreviewRole(key);
      router.push('/biz');
      router.refresh();
    });
  };
  return { pending, pick };
}

/** The role list itself: a menu inside the desktop dropdown, radio rows inside a sheet. */
export function RoleOptions({ options, current, onPick, asMenu }: { options: RoleOpt[]; current: string; onPick: (key: string) => void; asMenu?: boolean }) {
  return (
    <div role={asMenu ? undefined : 'radiogroup'} aria-label={asMenu ? undefined : 'תפקיד לתצוגה'} className={styles.options}>
      {options.map(o => {
        const on = o.key === current;
        return (
          <button
            key={o.key}
            type="button"
            role={asMenu ? 'menuitem' : 'radio'}
            aria-checked={asMenu ? undefined : on}
            className={styles.item}
            data-on={on || undefined}
            onClick={() => onPick(o.key)}
          >
            <span aria-hidden="true" className={styles.mark}>{on ? '✓' : ''}</span>
            <span className={styles.itemText}>
              <span className={styles.itemName}>{o.name}</span>
              <span className={styles.itemSub}>{o.sub}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Shows the signed-in role. Owners can preview what each role sees (design: "מחובר/ת כ־").
 * The preview only narrows permissions; server actions still check the real role.
 * Below 768px the menu opens as a bottom sheet.
 */
export function RoleMenu({ current, canPreview, options }: { current: string; canPreview: boolean; options: RoleOpt[] }) {
  const [open, setOpen] = useState(false);
  const { pending, pick } = usePreviewRole();
  const sheet = useSheetMode();
  const ref = useRef<HTMLDivElement>(null);
  const cur = options.find(o => o.key === current) ?? options[0];

  useEffect(() => {
    if (!open || sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open, sheet]);

  const choose = (key: string) => pick(key, () => setOpen(false));

  return (
    <div ref={ref} className={styles.wrap}>
      <button
        type="button"
        className={styles.btn}
        aria-expanded={canPreview ? open : undefined}
        aria-haspopup={canPreview ? (sheet ? 'dialog' : 'menu') : undefined}
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
      {open && !sheet && (
        <div role="menu" className={styles.menu}>
          <RoleOptions options={options} current={current} onPick={choose} asMenu />
          <span className={styles.note}>{ROLE_NOTE}</span>
        </div>
      )}
      <BottomSheet open={open && sheet} onClose={() => setOpen(false)} title="מחובר/ת כ־">
        <RoleOptions options={options} current={current} onPick={choose} />
        <p className={styles.note}>{ROLE_NOTE}</p>
      </BottomSheet>
    </div>
  );
}
