import type { Metadata } from 'next';

// Every admin page is out of search engines, whatever its own metadata says (the pages render their own
// shell; this layout only sets the robots default). robots.txt and the X-Robots-Tag header cover /ops too.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
