import type { Metadata } from 'next';
import { tabGuard } from '@/components/dashboard/guard';
import { ReadOnlyBanner } from '@/components/dashboard/ReadOnlyBanner';
import { MenuEditor } from '@/components/dashboard/menu/MenuEditor';
import { db } from '@/lib/server/db';
import { loadMenu } from './data';

// Design: project/BeautyFind Dashboard.dc.html (isMenu)

export const metadata: Metadata = { title: 'תפריט מחירים' };

export default async function MenuPage() {
  const ctx = await tabGuard('menu');
  const banner = !ctx.canEdit && <ReadOnlyBanner roleName={ctx.roleName} />;
  if (!ctx.branch) return <>{banner}<p>לא נמצא סניף לעריכה.</p></>;

  const [menu, cats] = await Promise.all([
    loadMenu(ctx.branch.id),
    db.branchCategory.findMany({ where: { branchId: ctx.branch.id }, select: { categorySlug: true } }),
  ]);

  return (
    <>
      {banner}
      <MenuEditor initialRows={menu.rows} initialUpdatedAt={menu.updatedAt} branchCats={cats.map(c => c.categorySlug)} canEdit={ctx.canEdit} />
    </>
  );
}
