'use client';

import { fromE164, telHref } from '@/lib/format';
import { track, type TrackType } from '@/lib/client/track';
import { waHref } from './format';
import { NavGlyph, PhoneGlyph, WhatsAppGlyph } from './icons';
import styles from './buttons.module.css';

type Size = 'sm' | 'md' | 'lg';
interface Base {
  branchId: string;
  size?: Size;
  className?: string;
}

/** WhatsApp chat with a prefilled Hebrew message. Tracks `whatsapp_click`. */
export function WhatsAppButton({ branchId, e164, businessName, size = 'md', className, label = 'וואטסאפ' }: Base & { e164: string; businessName: string; label?: string }) {
  return (
    <a
      href={waHref(e164, businessName)}
      target="_blank"
      rel="noopener noreferrer"
      className={`${styles.btn} ${styles.wa} ${className ?? ''}`}
      data-size={size === 'md' ? undefined : size}
      onClick={() => track(branchId, 'whatsapp_click')}
      aria-label={`${label}: ${businessName}`}
    >
      <WhatsAppGlyph />
      <span>{label}</span>
    </a>
  );
}

/** Click-to-call (tel:+972…). Tracks `call_click`. `showNumber` appends the local number (LTR). */
export function CallButton({ branchId, e164, size = 'md', className, label = 'שיחה', showNumber = false }: Base & { e164: string; label?: string; showNumber?: boolean }) {
  return (
    <a
      href={telHref(e164)}
      className={`${styles.btn} ${styles.call} ${className ?? ''}`}
      data-size={size === 'md' ? undefined : size}
      onClick={() => track(branchId, 'call_click')}
    >
      <PhoneGlyph />
      <span>
        {label}
        {showNumber && (
          <>
            {' '}
            <span className={`ltr ${styles.num}`}>{fromE164(e164)}</span>
          </>
        )}
      </span>
    </a>
  );
}

/** Waze navigation. Tracks `waze_click`. */
export function WazeButton({ branchId, href, size = 'sm', className, label = 'ניווט בוויז' }: Base & { href: string; label?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${styles.btn} ${styles.waze} ${className ?? ''}`}
      data-size={size === 'md' ? undefined : size}
      onClick={() => track(branchId, 'waze_click')}
    >
      <NavGlyph />
      <span>{label}</span>
    </a>
  );
}

/** Plain tracked link (phone number, email, website rows). */
export function TrackedLink({ branchId, type, href, className, children, external = false, dir }: { branchId: string; type: TrackType; href: string; className?: string; children: React.ReactNode; external?: boolean; dir?: 'ltr' | 'rtl' }) {
  return (
    <a href={href} className={className} dir={dir} onClick={() => track(branchId, type)} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {children}
    </a>
  );
}
