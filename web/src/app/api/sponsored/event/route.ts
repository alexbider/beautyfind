import { z } from 'zod';
import { hit } from '@/lib/server/rateLimit';
import { recordSponsoredStats } from '@/lib/server/sponsored';

// Sponsored slider counters (src/components/sponsored/SponsoredSlider.tsx): on-screen views and clicks to
// the profile, as anonymous daily totals per placement. Nothing about the visitor is stored. Same origin
// only, bots ignored, and a per-address limit so nobody can inflate a competitor's numbers (or their own).

const Body = z.object({
  type: z.enum(['impression', 'click']),
  ids: z.array(z.string().uuid()).min(1).max(20),
});

const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|whatsapp/i;

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin && host && new URL(origin).host !== host) return new Response(null, { status: 403 });
  if (BOT.test(req.headers.get('user-agent') ?? '')) return new Response(null, { status: 204 });

  let parsed;
  try {
    parsed = Body.safeParse(await req.json());
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!parsed.success) return new Response(null, { status: 400 });

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const limit = parsed.data.type === 'click' ? { max: 30, windowS: 3600 } : { max: 120, windowS: 3600 };
  if (!(await hit(`sp-${parsed.data.type}:${ip}`, limit)).ok) return new Response(null, { status: 204 });

  await recordSponsoredStats(parsed.data.ids, parsed.data.type);
  return new Response(null, { status: 204 });
}
