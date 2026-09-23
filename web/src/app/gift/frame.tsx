import { TopBar } from '@/components/shell/TopBar';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import s from '@/components/gift/gift.module.css';

// Frame of the public gift card pages. Desktop: the site header. App shell:
//  - buying (/gift/[branch]) is a focused flow: a flow top bar with × (the tab bar is hidden there);
//  - the balance check (/gift/check) is a pushed screen under "עוד": the site header's own top bar.
// `bare`: the page renders its own top bar and <main> (the buy form drives the step progress).

type Flow = { title: string; closeHref: string };

export function GiftFrame({ children, flow, pushed, bare = false }: { children: React.ReactNode; flow?: Flow; pushed?: { title: string; backHref: string }; bare?: boolean }) {
  return (
    <>
      {pushed ? (
        <SiteHeader variant="public" title={pushed.title} backHref={pushed.backHref} />
      ) : (
        <div className={`${s.deskHeader} bf-desk-only`}>
          <SiteHeader variant="public" />
        </div>
      )}
      {flow && !bare && <TopBar mode="flow" noBack title={flow.title} closeHref={flow.closeHref} />}
      {bare ? (
        children
      ) : (
        <main className={s.root}>
          <div className={s.wrap}>{children}</div>
        </main>
      )}
    </>
  );
}
