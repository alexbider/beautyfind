import 'server-only';
import { db } from '@/lib/server/db';
import { getSettings as importSettings } from '@/lib/server/importOps';
import { monthStart } from '@/lib/server/opsStats';

// Data for /ops/ai: what the tabs show is measured from env presence, the worker's last report, the
// approvals table and the spend ledger. Nothing here is a placeholder number.

export const AI_TABS = [
  { key: 'assistant', name: 'עוזר' },
  { key: 'providers', name: 'ספקי AI' },
  { key: 'mcp', name: 'שרת MCP' },
  { key: 'queue', name: 'תור אישורים' },
  { key: 'usage', name: 'שימוש ועלויות' },
] as const;
export type AiTab = (typeof AI_TABS)[number]['key'];

export interface ProviderRow {
  key: string;
  name: string;
  role: string;
  web: 'set' | 'missing' | 'n/a';
  worker: boolean | null; // null: the worker has not reported yet
  workerAt: Date | null;
  model: string | null;
}

/** AI providers: key presence on the web side (this process) and the worker's last self-report. */
export async function providers(): Promise<ProviderRow[]> {
  const s = await importSettings().catch(() => null);
  const w = s?.workerStatus ?? null;
  const at = w?.at ? new Date(w.at) : null;
  const env = (k: string): 'set' | 'missing' => (process.env[k] ? 'set' : 'missing');
  return [
    { key: 'anthropic', name: 'Anthropic · Claude', role: 'עוזר התפעול; כותב תיאורים בייבוא כשנבחר', web: env('ANTHROPIC_API_KEY'), worker: w ? w.anthropic : null, workerAt: at, model: process.env.OPS_ASSISTANT_MODEL || 'claude-opus-5-5' },
    { key: 'openai', name: 'OpenAI · ChatGPT', role: 'מחקר רשת וכתיבת תיאורים בייבוא (ברירת המחדל)', web: 'n/a', worker: w ? (w.openai ?? false) : null, workerAt: at, model: process.env.IMPORT_OPENAI_MODEL || null },
    { key: 'dataforseo', name: 'DataForSEO', role: 'תוצאות Google Maps וחיפוש לייבוא', web: 'n/a', worker: w ? w.dataforseo : null, workerAt: at, model: null },
    { key: 'apify', name: 'Apify', role: 'Google Maps, פייסבוק ואינסטגרם לייבוא', web: 'n/a', worker: w ? w.apify : null, workerAt: at, model: null },
    { key: 'youtube', name: 'YouTube Data API', role: 'אימות סרטונים בפרופילים', web: 'n/a', worker: w ? w.youtube : null, workerAt: at, model: null },
  ];
}

export type QueueFilter = 'proposed' | 'decided' | 'all';

export async function approvals(filter: QueueFilter) {
  const where = filter === 'proposed' ? { status: 'proposed' as const } : filter === 'decided' ? { status: { not: 'proposed' as const } } : {};
  const rows = await db.aiAction.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 });
  const ids = [...new Set(rows.map(r => r.decidedById).filter((x): x is string => !!x))];
  const people = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, email: true } }) : [];
  const name = new Map(people.map(p => [p.id, p.fullName ?? p.email ?? '']));
  return rows.map(r => ({ ...r, decidedBy: r.decidedById ? name.get(r.decidedById) ?? null : null }));
}

export interface UsageMonth { label: string; start: Date; providers: Record<string, { calls: number; usd: number }> }

/** Metered provider spend from the ledger (last 6 months) and the assistant's own token use from the audit log. */
export async function usage(): Promise<{ months: UsageMonth[]; assistant: { questions: number; input: number; output: number; proposals: number } }> {
  const from = monthStart(new Date(), -5);
  const [entries, asks] = await Promise.all([
    db.spendEntry.findMany({ where: { createdAt: { gte: from }, status: { in: ['committed', 'needs_reconciliation'] } }, select: { provider: true, createdAt: true, actualMicros: true, estimatedMicros: true } }),
    db.auditLog.findMany({ where: { action: 'ai_assistant_query', createdAt: { gte: monthStart() } }, select: { meta: true } }),
  ]);
  const months: UsageMonth[] = [];
  for (let i = 5; i >= 0; i--) {
    const start = monthStart(new Date(), -i);
    months.push({ start, label: start.toLocaleDateString('he-IL', { month: 'short', year: '2-digit', timeZone: 'Asia/Jerusalem' }), providers: {} });
  }
  for (const e of entries) {
    const m = [...months].reverse().find(x => e.createdAt >= x.start);
    if (!m) continue;
    const p = (m.providers[e.provider] ??= { calls: 0, usd: 0 });
    p.calls++;
    p.usd += Number(e.actualMicros ?? e.estimatedMicros) / 1_000_000;
  }
  const assistant = { questions: asks.length, input: 0, output: 0, proposals: 0 };
  for (const a of asks) {
    const m = (a.meta ?? {}) as { input?: number; output?: number; proposals?: number };
    assistant.input += m.input ?? 0;
    assistant.output += m.output ?? 0;
    assistant.proposals += m.proposals ?? 0;
  }
  return { months, assistant };
}
