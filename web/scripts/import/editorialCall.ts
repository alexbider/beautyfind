// The editorial API call: one structured request on the evidence packet, at most one repair request, and
// one fresh attempt when the repaired draft still breaks the text rules (sentences about missing data,
// record language, English inside Hebrew, Latin street words, dashes, emoji). A draft that still breaks
// them is rejected: the caller keeps the listing's current text instead of publishing it. A draft that
// passes gets one proofreading call (spelling and grammar only); a draft the proofreader finds unknown or
// invented Hebrew words in is rejected too.
// The writer is ChatGPT (OpenAI Responses API) or Claude, chosen by the llmProvider setting. With
// IMPORT_EDITORIAL_MOCK=1 (tests, simulation) the deterministic template draft stands in and no
// request leaves the machine.

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { applyProofread, checkOutput, GROUNDING_PROMPT, GROUNDING_SCHEMA, groundingMessage, groundingRepairMessage, normalizeOutput, onlyPolish, OUTPUT_SCHEMA, PROMPT_VERSION, PROOFREAD_PROMPT, PROOFREAD_SCHEMA, proofreadMessage, repairable, repairMessage, SYSTEM_PROMPT, templateDraft, textRuleViolations, userMessage, type EditorialOutput, type EvidencePacket, type GroundingClaim, type ProofreadOutput } from '../../src/lib/import/editorial';
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

const Proof = z.object({
  description: z.string().min(1).max(12_000),
  faqs: z.array(z.object({ q: z.string().min(1).max(300), a: z.string().min(1).max(2000) })).max(12),
  metaTitle: z.string().max(200),
  metaDescription: z.string().max(400),
  serviceSummaries: z.array(z.object({ name: z.string().max(160), summary: z.string().max(400) })).max(60),
  unknownWords: z.array(z.string().max(80)).max(50),
  changes: z.number().int().min(0),
});

const Grounding = z.object({ claims: z.array(z.object({ text: z.string().max(400), kind: z.string().max(40), supported: z.boolean(), basis: z.string().max(300) })).max(200) });

export type EditorialResult =
  | { ok: true; output: EditorialOutput; violations: string[]; repairs: number; proofread: boolean; grounded: boolean; unsupportedClaims: string[]; inputTokens: number; outputTokens: number; costUsd: number; model: string }
  | { ok: false; error: string; transient?: boolean; fatal?: boolean; unsupportedClaims?: string[]; inputTokens?: number; outputTokens?: number; costUsd?: number };

let client: Anthropic | null = null;
const api = () => (client ??= new Anthropic({ maxRetries: 3 }));
let useFormat = true;
// Low effort keeps the model's reasoning short: profile copy needs the facts laid out, not a long think.
// Sonnet 5 accepts low to max; a model that rejects the field falls back to its default once per process.
let useEffort = true;
// Room for the reasoning plus the full JSON: Sonnet 5's tokenizer spends about a token per Hebrew syllable,
// so a rich draft with eight FAQs and forty service summaries runs to several thousand output tokens, and
// 16000 cut four drafts in ten off on 2026-10-04. Streamed, because the SDK refuses a non-streaming request
// this large.
const MAX_TOKENS = 32000;

function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  return JSON.parse(a >= 0 && b > a ? t.slice(a, b + 1) : t);
}

type Turn = { role: 'user' | 'assistant'; content: string };
type Raw = { json: unknown; inputTokens: number; outputTokens: number; raw: string } | { error: string; transient?: boolean; fatal?: boolean };
/** One structured request: the system prompt, the JSON schema the answer must follow, the turns. */
interface Request {
  system: string;
  schema: Record<string, unknown>;
  turns: Turn[];
}

async function rawClaude(req: Request): Promise<Raw> {
  try {
    const outputConfig = { ...(useFormat ? { format: { type: 'json_schema' as const, schema: req.schema } } : {}), ...(useEffort ? { effort: 'low' as const } : {}) };
    const res = await api().messages
      .stream({
        model: EDITORIAL_MODEL,
        max_tokens: MAX_TOKENS,
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
        messages: req.turns.map(t => ({ role: t.role, content: t.content })) as Anthropic.MessageParam[],
      } as Anthropic.MessageStreamParams)
      .finalMessage();
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
    return { json, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, raw: text.text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof Anthropic.BadRequestError) {
      if (useEffort && /effort/i.test(msg)) {
        useEffort = false;
        return rawClaude(req);
      }
      if (useFormat && /output_config|format|schema|json_schema/i.test(msg)) {
        useFormat = false;
        return rawClaude(req);
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

/** The same structured request through the OpenAI Responses API (JSON schema output, no tools). */
async function rawOpenAI(req: Request): Promise<Raw> {
  const r = await responses({ model: OPENAI_MODEL, instructions: req.system, input: req.turns, schema: { name: 'profile_text', schema: req.schema, strict: true }, maxOutputTokens: 6000 });
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
  return { json, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, raw: r.text };
}

type Once<T> = { output: T; inputTokens: number; outputTokens: number; raw: string } | { error: string; transient?: boolean; fatal?: boolean };

/** One request parsed against its zod shape. */
async function structured<T>(provider: WriterProvider, req: Request, shape: z.ZodType<T>): Promise<Once<T>> {
  const r = await (provider === 'openai' ? rawOpenAI : rawClaude)(req);
  if ('error' in r) return r;
  const parsed = shape.safeParse(r.json);
  if (!parsed.success) return { error: `schema: ${parsed.error.message.slice(0, 200)}` };
  return { output: parsed.data, inputTokens: r.inputTokens, outputTokens: r.outputTokens, raw: r.raw };
}

/** Hebrew typography fixed in place on every string the writer returns (src/lib/import/editorial.ts normalizeOutput). */
const tidy = normalizeOutput;

/**
 * One generation call, then one repair call when the checks find something a rewrite can fix. When the text
 * rules are still broken after that, one fresh generation with the problems spelled out; a draft that still
 * breaks them is rejected (error `text_rules`). A passing draft gets one proofreading call: spelling and
 * grammar only, merged back only when facts and length are unchanged; unknown or invented Hebrew words
 * reject the draft (error `invented_words`).
 */
export async function writeEditorial(packet: EvidencePacket, provider: WriterProvider = 'openai'): Promise<EditorialResult> {
  const key = provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (mock() || !key) {
    if (!mock()) return { ok: false, error: 'no_api_key', fatal: true };
    const output = templateDraft(packet);
    return { ok: true, output, violations: checkOutput(output, packet).filter(v => !/^(short|long):/.test(v)), repairs: 0, proofread: false, grounded: false, unsupportedClaims: [], inputTokens: 0, outputTokens: 0, costUsd: 0, model: 'template' };
  }
  const model = provider === 'openai' ? OPENAI_MODEL : EDITORIAL_MODEL;
  const write = (turns: Turn[]) => structured(provider, { system: SYSTEM_PROMPT, schema: OUTPUT_SCHEMA, turns }, Out);
  const turns: Turn[] = [{ role: 'user', content: userMessage(packet) }];
  const first = await write(turns);
  if ('error' in first) return { ok: false, ...first };
  let inputTokens = first.inputTokens;
  let outputTokens = first.outputTokens;
  let output = tidy(first.output);
  let violations = checkOutput(output, packet);
  let repairs = 0;
  let raw = first.raw;
  if (repairable(violations).length) {
    repairs = 1;
    const second = await write([...turns, { role: 'assistant', content: raw }, { role: 'user', content: repairMessage(repairable(violations), packet) }]);
    if (!('error' in second)) {
      inputTokens += second.inputTokens;
      outputTokens += second.outputTokens;
      const fixed = tidy(second.output);
      const v2 = checkOutput(fixed, packet);
      // Keep whichever draft has fewer problems left.
      if (repairable(v2).length <= repairable(violations).length) {
        output = fixed;
        violations = v2;
        raw = second.raw;
      }
    }
  }
  if (onlyPolish(violations)) {
    // Everything else is right and only deterministic blockers remain (word count, filler, a repeated fact,
    // medical wording): one more targeted pass, since such a draft is stored but never published.
    repairs += 1;
    const third = await write([...turns, { role: 'assistant', content: raw }, { role: 'user', content: repairMessage(violations, packet) }]);
    if (!('error' in third)) {
      inputTokens += third.inputTokens;
      outputTokens += third.outputTokens;
      const fixed = tidy(third.output);
      const v3 = checkOutput(fixed, packet);
      if (v3.length <= violations.length) {
        output = fixed;
        violations = v3;
      }
    }
  }
  if (textRuleViolations(violations).length) {
    // The repair left text-rule breaks in: write the whole thing again with the breaks named up front.
    repairs += 1;
    const again = await write([{ role: 'user', content: `${userMessage(packet)}\n\nA previous draft was rejected for breaking these rules; do not repeat them:\n- ${textRuleViolations(violations).map(v => v.slice(5)).join('\n- ')}` }]);
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
  const cost = () => editorialCostUsd(inputTokens, outputTokens, pricing(), provider);
  if (textRuleViolations(violations).length) return { ok: false, error: `text_rules: ${textRuleViolations(violations).slice(0, 6).join(', ')}`.slice(0, 240), inputTokens, outputTokens, costUsd: cost() };
  if (violations.some(v => /^(short|long):/.test(v))) {
    // The draft is clean but outside its tier: stored with the violation (the listing keeps its text), and
    // the reason is visible on the record, so the grounding and proofreading calls are not spent on it.
    return { ok: true, output, violations, repairs, proofread: false, grounded: false, unsupportedClaims: [], inputTokens, outputTokens, costUsd: cost(), model };
  }

  // Fact grounding: every claim in the description and FAQs against the packet. Unsupported claims get one
  // repair that removes them; a draft that still carries one is rejected. The claims are logged either way.
  const unsupportedClaims: string[] = [];
  let grounded = false;
  const ground = () => structured<{ claims: GroundingClaim[] }>(provider, { system: GROUNDING_PROMPT, schema: GROUNDING_SCHEMA, turns: [{ role: 'user', content: groundingMessage(output, packet) }] }, Grounding);
  const g1 = await ground();
  if (!('error' in g1)) {
    inputTokens += g1.inputTokens;
    outputTokens += g1.outputTokens;
    let bad = g1.output.claims.filter(c => !c.supported);
    if (bad.length) {
      unsupportedClaims.push(...bad.map(c => `${c.kind}: ${c.text}`));
      console.log(`editorial: ${bad.length} unsupported claim(s) in the draft for ${packet.name}: ${bad.map(c => `"${c.text}" (${c.kind})`).join('; ')}`);
      repairs += 1;
      const fixed = await write([...turns, { role: 'assistant', content: JSON.stringify(output) }, { role: 'user', content: groundingRepairMessage(bad) }]);
      if (!('error' in fixed)) {
        inputTokens += fixed.inputTokens;
        outputTokens += fixed.outputTokens;
        const candidate = tidy(fixed.output);
        const vc = checkOutput(candidate, packet);
        if (!textRuleViolations(vc).length && !vc.some(v => /^(short|long):/.test(v))) {
          output = candidate;
          violations = vc;
          const g2 = await ground();
          if (!('error' in g2)) {
            inputTokens += g2.inputTokens;
            outputTokens += g2.outputTokens;
            bad = g2.output.claims.filter(c => !c.supported);
          }
        }
      }
      if (bad.length) return { ok: false, error: `unsupported_claims: ${bad.map(c => c.text).join('; ')}`.slice(0, 240), unsupportedClaims, inputTokens, outputTokens, costUsd: cost() };
    }
    grounded = true;
  }

  // Proofreading: spelling and grammar only. A failed or refused proofreading call leaves the draft as it is.
  let proofread = false;
  const pr = await structured<ProofreadOutput>(provider, { system: PROOFREAD_PROMPT, schema: PROOFREAD_SCHEMA, turns: [{ role: 'user', content: proofreadMessage(output) }] }, Proof);
  if (!('error' in pr)) {
    inputTokens += pr.inputTokens;
    outputTokens += pr.outputTokens;
    const unknown = pr.output.unknownWords.map(w => w.trim()).filter(w => /[א-ת]/.test(w) && output.description.includes(w));
    if (unknown.length) return { ok: false, error: `invented_words: ${unknown.slice(0, 8).join(', ')}`.slice(0, 240), inputTokens, outputTokens, costUsd: cost() };
    const merged = applyProofread(output, tidyProof(pr.output));
    if (merged.applied) {
      // The corrected text must still pass every check; otherwise the original stands.
      const v4 = checkOutput(merged.output, packet);
      if (v4.length <= violations.length && !textRuleViolations(v4).length) {
        output = merged.output;
        violations = v4;
        proofread = true;
      }
    }
  }
  return { ok: true, output, violations, repairs, proofread, grounded, unsupportedClaims, inputTokens, outputTokens, costUsd: cost(), model };
}

/** The proofreader's strings through the same typography fixes as the writer's. */
function tidyProof(p: ProofreadOutput): ProofreadOutput {
  const t = normalizeOutput({ heading: 'על העסק', description: p.description, faqs: p.faqs.map(f => ({ ...f, basis: '' })), metaTitle: p.metaTitle, metaDescription: p.metaDescription, serviceSummaries: p.serviceSummaries, insufficientEvidence: false, missing: [] });
  return { ...p, description: t.description, faqs: t.faqs.map(f => ({ q: f.q, a: f.a })), metaTitle: t.metaTitle, metaDescription: t.metaDescription, serviceSummaries: t.serviceSummaries };
}

export { PROMPT_VERSION };
