import type { Metadata } from 'next';
import { MoreMenu, type MoreRow } from '@/components/more/MoreMenu';
import { PRESET_NAMES } from '@/lib/permissions';
import { bizContext } from '@/lib/server/biz';

export const metadata: Metadata = { title: 'עוד' };

// Clinic "עוד" tab. The calendar, customers and messages screens arrive with the Noa Clinic back office.
// On phones the navy clinic header is hidden, so the clinic and the signed-in member show here.
export default async function ClinicMorePage() {
  const ctx = await bizContext();
  const rows: MoreRow[] = [
    { kind: 'link', label: 'לוח הבקרה של העסק', href: '/biz' },
    ...(ctx.perms.billing === 'edit' ? [{ kind: 'link', label: 'תשלומים וחשבוניות', href: '/biz/payments' } as MoreRow] : []),
  ];
  return (
    <MoreMenu
      nested
      title="עוד"
      intro={
        <>
          <strong>{ctx.branch?.name ?? 'העסק שלי'}</strong> · {ctx.member.displayName}, {PRESET_NAMES[ctx.role].name}
        </>
      }
      groups={[
        { name: 'מעבר', rows },
        { name: 'עזרה', rows: [{ kind: 'link', label: 'מרכז עזרה', href: '/help' }, { kind: 'link', label: 'יצירת קשר', href: '/contact' }] },
        { name: 'חשבון', rows: [{ kind: 'logout' }] },
      ]}
    />
  );
}
