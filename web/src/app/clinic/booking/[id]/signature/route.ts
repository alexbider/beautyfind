import { clinicContext } from '@/lib/server/clinic';
import { db } from '@/lib/server/db';
import { storage } from '@/lib/vendors/storage';
import { actorFrom, loadForActor, readerOf } from '../../transitions';

// The signature PNG of a booking's health declaration. Same reader rule as the answers:
// the treating practitioner and the branch's doctor. Everyone else gets a plain 404.

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let ctx;
  try {
    ctx = await clinicContext('bookings');
  } catch {
    return notFound();
  }
  const a = actorFrom(ctx);
  const b = await loadForActor(id, a);
  if (!b || !b.declaration || !readerOf(a, b)) return notFound();

  const file = await db.mediaFile.findUnique({ where: { id: b.declaration.signatureKey } });
  if (!file || !file.isPrivate || file.businessId !== b.branch.businessId) return notFound();
  const body = await storage().get(file.key);
  if (!body) return notFound();

  await db.auditLog.create({
    data: { actorId: a.userId, action: 'read_declaration', subjectType: 'health_declaration', subjectId: b.declaration.id, businessId: a.businessId, meta: { bookingId: b.id, part: 'signature' } },
  });

  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': file.mime,
      'Content-Length': String(body.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
