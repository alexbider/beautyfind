import Link from 'next/link';
import { PublicShell, StateCard } from '@/components/waitlist/ui';
import styles from '@/components/waitlist/Waitlist.module.css';
import { platformSettings } from '@/lib/server/platformSettings';

// Platform switches from /ops/settings on the public flows. `gate(flag)` tells a flow whether it is
// off (maintenance mode wins); `FeatureOff` is the screen shown instead. Existing bookings and cards
// are untouched: only new ones are paused.

export type PublicFlag = 'onlineBooking' | 'giftCards' | 'waitlist';

export async function gate(flag: PublicFlag): Promise<{ off: false } | { off: true; reason: 'maintenance' | 'feature'; message: string }> {
  const s = await platformSettings();
  if (s.maintenanceMode) return { off: true, reason: 'maintenance', message: s.maintenanceMessage };
  if (!s[flag]) return { off: true, reason: 'feature', message: '' };
  return { off: false };
}

const TITLE: Record<PublicFlag, { title: string; feature: string }> = {
  onlineBooking: { title: 'קביעת תור', feature: 'ההזמנה המקוונת מושהית כרגע. אפשר לפנות לקליניקה ישירות מהפרופיל.' },
  giftCards: { title: 'שובר מתנה', feature: 'רכישת שוברים מושהית כרגע. שוברים שכבר נרכשו תקפים וניתנים למימוש.' },
  waitlist: { title: 'רשימת המתנה', feature: 'רשימת ההמתנה מושהית כרגע. אפשר לפנות לקליניקה ישירות מהפרופיל.' },
};

export function FeatureOff({ flag, reason, message, closeHref }: { flag: PublicFlag; reason: 'maintenance' | 'feature'; message: string; closeHref: string }) {
  const t = TITLE[flag];
  return (
    <PublicShell title={t.title} closeHref={closeHref}>
      <StateCard title={reason === 'maintenance' ? 'האתר בתחזוקה קצרה' : 'לא זמין כרגע'} actions={<Link className={styles.btnGhost} href={closeHref}>לפרופיל הקליניקה</Link>}>
        <p>{reason === 'maintenance' ? message : t.feature}</p>
      </StateCard>
    </PublicShell>
  );
}

/** A banner for the home page while maintenance mode is on; renders nothing otherwise. */
export async function MaintenanceNotice() {
  const s = await platformSettings();
  if (!s.maintenanceMode) return null;
  return (
    <div role="status" style={{ padding: '10px 16px', background: '#FFF8EC', color: '#9A5B15', borderBottom: '1px solid #F1DDB5', fontSize: 14, fontWeight: 600, textAlign: 'center' }}>
      {s.maintenanceMessage}
    </div>
  );
}
