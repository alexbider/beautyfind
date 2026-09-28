import Link from 'next/link';
import styles from './import.module.css';

const TABS = [
  { key: 'runs', name: 'ייבוא וריצות', href: '/ops/import', hint: 'התחלת ייבוא ומעקב' },
  { key: 'review', name: 'תור הבדיקה', href: '/ops/import/review', hint: 'אישור רשומות לפני פרסום' },
  { key: 'enrich', name: 'השלמות', href: '/ops/import/enrich', hint: 'חוסרים בעסקים שפורסמו' },
  { key: 'report', name: 'דוח פרופילים', href: '/ops/import/report', hint: 'מה יש ומה חסר בכל עסק' },
] as const;

/** The three screens of the import, in the order staff use them. */
export function ImportNav({ current, counts }: { current: (typeof TABS)[number]['key']; counts?: Partial<Record<(typeof TABS)[number]['key'], number>> }) {
  return (
    <nav className={styles.tabs} aria-label="מסכי הייבוא">
      {TABS.map(t => (
        <Link key={t.key} href={t.href} className={styles.tab} aria-current={t.key === current ? 'page' : undefined}>
          <span className={styles.tabName}>{t.name}{counts?.[t.key] != null ? <span className={styles.tabCount}>{counts[t.key]!.toLocaleString('he-IL')}</span> : null}</span>
          <span className={styles.tabHint}>{t.hint}</span>
        </Link>
      ))}
    </nav>
  );
}
