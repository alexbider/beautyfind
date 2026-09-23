'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { TABS, isTabRoot } from '@/lib/ui/shell';
import { BottomSheet } from '../shell/BottomSheet';
import { TopBar } from '../shell/TopBar';
import { switchBusiness } from './actions';
import { ROLE_NOTE, RoleOptions, usePreviewRole, type RoleOpt } from './RoleMenu';
import styles from './DashTopBar.module.css';

// Dashboard top bar for the app shell (spec §2.1, §6 Dashboard). Replaces the desktop header and the
// side rail on phones and touch tablets. On the tab roots the title is the business name; tapping it
// opens the switcher sheet (business, branches, role preview: what the branch chip and RoleMenu do on
// desktop). Deeper screens get the standard pushed bar.

export interface SwitcherData {
  name: string;
  line: string;
  verified: boolean;
  profileHref: string | null;
  businesses: Array<{ id: string; name: string; current: boolean }>;
  branches: Array<{ id: string; name: string; city: string; live: boolean }>;
  role: string;
  canPreview: boolean;
  roles: RoleOpt[];
  views: Array<{ name: string; href: string }>;
}

/** Where back goes on a deep link: the tab the screen lives under. */
const PARENT: Record<string, string> = { '/biz/menu': '/biz/profile' };

export function DashTopBar(props: SwitcherData) {
  const path = usePathname() ?? '/biz';
  // "עוד" renders its own root bar (MoreMenu).
  if (path === '/biz/more') return null;
  if (!isTabRoot(TABS.business, path)) {
    const view = [...props.views].sort((a, b) => b.href.length - a.href.length).find(v => path === v.href || path.startsWith(v.href + '/'));
    return <TopBar mode="pushed" title={view?.name ?? props.name} backHref={PARENT[path] ?? '/biz/more'} />;
  }
  return <RootBar {...props} />;
}

function RootBar(d: SwitcherData) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const role = d.roles.find(r => r.key === d.role);

  useEffect(() => {
    const s = sentinel.current;
    if (!s) return;
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting));
    io.observe(s);
    return () => io.disconnect();
  }, []);

  return (
    <div className={styles.shell}>
      <div ref={sentinel} className={styles.sentinel} aria-hidden="true" />
      <div className={styles.bar} data-scrolled={scrolled || undefined}>
        <button type="button" className={styles.titleBtn} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
          <span className={styles.titleText}>
            <span className={styles.name}>{d.name}</span>
            <span className={styles.sub}>
              {d.role !== 'owner' && role ? `${role.name} · ` : ''}
              {d.verified ? 'מאומת' : 'ממתין לאימות'}
            </span>
          </span>
          <svg className={styles.chev} width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 4.2 6 8.2l4-4" />
          </svg>
          <span className="sr-only">, מעבר עסק ותפקיד</span>
        </button>
        {d.profileHref && (
          <Link href={d.profileHref} className={styles.iconBtn} aria-label="תצוגת הפרופיל הציבורי">
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </Link>
        )}
      </div>
      <Switcher open={open} onClose={() => setOpen(false)} d={d} />
    </div>
  );
}

function Switcher({ open, onClose, d }: { open: boolean; onClose: () => void; d: SwitcherData }) {
  const { pending: rolePending, pick } = usePreviewRole();
  const [bizPending, start] = useTransition();
  const others = d.businesses.filter(b => !b.current);
  const busy = rolePending || bizPending;

  const openBiz = (id: string) => {
    onClose();
    start(async () => {
      await switchBusiness(id);
      window.location.assign('/biz');
    });
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="העסק והתפקיד" size="half">
      <div className={styles.sheet} aria-busy={busy || undefined}>
        <div className={styles.current}>
          <span className={styles.curName}>{d.name}</span>
          {d.line && <span className={styles.curLine}>{d.line}</span>}
          <span className={styles.status} data-pending={!d.verified || undefined}>{d.verified ? 'מאומת' : 'ממתין לאימות'}</span>
        </div>

        {others.length > 0 && (
          <section aria-labelledby="sw-biz">
            <h3 id="sw-biz" className={styles.group}>מעבר לעסק אחר</h3>
            <ul className={styles.rows}>
              {others.map(b => (
                <li key={b.id}>
                  <button type="button" className={styles.row} onClick={() => openBiz(b.id)} disabled={busy}>
                    <span className={styles.rowName}>{b.name}</span>
                    <Chevron />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {d.branches.length > 0 && (
          <section aria-labelledby="sw-br">
            <h3 id="sw-br" className={styles.group}>{d.branches.length === 1 ? 'הסניף' : 'הסניפים'}</h3>
            <ul className={styles.rows}>
              {d.branches.map((b, i) => (
                <li key={b.id} className={styles.row} data-static>
                  <span className={styles.rowText}>
                    <span className={styles.rowName}>{b.name}</span>
                    <span className={styles.rowSub}>{b.city}</span>
                  </span>
                  <span className={styles.tag} data-off={!b.live || undefined}>{i === 0 ? 'מוצג בלוח' : b.live ? 'מפורסם' : 'טיוטה'}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="sw-role">
          <h3 id="sw-role" className={styles.group}>מחובר/ת כ־</h3>
          {d.canPreview ? (
            <>
              <RoleOptions options={d.roles} current={d.role} onPick={k => pick(k, onClose)} />
              <p className={styles.note}>{ROLE_NOTE}</p>
            </>
          ) : (
            <p className={styles.roleStatic}>{d.roles.find(r => r.key === d.role)?.name}</p>
          )}
        </section>

        {d.profileHref && (
          <Link href={d.profileHref} className={styles.row} onClick={onClose}>
            <span className={styles.rowName}>תצוגת הפרופיל הציבורי</span>
            <Chevron />
          </Link>
        )}
      </div>
    </BottomSheet>
  );
}

function Chevron() {
  return (
    <svg className={styles.rowChev} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}
