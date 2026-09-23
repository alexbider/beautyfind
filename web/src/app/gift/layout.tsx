import { SiteFooter } from '@/components/site-footer/SiteFooter';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import s from '@/components/gift/gift.module.css';

// Public gift card pages: /gift/[branch] (buy) and /gift/check (balance).

export default function GiftLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader variant="public" />
      <main className={s.root}>
        <div className={s.wrap}>{children}</div>
      </main>
      <SiteFooter />
    </>
  );
}
