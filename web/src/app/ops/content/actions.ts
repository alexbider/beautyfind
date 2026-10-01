'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { areaUserOrNull } from '@/components/ops/guard';
import { db } from '@/lib/server/db';
import { sitePages } from '@/lib/server/seo';

// Saves the SEO fields of one public page and refreshes it, so the next crawl sees the new title.

const Input = z.object({ path: z.string().min(1).max(120), title: z.string().trim().max(120).optional(), description: z.string().trim().max(320).optional(), keyword: z.string().trim().max(60).optional(), noindex: z.boolean().optional() });

export async function saveSeoAction(input: z.input<typeof Input>): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await areaUserOrNull('content', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = Input.safeParse(input);
  if (!p.success) return { ok: false, error: 'קלט לא תקין' };
  if (!sitePages().some(x => x.path === p.data.path)) return { ok: false, error: 'עמוד לא מוכר' };
  const data = { title: p.data.title || null, description: p.data.description || null, keyword: p.data.keyword || null, noindex: !!p.data.noindex, updatedById: user.id };
  await db.$transaction([
    db.pageSeo.upsert({ where: { path: p.data.path }, create: { path: p.data.path, ...data }, update: data }),
    db.auditLog.create({ data: { actorId: user.id, action: 'seo_update', subjectType: 'page_seo', subjectId: user.id, meta: { ref: p.data.path, noindex: !!p.data.noindex } } }),
  ]);
  revalidatePath(p.data.path);
  revalidatePath('/ops/content');
  return { ok: true };
}
