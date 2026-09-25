// Server-side fetching of third-party websites without SSRF exposure.
//
// - Only http/https, only ports 80 and 443, no credentials in the URL.
// - The host must resolve to public addresses only. The check runs inside the socket's DNS lookup, so
//   the address that is connected is the address that was checked (no DNS-rebinding window).
// - Redirects are followed by hand, at most 5, and every hop is checked the same way.
// - Responses are capped in size and time. Content is returned as data only.

import { BlockList, isIP } from 'node:net';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { Agent } from 'undici';

const BLOCKED = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4], ['255.255.255.255', 32],
] as const) BLOCKED.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['100::', 64],
] as const) BLOCKED.addSubnet(net, bits, 'ipv6');
// IPv4-mapped (::ffff:0:0/96) and NAT64 (64:ff9b::/96) are handled below, not in the list: Node's BlockList
// matches every IPv4 address against a mapped-range rule, which would block the whole internet.

/** True for loopback, private, link-local (cloud metadata), CGNAT, documentation, multicast and mapped forms. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return BLOCKED.check(ip, 'ipv4');
  if (v === 6) {
    const lower = ip.toLowerCase();
    // IPv4-mapped / NAT64 forms, dotted or hex: never needed for a public website, so refuse them all.
    if (/^(::ffff:|64:ff9b::|::ffff:0:)/.test(lower) || /^0{0,4}(:0{0,4}){4}:ffff:/.test(lower)) return true;
    return BLOCKED.check(lower, 'ipv6');
  }
  return true; // not an IP at all: refuse
}

export class UnsafeUrlError extends Error {}

const isLoopback = (host: string) => (isIP(host) === 4 && host.startsWith('127.')) || host === '::1';

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  /** Test fixtures only: allow loopback and the reserved .test TLD (any port). Other private ranges stay blocked. */
  allowPrivate?: boolean;
}

export interface SafeResponse {
  url: string; // final URL after redirects
  status: number;
  headers: Headers;
  body: string;
  truncated: boolean;
  redirects: string[];
}

/** Validates one URL before any network activity. Throws UnsafeUrlError. */
export function checkUrl(raw: string, allowPrivate = false): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrlError('bad_url');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UnsafeUrlError('scheme');
  if (u.username || u.password) throw new UnsafeUrlError('credentials');
  const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
  if (port !== 80 && port !== 443 && !allowPrivate) throw new UnsafeUrlError('port');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const fixture = allowPrivate && (host === 'localhost' || host.endsWith('.test') || isLoopback(host));
  if (fixture) return u;
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local') || host.endsWith('.test')) throw new UnsafeUrlError('host');
  if (isIP(host) && isPrivateAddress(host)) throw new UnsafeUrlError('private_ip');
  return u;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** DNS lookup that fails when any resolved address is private. Used at connect time. */
export function guardedLookup(hostname: string, options: object, cb: LookupCb) {
  dnsLookup(hostname, { ...(options as object), all: true }, (err, addresses) => {
    if (err) return cb(err, [] as LookupAddress[]);
    const list = addresses as LookupAddress[];
    if (!list.length || list.some(a => isPrivateAddress(a.address))) {
      const e = new Error(`unsafe_address ${hostname}`) as NodeJS.ErrnoException;
      e.code = 'EUNSAFE';
      return cb(e, [] as LookupAddress[]);
    }
    const all = (options as { all?: boolean }).all;
    if (all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

const safeAgent = new Agent({ connect: { lookup: guardedLookup as never }, connections: 4 });
// Test mode only: the reserved ".test" TLD (RFC 2606, never public) resolves to loopback so each
// fixture site can be its own domain.
function testLookup(hostname: string, options: object, cb: LookupCb) {
  if (/\.test$/i.test(hostname)) return (options as { all?: boolean }).all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4);
  guardedLookup(hostname, options, cb);
}
const testAgent = new Agent({ connect: { lookup: testLookup as never }, connections: 4 });

export async function safeFetch(raw: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const { timeoutMs = 15_000, maxBytes = 1_500_000, maxRedirects = 5, headers = {}, allowPrivate = false } = opts;
  const redirects: string[] = [];
  let url = checkUrl(raw, allowPrivate);
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; ; hop++) {
    const res = await fetch(url, {
      headers,
      redirect: 'manual',
      signal,
      // @ts-expect-error undici dispatcher on Node's fetch
      dispatcher: allowPrivate ? testAgent : safeAgent,
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      if (hop >= maxRedirects) throw new UnsafeUrlError('too_many_redirects');
      await res.body?.cancel().catch(() => {});
      url = checkUrl(new URL(res.headers.get('location')!, url).toString(), allowPrivate);
      redirects.push(url.toString());
      continue;
    }
    // Read at most maxBytes; stop the stream beyond that.
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let truncated = false;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          chunks.push(value.slice(0, value.byteLength - (size - maxBytes)));
          truncated = true;
          await reader.cancel().catch(() => {});
          break;
        }
        chunks.push(value);
      }
    }
    const body = new TextDecoder('utf-8').decode(Buffer.concat(chunks));
    return { url: url.toString(), status: res.status, headers: res.headers, body, truncated, redirects };
  }
}
