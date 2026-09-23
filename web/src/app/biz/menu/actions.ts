'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { categoryBySlug } from '@/lib/catalog';
import { requireArea } from '@/lib/server/biz';
import { db } from '@/lib/server/db';
import { loadMenu } from './data';
import { MAX_ROWS, PRICE_TYPES, parseDuration, parsePrice, validateMenu, type MenuRow, type RowErrors } from '@/components/dashboard/menu/shared';

export type SaveMenuResult =
  | { ok: true; rows: MenuRow[]; updatedAt: string }
  | { ok: false; error: string; byKey?: Record<string, RowErrors> };

const Row = z.object({
  key: z.string().max(64),
  id: z.string().uuid().nullable(),
  name: z.string().max(200),
  categorySlug: z.string().max(60).nullable(),
  priceType: z.enum(PRICE_TYPES),
  price: z.string().max(20),
  duration: z.string().max(10),
  isPublished: z.boolean(),
});
const Payload = z.object({ rows: z.array(Row).max(MAX_ROWS), deleted: z.array(z.string().uuid()).max(500) });

export async function saveMenu(input: { rows: MenuRow[]; deleted: string[] }): Promise<SaveMenuResult> {
  const ctx = await requireArea('menu', 'edit');
  const branch = ctx.branch;
  if (!branch) return { ok: false, error: 'לא נמצא סניף לעריכה.' };

  const parsed = Payload.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'חלק מהנתונים אינם תקינים. רעננו את הדף ונסו שוב.' };
  const { rows, deleted } = parsed.data;

  // Every id sent must be a treatment of this branch. Nothing from the client is trusted beyond that.
  const [existing, branchCats] = await Promise.all([
    db.treatment.findMany({ where: { branchId: branch.id }, select: { id: true, categorySlug: true } }),
    db.branchCategory.findMany({ where: { branchId: branch.id }, select: { categorySlug: true } }),
  ]);
  const saved = new Map(existing.map(t => [t.id, t.categorySlug]));
  const ids = rows.flatMap(r => (r.id ? [r.id] : []));
  if ([...ids, ...deleted].some(id => !saved.has(id)) || new Set(ids).size !== ids.length || deleted.some(id => ids.includes(id))) {
    return { ok: false, error: 'התפריט השתנה בינתיים. רעננו את הדף ונסו שוב.' };
  }

  const v = validateMenu(rows, branchCats.map(c => c.categorySlug), Object.fromEntries(saved));
  if (!v.ok) return { ok: false, error: 'יש טיפולים שדורשים תיקון.', byKey: v.byKey };

  const data = (r: MenuRow, i: number) => {
    const cat = r.categorySlug ? categoryBySlug(r.categorySlug) : undefined;
    const isMedical = !!cat?.isMedical;
    return {
      name: r.name.trim(),
      categorySlug: cat?.slug ?? null,
      priceType: r.priceType,
      priceAgorot: parsePrice(r.price)! * 100,
      durationMin: r.duration.trim() ? parseDuration(r.duration) : null,
      // Medical treatments go through a consult, never straight to online booking.
      isMedical,
      onlineBookable: !isMedical,
      ...(isMedical ? { requiresDeclaration: true } : {}),
      isPublished: r.isPublished,
      sortOrder: i,
    };
  };

  try {
    await db.$transaction(async tx => {
      if (deleted.length) await tx.treatment.deleteMany({ where: { id: { in: deleted }, branchId: branch.id } });
      for (const [i, r] of rows.entries()) {
        if (r.id) await tx.treatment.updateMany({ where: { id: r.id, branchId: branch.id }, data: data(r, i) });
        else await tx.treatment.create({ data: { branchId: branch.id, ...data(r, i) } });
      }
    });
  } catch (e) {
    console.error('[biz/menu] save failed', e);
    return { ok: false, error: 'השמירה נכשלה. השינויים עדיין כאן, נסו שוב בעוד רגע.' };
  }

  revalidatePath('/biz/menu');
  const fresh = await loadMenu(branch.id);
  return { ok: true, ...fresh };
}
