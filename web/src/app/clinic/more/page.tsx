import type { Metadata } from 'next';
import { MoreMenu, type MoreRow } from '@/components/more/MoreMenu';
import { bizContext } from '@/lib/server/biz';

export const metadata: Metadata = { title: 'עוד' };

// Clinic "עוד" tab. The calendar, customers and messages screens arrive with the Noa Clinic back office.
export default async function ClinicMorePage() {
  const ctx = await bizContext();
  const rows: MoreRow[] = [
    { kind: 'link', label: 'לוח הבקרה של העסק', href: '/biz' },
    ...(ctx.perms.billing === 'edit' ? [{ kind: 'link', label: 'תשלומים וחשבוניות', href: '/biz/payments' } as MoreRow] : []),
  ];
  return (
    <MoreMenu
      title="עוד"
      groups={[
        { name: 'מעבר', rows },
        { name: 'עזרה', rows: [{ kind: 'link', label: 'מרכז עזרה', href: '/help' }, { kind: 'link', label: 'צור קשר', href: '/contact' }] },
        { name: 'חשבון', rows: [{ kind: 'logout' }] },
      ]}
    />
  );
}
