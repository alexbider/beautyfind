// The editorial API call: one structured request on the evidence packet, at most one repair request, and
// one fresh attempt when the repaired draft still breaks the text rules (sentences about missing data,
// English inside Hebrew, dashes, emoji). A draft that still breaks them is rejected: the caller keeps the
// listing's current text instead of publishing it.
// The writer is ChatGPT (OpenAI Responses API) or Claude, chosen by the llmProvider setting. With
// IMPORT_EDITORIAL_MOCK=1 (tests, simulation) the deterministic template draft stands in and no
// request leaves the machine.

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { checkOutput, normalizeOutput, OUTPUT_SCHEMA, PROMPT_VERSION, repairable, repairMessage, SYSTEM_PROMPT, templateDraft, textRuleViolations, userMessage, type EditorialOutput, type EvidencePacket } from '../../src/lib/import/editorial';
import { openaiErrorKind } from '../../src/lib/import/openai';
import { editorialCostUsd, pricing } from '../../src/lib/import/pricing';
import { responses } from './providers/openai';

export type WriterProvider = 'anthropic' | 'openai';
export const EDITORIAL_MODEL = process.env.IMPORT_EDITORIAL_MODEL || pricing().editorial.model;
export const OPENAI_MODEL = process.env.IMPORT_OPENAI_MODEL || pricing().openai.model;
const mock = () => process.env.IMPORT_EDITORIAL_MOCK === '1'; // read per call: tests switch it on for one suite

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
      // Room for the model's own reasoning plus the full JSON: the cap counts both, and 6000 cut drafts off.
      max_tokens: 16000,
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

type Turn = { role: 'user' | 'assistant'; content: string };
type Once = { output: EditorialOutput; inputTokens: number; outputTokens: number; raw: string } | { error: string; transient?: boolean; fatal?: boolean };

/** The same structured request through the OpenAI Responses API (JSON schema output, no tools). */
async function onceOpenAI(turns: Turn[]): Promise<Once> {
  const r = await responses({ model: OPENAI_MODEL, instructions: SYSTEM_PROMPT, input: turns, schema: { name: 'profile_text', schema: OUTPUT_SCHEMA as unknown as Record<string, unknown>, strict: true }, maxOutputTokens: 6000 });
  if (r.kind === 'not_sent') return { error: 'no_api_key', fatal: true };
  if (r.kind === 'uncertain') return { error: `connection: ${r.message}`, transient: true };
  if (r.kind === 'error') {
    const why = openaiErrorKind(r.status, r.code, r.message);
    if (r.code === 'refusal') return { error: 'refusal' };
    if (why === 'auth') return { error: `auth: ${r.message.slice(0, 200)}`, fatal: true };
    if (why === 'funds') return { error: `no_credit: ${r.message.slice(0, 200)}`, fatal: true };
    if (why === 'transient') return { error: `api_${r.status ?? 'error'}: ${r.message.slice(0, 120)}`, transient: true };
    return { error: `api: ${r.message.slice(0, 240)}` };
  }
  let json: unknown = r.json;
  if (json == null) {
    try {
      json = parseJson(r.text);
    } catch {
      return { error: 'bad_json' };
    }
  }
  const parsed = Out.safeParse(json);
  if (!parsed.success) return { error: `schema: ${parsed.error.message.slice(0, 200)}` };
  return { output: parsed.data, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, raw: r.text };
}

const onceClaude = (turns: Turn[]): Promise<Once> => once(turns.map(t => ({ role: t.role, content: t.content })) as Anthropic.MessageParam[]);

/** Hebrew typography fixed in place on every string the writer returns (src/lib/import/editorial.ts normalizeOutput). */
const tidy = normalizeOutput;

/**
 * One generation call, then one repair call when the checks find something a rewrite can fix. When the text
 * rules are still broken after that, one fresh generation with the problems spelled out; a draft that still
 * breaks them is rejected (error `text_rules`).
 */
export async function writeEditorial(packet: EvidencePacket, provider: WriterProvider = 'openai'): Promise<EditorialResult> {
  const key = provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (mock() || !key) {
    if (!mock()) return { ok: false, error: 'no_api_key', fatal: true };
    const output = templateDraft(packet);
    return { ok: true, output, violations: checkOutput(output, packet).filter(v => !v.startsWith('short:')), repairs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, model: 'template' };
  }
  const call = provider === 'openai' ? onceOpenAI : onceClaude;
  const model = provider === 'openai' ? OPENAI_MODEL : EDITORIAL_MODEL;
  const turns: Turn[] = [{ role: 'user', content: userMessage(packet) }];
  const first = await call(turns);
  if ('error' in first) return { ok: false, ...first };
  let inputTokens = first.inputTokens;
  let outputTokens = first.outputTokens;
  let output = tidy(first.output);
  let violations = checkOutput(output, packet);
  let repairs = 0;
  if (repairable(violations).length) {
    repairs = 1;
    const second = await call([...turns, { role: 'assistant', content: first.raw }, { role: 'user', content: repairMessage(repairable(violations)) }]);
    if (!('error' in second)) {
      inputTokens += second.inputTokens;
      outputTokens += second.outputTokens;
      const fixed = tidy(second.output);
      const v2 = checkOutput(fixed, packet);
      // Keep whichever draft has fewer problems left.
      if (repairable(v2).length <= repairable(violations).length) {
        output = fixed;
        violations = v2;
      }
    }
  }
  if (textRuleViolations(violations).length) {
    // The repair left text-rule breaks in: write the whole thing again with the breaks named up front.
    repairs += 1;
    const again = await call([{ role: 'user', content: `${userMessage(packet)}\n\nA previous draft was rejected for breaking these rules; do not repeat them:\n- ${textRuleViolations(violations).map(v => v.slice(5)).join('\n- ')}` }]);
    if (!('error' in again)) {
      inputTokens += again.inputTokens;
      outputTokens += again.outputTokens;
      const fresh = tidy(again.output);
      const v3 = checkOutput(fresh, packet);
      if (textRuleViolations(v3).length < textRuleViolations(violations).length) {
        output = fresh;
        violations = v3;
      }
    }
  }
  const costUsd = editorialCostUsd(inputTokens, outputTokens, pricing(), provider);
  if (textRuleViolations(violations).length) return { ok: false, error: `text_rules: ${textRuleViolations(violations).slice(0, 6).join(', ')}`.slice(0, 240), inputTokens, outputTokens, costUsd };
  return { ok: true, output, violations, repairs, inputTokens, outputTokens, costUsd, model };
}

export { PROMPT_VERSION };
