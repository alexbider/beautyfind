import { redirect } from 'next/navigation';
import { DASH_VIEWS } from '@/components/dashboard/nav';
import { tabGuard } from '@/components/dashboard/guard';
import { bizContext } from '@/lib/server/biz';

export default async function OverviewPage() {
  const ctx = await bizContext();
  // Roles without the overview (e.g. accounting) land on their first permitted tab.
  if (ctx.perms.overview === 'none') {
    const first = DASH_VIEWS.find(v => v.key !== 'team' && v.key !== 'overview' && ctx.perms[v.key] !== 'none');
    redirect(first?.href ?? '/');
  }
  await tabGuard('overview');
  return null;
}
