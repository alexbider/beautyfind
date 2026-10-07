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

// ---------- Google indexing (tab גוגל) ----------

const GOOGLE_FLAGS = ['enabled', 'submitNew', 'submitBacklog', 'inspect'] as const;
type GoogleFlag = (typeof GOOGLE_FLAGS)[number];

/** One switch of the Google indexing settings, saved and logged. */
export async function setGoogleIndexingFlagAction(name: string, value: boolean): Promise<{ ok: boolean; error?: string }> {
  const user = await areaUserOrNull('content', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  if (!(GOOGLE_FLAGS as readonly string[]).includes(name)) return { ok: false, error: 'הגדרה לא מוכרת' };
  const cur = await platformSettings();
  await savePlatformSettings(user.id, { googleIndexing: { ...cur.googleIndexing, [name as GoogleFlag]: value } });
  await db.auditLog.create({ data: { actorId: user.id, action: 'google_indexing_update', subjectType: 'indexing', subjectId: user.id, meta: { ref: name, value } } });
  revalidatePath('/ops/content');
  return { ok: true };
}

const GoogleLimits = z.object({
  dailySubmitLimit: z.coerce.number().int().min(1).max(2000),
  dailyInspectLimit: z.coerce.number().int().min(0).max(2000),
  property: z.string().trim().max(200).refine(v => v === '' || /^sc-domain:[a-z0-9.-]+$/i.test(v) || /^https?:\/\/[^\s]+\/$/.test(v), 'נכס לא תקין: sc-domain:example.com או כתובת מלאה שמסתיימת ב־/'),
});

export async function saveGoogleIndexingLimitsAction(input: Record<string, string>): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await areaUserOrNull('content', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = GoogleLimits.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'קלט לא תקין' };
  const cur = await platformSettings();
  await savePlatformSettings(user.id, { googleIndexing: { ...cur.googleIndexing, ...p.data } });
  revalidatePath('/ops/content');
  return { ok: true };
}

/** Gets a token and inspects the homepage. Changes nothing on Google's side. */
export async function testGoogleIndexingAction(): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const user = await areaUserOrNull('content', 'view');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const { testGoogleConnection } = await import('@/lib/server/googleIndexing');
  const r = await testGoogleConnection();
  if (!r.ok) return r;
  const h = r.homepage;
  return { ok: true, text: `החיבור תקין. דף הבית: ${h.indexed ? 'באינדקס של גוגל' : 'לא באינדקס'}${h.coverageState ? ` (${h.coverageState})` : ''}` };
}

/** Runs the indexer now with the saved settings and quotas. */
export async function runGoogleIndexingAction(): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const user = await areaUserOrNull('content', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const { runGoogleIndexing } = await import('@/lib/server/googleIndexing');
  const r = await runGoogleIndexing({ trigger: 'manual', actorId: user.id });
  await db.auditLog.create({ data: { actorId: user.id, action: 'google_indexing_run', subjectType: 'indexing', subjectId: user.id, meta: { ref: r.runId ?? r.skipped ?? 'run', submitted: r.submitted, inspected: r.inspected, errors: r.errors } } });
  revalidatePath('/ops/content');
  const SKIP: Record<string, string> = { disabled: 'האינדוקס האוטומטי כבוי', not_configured: 'GOOGLE_INDEXING_CREDENTIALS לא מוגדר או לא תקין', site_not_indexable: 'האתר חסום לאינדוקס (STAGING או המתג הראשי)' };
  if (r.skipped) return r.ok ? { ok: true, text: `לא רץ: ${SKIP[r.skipped] ?? r.skipped}` } : { ok: false, error: SKIP[r.skipped] ?? r.skipped };
  const text = `נוספו ${r.discovered} כתובות חדשות · נבדקו ${r.inspected} · נשלחו לגוגל ${r.submitted} · שגיאות ${r.errors}${r.note ? ` · ${r.note}` : ''}`;
  return r.ok ? { ok: true, text } : { ok: false, error: text };
}
