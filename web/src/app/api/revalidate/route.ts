import { revalidatePath } from 'next/cache';
import { timingSafeEqual } from 'node:crypto';

// On-demand refresh of the cached public pages (home, regions, treatments), called by the import worker
// after it publishes listings. Needs REVALIDATE_SECRET on Vercel and the same value as a GitHub secret.
// Without it the pages still refresh on their own schedule (a few minutes).

export const dynamic = 'force-dynamic';

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function POST(req: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) return Response.json({ ok: false, error: 'not_configured' }, { status: 503 });
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!given || !same(given, secret)) return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });
  revalidatePath('/', 'layout');
  return Response.json({ ok: true, at: new Date().toISOString() });
}
