'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './DashNav.module.css';

export function DashNav({ views }: { views: Array<{ key: string; name: string; href: string; badge: number }> }) {
  const path = usePathname();
  return (
    <nav aria-label="ניווט בלוח הבקרה" className={styles.nav}>
      {views.map(v => {
        const on = v.href === '/biz' ? path === '/biz' : path.startsWith(v.href);
        return (
          <Link key={v.key} href={v.href} aria-current={on ? 'page' : undefined} className={styles.item} data-on={on || undefined}>
            <span>{v.name}</span>
            {v.badge > 0 && (
              <span dir="ltr" className={styles.badge}>
                {v.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
