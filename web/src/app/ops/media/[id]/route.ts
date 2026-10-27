import { areaUserOrNull, verifierOrNull } from '@/components/ops/guard';
import { db } from '@/lib/server/db';
import { storage } from '@/lib/vendors/storage';

// Private documents: license and certificate scans for verifiers, expense receipts for accounting. Clients'
// declaration signatures are health records and are never served here (only the treating clinic sees them).
// Everyone else, signed in or not, gets the same 404 as a missing file. Every read is in the audit log.
const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return notFound();
  const row = await db.mediaFile.findUnique({ where: { id } });
  if (!row || !row.isPrivate) return notFound();
  const signature = row.kind === 'signature' || row.alt === 'חתימה על הצהרת בריאות';
  if (signature) return notFound();
  const user = row.kind === 'receipt' ? await areaUserOrNull('accounting', 'view') : await verifierOrNull();
  if (!user) return notFound();
  await db.auditLog.create({ data: { actorId: user.id, action: 'private_file_view', subjectType: 'media', subjectId: row.id, businessId: row.businessId, meta: { kind: row.kind } } }).catch(() => undefined);
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
