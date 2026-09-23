'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { BottomSheet } from '@/components/shell/BottomSheet';
import { Segmented } from '@/components/shell/Segmented';
import { SiteHeader } from '@/components/site-header/SiteHeader';

// App-shell pieces of the Business Profile (responsive spec §6): the top bar that picks up the clinic
// name once the title scrolls away, the sticky section tabs, and the "פרטים" sheet with hours and address.

/** Site header whose phone top bar shows `name` only after the element `#watchId` has scrolled under it. */
export function ProfileHeader({ name, watchId, backHref }: { name: string; watchId: string; backHref: string }) {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const el = document.getElementById(watchId);
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setPast(!e.isIntersecting && e.boundingClientRect.top < 0), { rootMargin: '-56px 0px 0px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [watchId]);
  return <SiteHeader variant="public" title={past ? name : undefined} backHref={backHref} />;
}

/** Offset of the sticky top bar + section tabs, read from the live layout. */
function stickyOffset() {
  const bar = document.querySelector<HTMLElement>('[data-mode="pushed"]');
  const tabs = document.querySelector<HTMLElement>('[data-profile-tabs] > *');
  return (bar?.getBoundingClientRect().height ?? 56) + (tabs?.getBoundingClientRect().height ?? 56) + 8;
}

/** Section tabs (טיפולים · צוות · ביקורות · פרטים): scroll to a section, and follow the one in view. */
export function SectionTabs({ items }: { items: Array<{ key: string; label: string; target: string }> }) {
  const [on, setOn] = useState(items[0]?.key ?? '');

  useEffect(() => {
    const els = items.map(it => document.getElementById(it.target)).filter((x): x is HTMLElement => !!x);
    if (!els.length) return;
    const visible = new Map<string, number>();
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.boundingClientRect.top);
          else visible.delete(e.target.id);
        }
        // The first section (in page order) that is still in the reading band wins.
        const first = items.find(it => visible.has(it.target));
        if (first) setOn(first.key);
      },
      { rootMargin: '-120px 0px -45% 0px' },
    );
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [items]);

  const go = (key: string) => {
    const it = items.find(x => x.key === key);
    const el = it && document.getElementById(it.target);
    if (!el) return;
    setOn(key);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - stickyOffset(), behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <div data-profile-tabs style={{ display: 'contents' }}>
      <Segmented sticky label="מדורי העמוד" items={items.map(it => ({ key: it.key, label: it.label }))} value={on} onChange={go} />
    </div>
  );
}

const DetailsCtx = createContext<(() => void) | null>(null);

/** Owns the "פרטים" sheet; `sheet` is rendered only while it is open (never duplicated in the page HTML). */
export function DetailsSheetProvider({ title, sheet, children }: { title: string; sheet: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <DetailsCtx.Provider value={() => setOpen(true)}>
      {children}
      <BottomSheet open={open} onClose={() => setOpen(false)} title={title} size="half">
        {sheet}
      </BottomSheet>
    </DetailsCtx.Provider>
  );
}

export function DetailsTrigger({ className, children, label }: { className?: string; children: React.ReactNode; label?: string }) {
  const open = useContext(DetailsCtx);
  return (
    <button type="button" className={className} aria-haspopup="dialog" aria-label={label} onClick={() => open?.()}>
      {children}
    </button>
  );
}
