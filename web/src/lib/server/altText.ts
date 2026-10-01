import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { db } from './db';
import { storage } from '@/lib/vendors/storage';

// Alt text for a listing's images, written by Claude from the image itself (admin only). The result
// is a suggestion that lands in the alt field for the staff member to accept or edit; nothing is saved
// until they save the media section. Short, factual Hebrew: what is in the picture, no praise.

export const ALT_MODEL = process.env.OPS_ALT_MODEL || 'claude-sonnet-5-5';
const MAX_BYTES = 4_500_000; // the API caps an image at 5MB
const MEDIA_RE = /^\/media\/([0-9a-f-]{36})$/;

export interface AltContext { businessName: string; cityName: string; categories: string[]; kind: 'cover' | 'logo' | 'gallery'; tag?: string | null }
export type AltResult = { ok: true; alt: string; usage: { input: number; output: number } } | { ok: false; error: 'not_configured' | 'not_found' | 'too_large' | 'unsupported' | 'failed'; detail?: string };

let client: Anthropic | null = null;
const api = () => (client ??= new Anthropic({ maxRetries: 2, timeout: 60_000 }));

export async function describeImage(url: string, businessId: string, ctx: AltContext): Promise<AltResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: 'not_configured' };
  const m = MEDIA_RE.exec(url);
  if (!m) return { ok: false, error: 'not_found' };
  const row = await db.mediaFile.findUnique({ where: { id: m[1] } });
  if (!row || row.isPrivate || (row.businessId && row.businessId !== businessId)) return { ok: false, error: 'not_found' };
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(row.mime)) return { ok: false, error: 'unsupported' };
  if (row.bytes > MAX_BYTES) return { ok: false, error: 'too_large' };
  const bytes = await storage().get(row.key);
  if (!bytes) return { ok: false, error: 'not_found' };
  const kindText = ctx.kind === 'logo' ? 'לוגו של העסק' : ctx.kind === 'cover' ? 'תמונת השער של הפרופיל' : `תמונה בגלריה${ctx.tag ? ` (תגית: ${ctx.tag})` : ''}`;
  try {
    const res = await api().beta.messages.create({
      model: ALT_MODEL,
      max_tokens: 200,
      system: 'אתה כותב טקסט חלופי (alt) לתמונות בפרופיל של עסק יופי ואסתטיקה בישראל. כתוב בעברית, משפט אחד עד 110 תווים, עובדתי: מה רואים בתמונה (חלל, ציוד, טיפול, אנשים בלי לזהות אותם, לוגו וטקסט שמופיע). בלי שמות תואר שיווקיים, בלי "תמונה של" בתחילת המשפט, בלי נקודה בסוף. אם זה לוגו: "הלוגו של <שם העסק>" ואם יש בו טקסט, צטט אותו. החזר רק את הטקסט.',
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: row.mime as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: bytes.toString('base64') } },
          { type: 'text', text: `העסק: ${ctx.businessName}, ${ctx.cityName}. תחומים: ${ctx.categories.join(', ') || 'לא צוינו'}. סוג התמונה: ${kindText}.` },
        ],
      }],
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join(' ').trim().replace(/^["'“”]+|["'“”.]+$/g, '').slice(0, 200);
    if (!text) return { ok: false, error: 'failed', detail: res.stop_reason ?? 'empty' };
    return { ok: true, alt: text, usage: { input: res.usage.input_tokens, output: res.usage.output_tokens } };
  } catch (e) {
    return { ok: false, error: 'failed', detail: (e instanceof Error ? e.message : String(e)).slice(0, 160) };
  }
}
