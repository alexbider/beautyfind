// ChatGPT (OpenAI) as a research source and as the profile writer. Pure code: the research request,
// its answer schema, and how a cited answer becomes facts on an import record. The HTTP client is
// scripts/import/providers/openai.ts; the worker stage is scripts/import/stages/research.ts.
//
// Research rule: the model may only report a fact together with the public page it read it on. A fact
// without a source URL is dropped here before it can reach a record. The record then keeps every fact
// as an observation with that URL, fills only empty fields, and the usual checks apply: a website the
// model names is crawled and must belong to the business; an email found by search is marked
// email_from_search for a person to confirm; social accounts stay unverified until a profile or the
// site confirms them.

import { cleanEmail } from './email';
import { normalizeIlPhone } from './phone';
import type { DayHours, ImportedPriceType } from './rules';
import { classifyWebsite, socialOf } from './websiteKind';

export const RESEARCH_PROMPT_VERSION = '2026-09-28.1';

export interface ResearchSubject {
  name: string;
  address: string;
  cityName: string | null;
  phone: string | null;
  website: string | null;
  categories: string[]; // Hebrew names
  known: string[]; // what the record already has (so the model looks for the rest)
  missing: string[]; // what to look for, in plain words
}

export const RESEARCH_SYSTEM = `You research one Israeli beauty or aesthetics business for a directory listing. Use web search to read the business's own pages (its website, its Instagram or Facebook page, its Google Business Profile, booking pages it links to) and reputable directories. Report only facts you actually read, and give for every fact the exact URL of the page you read it on. Never guess, never infer from similar businesses, never invent a price, an hour, a person or an address. If a fact is not found, leave it out. Prefer the business's own pages over third-party listings. Do not report reviews or ratings text. Do not report anything about a different business with a similar name: the phone number and the city must match the business you were given.`;

export const RESEARCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['website', 'phone', 'email', 'whatsapp', 'instagram', 'facebook', 'tiktok', 'youtube', 'booking', 'hours', 'services', 'team', 'languages', 'establishedYear', 'accessible', 'freeParking', 'summary', 'notFound'],
  properties: {
    website: { type: ['object', 'null'], additionalProperties: false, required: ['value', 'sourceUrl'], properties: { value: { type: 'string' }, sourceUrl: { type: 'string' } } },
    phone: { type: ['object', 'null'], additionalProperties: false, required: ['value', 'sourceUrl'], properties: { value: { type: 'string' }, sourceUrl: { type: 'string' } } },
    email: { type: ['object', 'null'], additionalProperties: false, required: ['value', 'sourceUrl'], properties: { value: { type: 'string' }, sourceUrl: { type: 'string' } } },
    whatsapp: { type: ['object', 'null'], additionalProperties: false, required: ['value', 'sourceUrl'], properties: { value: { type: 'string' }, sourceUrl: { type: 'string' } } },
    instagram: { type: ['object', 'null'], additionalProperties: false, required: ['value', 'sourceUrl'], properties: { value: { type: 'string' }, sourceUrl: { type: 'string' } } },
    facebook: { type: ['object', 'null'], additionalProperties: false, required: ['value', 'sourceUrl'], properties: { value: { type: 'string' }, sourceUrl: { type: 'string' } } },
    tiktok: { type: ['object', 'null'], additionalProperties: false, required: ['value', 'sourceUrl'], properties: { value: { type: 'string' }, sourceUrl: { type: 'string' } } },
    youtube: { type: ['object', 'null'], additionalProperties: false, required: ['value', 'sourceUrl'], properties: { value: { type: 'string' }, sourceUrl: { type: 'string' } } },
    booking: { type: ['object', 'null'], additionalProperties: false, required: ['value', 'sourceUrl'], properties: { value: { type: 'string' }, sourceUrl: { type: 'string' } } },
    hours: {
      type: ['object', 'null'], additionalProperties: false, required: ['days', 'sourceUrl'],
      properties: { sourceUrl: { type: 'string' }, days: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['day', 'open', 'close', 'closed'], properties: { day: { type: 'integer', minimum: 0, maximum: 6, description: '0 = Sunday' }, open: { type: 'string', description: 'HH:MM, empty when closed' }, close: { type: 'string' }, closed: { type: 'boolean' } } } } },
    },
    services: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'priceNis', 'priceType', 'durationMin', 'sourceUrl', 'quote'], properties: { name: { type: 'string' }, priceNis: { type: ['number', 'null'] }, priceType: { type: 'string', enum: ['fixed', 'from', 'range', 'package', 'free', 'on_request'] }, durationMin: { type: ['integer', 'null'] }, sourceUrl: { type: 'string' }, quote: { type: 'string', description: 'the line on the page, verbatim' } } } },
    team: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'role', 'sourceUrl'], properties: { name: { type: 'string' }, role: { type: 'string' }, sourceUrl: { type: 'string' } } } },
    languages: { type: ['object', 'null'], additionalProperties: false, required: ['value', 'sourceUrl'], properties: { value: { type: 'array', items: { type: 'string' } }, sourceUrl: { type: 'string' } } },
    establishedYear: { type: ['object', 'null'], additionalProperties: false, required: ['value', 'sourceUrl'], properties: { value: { type: 'integer' }, sourceUrl: { type: 'string' } } },
    accessible: { type: ['object', 'null'], additionalProperties: false, required: ['value', 'sourceUrl'], properties: { value: { type: 'boolean' }, sourceUrl: { type: 'string' } } },
    freeParking: { type: ['object', 'null'], additionalProperties: false, required: ['value', 'sourceUrl'], properties: { value: { type: 'boolean' }, sourceUrl: { type: 'string' } } },
    summary: { type: 'array', description: 'Short factual notes about the business, each with the page it comes from', items: { type: 'object', additionalProperties: false, required: ['text', 'sourceUrl'], properties: { text: { type: 'string' }, sourceUrl: { type: 'string' } } } },
    notFound: { type: 'array', items: { type: 'string' }, description: 'what you looked for and could not find' },
  },
} as const;

export function researchMessage(s: ResearchSubject): string {
  return [
    `Business: ${s.name}`,
    `Address: ${s.address}${s.cityName ? ` (${s.cityName})` : ''}`,
    s.phone ? `Phone on record: ${s.phone}` : 'Phone on record: none',
    s.website ? `Website on record: ${s.website}` : 'Website on record: none',
    s.categories.length ? `Field: ${s.categories.join(', ')}` : '',
    s.known.length ? `Already known (no need to repeat): ${s.known.join(', ')}` : '',
    `Look for: ${s.missing.join(', ')}.`,
    'Answer in the JSON schema. Every value needs the URL of the page you read it on. Hebrew text stays Hebrew.',
  ].filter(Boolean).join('\n');
}

/** What the research step is asked to find, from the record's missing template sections. */
export function researchTargets(missing: string[]): string[] {
  const want = new Set<string>();
  const add = (...xs: string[]) => xs.forEach(x => want.add(x));
  for (const m of missing) {
    if (m === 'contact') add('official website', 'phone', 'email', 'WhatsApp', 'Instagram', 'Facebook');
    if (m === 'hours') add('opening hours');
    if (m === 'services') add('services and prices');
    if (m === 'about' || m === 'faq') add('what the business does, its specialities and premises', 'official website');
    if (m === 'team') add('team members with roles');
    if (m === 'facts') add('founding year', 'languages spoken', 'team size');
    if (m === 'chips') add('wheelchair access', 'free parking');
    if (m === 'video') add('YouTube channel');
    if (m === 'hero' || m === 'identity') add('official website', 'Instagram');
  }
  return [...want];
}

type Cited<T> = { value: T; sourceUrl: string } | null | undefined;

export interface ResearchAnswer {
  website?: Cited<string>;
  phone?: Cited<string>;
  email?: Cited<string>;
  whatsapp?: Cited<string>;
  instagram?: Cited<string>;
  facebook?: Cited<string>;
  tiktok?: Cited<string>;
  youtube?: Cited<string>;
  booking?: Cited<string>;
  hours?: { days: Array<{ day: number; open: string; close: string; closed: boolean }>; sourceUrl: string } | null;
  services?: Array<{ name: string; priceNis: number | null; priceType: string; durationMin: number | null; sourceUrl: string; quote: string }>;
  team?: Array<{ name: string; role: string; sourceUrl: string }>;
  languages?: Cited<string[]>;
  establishedYear?: Cited<number>;
  accessible?: Cited<boolean>;
  freeParking?: Cited<boolean>;
  summary?: Array<{ text: string; sourceUrl: string }>;
  notFound?: string[];
}

export interface Fact<T> {
  value: T;
  sourceUrl: string;
}

export interface ResearchFacts {
  website: Fact<string> | null; // an own site or a social profile, classified
  websiteKind: string | null;
  phone: Fact<string> | null;
  email: Fact<string> | null;
  whatsapp: Fact<string> | null;
  socials: Array<{ network: string; url: string; sourceUrl: string }>;
  booking: Fact<string> | null;
  hours: Fact<DayHours[]> | null;
  services: Array<{ name: string; priceNis: number | null; priceType: ImportedPriceType; durationMin: number | null; sourceUrl: string; quote: string }>;
  team: Array<{ name: string; role: string; sourceUrl: string }>;
  languages: Fact<string[]> | null;
  establishedYear: Fact<number> | null;
  accessible: Fact<boolean> | null;
  freeParking: Fact<boolean> | null;
  notes: Array<{ text: string; sourceUrl: string }>;
  notFound: string[];
  sources: string[]; // every URL cited
  dropped: number; // facts that came without a usable source URL
}

const url = (u: unknown): string | null => {
  if (typeof u !== 'string') return null;
  const t = u.trim();
  if (!/^https?:\/\/[^\s]+$/i.test(t)) return null;
  try {
    const p = new URL(t);
    return ['http:', 'https:'].includes(p.protocol) ? p.toString() : null;
  } catch {
    return null;
  }
};

const clock = (s: string) => (/^([01]?\d|2[0-3]):[0-5]\d$/.test(s.trim()) ? s.trim().padStart(5, '0') : null);

/** Answer to facts. Anything without a page URL is dropped and counted; phones and emails are normalized. */
export function researchFacts(a: ResearchAnswer): ResearchFacts {
  let dropped = 0;
  const sources = new Set<string>();
  const cited = <T>(c: Cited<T> | undefined): Fact<T> | null => {
    if (!c || c.value == null) return null;
    const u = url(c.sourceUrl);
    if (!u) {
      dropped++;
      return null;
    }
    sources.add(u);
    return { value: c.value, sourceUrl: u };
  };
  const site = cited(a.website);
  const w = site ? classifyWebsite(site.value) : null;
  const socials: ResearchFacts['socials'] = [];
  for (const net of ['instagram', 'facebook', 'tiktok', 'youtube'] as const) {
    const f = cited(a[net]);
    const s = f ? socialOf(f.value) : null;
    if (f && s && s.network === net) socials.push({ network: net, url: s.url, sourceUrl: f.sourceUrl });
  }
  if (w && w.kind === 'social' && w.url) {
    const s = socialOf(w.url);
    if (s && !socials.some(x => x.network === s.network)) socials.push({ network: s.network, url: s.url, sourceUrl: site!.sourceUrl });
  }
  const phone = cited(a.phone);
  const email = cited(a.email);
  const wa = cited(a.whatsapp);
  const hoursRaw = a.hours && url(a.hours.sourceUrl) ? a.hours : null;
  if (a.hours && !hoursRaw) dropped++;
  let hours: Fact<DayHours[]> | null = null;
  if (hoursRaw && Array.isArray(hoursRaw.days) && hoursRaw.days.length) {
    const days: DayHours[] = Array.from({ length: 7 }, () => ({ open: '', close: '', closed: false, unknown: true }));
    let any = false;
    for (const d of hoursRaw.days) {
      if (typeof d.day !== 'number' || d.day < 0 || d.day > 6) continue;
      if (d.closed) {
        days[d.day] = { open: '', close: '', closed: true };
        any = true;
        continue;
      }
      const o = clock(d.open ?? '');
      const c = clock(d.close ?? '');
      if (o && c) {
        days[d.day] = { open: o, close: c, closed: false };
        any = true;
      }
    }
    if (any) {
      hours = { value: days, sourceUrl: url(hoursRaw.sourceUrl)! };
      sources.add(hours.sourceUrl);
    }
  }
  const services: ResearchFacts['services'] = [];
  for (const s of a.services ?? []) {
    const u = url(s.sourceUrl);
    if (!u || !s.name?.trim()) {
      dropped++;
      continue;
    }
    sources.add(u);
    const price = typeof s.priceNis === 'number' && s.priceNis > 0 && s.priceNis < 100_000 ? Math.round(s.priceNis) : null;
    const type = (['fixed', 'from', 'range', 'package', 'free', 'on_request'].includes(s.priceType) ? s.priceType : price ? 'fixed' : 'on_request') as ImportedPriceType;
    services.push({ name: s.name.trim().slice(0, 120), priceNis: type === 'free' ? null : price, priceType: price || type === 'free' ? type : 'on_request', durationMin: typeof s.durationMin === 'number' && s.durationMin > 0 && s.durationMin < 600 ? s.durationMin : null, sourceUrl: u, quote: (s.quote ?? '').slice(0, 200) });
  }
  const team: ResearchFacts['team'] = [];
  for (const t of a.team ?? []) {
    const u = url(t.sourceUrl);
    if (!u || !t.name?.trim() || !t.role?.trim()) {
      dropped++;
      continue;
    }
    sources.add(u);
    team.push({ name: t.name.trim().slice(0, 80), role: t.role.trim().slice(0, 80), sourceUrl: u });
  }
  const languages = cited(a.languages);
  const year = cited(a.establishedYear);
  const notes: ResearchFacts['notes'] = [];
  for (const n of a.summary ?? []) {
    const u = url(n.sourceUrl);
    if (!u || !n.text?.trim()) {
      dropped++;
      continue;
    }
    sources.add(u);
    notes.push({ text: n.text.trim().slice(0, 300), sourceUrl: u });
  }
  const bookingRaw = cited(a.booking);
  const booking = bookingRaw && classifyWebsite(bookingRaw.value).kind === 'booking' ? { value: classifyWebsite(bookingRaw.value).url!, sourceUrl: bookingRaw.sourceUrl } : null;
  return {
    website: w && w.url && (w.kind === 'own' || w.kind === 'linkhub') ? { value: w.url, sourceUrl: site!.sourceUrl } : null,
    websiteKind: w?.kind ?? null,
    phone: phone && normalizeIlPhone(phone.value) ? { value: normalizeIlPhone(phone.value)!, sourceUrl: phone.sourceUrl } : null,
    email: email && cleanEmail(email.value) ? { value: cleanEmail(email.value)!, sourceUrl: email.sourceUrl } : null,
    whatsapp: wa && normalizeIlPhone(wa.value) ? { value: normalizeIlPhone(wa.value)!, sourceUrl: wa.sourceUrl } : null,
    socials,
    booking,
    hours,
    services: services.slice(0, 60),
    team: team.slice(0, 12),
    languages: languages && Array.isArray(languages.value) && languages.value.length ? { value: languages.value.map(x => String(x).trim()).filter(Boolean).slice(0, 8), sourceUrl: languages.sourceUrl } : null,
    establishedYear: year && Number.isInteger(year.value) && year.value >= 1950 && year.value <= new Date().getFullYear() ? year : null,
    accessible: cited(a.accessible),
    freeParking: cited(a.freeParking),
    notes: notes.slice(0, 12),
    notFound: (a.notFound ?? []).map(String).slice(0, 12),
    sources: [...sources],
    dropped,
  };
}

/** Cost of one Responses API call from the usage it reports. */
export function openaiCostUsd(u: { inputTokens: number; outputTokens: number; searchCalls: number }, p: { inputPer1MUsd: number; outputPer1MUsd: number; webSearchPer1kUsd: number }): number {
  return (u.inputTokens * p.inputPer1MUsd + u.outputTokens * p.outputPer1MUsd) / 1_000_000 + (u.searchCalls * p.webSearchPer1kUsd) / 1000;
}

/** Why a request failed, from the HTTP status and OpenAI's error body. */
export function openaiErrorKind(status: number | null, code: string | null, message: string): 'funds' | 'auth' | 'transient' | 'other' {
  const m = `${code ?? ''} ${message}`.toLowerCase();
  if (status === 401 || /invalid_api_key|incorrect api key|authentication/.test(m)) return 'auth';
  if (status === 402 || /insufficient_quota|billing|exceeded your current quota|hard limit/.test(m)) return 'funds';
  if (status === 429 || (status != null && status >= 500) || /rate_limit|overloaded|server_error|timeout/.test(m)) return 'transient';
  if (/model_not_found|does not exist/.test(m)) return 'auth';
  return 'other';
}
