import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { db } from './db';
import { businessLabel, proposeAiAction } from './aiActions';
import { monthStart, monthlyPlatformIncome, mrr } from './opsStats';
import { platformSettings } from './platformSettings';
import { PLATFORM_BILLING_LINE } from '@/lib/pricing';

// The operations assistant on /ops/ai: Claude with read-only tools over the platform's own tables
// (businesses, billing, disputes, queues) and one write tool that only files a proposal in the
// approvals queue. It never sees client health data (no tool exposes it) and never changes a row.
// Every question is one audit row with the tokens used, so the usage tab is measured, not guessed.

export const ASSISTANT_MODEL = process.env.OPS_ASSISTANT_MODEL || 'claude-opus-5-5';
export const assistantConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

export interface ChatTurn { role: 'user' | 'assistant'; text: string }
export interface Proposal { ref: string; action: string; label: string | null }
export interface AssistantAnswer {
  text: string;
  proposals: Proposal[];
  tools: string[];
  usage: { input: number; output: number };
  model: string;
}

const SYSTEM = `אתה עוזר התפעול של BeautyFind, מדריך יופי ואסתטיקה ישראלי. המשתמש/ת הוא איש צוות של הפלטפורמה.
כללים:
- ענה בעברית, קצר וענייני. מספרים רק מתוך הכלים; אם כלי לא החזיר נתון, אמור שאין נתון. אל תמציא.
- אתה קורא בלבד. כל פעולת כתיבה (הסתרת עסק, החזרה לאוויר, הערה) מוגשת דרך propose_action ונכנסת לתור אישורים שאדם מחליט עליו. אל תטען שביצעת פעולה; אמור שהצעת אותה ומספר הבקשה.
- אין לך גישה לפרטי בריאות של לקוחות ולא תבקש אותם.
- עובדות חיוב: הפלטפורמה מחייבת דרך ${PLATFORM_BILLING_LINE}; על חיובי הפלטפורמה (מנויים ומקומות ממומנים) אין מע״מ ישראלי. מע״מ של 18% מופיע רק במסמכים שקליניקות מפיקות ללקוחותיהן.
- כשמבקשים "מה דורש טיפול", השתמש ב-platform_summary והצג את התורים הלא ריקים עם קישור לעמוד המתאים (/ops/...).`;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  { name: 'platform_summary', description: 'מצב הפלטפורמה עכשיו: עסקים לפי מצב, MRR, תורים שמחכים לאדם (חיובים שנכשלו, מחלוקות, ממומנים, פרטיות, אימות, ביקורות, ייבוא, בקשות AI).', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'search_businesses', description: 'חיפוש עסקים לפי שם, מצב או חוב. מחזיר מזהה, שם, מצב, תוכנית, סניפים, אזורים, מצב מנוי וחיוב חודשי.', input_schema: { type: 'object', properties: { query: { type: 'string', description: 'חלק מהשם' }, status: { type: 'string', enum: ['pending', 'live', 'past_due', 'hidden'] }, in_debt: { type: 'boolean', description: 'רק עסקים עם מנוי בחוב' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false } },
  { name: 'billing_overview', description: 'הכנסות הפלטפורמה לפי חודש (מנויים ומקומות ממומנים, באגורות ברוטו), המדיניות על מע״מ, ורשימת המנויים בחוב.', input_schema: { type: 'object', properties: { months: { type: 'integer', minimum: 1, maximum: 24 } }, additionalProperties: false } },
  { name: 'list_disputes', description: 'מחלוקות מקדמה ושובר: טענה, עובדות המערכת, מדיניות שהוצגה, המלצה ומצב.', input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'recommended_refund', 'closed_policy_upheld', 'escalated_legal'] }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false } },
  { name: 'approvals_queue', description: 'בקשות AI שמחכות לאישור אדם.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'propose_action', description: 'מגיש הצעה לפעולת כתיבה לתור האישורים. לא מבצע כלום בעצמו. hide_business מסיר עסק מהמדריך; restore_business מחזיר אותו; note רושם הערה בתיק העסק.', input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['hide_business', 'restore_business', 'note'] }, business_id: { type: 'string', description: 'מזהה העסק מתוך search_businesses' }, reason: { type: 'string', description: 'הנימוק שיוצג לאדם המאשר' } }, required: ['action', 'business_id', 'reason'], additionalProperties: false } },
];

const SearchIn = z.object({ query: z.string().max(120).optional(), status: z.enum(['pending', 'live', 'past_due', 'hidden']).optional(), in_debt: z.boolean().optional(), limit: z.number().int().min(1).max(50).optional() });
const BillingIn = z.object({ months: z.number().int().min(1).max(24).optional() });
const DisputesIn = z.object({ status: z.enum(['open', 'recommended_refund', 'closed_policy_upheld', 'escalated_legal']).optional(), limit: z.number().int().min(1).max(50).optional() });
const ProposeIn = z.object({ action: z.enum(['hide_business', 'restore_business', 'note']), business_id: z.string().uuid(), reason: z.string().min(3).max(1000) });

async function runTool(name: string, input: unknown, proposals: Proposal[]): Promise<unknown> {
  const safe = (p: Promise<number>) => p.catch(() => null);
  switch (name) {
    case 'platform_summary': {
      const [byStatus, m, bookings, pastDue, disputes, sponsored, ai, verification, reviews, importReview, privacyReq, privacyDone, privacyMsgs] = await Promise.all([
        db.business.groupBy({ by: ['status'], _count: true }),
        mrr(),
        safe(db.booking.count({ where: { createdAt: { gte: monthStart() } } })),
        safe(db.subscription.count({ where: { status: 'past_due' } })),
        safe(db.dispute.count({ where: { status: 'open' } })),
        safe(db.campaign.count({ where: { status: 'pending_review' } })),
        safe(db.aiAction.count({ where: { status: 'proposed' } })),
        safe(db.verificationRequest.count({ where: { status: { in: ['open', 'awaiting_document'] } } })),
        safe(db.review.count({ where: { status: 'submitted' } })),
        safe(db.importPlace.count({ where: { status: { in: ['ready', 'needs_review'] } } })),
        safe(db.decision.count({ where: { subjectType: 'user', action: 'delete_request' } })),
        safe(db.decision.count({ where: { subjectType: 'user', action: { in: ['delete_done', 'delete_rejected'] } } })),
        safe(db.contactMessage.count({ where: { reason: { in: ['access', 'correction'] }, status: { not: 'closed' } } })),
      ]);
      return {
        businesses_by_status: Object.fromEntries(byStatus.map(r => [r.status, r._count])),
        mrr_nis: m.totalNis, paying_businesses: m.businesses, paying_branches: m.branches,
        bookings_created_this_month: bookings,
        queues: {
          failed_charges: { count: pastDue, href: '/ops/accounting?tab=subscriptions&filter=past_due' },
          open_disputes: { count: disputes, href: '/ops/disputes' },
          sponsored_to_review: { count: sponsored, href: '/ops/sponsored' },
          ai_proposals: { count: ai, href: '/ops/ai?tab=queue' },
          privacy_requests: { count: Math.max(0, (privacyReq ?? 0) - (privacyDone ?? 0)) + (privacyMsgs ?? 0), href: '/ops/clients?tab=privacy' },
          verification: { count: verification, href: '/ops/verification' },
          reviews_to_publish: { count: reviews, href: '/ops/moderation' },
          import_review: { count: importReview, href: '/ops/import/review' },
        },
      };
    }
    case 'search_businesses': {
      const p = SearchIn.parse(input ?? {});
      const s = await platformSettings();
      const rows = await db.business.findMany({
        where: {
          ...(p.query ? { OR: [{ legalName: { contains: p.query, mode: 'insensitive' } }, { branches: { some: { name: { contains: p.query, mode: 'insensitive' } } } }] } : {}),
          ...(p.status ? { status: p.status } : {}),
          ...(p.in_debt ? { subscription: { status: 'past_due' } } : {}),
        },
        take: p.limit ?? 20, orderBy: { updatedAt: 'desc' },
        select: { id: true, legalName: true, status: true, createdAt: true, subscription: { select: { plan: true, status: true, pricePerBranchAgorot: true } }, branches: { select: { name: true, regionSlug: true, status: true }, orderBy: { createdAt: 'asc' } } },
      });
      return rows.map(b => {
        const live = b.branches.filter(x => x.status === 'live').length;
        const unit = b.subscription ? (b.subscription.plan === 'advanced' ? s.advancedMonthlyNis : s.basicMonthlyNis) : 0;
        return { id: b.id, name: b.branches[0]?.name ?? b.legalName ?? 'עסק ללא שם', status: b.status, plan: b.subscription?.plan ?? null, subscription_status: b.subscription?.status ?? null, live_branches: live, regions: [...new Set(b.branches.map(x => x.regionSlug))], monthly_charge_nis_approx: unit * live, since: b.createdAt.toISOString().slice(0, 10), admin_href: `/ops/businesses/${b.id}` };
      });
    }
    case 'billing_overview': {
      const p = BillingIn.parse(input ?? {});
      const [income, debt] = await Promise.all([
        monthlyPlatformIncome(p.months ?? 6),
        db.subscription.findMany({ where: { status: 'past_due' }, select: { updatedAt: true, plan: true, business: { select: { id: true, legalName: true, branches: { select: { name: true }, orderBy: { createdAt: 'asc' }, take: 1 } } } }, take: 50 }),
      ]);
      return {
        vat_policy: `חיובי הפלטפורמה דרך ${PLATFORM_BILLING_LINE}: ללא מע״מ ישראלי. מע״מ 18% חל רק על מסמכים שקליניקות מפיקות ללקוחותיהן.`,
        months: income.map(m => ({ month: m.label, gross_agorot: m.agorot, subscriptions_agorot: m.subscriptions, sponsored_agorot: m.sponsored })),
        in_debt: debt.map(d => ({ business_id: d.business.id, business: d.business.branches[0]?.name ?? d.business.legalName ?? 'עסק ללא שם', plan: d.plan, since: d.updatedAt.toISOString().slice(0, 10), admin_href: `/ops/businesses/${d.business.id}` })),
      };
    }
    case 'list_disputes': {
      const p = DisputesIn.parse(input ?? {});
      const rows = await db.dispute.findMany({ where: p.status ? { status: p.status } : {}, take: p.limit ?? 20, orderBy: { createdAt: 'desc' }, select: { ref: true, kind: true, status: true, amountAgorot: true, claim: true, systemFacts: true, policyShown: true, recommendation: true, createdAt: true, businessId: true } });
      const biz = await db.business.findMany({ where: { id: { in: [...new Set(rows.map(d => d.businessId))] } }, select: { id: true, legalName: true, branches: { select: { name: true }, orderBy: { createdAt: 'asc' }, take: 1 } } });
      const bizName = new Map(biz.map(b => [b.id, b.branches[0]?.name ?? b.legalName ?? 'עסק ללא שם']));
      return rows.map(d => ({ ref: d.ref, kind: d.kind, status: d.status, business: bizName.get(d.businessId) ?? null, amount_agorot: d.amountAgorot, claim: d.claim, system_facts: d.systemFacts, policy_shown: d.policyShown, recommendation: d.recommendation, opened: d.createdAt.toISOString().slice(0, 10), admin_href: '/ops/disputes' }));
    }
    case 'approvals_queue': {
      const rows = await db.aiAction.findMany({ where: { status: 'proposed' }, orderBy: { createdAt: 'desc' }, take: 30, select: { ref: true, action: true, subjectLabel: true, reason: true, source: true, createdAt: true } });
      return rows.map(r => ({ ref: r.ref, action: r.action, business: r.subjectLabel, reason: r.reason, source: r.source, proposed: r.createdAt.toISOString() }));
    }
    case 'propose_action': {
      const p = ProposeIn.parse(input);
      const r = await proposeAiAction({ source: 'assistant', action: p.action, businessId: p.business_id, reason: p.reason });
      if (!r.ok) return { error: r.error };
      proposals.push({ ref: r.ref, action: p.action, label: await businessLabel(p.business_id) });
      return { ok: true, ref: r.ref, status: 'proposed', note: 'ממתין לאישור אדם בתור האישורים (/ops/ai?tab=queue)' };
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}

let client: Anthropic | null = null;
const api = () => (client ??= new Anthropic({ maxRetries: 2, timeout: 90_000 }));

/** One question in a short conversation. `history` is the prior turns the browser kept (text only). */
export async function askAssistant(opts: { userName: string; question: string; history: ChatTurn[] }): Promise<AssistantAnswer> {
  const proposals: Proposal[] = [];
  const tools: string[] = [];
  const usage = { input: 0, output: 0 };
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...opts.history.slice(-10).filter(t => t.text.trim()).map(t => ({ role: t.role, content: t.text.slice(0, 4000) })),
    { role: 'user', content: opts.question.slice(0, 4000) },
  ];
  let model = ASSISTANT_MODEL;
  for (let round = 0; round < 8; round++) {
    const res = await api().beta.messages.create({
      model: ASSISTANT_MODEL,
      max_tokens: 4000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: `${SYSTEM}\nשם המשתמש/ת: ${opts.userName}. התאריך: ${new Date().toISOString().slice(0, 10)}.`, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      messages,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    model = res.model || model;
    usage.input += res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
    usage.output += res.usage.output_tokens;
    const toolUses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !toolUses.length) {
      const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('\n').trim();
      if (res.stop_reason === 'refusal') return { text: 'העוזר סירב לענות על השאלה הזו.', proposals, tools, usage, model };
      return { text: text || (res.stop_reason === 'max_tokens' ? 'התשובה נקטעה. נסו שאלה ממוקדת יותר.' : 'אין תשובה.'), proposals, tools, usage, model };
    }
    messages.push({ role: 'assistant', content: res.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const t of toolUses) {
      tools.push(t.name);
      let out: unknown;
      try {
        out = await runTool(t.name, t.input, proposals);
      } catch (e) {
        out = { error: e instanceof Error ? e.message : String(e) };
      }
      results.push({ type: 'tool_result', tool_use_id: t.id, content: JSON.stringify(out).slice(0, 60_000) });
    }
    messages.push({ role: 'user', content: results });
  }
  return { text: 'העוזר לא סיים בתוך מכסת הסבבים. נסו שאלה ממוקדת יותר.', proposals, tools, usage, model };
}
