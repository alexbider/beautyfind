import type { Metadata } from 'next';
import { OfflineView } from './OfflineView';

// Served by the service worker when a page can't load without a connection (States → error).
export const metadata: Metadata = { title: 'אין חיבור', robots: { index: false, follow: false } };
export const dynamic = 'force-static';

export default function OfflinePage() {
  return <OfflineView />;
}
