import { SiteFooter } from '@/components/site-footer/SiteFooter';

// Public gift card pages: /gift/[branch] (buy) and /gift/check (balance). Each page renders its
// header through GiftFrame (./frame.tsx). The footer is a desktop pattern; the shell has "עוד".

export default function GiftLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <div className="bf-desk-only">
        <SiteFooter />
      </div>
    </>
  );
}
