import { z } from 'zod';
import { db } from '@/lib/server/db';
import { PUBLIC_WHERE } from '@/lib/server/public';

// Profile analytics (ProfileEvent). The client only calls this after the visitor accepted
// analytics cookies (see lib/client/track.ts). No personal data is stored.

const Body = z.object({
  branchId: z.string().uuid(),
  type: z.enum(['view', 'contact_click', 'whatsapp_click', 'call_click', 'waze_click', 'booking_start', 'form_submit']),
  query: z.string().trim().max(80).optional(),
});

function deviceOf(ua: string): 'mobile' | 'tablet' | 'desktop' {
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone/i.test(ua)) return 'mobile';
  return 'desktop';
}

export async function POST(req: Request) {
  // Same-origin only: a cross-site page can't inflate someone's numbers.
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin && host && new URL(origin).host !== host) return new Response(null, { status: 403 });

  let parsed;
  try {
    parsed = Body.safeParse(await req.json());
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!parsed.success) return new Response(null, { status: 400 });
  const { branchId, type, query } = parsed.data;

  const branch = await db.branch.findFirst({ where: { AND: [PUBLIC_WHERE, { id: branchId }] }, select: { id: true } });
  if (!branch) return new Response(null, { status: 404 });

  await db.profileEvent.create({ data: { branchId, type, query: query || null, device: deviceOf(req.headers.get('user-agent') ?? '') } });
  return new Response(null, { status: 204 });
}
