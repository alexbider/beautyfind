'use client';

import { track } from '@/lib/client/track';
import s from './search.module.css';

/** Icon-only WhatsApp button on a result card. Counts the click for the business's stats. */
export function WhatsAppButton({ branchId, e164, name, query, className }: { branchId: string; e164: string; name: string; query?: string; className?: string }) {
  return (
    <a
      href={`https://wa.me/${e164.replace(/\D/g, '')}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`וואטסאפ אל ${name}`}
      className={`${s.waBtn} ${className ?? ''}`}
      onClick={() => track(branchId, 'whatsapp_click', query || undefined)}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 2.2A9.7 9.7 0 0 0 3.6 16.8L2.3 21.7l5-1.3A9.7 9.7 0 1 0 12 2.2zm0 17.7c-1.5 0-2.9-.4-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 19.9zm4.4-6c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.5.1l-.8 1c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 2s.8 2.3.9 2.5c.1.2 1.6 2.5 4 3.5 1.5.6 2 .7 2.8.6.4-.1 1.4-.6 1.6-1.1.2-.5.2-1 .1-1.1z"
        />
      </svg>
    </a>
  );
}
