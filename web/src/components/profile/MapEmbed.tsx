'use client';

import { mapsEmbedUrl } from '@/lib/mapsEmbed';
import { EmbedGate } from './EmbedGate';

// Google Maps Embed API, place mode, consent-gated (cookie preferences, "תוכן מוטמע"); 300px on desktop, 200px on phones via CSS.
import styles from './MapEmbed.module.css';

export function MapEmbed({ embedKey, query, title }: { embedKey: string; query: string; title: string }) {
  return (
    <EmbedGate label="הפעלת המפה" note="המפה נטענת מ־Google Maps רק אחרי אישור. עד אז אפשר להשתמש בקישורי הניווט מתחת." height={200} className={styles.gate}>
      <iframe
        className={styles.map}
        src={mapsEmbedUrl(embedKey, query)}
        title={title}
        loading="lazy"
        allowFullScreen
        referrerPolicy="no-referrer-when-downgrade"
      />
    </EmbedGate>
  );
}
