'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { CLAIM_LINK_LABEL, MEDICAL_LABEL, MOH_REGISTRY_URL, nextMedicalInfoOpen, REGISTRY_LINK_LABEL, type MedicalState } from '@/lib/medical';
import { SHEET_MQ } from '@/lib/ui/shell';
import { CheckMark, CloseGlyph } from './icons';
import styles from './MedicalInfo.module.css';

/** What the profile hands every medical treatment row: the state, the setting's text and the claim link. */
export interface MedicalContext {
  state: MedicalState;
  text: string; // the no-doctor disclaimer (setting medicalDisclaimer)
  statedText: string; // the stated-doctor disclaimer with {name} (setting medicalStatedDisclaimer)
  claimHref: string;
}

/** The verified state: who performs the treatment, with the license tag when the license was checked. */
export function MedicalBadge({ badge, licenseTag }: { badge: string; licenseTag: string | null }) {
  return (
    <span className={styles.badge}>
      <span>{badge}</span>
      {licenseTag && (
        <span className={styles.lic}>
          <CheckMark size={11} />
          {licenseTag}
        </span>
      )}
    </span>
  );
}

/**
 * The "no doctor on file" state: a real button after the treatment name that opens the disclaimer. The
 * popover is in the server HTML (hidden until opened) so it reads without JavaScript; it is positioned
 * fixed next to the button on wide screens and becomes a bottom sheet below 768px. Enter and Space toggle
 * (native button), Escape closes and returns focus, an outside tap closes. Nothing in the row moves.
 */
export function MedicalInfo({ text, claimHref, treatment }: { text: string; claimHref: string | null; treatment: string }) {
  const id = `mi-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const b = btn.current;
    const el = pop.current;
    if (!b || !el) return;
    if (window.matchMedia(SHEET_MQ).matches) {
      el.style.width = el.style.left = el.style.top = '';
      return;
    }
    const r = b.getBoundingClientRect();
    const w = Math.min(360, window.innerWidth - 32);
    // RTL: the popover's right edge sits on the button's right edge, kept inside the viewport.
    const left = Math.max(16, Math.min(r.right - w, window.innerWidth - 16 - w));
    el.style.width = `${w}px`;
    el.style.left = `${left}px`;
    const h = el.offsetHeight;
    const below = r.bottom + 8;
    el.style.top = `${below + h > window.innerHeight - 16 && r.top - h - 8 > 16 ? r.top - h - 8 : below}px`;
  }, []);

  const close = useCallback((focusTrigger: boolean) => {
    setOpen(false);
    if (focusTrigger) btn.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (open) {
      place();
      pop.current?.focus();
    }
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (!nextMedicalInfoOpen(e.key, true)) {
        e.preventDefault();
        close(true);
      }
    };
    const onDown = (e: Event) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) close(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place, close]);

  return (
    <span ref={wrap} className={styles.wrap}>
      <button type="button" ref={btn} className={styles.trigger} aria-expanded={open} aria-controls={id} aria-label={`${MEDICAL_LABEL}: ${treatment}. מידע על הטיפול`} onClick={() => setOpen(o => !o)}>
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="10" cy="10" r="7.6" />
          <path d="M10 6.2v.2M10 9v4.6" />
        </svg>
        <span>{MEDICAL_LABEL}</span>
      </button>
      {open && <span className={styles.backdrop} aria-hidden="true" onClick={() => close(false)} />}
      <div id={id} ref={pop} role="dialog" aria-labelledby={`${id}-t`} tabIndex={-1} className={styles.pop} hidden={!open}>
        <div className={styles.popHead}>
          <span id={`${id}-t`} className={styles.popTitle}>{MEDICAL_LABEL}</span>
          <button type="button" className={styles.popClose} aria-label="סגירה" onClick={() => close(true)}>
            <CloseGlyph />
          </button>
        </div>
        <p className={styles.text}>{text}</p>
        <p className={styles.links}>
          <a href={MOH_REGISTRY_URL} target="_blank" rel="noopener nofollow">{REGISTRY_LINK_LABEL}</a>
          {claimHref && <Link href={claimHref} rel="nofollow">{CLAIM_LINK_LABEL}</Link>}
        </p>
      </div>
    </span>
  );
}

/** The row element for a medical treatment: the badge or the disclaimer trigger, by state. */
export function MedicalMark({ ctx, treatment }: { ctx: MedicalContext; treatment: string }) {
  if (ctx.state.kind === 'verified') return <MedicalBadge badge={ctx.state.badge} licenseTag={ctx.state.licenseTag} />;
  if (ctx.state.kind === 'stated') return <MedicalInfo text={ctx.statedText.replace(/\{name\}/g, ctx.state.name)} claimHref={null} treatment={treatment} />;
  return <MedicalInfo text={ctx.text} claimHref={ctx.claimHref} treatment={treatment} />;
}
