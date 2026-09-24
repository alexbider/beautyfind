// Reads the website text of one business with Claude and returns categories, the treatment menu
// and a short neutral description, all constrained to a JSON schema and checked again with zod.
// Claude is told to use only what the pages say: no invented prices, claims or staff.

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { CATEGORIES } from '../../src/lib/catalog';

// Default per the project's Claude API guidance. Set IMPORT_MODEL to trade quality for cost
// (for example claude-sonnet-5 or claude-haiku-4-5); every record still goes through review.
const MODEL = process.env.IMPORT_MODEL || 'claude-opus-5';
const SLUGS = CATEGORIES.map(c => c.slug);
const TYPES = ['clinic', 'medspa', 'cosmetics', 'salon'] as const;
const PRICE_TYPES = ['fixed', 'from', 'per_unit', 'per_ml', 'per_area'] as const;

const client = new Anthropic({ maxRetries: 4 });

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });

// Hand-written so it stays inside what structured outputs accept.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isBeautyBusiness', 'categories', 'businessType', 'description', 'treatments', 'emails'],
  properties: {
    isBeautyBusiness: { type: 'boolean' },
    categories: { type: 'array', items: { type: 'string', enum: SLUGS } },
    businessType: { type: 'string', enum: [...TYPES] },
    description: nullable({ type: 'string' }),
    emails: { type: 'array', items: { type: 'string' } },
    treatments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'category', 'priceNis', 'priceType', 'durationMin', 'isMedical'],
        properties: {
          name: { type: 'string' },
          category: nullable({ type: 'string', enum: SLUGS }),
          priceNis: nullable({ type: 'number' }),
          priceType: { type: 'string', enum: [...PRICE_TYPES] },
          durationMin: nullable({ type: 'integer' }),
          isMedical: { type: 'boolean' },
        },
      },
    },
  },
};

const Out = z.object({
  isBeautyBusiness: z.boolean(),
  categories: z.array(z.enum(SLUGS as [string, ...string[]])),
  businessType: z.enum(TYPES),
  description: z.string().nullable(),
  emails: z.array(z.string()),
  treatments: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        category: z.enum(SLUGS as [string, ...string[]]).nullable(),
        priceNis: z.number().positive().max(200_000).nullable(),
        priceType: z.enum(PRICE_TYPES),
        durationMin: z.number().int().positive().max(24 * 60).nullable(),
        isMedical: z.boolean(),
      }),
    )
    .max(120),
});
export type Extraction = z.infer<typeof Out>;

const SYSTEM = `You read the website of an Israeli beauty or aesthetics business and fill a JSON record for a Hebrew directory.

Categories (slug: Hebrew name):
${CATEGORIES.map(c => `- ${c.slug}: ${c.name}${c.isMedical ? ' (medical)' : ''}`).join('\n')}

Business types: clinic (a doctor performs medical treatments), medspa (cosmetic and medical treatments under a doctor), cosmetics (cosmetic treatments, no injections), salon (hair, nails, brows and other non-medical services).

Rules:
- Use only facts written in the pages. If something is not stated, leave it out or use null. Never guess a price, a duration or a treatment.
- categories: every category the business clearly offers. Empty when the pages do not show it.
- treatments: the services listed on the site, names in Hebrew as written (keep a short Latin brand name if that is how the site writes it). priceNis is the number shown in shekels, as shown; null when there is no price. priceType "from" when the site says "החל מ" or "מ־", per_unit for injections priced per unit, per_ml for fillers priced per ml, per_area for laser priced per area, otherwise fixed. isMedical is true for injections (Botox, fillers), medical lasers, surgery, prescription treatments and anything the site says a doctor performs.
- emails: only addresses that appear in the text.
- description: two or three plain Hebrew sentences in third person about what this business offers and where, based only on the pages. No superlatives, no promises of results, no em dashes, no invented history or awards. null when the pages say too little.
- isBeautyBusiness: false when the site is clearly not a beauty, hair, nails, spa or aesthetics business.`;

export type ExtractResult =
  | { ok: true; data: Extraction; inputTokens: number; outputTokens: number }
  // transient: try the same record again later. fatal: every call will fail the same way (key, credit, model).
  | { ok: false; error: string; transient?: boolean; fatal?: boolean };

// Request options the account may not have. Each is dropped for the rest of the run the first time
// the API rejects it, and the call is retried without it.
let useFallbacks = true;
let useFormat = true;

const JSON_ONLY = '\n\nReply with only the JSON object, no other text. Keys: isBeautyBusiness, categories, businessType, description, emails, treatments (name, category, priceNis, priceType, durationMin, isMedical).';

function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  return JSON.parse(a >= 0 && b > a ? t.slice(a, b + 1) : t);
}

async function call(user: string) {
  const params = {
    model: MODEL,
    max_tokens: 16000,
    system: [{ type: 'text' as const, text: useFormat ? SYSTEM : SYSTEM + JSON_ONLY, cache_control: { type: 'ephemeral' as const } }],
    output_config: useFormat ? { effort: 'low' as const, format: { type: 'json_schema' as const, schema: SCHEMA } } : { effort: 'low' as const },
    messages: [{ role: 'user' as const, content: user }],
  };
  return useFallbacks
    ? client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
    : client.beta.messages.create(params);
}

export async function extract(input: { name: string; address: string; types: string[]; text: string }): Promise<ExtractResult> {
  const user = `Business name on Google: ${input.name}
Address: ${input.address}
Google place types: ${input.types.join(', ') || 'none'}

Website pages:
${input.text}`;

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await call(user);
      if (res.stop_reason === 'refusal') return { ok: false, error: 'refusal' };
      if (res.stop_reason === 'max_tokens') return { ok: false, error: 'max_tokens' };
      const text = res.content.find(b => b.type === 'text');
      if (!text || text.type !== 'text') return { ok: false, error: 'no_text' };
      let json: unknown;
      try {
        json = parseJson(text.text);
      } catch {
        return { ok: false, error: 'bad_json' };
      }
      const parsed = Out.safeParse(json);
      if (!parsed.success) return { ok: false, error: 'schema: ' + parsed.error.message.slice(0, 200) };
      return { ok: true, data: parsed.data, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof Anthropic.BadRequestError) {
        // An option this account or model does not accept: drop it and try again right away.
        if (useFallbacks && /fallback|beta|server-side/i.test(msg)) {
          useFallbacks = false;
          console.warn('[extract] server-side fallbacks not accepted, continuing without them:', msg.slice(0, 160));
          continue;
        }
        if (useFormat && /output_config|format|schema|json_schema/i.test(msg)) {
          useFormat = false;
          console.warn('[extract] structured output not accepted, asking for plain JSON instead:', msg.slice(0, 160));
          continue;
        }
        if (/credit balance|billing/i.test(msg)) return { ok: false, error: `no_credit: ${msg.slice(0, 200)}`, fatal: true };
        return { ok: false, error: `api_400: ${msg.slice(0, 240)}` };
      }
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { ok: false, error: `auth: ${msg.slice(0, 200)}`, fatal: true };
      if (e instanceof Anthropic.NotFoundError) return { ok: false, error: `model_not_found: ${MODEL}`, fatal: true };
      if (e instanceof Anthropic.RateLimitError || (e instanceof Anthropic.APIError && (e.status === 529 || (e.status ?? 0) >= 500))) {
        // The SDK already retried; wait longer before our own retry (rate limits reset per minute).
        const wait = Number((e as InstanceType<typeof Anthropic.APIError>).headers?.get?.('retry-after')) || 20 * (attempt + 1);
        await new Promise(r => setTimeout(r, Math.min(wait, 90) * 1000));
        if (attempt < 3) continue;
        return { ok: false, error: e instanceof Anthropic.RateLimitError ? 'rate_limited' : `api_${e.status}`, transient: true };
      }
      if (e instanceof Anthropic.APIConnectionError) return { ok: false, error: 'connection', transient: true };
      return { ok: false, error: msg.slice(0, 200) };
    }
  }
  return { ok: false, error: 'retries_used', transient: true };
}
