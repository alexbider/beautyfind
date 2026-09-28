// OpenAI Responses API client for the research step (web search) and the profile writer. The key is
// server-side only (OPENAI_API_KEY) and never logged. Same outcome vocabulary as the other providers.

const BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com';

export interface OpenAIUsage {
  inputTokens: number;
  outputTokens: number;
  searchCalls: number;
}

export type OpenAIResult =
  | { kind: 'ok'; text: string; json: unknown | null; usage: OpenAIUsage; citations: string[]; model: string }
  | { kind: 'error'; status: number | null; code: string | null; message: string }
  | { kind: 'not_sent'; message: string }
  | { kind: 'uncertain'; message: string };

const NOT_SENT = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH']);

export function openaiConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export interface ResponsesRequest {
  model: string;
  instructions: string;
  input: string | Array<{ role: 'user' | 'assistant'; content: string }>;
  schema?: { name: string; schema: Record<string, unknown>; strict?: boolean };
  webSearch?: { enabled: boolean; country?: string; maxCalls?: number };
  maxOutputTokens?: number;
  timeoutMs?: number;
}

/** One Responses API call. With `webSearch` the model may search and read pages; citations come back as URLs. */
export async function responses(req: ResponsesRequest): Promise<OpenAIResult> {
  if (!process.env.OPENAI_API_KEY) return { kind: 'not_sent', message: 'OPENAI_API_KEY not set' };
  const body: Record<string, unknown> = {
    model: req.model,
    instructions: req.instructions,
    input: req.input,
    max_output_tokens: req.maxOutputTokens ?? 6000,
    ...(req.schema ? { text: { format: { type: 'json_schema', name: req.schema.name, schema: req.schema.schema, strict: req.schema.strict ?? false } } } : {}),
    ...(req.webSearch?.enabled ? { tools: [{ type: 'web_search', ...(req.webSearch.country ? { user_location: { type: 'approximate', country: req.webSearch.country } } : {}) }], tool_choice: 'auto', ...(req.webSearch.maxCalls ? { max_tool_calls: req.webSearch.maxCalls } : {}) } : {}),
  };
  let res: Response;
  try {
    res = await fetch(`${BASE}/v1/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(req.timeoutMs ?? 180_000),
    });
  } catch (e) {
    const code = ((e as { cause?: { code?: string } }).cause?.code ?? '') as string;
    const msg = `${(e as Error).name}: ${code || (e as Error).message}`.slice(0, 200);
    return NOT_SENT.has(code) ? { kind: 'not_sent', message: msg } : { kind: 'uncertain', message: msg };
  }
  let json: Record<string, unknown>;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    return res.status >= 500 ? { kind: 'uncertain', message: `http_${res.status}` } : { kind: 'error', status: res.status, code: null, message: `http_${res.status}` };
  }
  if (res.status !== 200) {
    const err = (json.error ?? {}) as { code?: string; message?: string; type?: string };
    return { kind: 'error', status: res.status, code: err.code ?? err.type ?? null, message: (err.message ?? `http_${res.status}`).slice(0, 300) };
  }
  if (json.error) {
    const err = json.error as { code?: string; message?: string };
    return { kind: 'error', status: null, code: err.code ?? null, message: (err.message ?? 'response error').slice(0, 300) };
  }
  const output = (json.output ?? []) as Array<Record<string, unknown>>;
  let text = '';
  const citations: string[] = [];
  let searchCalls = 0;
  for (const item of output) {
    if (item.type === 'web_search_call') searchCalls++;
    if (item.type === 'message') {
      for (const c of (item.content ?? []) as Array<Record<string, unknown>>) {
        if (c.type === 'output_text' && typeof c.text === 'string') text += c.text;
        if (c.type === 'refusal') return { kind: 'error', status: null, code: 'refusal', message: String(c.refusal ?? 'refusal') };
        for (const a of (c.annotations ?? []) as Array<Record<string, unknown>>) if (a.type === 'url_citation' && typeof a.url === 'string') citations.push(a.url);
      }
    }
  }
  if (json.status === 'incomplete') {
    const why = (json.incomplete_details as { reason?: string } | undefined)?.reason ?? 'incomplete';
    if (!text) return { kind: 'error', status: null, code: 'incomplete', message: why };
  }
  const usage = (json.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
  let parsed: unknown = null;
  if (req.schema && text) {
    try {
      const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
      const a = t.indexOf('{');
      const b = t.lastIndexOf('}');
      parsed = JSON.parse(a >= 0 && b > a ? t.slice(a, b + 1) : t);
    } catch {
      parsed = null;
    }
  }
  return { kind: 'ok', text, json: parsed, usage: { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0, searchCalls }, citations: [...new Set(citations)], model: String(json.model ?? req.model) };
}
