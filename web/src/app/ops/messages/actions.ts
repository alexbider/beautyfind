'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { areaUserOrNull } from '@/components/ops/guard';
import { db } from '@/lib/server/db';
import { platformSettings, savePlatformSettings } from '@/lib/server/platformSettings';
import { TEMPLATES } from './catalog';

// Draft copy for a template, kept in platform settings until it is submitted to the messaging
// provider (WhatsApp templates need Meta's approval; the code sends by template id, not by text).

const Input = z.object({ id: z.string().max(10), text: z.string().max(2000) });

export async function saveTemplateDraftAction(input: z.input<typeof Input>): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await areaUserOrNull('messages', 'edit');
  if (!user) return { ok: false, error: 'אין הרשאה' };
  const p = Input.safeParse(input);
  if (!p.success || !TEMPLATES.some(t => t.id === p.data.id)) return { ok: false, error: 'תבנית לא מוכרת' };
  const cur = await platformSettings();
  const drafts = { ...cur.templateDrafts };
  if (p.data.text.trim()) drafts[p.data.id] = p.data.text.trim();
  else delete drafts[p.data.id];
  await savePlatformSettings(user.id, { templateDrafts: drafts });
  await db.auditLog.create({ data: { actorId: user.id, action: 'template_draft', subjectType: 'platform_settings', subjectId: user.id, meta: { ref: p.data.id } } });
  revalidatePath('/ops/messages');
  return { ok: true };
}
