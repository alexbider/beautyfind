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

export async function extract(input: { name: string; address: string; types: string[]; text: string }): Promise<
  { ok: true; data: Extraction; inputTokens: number; outputTokens: number } | { ok: false; error: string }
> {
  const user = `Business name on Google: ${input.name}
Address: ${input.address}
Google place types: ${input.types.join(', ') || 'none'}

Website pages:
${input.text}`;

  try {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: user }],
    });
    if (res.stop_reason === 'refusal') return { ok: false, error: 'refusal' };
    if (res.stop_reason === 'max_tokens') return { ok: false, error: 'max_tokens' };
    const text = res.content.find(b => b.type === 'text');
    if (!text || text.type !== 'text') return { ok: false, error: 'no_text' };
    const parsed = Out.safeParse(JSON.parse(text.text));
    if (!parsed.success) return { ok: false, error: 'schema: ' + parsed.error.message.slice(0, 200) };
    return { ok: true, data: parsed.data, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: 'rate_limited' };
    if (e instanceof Anthropic.APIError) return { ok: false, error: `api_${e.status}: ${e.message.slice(0, 200)}` };
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : 'failed' };
  }
}
