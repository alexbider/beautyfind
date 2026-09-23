import { db } from '@/lib/server/db';
import { storage } from '@/lib/vendors/storage';

// Public uploaded images. Private files are never served here.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 });
  const row = await db.mediaFile.findUnique({ where: { id } });
  if (!row || row.isPrivate) return new Response('Not found', { status: 404 });
  const body = await storage().get(row.key);
  if (!body) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(body), {
    headers: { 'Content-Type': row.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
  });
}
