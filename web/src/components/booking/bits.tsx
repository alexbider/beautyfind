'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fromE164, telHref } from '@/lib/format';
import { waLink } from './shared';
import s from './bits.module.css';

// Small pieces shared by Booking and Manage Booking.

/** Forward arrow points left (RTL); `back` mirrors it. */
export function ArrowGlyph({ size = 15, back = false }: { size?: number; back?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={back ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M12 7H2M6 3 2 7l4 4" />
    </svg>
  );
}

export function CheckGlyph({ size = 13, strokeWidth = 2.2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 7.5 5.5 10.5 11.5 4" />
    </svg>
  );
}

export function PeopleGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <circle cx="16.5" cy="9" r="2.6" />
      <path d="M15.2 14.2A4.6 4.6 0 0 1 20.5 19" />
    </svg>
  );
}

const PHONE_PATH = 'M5 3.5h3.2l1.6 4-2 1.3a11 11 0 0 0 5.4 5.4l1.3-2 4 1.6V17a2.5 2.5 0 0 1-2.7 2.5A15.5 15.5 0 0 1 2.5 6.2 2.5 2.5 0 0 1 5 3.5z';
const WA_PATH =
  'M12 2.2A9.7 9.7 0 0 0 3.6 16.8L2.3 21.7l5-1.3A9.7 9.7 0 1 0 12 2.2zm0 17.7c-1.5 0-2.9-.4-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 19.9zm4.4-6c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.5.1l-.8 1c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 2s.8 2.3.9 2.5c.1.2 1.6 2.5 4 3.5 1.5.6 2 .7 2.8.6.4-.1 1.4-.6 1.6-1.1.2-.5.2-1 .1-1.1z';

/** Phone button (white, #D4D4D4 border, navy text, teal handset). Number in an LTR span. */
export function PhoneButton({ e164, label }: { e164: string; label?: string }) {
  return (
    <a href={telHref(e164)} className={`${s.btn} ${s.phone}`}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={s.phoneGlyph}>
        <path d={PHONE_PATH} />
      </svg>
      <span className={s.btnText}>
        {label}
        <span className={`${s.num} ltr tnum`}>{fromE164(e164)}</span>
      </span>
    </a>
  );
}

/** WhatsApp button (#EAF7EF / #BFE6CC / #0E6B3A, #1DA851 glyph). */
export function WhatsAppButton({ e164, text }: { e164: string; text: string }) {
  return (
    <a href={waLink(e164, text)} target="_blank" rel="noopener noreferrer" className={`${s.btn} ${s.wa}`}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className={s.waGlyph}>
        <path fill="currentColor" d={WA_PATH} />
      </svg>
      <span className={s.btnText}>וואטסאפ</span>
    </a>
  );
}

/** App-shell contact row: WhatsApp, call and navigate as icon buttons with a short label. */
export function ContactIcons({ whatsapp, waText, phone, navHref }: { whatsapp: string | null; waText: string; phone: string | null; navHref: string }) {
  return (
    <div className={s.iconRow}>
      {whatsapp && (
        <a href={waLink(whatsapp, waText)} target="_blank" rel="noopener noreferrer" className={s.iconBtn} aria-label="הודעת וואטסאפ לקליניקה">
          <span className={s.iconDisc} data-tone="wa" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24">
              <path fill="currentColor" d={WA_PATH} />
            </svg>
          </span>
          <span className={s.iconLabel} aria-hidden="true">וואטסאפ</span>
        </a>
      )}
      {phone && (
        <a href={telHref(phone)} className={s.iconBtn} aria-label={`חיוג לקליניקה, ${fromE164(phone)}`}>
          <span className={s.iconDisc} aria-hidden="true">
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d={PHONE_PATH} />
            </svg>
          </span>
          <span className={s.iconLabel} aria-hidden="true">חיוג</span>
        </a>
      )}
      <a href={navHref} target="_blank" rel="noopener noreferrer" className={s.iconBtn} aria-label="ניווט לקליניקה ב־Waze">
        <span className={s.iconDisc} aria-hidden="true">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11 21 3l-8 18-2-8-8-2z" />
          </svg>
        </span>
        <span className={s.iconLabel} aria-hidden="true">ניווט</span>
      </a>
    </div>
  );
}

/** Navy toast, bottom centre, 3.2s (07-rules). */
export function useToast() {
  const [toast, setToast] = useState('');
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((text: string) => {
    if (t.current) clearTimeout(t.current);
    setToast(text);
    t.current = setTimeout(() => setToast(''), 3200);
  }, []);
  useEffect(() => () => {
    if (t.current) clearTimeout(t.current);
  }, []);
  return { toast, flash };
}

export function Toast({ text }: { text: string }) {
  return (
    <div role="status" aria-live="polite" className={s.toastSlot}>
      {text && <div className={s.toast}>{text}</div>}
    </div>
  );
}
