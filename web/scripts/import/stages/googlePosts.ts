// Photos from the business's own posts on its Google profile (DataForSEO Google business updates), for
// listings that still have fewer than five photos after the website stage. The profile gallery shows one
// large and four small photos.
//
// Asynchronous: tasks are posted (up to 100 per request, reserved against the run budget first), then
// collected. A task that is not ready after about 20 minutes is left and reported.

import { Prisma, type ImportRun } from '@prisma/client';
import { BudgetExceeded, commit, release, reserve, uncertain, withCaps } from '../../../src/lib/import/budget';
import { largerGoogleImage } from '../../../src/lib/import/dataforseo';
import { pricing, toMicros } from '../../../src/lib/import/pricing';
import { bump, db, heartbeat, log, setStats, settings, Stop } from '../ctx';
import { dfsRequest } from '../providers/dataforseo';

const POST_PATH = '/v3/business_data/google/my_business_updates/task_post';
const GET_PATH = '/v3/business_data/google/my_business_updates/task_get/';
const ISRAEL = 2376; // DataForSEO location code
const TARGET = 5;
const BATCH = 100;

type Crawl = { imageCandidates?: { logos?: string[]; photos?: string[] }; postsTask?: string; postImages?: string[] } & Record<string, unknown>;

/** Posts tasks for the given records that need more photos and have a Google cid. */
export async function queuePostPhotos(run: ImportRun, placeIds: string[]) {
  const s = await settings();
  if (!s.googlePostPhotos || !s.dataforseoEnabled || s.killSwitch || !placeIds.length) return;
  const places = await db.importPlace.findMany({ where: { id: { in: placeIds }, provider: 'dataforseo', sourceId: { not: null } }, select: { id: true, sourceId: true, photoUrls: true, crawl: true } });
  const need = places.filter(p => {
    const c = (p.crawl ?? {}) as Crawl;
    const have = new Set([...p.photoUrls, ...(c.imageCandidates?.photos ?? [])]).size;
    return have < TARGET && !c.postsTask && /^\d+$/.test(p.sourceId!);
  });
  if (!need.length) return;
  const per = pricing().dataforseo.businessUpdates.perTaskUsd;
  for (let i = 0; i < need.length; i += BATCH) {
    await heartbeat(run.id);
    const batch = need.slice(i, i + BATCH);
    const requestKey = `posts:${run.id}:${batch[0].id}`;
    const estimate = toMicros(per * batch.length);
    try {
      const st = await reserve(db, withCaps({ runId: run.id, provider: 'dataforseo', endpoint: 'google/my_business_updates/task_post', requestKey, estimateMicros: estimate, meta: { tasks: batch.length } }));
      if (st === 'exists') continue;
    } catch (e) {
      if (e instanceof BudgetExceeded) {
        await setStats(run.id, { budgetHit: true });
        log('posts: budget reached, no more photo tasks');
        return;
      }
      throw e;
    }
    const res = await dfsRequest('POST', POST_PATH, batch.map(p => ({ keyword: `cid:${p.sourceId}`, location_code: ISRAEL, language_code: 'he', depth: 20, tag: p.id })));
    if (res.kind === 'not_sent') {
      await release(db, requestKey, res.message);
      return;
    }
    if (res.kind === 'uncertain') {
      await uncertain(db, requestKey, estimate, res.message);
      return;
    }
    if (res.kind === 'error') {
      if (res.costUsd != null) await commit(db, requestKey, toMicros(res.costUsd), estimate);
      else await release(db, requestKey, res.message);
      if (res.fatal) throw new Error(`DataForSEO ${res.code}: ${res.message}`);
      log('posts: task_post failed', res.code, res.message);
      return;
    }
    await commit(db, requestKey, typeof res.json.cost === 'number' ? toMicros(res.json.cost) : null, estimate);
    const ids: Array<{ id: string; placeId: string }> = [];
    for (const t of res.json.tasks ?? []) {
      const tag = (t as { data?: { tag?: string } }).data?.tag;
      if (t.id && tag && (t.status_code === 20100 || t.status_code === 20000)) ids.push({ id: t.id, placeId: tag });
    }
    for (const x of ids) {
      const p = batch.find(b => b.id === x.placeId)!;
      await db.importPlace.update({ where: { id: p.id }, data: { crawl: { ...((p.crawl as object) ?? {}), postsTask: x.id } as Prisma.InputJsonValue } });
    }
    await db.importTask.create({ data: { runId: run.id, key: `posts:${i}:${Date.now()}`, kind: 'posts_collect', params: { tasks: ids, since: Date.now() } } });
    await bump(run.id, { postTasks: ids.length });
  }
}

/** Collects finished post tasks. Returns true while tasks are still waiting. */
export async function collectPostPhotos(run: ImportRun): Promise<boolean> {
  const task = await db.importTask.findFirst({ where: { runId: run.id, kind: 'posts_collect', status: 'pending' }, orderBy: { createdAt: 'asc' } });
  if (!task) return false;
  await heartbeat(run.id);
  const s = await settings();
  if (s.killSwitch) throw new Stop('kill switch on');
  const params = task.params as { tasks: Array<{ id: string; placeId: string }>; since: number };
  const waiting: typeof params.tasks = [];
  let added = 0;
  for (const t of params.tasks) {
    const r = await dfsRequest('GET', `${GET_PATH}${t.id}`);
    if (r.kind !== 'ok') {
      waiting.push(t);
      continue;
    }
    const tk = r.json.tasks?.[0];
    if (!tk || (tk.status_code ?? 0) >= 40600 && (tk.status_code ?? 0) < 40700) {
      waiting.push(t); // queued or in progress
      continue;
    }
    const items = ((tk.result?.[0] as { items?: Array<{ images_url?: string | null }> } | undefined)?.items ?? []);
    const urls = [...new Set(items.map(i => i.images_url).filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u)).map(u => largerGoogleImage(u, 'photo')))].slice(0, 10);
    const p = await db.importPlace.findUnique({ where: { id: t.placeId } });
    if (!p) continue;
    const c = (p.crawl ?? {}) as Crawl & { editedFields?: string[] };
    const photos = c.editedFields?.includes('photoUrls') ? p.photoUrls : [...new Set([...p.photoUrls, ...urls])].slice(0, s.maxListingPhotos);
    await db.importPlace.update({
      where: { id: p.id },
      data: {
        photoUrls: photos,
        crawl: { ...c, postImages: urls, imageCandidates: { logos: c.imageCandidates?.logos ?? [], photos: [...new Set([...(c.imageCandidates?.photos ?? []), ...urls])] } } as Prisma.InputJsonValue,
      },
    });
    added += urls.length;
  }
  const expired = Date.now() - params.since > 20 * 60_000;
  if (!waiting.length || expired) {
    await db.importTask.update({ where: { id: task.id }, data: { status: 'done', found: added, error: waiting.length ? `${waiting.length} not ready after 20 minutes` : null } });
  } else {
    await db.importTask.update({ where: { id: task.id }, data: { params: { ...params, tasks: waiting } } });
    await new Promise(r => setTimeout(r, 30_000));
  }
  if (added) await bump(run.id, { postPhotos: added });
  return true;
}
