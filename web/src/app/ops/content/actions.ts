'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { areaUserOrNull } from '@/components/ops/access';
import { INDEX_SECTION_KEYS, INDEX_SECTIONS, type IndexSectionKey } from '@/lib/indexing';
import { db } from '@/lib/server/db';
import { platformSettings, savePlatformSettings } from '@/lib/server/platformSettings';
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
  revalidatePath('/sitemap.xml');
  revalidatePath('/ops/content');
  return { ok: true };
}

/**
 * The indexing switches (tab אינדוקס): "site" is the master switch, "section:<key>" one public section.
 * Saved in platform settings, logged, and every public page, robots.txt and the sitemap are refreshed so
 * the next crawl sees the change.
 */
export async function setIndexingAction(name: string, value: boolean): Promise<{ ok: boolean; error?: string }> {
  const user = await areaUserOrNull('content', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  let label: string;
  if (name === 'site') {
    await savePlatformSettings(user.id, { indexSite: value });
    label = 'האתר';
  } else if (name.startsWith('section:') && (INDEX_SECTION_KEYS as readonly string[]).includes(name.slice(8))) {
    const key = name.slice(8) as IndexSectionKey;
    const cur = await platformSettings();
    await savePlatformSettings(user.id, { indexSections: { ...cur.indexSections, [key]: value } });
    label = INDEX_SECTIONS.find(s => s.key === key)?.name ?? key;
  } else {
    return { ok: false, error: 'הגדרה לא מוכרת' };
  }
  await db.auditLog.create({ data: { actorId: user.id, action: 'indexing_update', subjectType: 'indexing', subjectId: user.id, meta: { ref: label, target: name, index: value } } });
  revalidatePath('/', 'layout'); // every public page carries the robots tag
  revalidatePath('/robots.txt');
  revalidatePath('/sitemap.xml');
  return { ok: true };
}
