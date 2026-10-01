'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { areaUserOrNull } from '@/components/ops/guard';
import { decideAiAction } from '@/lib/server/aiActions';
import { askAssistant, assistantConfigured, type AssistantAnswer, type ChatTurn } from '@/lib/server/assistant';
import { db } from '@/lib/server/db';

// Server actions for /ops/ai. Asking the assistant needs view access to the area (it only reads);
// deciding a proposal needs edit access, because approving executes it.

const Ask = z.object({
  question: z.string().trim().min(2).max(4000),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(8000) })).max(20).default([]),
});

export type AskResult = { ok: true; answer: AssistantAnswer } | { ok: false; error: 'forbidden' | 'invalid' | 'not_configured' | 'failed'; detail?: string };

export async function askAssistantAction(input: z.input<typeof Ask>): Promise<AskResult> {
  const user = await areaUserOrNull('ai', 'view');
  if (!user) return { ok: false, error: 'forbidden' };
  const p = Ask.safeParse(input);
  if (!p.success) return { ok: false, error: 'invalid' };
  if (!assistantConfigured()) return { ok: false, error: 'not_configured' };
  const t0 = Date.now();
  try {
    const answer = await askAssistant({ userName: user.fullName ?? user.email ?? 'צוות', question: p.data.question, history: p.data.history as ChatTurn[] });
    await db.auditLog.create({
      data: {
        actorId: user.id, action: 'ai_assistant_query', subjectType: 'user', subjectId: user.id,
        meta: { source: 'assistant', model: answer.model, question: p.data.question.slice(0, 300), tools: answer.tools, input: answer.usage.input, output: answer.usage.output, proposals: answer.proposals.length, refs: answer.proposals.map(x => x.ref), ms: Date.now() - t0 },
      },
    });
    if (answer.proposals.length) { revalidatePath('/ops/ai'); revalidatePath('/ops'); }
    return { ok: true, answer };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await db.auditLog.create({ data: { actorId: user.id, action: 'ai_assistant_query', subjectType: 'user', subjectId: user.id, meta: { source: 'assistant', question: p.data.question.slice(0, 300), error: detail.slice(0, 200), ms: Date.now() - t0 } } }).catch(() => {});
    return { ok: false, error: 'failed', detail: detail.slice(0, 200) };
  }
}

const Decide = z.object({ id: z.string().uuid(), decision: z.enum(['approve', 'reject']), note: z.string().trim().max(300).optional() });

export async function decideAiActionAction(input: z.input<typeof Decide>): Promise<{ ok: true; result: string } | { ok: false; error: string }> {
  const user = await areaUserOrNull('ai', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = Decide.safeParse(input);
  if (!p.success) return { ok: false, error: 'קלט לא תקין' };
  const r = await decideAiAction({ id: user.id, opsRole: user.opsRole ?? null }, p.data.id, p.data.decision, p.data.note ?? null);
  revalidatePath('/ops/ai');
  revalidatePath('/ops');
  if (!r.ok) return { ok: false, error: r.error === 'not_found' ? 'הבקשה לא נמצאה' : r.error === 'already_decided' ? 'כבר הוחלט על הבקשה הזו' : `הביצוע נכשל: ${r.error}` };
  return r;
}
