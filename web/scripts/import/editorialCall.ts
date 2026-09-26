// The editorial API call: one structured Claude request on the evidence packet, at most one repair
// request. Model and behaviour are configurable; with IMPORT_EDITORIAL_MOCK=1 (tests, simulation) the
// deterministic template draft stands in and no request leaves the machine.

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { checkOutput, OUTPUT_SCHEMA, PROMPT_VERSION, repairable, repairMessage, SYSTEM_PROMPT, templateDraft, userMessage, type EditorialOutput, type EvidencePacket } from '../../src/lib/import/editorial';
import { editorialCostUsd, pricing } from '../../src/lib/import/pricing';

export const EDITORIAL_MODEL = process.env.IMPORT_EDITORIAL_MODEL || pricing().editorial.model;
const MOCK = process.env.IMPORT_EDITORIAL_MOCK === '1';

const Out = z.object({
  heading: z.enum(['על הקליניקה', 'על המספרה', 'על הספא', 'על הסטודיו', 'על העסק']),
  description: z.string().min(1).max(12_000),
  faqs: z.array(z.object({ q: z.string().min(3).max(300), a: z.string().min(1).max(2000), basis: z.string().max(200) })).max(12),
  metaTitle: z.string().max(200),
  metaDescription: z.string().max(400),
  serviceSummaries: z.array(z.object({ name: z.string().max(160), summary: z.string().max(400) })).max(60),
  insufficientEvidence: z.boolean(),
  missing: z.array(z.string().max(120)).max(20),
});

export type EditorialResult =
  | { ok: true; output: EditorialOutput; violations: string[]; repairs: number; inputTokens: number; outputTokens: number; costUsd: number; model: string }
  | { ok: false; error: string; transient?: boolean; fatal?: boolean; inputTokens?: number; outputTokens?: number; costUsd?: number };

let client: Anthropic | null = null;
const api = () => (client ??= new Anthropic({ maxRetries: 3 }));
let useFormat = true;

function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  return JSON.parse(a >= 0 && b > a ? t.slice(a, b + 1) : t);
}

async function once(messages: Anthropic.MessageParam[]): Promise<{ output: EditorialOutput; inputTokens: number; outputTokens: number; raw: string } | { error: string; transient?: boolean; fatal?: boolean }> {
  try {
    const res = await api().messages.create({
      model: EDITORIAL_MODEL,
      max_tokens: 6000,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      ...(useFormat ? { output_config: { format: { type: 'json_schema' as const, schema: OUTPUT_SCHEMA } } } : {}),
      messages,
    } as Anthropic.MessageCreateParamsNonStreaming);
    if (res.stop_reason === 'refusal') return { error: 'refusal' };
    if (res.stop_reason === 'max_tokens') return { error: 'max_tokens' };
    const text = res.content.find(b => b.type === 'text');
    if (!text || text.type !== 'text') return { error: 'no_text' };
    let json: unknown;
    try {
      json = parseJson(text.text);
    } catch {
      return { error: 'bad_json' };
    }
    const parsed = Out.safeParse(json);
    if (!parsed.success) return { error: `schema: ${parsed.error.message.slice(0, 200)}` };
    return { output: parsed.data, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, raw: text.text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof Anthropic.BadRequestError) {
      if (useFormat && /output_config|format|schema|json_schema/i.test(msg)) {
        useFormat = false;
        return once(messages);
      }
      if (/credit balance|billing/i.test(msg)) return { error: `no_credit: ${msg.slice(0, 200)}`, fatal: true };
      return { error: `api_400: ${msg.slice(0, 240)}` };
    }
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { error: `auth: ${msg.slice(0, 200)}`, fatal: true };
    if (e instanceof Anthropic.NotFoundError) return { error: `model_not_found: ${EDITORIAL_MODEL}`, fatal: true };
    if (e instanceof Anthropic.RateLimitError || (e instanceof Anthropic.APIError && (e.status === 529 || (e.status ?? 0) >= 500))) return { error: e instanceof Anthropic.RateLimitError ? 'rate_limited' : `api_${e.status}`, transient: true };
    if (e instanceof Anthropic.APIConnectionError) return { error: 'connection', transient: true };
    return { error: msg.slice(0, 200) };
  }
}

/** One generation call, then one repair call when the checks find something a rewrite can fix. */
export async function writeEditorial(packet: EvidencePacket): Promise<EditorialResult> {
  if (MOCK || !process.env.ANTHROPIC_API_KEY) {
    if (!MOCK) return { ok: false, error: 'no_api_key', fatal: true };
    const output = templateDraft(packet);
    return { ok: true, output, violations: checkOutput(output, packet).filter(v => !v.startsWith('short:')), repairs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, model: 'template' };
  }
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage(packet) }];
  const first = await once(messages);
  if ('error' in first) return { ok: false, ...first };
  let inputTokens = first.inputTokens;
  let outputTokens = first.outputTokens;
  let output = first.output;
  let violations = checkOutput(output, packet);
  let repairs = 0;
  if (repairable(violations).length) {
    repairs = 1;
    const second = await once([...messages, { role: 'assistant', content: first.raw }, { role: 'user', content: repairMessage(repairable(violations)) }]);
    if (!('error' in second)) {
      inputTokens += second.inputTokens;
      outputTokens += second.outputTokens;
      const v2 = checkOutput(second.output, packet);
      // Keep whichever draft has fewer problems left.
      if (repairable(v2).length <= repairable(violations).length) {
        output = second.output;
        violations = v2;
      }
    }
  }
  return { ok: true, output, violations, repairs, inputTokens, outputTokens, costUsd: editorialCostUsd(inputTokens, outputTokens), model: EDITORIAL_MODEL };
}

export { PROMPT_VERSION };
