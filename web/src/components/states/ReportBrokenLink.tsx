'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { contactHref } from '@/components/contact/reasons';

/** "דיווח על קישור שבור": opens the correction form with the broken address filled in. */
export function ReportBrokenLink({ className, children = 'דיווח על קישור שבור' }: { className?: string; children?: React.ReactNode }) {
  const [href, setHref] = useState(contactHref('correction'));
  useEffect(() => {
    setHref(contactHref('correction', { page: window.location.pathname + window.location.search }));
  }, []);
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
