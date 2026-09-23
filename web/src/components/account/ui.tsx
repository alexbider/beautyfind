'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './ui.module.css';

// Small shared pieces for the client pages (account, saved, unsubscribe).

/** Toast state: navy, bottom-centre, 3.2s (4s when it carries an action). */
export function useToast() {
  const [toast, setToast] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const show = useCallback((text: string, action?: { label: string; run: () => void }) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ text, action });
    timer.current = setTimeout(() => setToast(null), action ? 4000 : 3200);
  }, []);
  const hide = useCallback(() => setToast(null), []);
  return { toast, show, hide };
}

export function Toast({ toast, onHide, raised }: { toast: ReturnType<typeof useToast>['toast']; onHide: () => void; raised?: boolean }) {
  return (
    <div className={styles.toastWrap} data-raised={raised || undefined} role="status" aria-live="polite">
      {toast && (
        <div className={styles.toast}>
          <span>{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              className={styles.toastAction}
              onClick={() => {
                toast.action!.run();
                onHide();
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** On/off switch (07-rules): role="switch", 50×30 track, 44px tap target. */
export function Switch({
  on, label, onChange, disabled, size = 'md',
}: { on: boolean; label: string; onChange: (next: boolean) => void; disabled?: boolean; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={styles.switch}
      data-size={size}
      data-on={on || undefined}
      onClick={() => onChange(!on)}
    >
      <span className={styles.track} aria-hidden="true">
        <span className={styles.knob} />
      </span>
    </button>
  );
}

/**
 * Modal confirm built on <dialog>: focus moves to the safe button on open, Esc closes,
 * and focus returns to the element that opened it.
 */
export function ConfirmDialog({
  open, title, children, confirmLabel, cancelLabel = 'ביטול', danger, busy, onConfirm, onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement;
      d.showModal();
      cancelRef.current?.focus();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="bf-confirm-title"
      onClose={() => {
        onClose();
        if (opener.current instanceof HTMLElement) opener.current.focus();
      }}
      onClick={e => {
        if (e.target === ref.current && !busy) ref.current?.close();
      }}
    >
      <div className={styles.dialogBody}>
        <h2 id="bf-confirm-title" className={styles.dialogTitle}>{title}</h2>
        <div className={styles.dialogText}>{children}</div>
        <div className={styles.dialogActions}>
          <button type="button" className={danger ? styles.btnDanger : styles.btnPrimary} onClick={onConfirm} disabled={busy} aria-busy={busy || undefined}>
            {confirmLabel}
          </button>
          <button type="button" ref={cancelRef} className={styles.btnGhost} onClick={() => ref.current?.close()} disabled={busy}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
