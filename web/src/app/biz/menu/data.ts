import 'server-only';
import { db } from '@/lib/server/db';
import type { MenuRow } from '@/components/dashboard/menu/shared';

/** Rows in editor form, plus the latest change time. Also used by the page. */
export async function loadMenu(branchId: string): Promise<{ rows: MenuRow[]; updatedAt: string }> {
  const list = await db.treatment.findMany({ where: { branchId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  const latest = list.reduce<Date | null>((m, t) => (!m || t.updatedAt > m ? t.updatedAt : m), null);
  return {
    rows: list.map(t => ({
      key: t.id,
      id: t.id,
      name: t.name,
      categorySlug: t.categorySlug,
      priceType: t.priceType,
      price: String(Math.round(t.priceAgorot / 100)),
      duration: t.durationMin ? String(t.durationMin) : '',
      isPublished: t.isPublished,
    })),
    updatedAt: latest ? latest.toISOString() : '',
  };
}
