// Official YouTube videos: validation and bounded channel discovery.
//
// Two access paths, both read-only and quota-aware:
// - YouTube Data API v3 when YOUTUBE_API_KEY is set: videos.list in batches of up to 50 ids (1 quota unit
//   per call) with snippet, contentDetails and status, which tells us whether embedding is allowed and
//   whether the video is public. Channel discovery: channels.list (1 unit) + playlistItems.list (1 unit)
//   on the uploads playlist, then one videos.list. Quota units are counted and capped per run.
// - Without a key: the public oEmbed endpoint (no key, no quota) confirms that a video exists and can be
//   embedded (private, deleted and embed-disabled videos answer 401/403/404). Channel discovery is not
//   possible without the key; a channel link alone is not a video section.
//
// Nothing is downloaded or rehosted. Titles are stored as given by YouTube (attribution).

import { safeFetch } from './safeFetch';

export interface VideoRecord {
  id: string;
  title: string | null;
  channelId: string | null;
  channelTitle: string | null;
  durationSec: number | null;
  thumbnail: string | null;
  source: 'website' | 'channel' | 'owner';
  sourceUrl: string | null;
  validatedAt: string;
  validatedVia: 'api' | 'oembed';
  embeddable: boolean;
  status: 'ok' | 'private' | 'not_found' | 'not_embeddable' | 'unknown';
}

export interface YoutubeOptions {
  apiKey?: string | null;
  /** Test fixtures only: base URLs of a local stand-in. */
  apiBase?: string;
  oembedBase?: string;
  allowPrivate?: boolean;
  /** Called with the quota units a call will use; return false to refuse it (cap reached). */
  quota?: (units: number) => boolean;
}

const API = 'https://www.googleapis.com/youtube/v3';
const OEMBED = 'https://www.youtube.com/oembed';
const HEADERS = { 'User-Agent': 'BeautyFindBot/1.0 (+https://beautyfind.co.il/bot)', Accept: 'application/json' };

/** ISO 8601 duration (PT2M14S) to seconds. */
export function isoDuration(s: string | undefined): number | null {
  const m = s?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

async function getJson(url: string, o: YoutubeOptions): Promise<{ status: number; json: unknown }> {
  const r = await safeFetch(url, { headers: HEADERS, timeoutMs: 12_000, maxBytes: 600_000, allowPrivate: o.allowPrivate });
  let json: unknown = null;
  try {
    json = JSON.parse(r.body);
  } catch {
    /* non-JSON answers are treated by status */
  }
  return { status: r.status, json };
}

const now = () => new Date().toISOString();

/** Validates video ids. With the API: one call per 50 ids; without it: one oEmbed request per id. */
export async function validateVideos(ids: string[], o: YoutubeOptions, source: VideoRecord['source'], sourceUrl: string | null): Promise<{ videos: VideoRecord[]; quotaUsed: number }> {
  const uniq = [...new Set(ids.filter(id => /^[A-Za-z0-9_-]{11}$/.test(id)))];
  const out: VideoRecord[] = [];
  let quotaUsed = 0;
  if (o.apiKey) {
    for (let i = 0; i < uniq.length; i += 50) {
      const batch = uniq.slice(i, i + 50);
      if (o.quota && !o.quota(1)) break;
      quotaUsed += 1;
      const q = new URLSearchParams({ part: 'snippet,contentDetails,status', id: batch.join(','), key: o.apiKey, maxResults: '50' });
      const { status, json } = await getJson(`${o.apiBase ?? API}/videos?${q}`, o);
      const items = status === 200 && json && typeof json === 'object' ? (((json as { items?: unknown[] }).items ?? []) as Array<Record<string, unknown>>) : [];
      const byId = new Map(items.map(it => [String(it.id), it]));
      for (const id of batch) {
        const it = byId.get(id);
        if (!it) {
          out.push({ id, title: null, channelId: null, channelTitle: null, durationSec: null, thumbnail: null, source, sourceUrl, validatedAt: now(), validatedVia: 'api', embeddable: false, status: status === 200 ? 'not_found' : 'unknown' });
          continue;
        }
        const sn = (it.snippet ?? {}) as Record<string, unknown>;
        const st = (it.status ?? {}) as Record<string, unknown>;
        const cd = (it.contentDetails ?? {}) as Record<string, unknown>;
        const isPublic = st.privacyStatus === 'public';
        const embeddable = st.embeddable === true && isPublic;
        const thumbs = (sn.thumbnails ?? {}) as Record<string, { url?: string }>;
        out.push({
          id, title: typeof sn.title === 'string' ? sn.title.slice(0, 160) : null, channelId: typeof sn.channelId === 'string' ? sn.channelId : null,
          channelTitle: typeof sn.channelTitle === 'string' ? sn.channelTitle : null, durationSec: isoDuration(cd.duration as string | undefined),
          thumbnail: thumbs.medium?.url ?? thumbs.default?.url ?? null, source, sourceUrl, validatedAt: now(), validatedVia: 'api', embeddable,
          status: !isPublic ? 'private' : embeddable ? 'ok' : 'not_embeddable',
        });
      }
    }
    return { videos: out, quotaUsed };
  }
  for (const id of uniq) {
    const q = new URLSearchParams({ url: `https://www.youtube.com/watch?v=${id}`, format: 'json' });
    let status = 0;
    let json: unknown = null;
    try {
      ({ status, json } = await getJson(`${o.oembedBase ?? OEMBED}?${q}`, o));
    } catch {
      status = 0;
    }
    const j = (json ?? {}) as Record<string, unknown>;
    const ok = status === 200 && typeof j.title === 'string';
    out.push({
      id, title: ok ? String(j.title).slice(0, 160) : null, channelId: null, channelTitle: ok && typeof j.author_name === 'string' ? j.author_name : null, durationSec: null,
      thumbnail: ok && typeof j.thumbnail_url === 'string' ? j.thumbnail_url : null, source, sourceUrl, validatedAt: now(), validatedVia: 'oembed', embeddable: ok,
      status: ok ? 'ok' : status === 404 ? 'not_found' : status === 401 || status === 403 ? 'not_embeddable' : status === 0 ? 'unknown' : 'private',
    });
  }
  return { videos: out, quotaUsed };
}

/**
 * Up to `take` recent uploads of a channel link (youtube.com/@handle, /channel/UC..., /c/name, /user/name).
 * API key required: 2 quota units, plus the validation call. Returns [] without a key.
 */
export async function channelUploads(channelUrl: string, o: YoutubeOptions, take = 10): Promise<{ ids: string[]; channelId: string | null; quotaUsed: number }> {
  if (!o.apiKey) return { ids: [], channelId: null, quotaUsed: 0 };
  let u: URL;
  try {
    u = new URL(channelUrl);
  } catch {
    return { ids: [], channelId: null, quotaUsed: 0 };
  }
  const [kind, name] = u.pathname.split('/').filter(Boolean);
  const params: Record<string, string> = { part: 'contentDetails', key: o.apiKey };
  if (kind?.startsWith('@')) params.forHandle = kind;
  else if (kind === 'channel' && name) params.id = name;
  else if ((kind === 'c' || kind === 'user') && name) params.forUsername = name;
  else return { ids: [], channelId: null, quotaUsed: 0 };
  if (o.quota && !o.quota(2)) return { ids: [], channelId: null, quotaUsed: 0 };
  const ch = await getJson(`${o.apiBase ?? API}/channels?${new URLSearchParams(params)}`, o);
  const item = (((ch.json as { items?: unknown[] } | null)?.items ?? [])[0] ?? null) as Record<string, unknown> | null;
  const uploads = ((item?.contentDetails as { relatedPlaylists?: { uploads?: string } } | undefined)?.relatedPlaylists?.uploads ?? null) as string | null;
  if (!uploads) return { ids: [], channelId: null, quotaUsed: 1 };
  const pl = await getJson(`${o.apiBase ?? API}/playlistItems?${new URLSearchParams({ part: 'contentDetails', playlistId: uploads, maxResults: String(Math.min(50, take)), key: o.apiKey })}`, o);
  const ids = ((((pl.json as { items?: unknown[] } | null)?.items ?? []) as Array<{ contentDetails?: { videoId?: string } }>).map(x => x.contentDetails?.videoId).filter((x): x is string => !!x));
  return { ids: ids.slice(0, take), channelId: typeof item?.id === 'string' ? item.id : null, quotaUsed: 2 };
}

/** Picks up to `max` playable videos, preferring ones from the official site over channel uploads. */
export function chooseVideos(videos: VideoRecord[], max = 3): VideoRecord[] {
  const ok = videos.filter(v => v.status === 'ok' && v.embeddable);
  const rank = (v: VideoRecord) => (v.source === 'owner' ? 0 : v.source === 'website' ? 1 : 2);
  return [...ok].sort((a, b) => rank(a) - rank(b)).slice(0, max);
}
