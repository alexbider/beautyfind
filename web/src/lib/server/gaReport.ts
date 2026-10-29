import 'server-only';
import { createSign } from 'node:crypto';
import { resolveServiceAccount, type ServiceAccount } from './googleIndexing';
import { platformSettings } from './platformSettings';

// Google Analytics Data API, for the admin performance tab. Reads the profile_view events the public
// site sends with a profile_id parameter (src/components/profile/ProfileView.tsx). Needs the GA4 property
// ID on /ops/settings, the service account added as a Viewer on that property, and profile_id registered
// as an event-scoped custom dimension in GA.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

let cached: { email: string; token: string; until: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cached && cached.email === sa.clientEmail && cached.until > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const signature = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(sa.privateKey);
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${b64url(signature)}` }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!r.ok || !j.access_token) throw new Error(`token: ${j.error_description ?? j.error ?? r.status}`);
  cached = { email: sa.clientEmail, token: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

export type ProfileViewsResult =
  | { ok: true; days: number; total: number; rows: { profileId: string; views: number }[] }
  | { ok: false; reason: 'no_property' | 'no_key' | 'error'; message: string };

export async function gaProfileViews(days = 30): Promise<ProfileViewsResult> {
  const { analyticsPropertyId } = await platformSettings();
  if (!analyticsPropertyId) return { ok: false, reason: 'no_property', message: 'עוד לא הוגדר מזהה נכס GA4 ב־/ops/settings' };
  const key = await resolveServiceAccount().catch(() => null);
  if (!key) return { ok: false, reason: 'no_key', message: 'אין מפתח שירות של Google מוגדר' };
  try {
    const token = await accessToken(key.sa);
    const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${analyticsPropertyId}:runReport`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
        dimensions: [{ name: 'customEvent:profile_id' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { value: 'profile_view' } } },
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        limit: 20,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const j = (await r.json().catch(() => ({}))) as { error?: { message?: string }; rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[] };
    if (!r.ok) return { ok: false, reason: 'error', message: j.error?.message ?? `HTTP ${r.status}` };
    const rows = (j.rows ?? []).map(x => ({ profileId: x.dimensionValues[0]?.value ?? '', views: Number(x.metricValues[0]?.value ?? 0) }))
      .filter(x => x.profileId && x.profileId !== '(not set)');
    return { ok: true, days, total: rows.reduce((n, x) => n + x.views, 0), rows };
  } catch (e) {
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : 'שגיאה' };
  }
}
