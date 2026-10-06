'use server';

import { revalidatePath } from 'next/cache';
import { areaUserOrNull } from '@/components/ops/access';
import type { Level } from '@/components/ops/roles';
import { listMedia, updateMedia, uploadArticleImage } from '@/lib/server/articleMedia';
import {
  articleLinks, createArticle, createTag, deleteArticle, findArticle, articleView, getAuthor, listArticles, listAuthors, listCategories, listTags, publishArticle, replaceInArticle, scheduleArticle,
  unpublishArticle, updateArticle, upsertAuthor, upsertCategory, validateArticle, type ArticleListFilter,
} from '@/lib/server/articles';
import { platformSettings, savePlatformSettings } from '@/lib/server/platformSettings';

// The magazine's server actions: the admin screen (/ops/magazine) and the MCP tools both call these, so a
// write from either passes the same area check, the same validation (src/lib/server/articles.ts) and
// leaves the same audit rows. Reads need view access to the magazine area, writes need edit.

const DENIED = { ok: false as const, error: 'אין הרשאה' };
const staff = (level: Level = 'edit') => areaUserOrNull('magazine', level);

// ---------- reads ----------

export async function listArticlesAction(filter: ArticleListFilter) {
  if (!(await staff('view'))) return DENIED;
  return { ok: true as const, ...(await listArticles(filter)) };
}

export async function getArticleAction(idOrSlug: string) {
  if (!(await staff('view'))) return DENIED;
  const row = await findArticle(idOrSlug, { includeDeleted: true });
  return row ? { ok: true as const, article: articleView(row) } : { ok: false as const, error: 'article not found' };
}

export async function validateArticleAction(id: string, patch?: unknown) {
  if (!(await staff('view'))) return DENIED;
  return validateArticle(id, patch);
}

export async function articleLinksAction(id: string) {
  if (!(await staff('view'))) return DENIED;
  return articleLinks(id);
}

export async function listAuthorsAction(opts: { includeInactive?: boolean; reviewersOnly?: boolean } = {}) {
  if (!(await staff('view'))) return DENIED;
  return { ok: true as const, authors: await listAuthors(opts) };
}

export async function getAuthorAction(idOrSlug: string) {
  if (!(await staff('view'))) return DENIED;
  const a = await getAuthor(idOrSlug);
  return a ? { ok: true as const, author: a } : { ok: false as const, error: 'author not found' };
}

export async function listCategoriesAction() {
  if (!(await staff('view'))) return DENIED;
  return { ok: true as const, categories: await listCategories() };
}

export async function listTagsAction() {
  if (!(await staff('view'))) return DENIED;
  return { ok: true as const, tags: await listTags() };
}

export async function listMediaAction(opts: { q?: string; kind?: string | null; page?: number; pageSize?: number } = {}) {
  if (!(await staff('view'))) return DENIED;
  return { ok: true as const, ...(await listMedia(opts)) };
}

// ---------- writes ----------

export async function createArticleAction(input: unknown) {
  const u = await staff(); if (!u) return DENIED;
  return createArticle(u, input);
}

export async function updateArticleAction(id: string, patch: unknown, expectedUpdatedAt?: string | null) {
  const u = await staff(); if (!u) return DENIED;
  return updateArticle(u, id, patch, expectedUpdatedAt);
}

export async function publishArticleAction(id: string, opts: { note?: string; source?: string } = {}) {
  const u = await staff(); if (!u) return DENIED;
  const r = await publishArticle(u, id, { note: opts.note, source: opts.source ?? 'admin' });
  if (r.ok && 'queued' in r) { revalidatePath('/ops/ai'); revalidatePath('/ops'); }
  return r;
}

export async function unpublishArticleAction(id: string, reason?: string) {
  const u = await staff(); if (!u) return DENIED;
  return unpublishArticle(u, id, reason);
}

export async function scheduleArticleAction(id: string, when: string) {
  const u = await staff(); if (!u) return DENIED;
  return scheduleArticle(u, id, when);
}

export async function deleteArticleAction(id: string, reason?: string) {
  const u = await staff(); if (!u) return DENIED;
  return deleteArticle(u, id, reason);
}

export async function replaceInArticleAction(id: string, find: string, replace: string, opts: { all?: boolean; expectedUpdatedAt?: string | null } = {}) {
  const u = await staff(); if (!u) return DENIED;
  return replaceInArticle(u, id, find, replace, opts);
}

export async function upsertAuthorAction(input: unknown) {
  const u = await staff(); if (!u) return DENIED;
  const r = await upsertAuthor(u, input);
  if (r.ok) revalidatePath('/ops/magazine');
  return r;
}

export async function upsertCategoryAction(input: unknown) {
  const u = await staff(); if (!u) return DENIED;
  const r = await upsertCategory(u, input);
  if (r.ok) revalidatePath('/ops/magazine');
  return r;
}

export async function createTagAction(input: { name: string; slug?: string }) {
  const u = await staff(); if (!u) return DENIED;
  return createTag(u, input);
}

export async function uploadMediaAction(input: unknown) {
  const u = await staff(); if (!u) return DENIED;
  return uploadArticleImage(u, input);
}

export async function updateMediaAction(id: string, patch: unknown) {
  const u = await staff(); if (!u) return DENIED;
  return updateMedia(u, id, patch);
}

/** The approvals switch: publish_article files a proposal instead of publishing (needs full access to the area). */
export async function setMagazineApprovalAction(value: boolean): Promise<{ ok: boolean; error?: string }> {
  const u = await staff('full'); if (!u) return DENIED;
  const cur = await platformSettings();
  if (cur.magazinePublishApproval !== value) await savePlatformSettings(u.id, { magazinePublishApproval: value });
  revalidatePath('/ops/magazine');
  return { ok: true };
}
