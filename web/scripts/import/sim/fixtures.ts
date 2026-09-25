// Local stand-ins for the paid provider and for business websites. Used by tests and by the
// simulated pilot (scripts/import/simulate.ts). Everything here is invented: no real business, no
// network access, no credentials. Each site gets its own hostname under the reserved .test TLD, which
// safeFetch resolves to loopback only when IMPORT_TEST_ALLOW_PRIVATE=1.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { deflateSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';
import type { DfsItem } from '../../../src/lib/import/dataforseo';

export type DfsMode = 'ok' | 'hang' | 'fatal' | 'transient' | 'bad_json';

export interface MockDfs {
  url: string;
  requests: Array<{ body: unknown; at: number }>;
  setMode: (m: DfsMode) => void;
  close: () => Promise<void>;
}

const listen = (srv: Server, host = '127.0.0.1') =>
  new Promise<number>(res => srv.listen(0, host, () => res((srv.address() as AddressInfo).port)));
const readBody = (req: IncomingMessage) =>
  new Promise<string>(res => {
    let s = '';
    req.on('data', c => (s += c));
    req.on('end', () => res(s));
  });

/**
 * DataForSEO Business Listings Search (live) look-alike. Pages through `items` with offset/limit and
 * reports cost the way the real API does (tasks[0].cost), using the reference rates.
 */
export async function startMockDfs(items: DfsItem[], opts: { perRequestUsd?: number; perItemUsd?: number } = {}): Promise<MockDfs> {
  const perRequest = opts.perRequestUsd ?? 0.012;
  const perItem = opts.perItemUsd ?? 0.00036;
  let mode: DfsMode = 'ok';
  const requests: MockDfs['requests'] = [];
  const srv = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const raw = await readBody(req);
    let body: Array<{ limit?: number; offset?: number; offset_token?: string }> = [];
    try {
      body = JSON.parse(raw);
    } catch {
      /* empty */
    }
    requests.push({ body, at: Date.now() });
    if (!/^Basic /.test(req.headers.authorization ?? '')) return void res.writeHead(401).end('{"status_code":40100,"status_message":"You are not authorized"}');
    if (mode === 'hang') return void req.socket.destroy(); // request received, no answer: billing unknown
    if (mode === 'bad_json') return void res.writeHead(502).end('<html>bad gateway</html>');
    res.setHeader('content-type', 'application/json');
    if (mode === 'fatal') return void res.end(JSON.stringify({ status_code: 40200, status_message: 'Payment Required.', cost: 0, tasks: [] }));
    if (mode === 'transient') return void res.end(JSON.stringify({ status_code: 50000, status_message: 'Internal Error.', cost: 0, tasks: [] }));
    const q = body[0] ?? {};
    const limit = Math.min(q.limit ?? 100, 1000);
    const offset = q.offset_token ? Number(Buffer.from(q.offset_token, 'base64').toString()) : q.offset ?? 0;
    const page = items.slice(offset, offset + limit);
    const next = offset + page.length;
    const cost = perRequest + page.length * perItem;
    res.end(
      JSON.stringify({
        version: 'mock', status_code: 20000, status_message: 'Ok.', cost, tasks_count: 1, tasks_error: 0,
        tasks: [{
          id: `mock-${requests.length}`, status_code: 20000, status_message: 'Ok.', cost, result_count: 1,
          result: [{ total_count: items.length, count: page.length, offset, offset_token: next < items.length ? Buffer.from(String(next)).toString('base64') : null, items: page }],
        }],
      }),
    );
  });
  const port = await listen(srv);
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    setMode: m => (mode = m),
    close: () => new Promise(r => srv.close(() => r())),
  };
}

export type SiteKind = 'full' | 'no_email' | 'agency_footer' | 'blocked' | 'robots' | 'conflict_phone' | 'redirect_private' | 'unrelated';

export interface FixtureSite {
  host: string; // site-N.test
  kind: SiteKind;
  email?: string;
  phone?: string; // national format shown on the site
}

// A real PNG of the given size (solid colour), so image checks see genuine dimensions.
const pngCache = new Map<string, Buffer>();
export function png(w: number, h: number): Buffer {
  const k = `${w}x${h}`;
  if (pngCache.has(k)) return pngCache.get(k)!;
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0xc8)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const out = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  pngCache.set(k, out);
  return out;
}

function page(title: string, body: string) {
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
}

/** Serves every fixture site from one server; the Host header picks the site. */
export async function startSites(sites: FixtureSite[]): Promise<{ port: number; hits: Map<string, number>; close: () => Promise<void> }> {
  const byHost = new Map(sites.map(s => [s.host, s]));
  const hits = new Map<string, number>();
  const srv = createServer((req, res) => {
    const host = (req.headers.host ?? '').split(':')[0];
    hits.set(host, (hits.get(host) ?? 0) + 1);
    const s = byHost.get(host);
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (!s) return void res.writeHead(404).end();
    if (path === '/robots.txt') {
      res.setHeader('content-type', 'text/plain');
      return void res.end(s.kind === 'robots' ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\n');
    }
    if (s.kind === 'blocked') return void res.writeHead(403, { 'content-type': 'text/html' }).end(page('Forbidden', 'Access denied'));
    if (s.kind === 'redirect_private') return void res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }).end();
    if (path === '/logo.png') return void res.writeHead(200, { 'content-type': 'image/png' }).end(png(240, 240));
    if (/^\/img\/photo-\d\.png$/.test(path)) return void res.writeHead(200, { 'content-type': 'image/png' }).end(png(960, 640));
    if (path === '/img/tiny.png') return void res.writeHead(200, { 'content-type': 'image/png' }).end(png(40, 40));
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (s.kind === 'unrelated') {
      // A different business entirely: its own name and phone.
      return void res.end(page('חנות רהיטים אחרת', '<h1>חנות רהיטים אחרת</h1><a href="tel:04-8123456">04-8123456</a><p>ספות ושולחנות</p>'));
    }
    const name = `עסק לדוגמה ${host.replace(/\D/g, '')}`;
    const nav = '<a href="/צור-קשר">צור קשר</a> <a href="/מחירון">מחירון</a> <a href="/blog/post">בלוג</a>';
    const footer = s.kind === 'agency_footer' ? '<footer>האתר נבנה ע"י סטודיו דוגמה studio@example-agency.test</footer>' : '';
    const imgs = '<header><img class="logo" src="/logo.png" alt="לוגו"></header><img src="/img/photo-1.png" width="960" height="640" alt="חדר טיפולים"><img src="/img/photo-2.png" width="960" height="640" alt="עמדת עבודה"><img src="/img/tiny.png" alt="אייקון">';
    const menu = '<h2>הטיפולים שלנו</h2><ul><li>טיפול פנים קלאסי</li><li>הרמת ריסים</li><li>עיצוב גבות</li><li>מניקור</li><li>אודות</li></ul>';
    if (path === '/' || path === '') return void res.end(page(name, `${imgs}<h1>${name}</h1>${nav}<p>ברוכים הבאים</p>${menu}${footer}`));
    if (path === '/צור-קשר') {
      const email = s.kind === 'no_email' || !s.email ? '' : `<a href="mailto:${s.email}">${s.email}</a>`;
      const phone = s.phone ? `<a href="tel:${s.phone}">${s.phone}</a>` : '';
      const ld = `<script type="application/ld+json">${JSON.stringify({ '@type': 'BeautySalon', name, telephone: s.phone, openingHoursSpecification: [{ dayOfWeek: 'Sunday', opens: '09:00', closes: '18:00' }] })}</script>`;
      return void res.end(page('צור קשר', `<h1>צור קשר</h1>${email} ${phone} <a href="https://wa.me/972501234567">וואטסאפ</a>${ld}${footer}`));
    }
    if (path === '/מחירון') return void res.end(page('מחירון', '<h1>מחירון</h1><p>טיפול פנים קלאסי ₪250</p><p>מניקור ג׳ל 120 ₪</p><div>הרמת ריסים</div><div>₪ 220</div><p>פדיקור 60 דק׳ - 180 ש"ח</p>'));
    res.writeHead(404).end();
  });
  const port = await listen(srv, '0.0.0.0');
  return { port, hits, close: () => new Promise(r => srv.close(() => r())) };
}

/** Invented DataForSEO items: city centres, Israeli phone formats, a few deliberate edge cases. */
export function fakeItems(n: number, sitePort: number | null, opts: { siteShare?: number } = {}): { items: DfsItem[]; sites: FixtureSite[] } {
  const cities = [
    { city: 'Tel Aviv-Yafo', lat: 32.0853, lng: 34.7818 },
    { city: 'Haifa', lat: 32.794, lng: 34.9896 },
    { city: 'Jerusalem', lat: 31.7683, lng: 35.2137 },
  ];
  const kinds: SiteKind[] = ['full', 'full', 'full', 'no_email', 'agency_footer', 'blocked', 'robots', 'conflict_phone', 'redirect_private', 'unrelated'];
  const items: DfsItem[] = [];
  const sites: FixtureSite[] = [];
  const siteShare = opts.siteShare ?? 0.6;
  for (let i = 0; i < n; i++) {
    const c = cities[i % cities.length];
    const phone = `03-${String(5000000 + i * 7).slice(0, 7).replace(/^(\d{3})/, '$1-')}`;
    const withSite = sitePort != null && i % 10 < siteShare * 10 && sites.length < 250;
    let url: string | undefined;
    if (withSite) {
      const host = `site-${i}.test`;
      const kind = kinds[sites.length % kinds.length];
      sites.push({ host, kind, email: `info@${host}`, phone: kind === 'conflict_phone' ? '03-7654321' : phone });
      url = `http://${host}:${sitePort}/`;
    }
    // The provider sometimes gives a directory page or a social profile instead of a website.
    if (!url && i % 13 === 5) url = `https://www.easy.co.il/page/${1000 + i}`;
    if (!url && i % 13 === 8) url = `https://www.instagram.com/sim_salon_${i}/`;
    // Google profile images (logo and main photo) served by the fixture image host.
    const gimg = sitePort != null && i % 3 === 0 ? `http://gimg.test:${sitePort}` : null;
    items.push({
      logo: gimg ? `${gimg}/logo.png` : undefined,
      main_image: gimg ? `${gimg}/img/photo-3.png` : undefined,
      contact_info: i % 17 === 4 ? [{ type: 'mail', value: `hello${i}@mail.test`, source: 'business' }] : undefined,
      type: 'business_listing',
      title: `סלון דוגמה ${i + 1}`,
      category: i % 2 ? 'Nail salon' : 'Beauty salon',
      category_ids: [i % 2 ? 'nail_salon' : 'beauty_salon'],
      cid: String(900000000000 + i),
      place_id: i % 7 === 0 ? undefined : `ChIJsim${String(i).padStart(6, '0')}xxxxxxxx`,
      address: `רחוב הדוגמה ${i + 1}, ${c.city}`,
      address_info: { city: c.city, country_code: 'IL' },
      phone: i % 11 === 0 ? undefined : phone,
      url,
      domain: url ? new URL(url).hostname.replace(/^www\./, '') : undefined,
      latitude: c.lat + (i % 10) * 0.001,
      longitude: c.lng + (i % 10) * 0.001,
      rating: { value: 4 + (i % 10) / 10, votes_count: 10 + i },
      work_time: { work_hours: { timetable: { sunday: [{ open: { hour: 9, minute: 0 }, close: { hour: 18, minute: 0 } }] } } },
      check_url: `https://www.google.com/maps?cid=${900000000000 + i}`,
      last_updated_time: '2026-09-01 10:00:00 +00:00',
    });
  }
  if (sitePort != null) sites.push({ host: 'gimg.test', kind: 'full' });
  // Same place twice (a provider repeat): must end up as one record.
  if (n > 3) items.push({ ...items[1] });
  // No coordinates: cannot be placed, skipped.
  items.push({ ...items[0], place_id: 'ChIJsimNOCOORDSxxxxxxxx', cid: '1', latitude: undefined, longitude: undefined });
  return { items, sites };
}
