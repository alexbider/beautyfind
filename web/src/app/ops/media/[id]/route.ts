import { verifierOrNull } from '@/components/ops/guard';
import { db } from '@/lib/server/db';
import { storage } from '@/lib/vendors/storage';

// Private documents (license and certificate scans). Only BeautyFind verifiers and ops can
// read them; everyone else, signed in or not, gets the same 404 as a missing file.
const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return notFound();
  if (!(await verifierOrNull())) return notFound();

  const row = await db.mediaFile.findUnique({ where: { id } });
  if (!row || !row.isPrivate) return notFound();
  const body = await storage().get(row.key);
  if (!body) return notFound();

  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': row.mime,
      'Content-Length': String(body.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
