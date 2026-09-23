'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from '@/app/clinic/layout.module.css';

export function ClinicNav({ items }: { items: Array<{ name: string; href: string }> }) {
  const path = usePathname() ?? '';
  return (
    <nav aria-label="מערכת הקליניקה" className={styles.nav}>
      {items.map(it => {
        const on = it.href === '/clinic' ? path === '/clinic' || path.startsWith('/clinic/booking') : path.startsWith(it.href);
        return (
          <Link key={it.href} href={it.href} aria-current={on ? 'page' : undefined} data-on={on || undefined} className={styles.navItem}>
            {it.name}
          </Link>
        );
      })}
    </nav>
  );
}
