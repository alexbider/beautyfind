import 'server-only';
import { db } from './db';
import { googleAvailable } from './googleDisplay';
import { resolveServiceAccount } from './googleIndexing';
import { platformSettings } from './platformSettings';
import { getSettings as importSettings } from './importOps';
import { checkDatabase, checkSite } from './opsHealth';
import { INVOICE_PROVIDERS } from '@/lib/vendors/invoicing/registry';
import { PAYMENT_PROVIDERS } from '@/lib/vendors/payments/registry';

// Platform-level integrations for /ops/integrations: what is wired in code, what is configured in this
// deployment (secret present), what businesses have connected, and what is not built yet. Each card is
// measured; a card that says "not connected" says why. Secrets are never read into the page, only
// their presence.

export type IntegrationState = 'connected' | 'attention' | 'not_connected' | 'unavailable';
export interface Integration {
  key: string;
  name: string;
  desc: string;
  state: IntegrationState;
  note: string; // where it stands now (last sync, counts, or why not connected)
  where: string; // where the secret or setting lives
  checkable: boolean;
  href?: string; // the admin screen where it is set up
}
export interface IntegrationGroup { name: string; items: Integration[] }

const has = (k: string) => Boolean(process.env[k]);
const rel = (d: Date | null) => (d ? `דיווח אחרון ${Math.max(0, Math.round((Date.now() - d.getTime()) / 60_000))} דק׳` : 'העובד עוד לא דיווח');

export async function integrationGroups(): Promise<IntegrationGroup[]> {
  const [conns, s, gKey, gOn] = await Promise.all([
    db.providerConnection.groupBy({ by: ['provider', 'kind', 'status'], _count: true }).catch(() => []),
    importSettings().catch(() => null),
    resolveServiceAccount().catch(() => null),
    platformSettings().then(p => p.googleIndexing.enabled).catch(() => false),
  ]);
  const w = s?.workerStatus ?? null;
  const wAt = w?.at ? new Date(w.at) : null;
  const count = (provider: string, kind: string, status: string) => conns.find(c => c.provider === provider && c.kind === kind && c.status === status)?._count ?? 0;
  const businessProvider = (p: { key: string; name: string; available: boolean; kind: string }, desc: string): Integration => {
    const ok = count(p.key, p.kind, 'connected');
    const err = count(p.key, p.kind, 'error');
    if (!p.available) return { key: `${p.kind}:${p.key}`, name: p.name, desc, state: 'unavailable', note: 'המתאם עוד לא מומש; עסקים לא יכולים לחבר', where: `src/lib/vendors/${p.kind}`, checkable: false };
    if (err) return { key: `${p.kind}:${p.key}`, name: p.name, desc, state: 'attention', note: `${ok} עסקים מחוברים · ${err} בשגיאה`, where: 'חיבור לכל עסק מלוח הניהול שלו', checkable: false };
    return { key: `${p.kind}:${p.key}`, name: p.name, desc, state: ok ? 'connected' : 'not_connected', note: ok ? `${ok} עסקים מחוברים` : 'אף עסק עוד לא חיבר', where: 'חיבור לכל עסק מלוח הניהול שלו', checkable: false };
  };
  const workerKey = (key: string, name: string, desc: string, flag: boolean | undefined | null, where: string): Integration => ({
    key, name, desc,
    state: w ? (flag ? 'connected' : 'not_connected') : 'not_connected',
    note: w ? (flag ? rel(wAt) : 'הסוד חסר אצל העובד') : 'העובד עוד לא דיווח',
    where, checkable: false,
  });
  const messaging = process.env.MESSAGING_ADAPTER ?? 'console';
  const msg = (key: string, name: string, desc: string): Integration => ({
    key, name, desc,
    state: messaging === 'console' ? 'not_connected' : 'connected',
    note: messaging === 'console' ? 'MESSAGING_ADAPTER=console: הודעות נרשמות ללוג בלבד' : `ספק: ${messaging}`,
    where: 'MESSAGING_ADAPTER בסביבת האתר',
    checkable: false,
  });
  const notBuilt = (key: string, name: string, desc: string): Integration => ({ key, name, desc, state: 'unavailable', note: 'עוד לא מחובר בקוד', where: '—', checkable: false });

  const payments: IntegrationGroup = {
    name: 'תשלומים',
    items: PAYMENT_PROVIDERS.filter(p => p.key !== 'sandbox').map(p => businessProvider(p, p.key === 'cardcom' ? 'סליקה, טוקנים וחיוב חוזר למנויים' : 'סליקה לקליניקות')).concat([
      { key: 'payments:sandbox', name: 'סביבת בדיקה', desc: 'סליקה מדומה לפיתוח והדגמות', state: process.env.NODE_ENV === 'production' && process.env.ALLOW_SANDBOX_PAYMENTS !== '1' ? 'not_connected' : 'connected', note: process.env.NODE_ENV === 'production' && process.env.ALLOW_SANDBOX_PAYMENTS !== '1' ? 'חסום בייצור' : `${count('sandbox', 'payments', 'connected')} עסקים מחוברים`, where: 'ALLOW_SANDBOX_PAYMENTS', checkable: false },
    ]),
  };
  const invoicing: IntegrationGroup = {
    name: 'חשבוניות ומיסוי',
    items: [
      ...INVOICE_PROVIDERS.filter(p => p.key !== 'sandbox').map(p => businessProvider(p, 'הפקת חשבוניות מס, קבלות וזיכויים')),
      notBuilt('tax:allocation', 'רשות המסים · מספרי הקצאה', 'בקשת מספר הקצאה לחשבוניות מעל הסף'),
    ],
  };
  const messages: IntegrationGroup = {
    name: 'הודעות',
    items: [msg('msg:whatsapp', 'WhatsApp Business', 'אישורי תור, תזכורות, הודעות שירות'), msg('msg:sms', 'SMS', 'גיבוי לוואטסאפ ו־OTP'), msg('msg:email', 'אימייל', 'חשבוניות, איפוס סיסמה, דיוור')],
  };
  const calendars: IntegrationGroup = {
    name: 'יומנים',
    items: [
      { ...notBuilt('calendar:google', 'Google Calendar', 'סנכרון דו־כיווני ליומני סניפים'), note: count('google', 'calendar', 'connected') ? `${count('google', 'calendar', 'connected')} חיבורים` : 'עוד לא מחובר בקוד' },
      notBuilt('calendar:microsoft', 'Microsoft 365', 'סנכרון דו־כיווני'),
      notBuilt('calendar:ical', 'iCal', 'קישורי מנוי לקריאה'),
    ],
  };
  const analytics: IntegrationGroup = {
    name: 'אנליטיקס ונתונים',
    items: [
      notBuilt('analytics:ga4', 'Google Analytics 4', 'תנועה, משפכי הזמנה, המרות'),
      notBuilt('analytics:gsc', 'Google Search Console', 'אינדקס, ביטויים, Core Web Vitals'),
      { key: 'google:indexing', name: 'Google Indexing API', desc: 'שליחת עמודים חדשים ועמודים שלא באינדקס לגוגל, ובדיקת מצב האינדקס', state: gKey && gOn ? 'connected' : 'not_connected', note: !gKey ? 'לא הועלה מפתח של חשבון שירות' : gOn ? `פעיל · ${gKey.sa.clientEmail}` : `מפתח קיים (${gKey.sa.clientEmail}); האינדוקס כבוי`, where: '/ops/content?tab=google', checkable: false, href: '/ops/content?tab=google' },
      { key: 'google:places', name: 'Google Places (New)', desc: 'דירוגי גוגל ושעות לפרופילים, בפעולה מפורשת של צוות', state: googleAvailable() ? 'connected' : 'not_connected', note: googleAvailable() ? 'מופעל' : has('GOOGLE_MAPS_API_KEY') ? 'מפתח קיים; GOOGLE_ENRICHMENT_ENABLED כבוי' : 'חסר GOOGLE_MAPS_API_KEY', where: 'GOOGLE_MAPS_API_KEY, GOOGLE_ENRICHMENT_ENABLED', checkable: true },
      { key: 'google:embed', name: 'Google Maps Embed', desc: 'מפה בפרופילי העסקים', state: has('NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY') ? 'connected' : 'not_connected', note: has('NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY') ? 'מפתח מוגדר' : 'חסר מפתח', where: 'NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY', checkable: true },
    ],
  };
  const sources: IntegrationGroup = {
    name: 'מקורות ייבוא',
    items: [
      workerKey('src:dataforseo', 'DataForSEO', 'תוצאות Google Maps וחיפוש', w?.dataforseo, 'DATAFORSEO_LOGIN/PASSWORD ב־GitHub Secrets'),
      workerKey('src:apify', 'Apify', 'Google Maps, פייסבוק ואינסטגרם', w?.apify, 'APIFY_TOKEN ב־GitHub Secrets'),
      workerKey('src:openai', 'OpenAI · ChatGPT', 'מחקר רשת וכתיבת תיאורים', w?.openai, 'OPENAI_API_KEY ב־GitHub Secrets'),
      workerKey('src:anthropic', 'Anthropic · Claude', 'כותב חלופי בייבוא', w?.anthropic, 'ANTHROPIC_API_KEY ב־GitHub Secrets'),
      workerKey('src:youtube', 'YouTube Data API', 'אימות סרטונים', w?.youtube, 'YOUTUBE_API_KEY ב־GitHub Secrets'),
      workerKey('src:browser', 'Chromium · Crawlee', 'רינדור אתרים שדורשים דפדפן', w?.browser, 'מותקן בתמונת העובד'),
    ],
  };
  const blob = process.env.STORAGE_ADAPTER === 'blob' || has('BLOB_READ_WRITE_TOKEN');
  const ops: IntegrationGroup = {
    name: 'תפעול',
    items: [
      { key: 'ops:db', name: 'מסד נתונים · Postgres', desc: 'Neon דרך Prisma', state: 'connected', note: 'נבדק בלחיצה', where: 'DATABASE_URL', checkable: true },
      { key: 'ops:site', name: 'אתר ציבורי', desc: 'הפריסה הנוכחית עונה', state: 'connected', note: 'נבדק בלחיצה', where: 'SITE_URL', checkable: true },
      { key: 'ops:blob', name: 'אחסון תמונות · Vercel Blob', desc: 'תמונות פרופיל ומסמכים', state: blob ? 'connected' : 'not_connected', note: blob ? 'מחובר' : 'אחסון מקומי (UPLOAD_DIR)', where: 'STORAGE_ADAPTER, BLOB_READ_WRITE_TOKEN', checkable: true },
      { key: 'ops:github', name: 'עובד הייבוא · GitHub Actions', desc: 'הפעלת ריצות ייבוא מהניהול', state: has('GITHUB_DISPATCH_TOKEN') ? 'connected' : 'not_connected', note: has('GITHUB_DISPATCH_TOKEN') ? 'טוקן מוגדר' : 'חסר GITHUB_DISPATCH_TOKEN: ריצות מחכות להפעלה ידנית', where: 'GITHUB_DISPATCH_TOKEN, GITHUB_REPOSITORY_SLUG', checkable: true },
      { key: 'ops:revalidate', name: 'רענון עמודים · Revalidate', desc: 'העובד מרענן עמודים אחרי פרסום', state: has('REVALIDATE_SECRET') ? 'connected' : 'not_connected', note: has('REVALIDATE_SECRET') ? 'סוד מוגדר' : 'חסר REVALIDATE_SECRET', where: 'REVALIDATE_SECRET (Vercel ו־GitHub)', checkable: true },
      { key: 'ops:assistant', name: 'עוזר התפעול · Anthropic', desc: 'הצ׳אט ב־AI ו־MCP', state: has('ANTHROPIC_API_KEY') ? 'connected' : 'not_connected', note: has('ANTHROPIC_API_KEY') ? 'מפתח מוגדר' : 'חסר ANTHROPIC_API_KEY באתר', where: 'ANTHROPIC_API_KEY בסביבת האתר', checkable: true },
      notBuilt('ops:sentry', 'Sentry', 'ניטור שגיאות'),
      notBuilt('ops:slack', 'Slack', 'התראות תפעול וכספים לערוצים'),
      { key: 'ops:backup', name: 'גיבוי מסד נתונים', desc: 'שחזור לנקודת זמן', state: 'unavailable', note: 'מנוהל בחשבון Neon, לא מהאפליקציה', where: 'Neon console', checkable: false },
    ],
  };
  return [payments, invoicing, messages, calendars, analytics, sources, ops];
}

export interface CheckResult { ok: boolean; note: string; ms: number | null }

/** A free check for one card: no paid call, no secret printed. */
export async function checkIntegration(key: string): Promise<CheckResult> {
  const t0 = Date.now();
  const timed = (ok: boolean, note: string): CheckResult => ({ ok, note, ms: Date.now() - t0 });
  switch (key) {
    case 'ops:db': {
      const r = await checkDatabase();
      return { ok: r.state === 'ok', note: r.note, ms: r.ms };
    }
    case 'ops:site': {
      const r = await checkSite();
      return { ok: r.state === 'ok', note: r.note, ms: r.ms };
    }
    case 'ops:blob':
      return timed(process.env.STORAGE_ADAPTER === 'blob' || has('BLOB_READ_WRITE_TOKEN'), has('BLOB_READ_WRITE_TOKEN') ? 'טוקן Blob קיים' : 'אין טוקן Blob; אחסון מקומי');
    case 'ops:github': {
      const token = process.env.GITHUB_DISPATCH_TOKEN;
      if (!token) return timed(false, 'חסר GITHUB_DISPATCH_TOKEN');
      const repo = process.env.GITHUB_REPOSITORY_SLUG || 'alexbider/beautyfind';
      try {
        const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/import.yml`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(8000), cache: 'no-store' });
        if (res.status === 200) { const j = (await res.json()) as { state?: string }; return timed(j.state === 'active', `workflow ${j.state ?? '?'}`); }
        return timed(false, `GitHub HTTP ${res.status}`);
      } catch (e) {
        return timed(false, `לא הושגה תשובה: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`);
      }
    }
    case 'ops:revalidate':
      return timed(has('REVALIDATE_SECRET'), has('REVALIDATE_SECRET') ? 'סוד מוגדר' : 'חסר REVALIDATE_SECRET');
    case 'ops:assistant':
      return timed(has('ANTHROPIC_API_KEY'), has('ANTHROPIC_API_KEY') ? 'מפתח מוגדר (לא נשלחה בקשה למודל)' : 'חסר ANTHROPIC_API_KEY');
    case 'google:places':
      return timed(googleAvailable(), googleAvailable() ? 'מופעל (לא נשלחה בקשה בתשלום)' : 'כבוי או חסר מפתח');
    case 'google:embed':
      return timed(has('NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY'), has('NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY') ? 'מפתח מוגדר' : 'חסר מפתח');
    default:
      return timed(false, 'אין בדיקה אוטומטית לפריט הזה');
  }
}
