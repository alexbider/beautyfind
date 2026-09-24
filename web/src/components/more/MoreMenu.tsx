import Link from 'next/link';
import { TopBar } from '../shell/TopBar';
import { CookiePrefsRow } from './CookiePrefsRow';
import styles from './MoreMenu.module.css';

// The "עוד" tab page (spec §2.2): replaces the desktop footer and the menus that don't fit five tabs.
export type MoreRow =
  | { kind: 'link'; label: string; href: string; note?: string; external?: boolean }
  | { kind: 'logout'; label?: string }
  | { kind: 'cookies' }
  | { kind: 'static'; label: string; note: string };

export function MoreMenu({
  title,
  intro,
  groups,
  nested = false,
}: {
  title: string;
  intro?: React.ReactNode;
  groups: Array<{ name: string; rows: MoreRow[] }>;
  /** Inside a layout that already renders <main> (dashboard, clinic). */
  nested?: boolean;
}) {
  const Root = nested ? 'div' : 'main';
  return (
    <>
      <TopBar mode="root" largeTitle={title} />
      <Root className={styles.root}>
        <h1 className={styles.deskTitle}>{title}</h1>
        {intro && <div className={styles.intro}>{intro}</div>}
        {groups.map(g => (
          <section key={g.name} className={styles.group} aria-labelledby={`more-${g.name}`}>
            <h2 id={`more-${g.name}`} className={styles.groupName}>
              {g.name}
            </h2>
            <ul className={styles.list}>
              {g.rows.map((r, i) => (
                <li key={i}>
                  {r.kind === 'link' ? (
                    <Link href={r.href} className={styles.row}>
                      <span className={styles.label}>{r.label}</span>
                      {r.note && <span className={styles.note}>{r.note}</span>}
                      <Chevron />
                    </Link>
                  ) : r.kind === 'logout' ? (
                    <form action="/logout" method="post">
                      <button type="submit" className={styles.row} data-danger>
                        <span className={styles.label}>{r.label ?? 'יציאה מהחשבון'}</span>
                      </button>
                    </form>
                  ) : r.kind === 'cookies' ? (
                    <CookiePrefsRow className={styles.row} labelClass={styles.label} />
                  ) : (
                    <div className={styles.row} data-static>
                      <span className={styles.label}>{r.label}</span>
                      <span className={styles.note}>{r.note}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </Root>
    </>
  );
}

function Chevron() {
  return (
    <svg className={styles.chev} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}
