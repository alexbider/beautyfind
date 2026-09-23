import type { Metadata } from 'next';

// Booking links carry a bearer token: keep every /b/* page out of search and referrers.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function BookingTokenLayout({ children }: { children: React.ReactNode }) {
  return children;
}
