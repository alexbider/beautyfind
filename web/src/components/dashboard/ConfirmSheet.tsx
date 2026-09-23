'use client';

import type { ReactNode } from 'react';
import { BottomSheet } from '../shell/BottomSheet';
import styles from './ConfirmSheet.module.css';

/**
 * Confirmation as a short bottom sheet (spec §3: modal dialogs and confirmations become sheets below
 * 768px). The dashboard keeps its inline confirmations on wider screens and renders this instead on phones.
 */
export function ConfirmSheet({
  open, title, body, confirmLabel, pending = false, error, tone = 'danger', cancelLabel = 'ביטול', onConfirm, onCancel,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  pending?: boolean;
  error?: ReactNode;
  tone?: 'danger' | 'primary';
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <BottomSheet
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <div className={styles.actions}>
          <button type="button" className={styles.confirm} data-tone={tone} onClick={onConfirm} disabled={pending} aria-busy={pending || undefined}>
            {confirmLabel}
          </button>
          <button type="button" className={styles.cancel} onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      }
    >
      <div className={styles.body}>{body}</div>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    </BottomSheet>
  );
}
