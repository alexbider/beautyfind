import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminShell } from '@/components/ops/AdminShell';
import { areaLevel, requireArea } from '@/components/ops/guard';
import { atLeast } from '@/components/ops/roles';
import { Chip, PageHead, dateTimeIL, ui } from '@/components/ops/ui';
import { loadBranchEdit } from '../../../branchEdit';
import { BranchEditor } from './BranchEditor';

export const metadata: Metadata = { title: 'עריכת סניף · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function BranchEditPage({ params }: { params: Promise<{ id: string; branchId: string }> }) {
  const { id, branchId } = await params;
  const user = await requireArea('businesses', 'view', `/ops/businesses/${id}/branches/${branchId}`);
  const [data, level] = await Promise.all([loadBranchEdit(branchId), areaLevel(user, 'businesses')]);
  if (!data || data.businessId !== id) notFound();
  return (
    <AdminShell user={user}>
      <PageHead
        eyebrow={<><Link href="/ops/businesses" className={ui.rowLink}>תפעול · עסקים</Link> · <Link href={`/ops/businesses/${id}`} className={ui.rowLink}>{data.businessName}</Link></>}
        title={data.details.name}
        lead={<>{data.details.cityName} · עודכן {dateTimeIL(data.updatedAt)}{data.publicHref ? <> · <a href={data.publicHref} target="_blank" rel="noreferrer" className={ui.rowLink}>לפרופיל הציבורי</a></> : null}</>}
        actions={<><Chip tone={data.details.status === 'live' ? 'ok' : 'neutral'}>{data.details.status === 'live' ? 'חי' : data.details.status === 'draft' ? 'טיוטה' : 'לא מפורסם'}</Chip>{data.details.isClaimed ? <Chip tone="info">בבעלות מאומתת</Chip> : null}{data.gap ? <Chip tone={data.gap.readiness >= 80 ? 'ok' : data.gap.readiness >= 50 ? 'warn' : 'bad'}>מוכנות {data.gap.readiness}%</Chip> : null}</>}
      />
      <BranchEditor data={data} canEdit={atLeast(level, 'edit')} />
    </AdminShell>
  );
}
